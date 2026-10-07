import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCallHandler } from '../src/ocpp/handlers';
import { OcppCallError } from '../src/ocpp/messages';
import { makeRig } from './helpers';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('boot e heartbeat', () => {
  it('Boot aceito -> StatusNotification Available -> Heartbeat sem timers duplicados', async () => {
    const { cp, transport } = await makeRig();
    expect(transport.actions().slice(0, 3)).toEqual([
      'BootNotification',
      'StatusNotification',
      'StatusNotification',
    ]);
    expect(transport.last('BootNotification')!.payload).toMatchObject({
      chargePointVendor: 'Inovative',
      chargePointModel: 'EV-Simulator',
    });
    expect(transport.last('StatusNotification')!.payload).toMatchObject({
      connectorId: 1,
      errorCode: 'NoError',
      status: 'Available',
    });

    // reconexoes repetidas nao multiplicam heartbeats (interval do Boot = 300s)
    cp.onDisconnected();
    cp.onConnected();
    await cp.settled();
    cp.onDisconnected();
    cp.onConnected();
    await cp.settled();
    transport.calls.length = 0;
    await vi.advanceTimersByTimeAsync(300_000);
    await cp.settled();
    expect(transport.actions().filter((a) => a === 'Heartbeat')).toHaveLength(1);
  });

  it('Boot rejeitado nao registra e tenta de novo apos o interval', async () => {
    const { cp, transport } = await makeRig({ heartbeatIntervalSeconds: 60 });
    cp.onDisconnected();
    transport.bootStatus = 'Rejected';
    transport.bootInterval = 20;
    transport.calls.length = 0;
    cp.onConnected();
    await cp.settled();
    expect(cp.registered).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    await cp.settled();
    expect(transport.actions().filter((a) => a === 'BootNotification')).toHaveLength(2);
    expect(transport.actions()).not.toContain('Heartbeat');
  });

  it('AUTO_START_TRANSACTION inicia a sessao apos o atraso', async () => {
    const { cp, transport } = await makeRig({
      autoStartTransaction: true,
      autoStartDelaySeconds: 5,
    });
    expect(transport.actions()).not.toContain('Authorize');
    await vi.advanceTimersByTimeAsync(5000);
    await cp.settled();
    expect(cp.connector.status).toBe('Charging');
  });
});

describe('sessao local', () => {
  it('Authorize -> StartTransaction -> Charging guardando o transactionId do CSMS', async () => {
    const { cp, transport } = await makeRig();
    transport.nextTransactionId = 987;
    expect(await cp.startLocalSession()).toBe(true);
    expect(cp.connector.status).toBe('Charging');
    expect(cp.connector.transaction!.transactionId).toBe(987);
    const names = transport.actions();
    expect(names.indexOf('Authorize')).toBeLessThan(names.indexOf('StartTransaction'));
    expect(transport.last('StartTransaction')!.payload).toMatchObject({
      connectorId: 1,
      idTag: 'SIMULATOR001',
      meterStart: 0,
    });
    const statuses = transport.calls
      .filter((c) => c.action === 'StatusNotification')
      .map((c) => c.payload.status);
    expect(statuses.slice(-2)).toEqual(['Preparing', 'Charging']);
  });

  it('nao inicia carga se Authorize for recusado', async () => {
    const { cp, transport } = await makeRig();
    transport.authStatus = 'Invalid';
    expect(await cp.startLocalSession()).toBe(false);
    expect(transport.actions()).not.toContain('StartTransaction');
    expect(cp.connector.status).toBe('Available');
  });

  it('nao cria transacoes simultaneas', async () => {
    const { cp, transport } = await makeRig();
    const [a, b] = await Promise.all([cp.startLocalSession(), cp.startLocalSession()]);
    expect([a, b].sort()).toEqual([false, true]);
    expect(transport.actions().filter((x) => x === 'StartTransaction')).toHaveLength(1);
  });

  it('energia/SOC seguem o tempo real e MeterValues e monotonico', async () => {
    const { cp, transport, advance } = await makeRig();
    await cp.startLocalSession();
    const energies: number[] = [];
    for (let i = 0; i < 3; i++) {
      advance(10_000);
      await cp.sendMeterValues();
      const sv = transport.last('MeterValues')!.payload.meterValue[0].sampledValue;
      energies.push(Number(sv.find((s: any) => s.measurand === 'Energy.Active.Import.Register').value));
      expect(transport.last('MeterValues')!.payload.transactionId).toBe(4242);
    }
    // 22 kW x 10 s = 61.11 Wh... = 22000 W * 10/3600 h
    expect(energies[0]).toBe(Math.round((22000 * 10) / 3600));
    expect(energies[1]).toBeGreaterThan(energies[0]);
    expect(energies[2]).toBeGreaterThan(energies[1]);
    const expectedSoc = 30 + ((22 * 30) / 3600 / 60) * 100;
    expect(cp.vehicle.socPercent).toBeCloseTo(expectedSoc, 6);
  });

  it('para ao atingir o SOC alvo: Finishing -> StopTransaction -> Available', async () => {
    const { cp, transport, advance } = await makeRig();
    await cp.startLocalSession();
    advance(2 * 3_600_000); // mais que o suficiente para 36 kWh a 22 kW
    cp.tick();
    await cp.settled();
    expect(cp.vehicle.socPercent).toBeCloseTo(90, 6);
    const stop = transport.last('StopTransaction')!.payload;
    expect(stop).toMatchObject({ transactionId: 4242, reason: 'Local', idTag: 'SIMULATOR001' });
    expect(stop.meterStop).toBe(36_000);
    expect(cp.connector.status).toBe('Available');
    const statuses = transport.calls
      .filter((c) => c.action === 'StatusNotification')
      .map((c) => c.payload.status);
    expect(statuses.slice(-2)).toEqual(['Finishing', 'Available']);
  });

  it('meterStart da proxima sessao continua do registrador acumulativo', async () => {
    const { cp, transport, advance } = await makeRig();
    await cp.startLocalSession();
    advance(2 * 3_600_000);
    cp.tick();
    await cp.settled();
    await cp.startLocalSession();
    expect(transport.last('StartTransaction')!.payload.meterStart).toBe(36_000);
  });
});

describe('comandos remotos', () => {
  it('RemoteStartTransaction aceita, inicia carga e rejeita segunda', async () => {
    const { cp, transport } = await makeRig();
    expect(cp.remoteStart({ idTag: 'REMOTE1' })).toEqual({ status: 'Accepted' });
    expect(cp.remoteStart({ idTag: 'REMOTE2' })).toEqual({ status: 'Rejected' });
    await cp.settled();
    expect(cp.connector.status).toBe('Charging');
    expect(transport.last('StartTransaction')!.payload.idTag).toBe('REMOTE1');
    expect(cp.remoteStart({ idTag: 'REMOTE3' })).toEqual({ status: 'Rejected' });
  });

  it('RemoteStartTransaction rejeita conector errado e idTag invalido', async () => {
    const { cp } = await makeRig();
    expect(cp.remoteStart({ idTag: 'A', connectorId: 2 })).toEqual({ status: 'Rejected' });
    expect(() => cp.remoteStart({} as any)).toThrow(OcppCallError);
  });

  it('RemoteStopTransaction compara transactionId', async () => {
    const { cp, transport } = await makeRig();
    await cp.startLocalSession();
    expect(cp.remoteStop({ transactionId: 1 })).toEqual({ status: 'Rejected' });
    expect(cp.connector.status).toBe('Charging');
    expect(cp.remoteStop({ transactionId: 4242 })).toEqual({ status: 'Accepted' });
    await cp.settled();
    expect(transport.last('StopTransaction')!.payload).toMatchObject({
      transactionId: 4242,
      reason: 'Remote',
    });
    expect(cp.connector.status).toBe('Available');
    expect(cp.remoteStop({ transactionId: 4242 })).toEqual({ status: 'Rejected' });
  });

  it('Reset Soft encerra a transacao, nao reconecta e refaz o Boot', async () => {
    const { cp, transport } = await makeRig();
    await cp.startLocalSession();
    transport.calls.length = 0;
    expect(cp.reset({ type: 'Soft' })).toEqual({ status: 'Accepted' });
    await cp.settled();
    expect(transport.last('StopTransaction')!.payload.reason).toBe('SoftReset');
    expect(transport.actions()).toContain('BootNotification');
    expect(transport.reconnects).toBe(0);
    expect(cp.connector.status).toBe('Available');
    expect(cp.connector.transaction).toBeNull();
  });

  it('Reset Hard encerra a transacao e pede reconexao (sem reiniciar container)', async () => {
    const { cp, transport } = await makeRig();
    await cp.startLocalSession();
    cp.reset({ type: 'Hard' });
    await cp.settled();
    expect(transport.last('StopTransaction')!.payload.reason).toBe('HardReset');
    expect(transport.reconnects).toBe(1);
    expect(cp.registered).toBe(false);
  });

  it('Reset com tipo invalido e rejeitado', async () => {
    const { cp } = await makeRig();
    expect(cp.reset({ type: 'Foo' } as any)).toEqual({ status: 'Rejected' });
  });
});

describe('roteador de CALLs', () => {
  it('encaminha comandos e responde NotImplemented para o resto', async () => {
    const { cp } = await makeRig();
    const handle = createCallHandler(cp);
    await expect(handle('RemoteStartTransaction', { idTag: 'T' })).resolves.toEqual({
      status: 'Accepted',
    });
    await expect(handle('GetConfiguration', {})).rejects.toMatchObject({ code: 'NotImplemented' });
    await cp.settled();
  });
});

describe('offline', () => {
  it('StopTransaction ocorrido offline e reenviado apos novo Boot', async () => {
    const { cp, transport, advance } = await makeRig();
    await cp.startLocalSession();
    advance(60_000);
    transport.connected = false;
    cp.onDisconnected();
    await cp.stopTransaction('Local');
    expect(cp.connector.status).toBe('Available');
    transport.connected = true;
    transport.calls.length = 0;
    cp.onConnected();
    await cp.settled();
    expect(transport.last('StopTransaction')!.payload.transactionId).toBe(4242);
  });
});
