import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCallHandler } from '../src/ocpp/handlers';
import { ConfigurationStore } from '../src/simulator/configuration';
import { LocalAuthList } from '../src/simulator/local-list';
import { makeRig } from './helpers';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const statuses = (t: { calls: Array<{ action: string; payload: any }> }) =>
  t.calls.filter((c) => c.action === 'StatusNotification').map((c) => c.payload.status);

describe('configuracao OCPP', () => {
  it('GetConfiguration lista chaves e informa desconhecidas', async () => {
    const { cp } = await makeRig();
    const handle = createCallHandler(cp);
    const r: any = await handle('GetConfiguration', { key: ['HeartbeatInterval', 'Nope'] });
    expect(r.configurationKey).toEqual([
      { key: 'HeartbeatInterval', readonly: false, value: '300' },
    ]);
    expect(r.unknownKey).toEqual(['Nope']);
  });

  it('ChangeConfiguration: Accepted, Rejected (readonly/invalido) e NotSupported', () => {
    const c = new ConfigurationStore({
      heartbeatIntervalSeconds: 60,
      meterIntervalSeconds: 10,
      connectors: 1,
    });
    expect(c.change('MeterValueSampleInterval', '30')).toBe('Accepted');
    expect(c.get('MeterValueSampleInterval')).toBe('30');
    expect(c.change('NumberOfConnectors', '4')).toBe('Rejected');
    expect(c.change('HeartbeatInterval', 'abc')).toBe('Rejected');
    expect(c.change('MeterValuesSampledData', 'Foo')).toBe('Rejected');
    expect(c.change('Inexistente', '1')).toBe('NotSupported');
  });

  it('MeterValuesSampledData define os measurands enviados', async () => {
    const { cp, transport } = await makeRig();
    const handle = createCallHandler(cp);
    await handle('ChangeConfiguration', {
      key: 'MeterValuesSampledData',
      value: 'Voltage,Temperature',
    });
    await cp.startLocalSession();
    await vi.advanceTimersByTimeAsync(10_000);
    await cp.settled();
    const mv = transport.last('MeterValues')!.payload;
    expect(mv.meterValue[0].sampledValue.map((v: any) => v.measurand)).toEqual([
      'Voltage',
      'Temperature',
    ]);
  });
});

describe('disponibilidade', () => {
  it('Inoperative em repouso -> Unavailable; Operative volta a Available', async () => {
    const { cp, transport } = await makeRig();
    const handle = createCallHandler(cp);
    expect(await handle('ChangeAvailability', { connectorId: 1, type: 'Inoperative' })).toEqual({
      status: 'Accepted',
    });
    expect(cp.connector.status).toBe('Unavailable');
    await handle('ChangeAvailability', { connectorId: 1, type: 'Operative' });
    expect(cp.connector.status).toBe('Available');
    await cp.settled();
    expect(statuses(transport).slice(-2)).toEqual(['Unavailable', 'Available']);
  });

  it('Inoperative durante transacao fica Scheduled e aplica ao terminar', async () => {
    const { cp } = await makeRig();
    const handle = createCallHandler(cp);
    await cp.startLocalSession();
    expect(await handle('ChangeAvailability', { connectorId: 1, type: 'Inoperative' })).toEqual({
      status: 'Scheduled',
    });
    expect(cp.connector.status).toBe('Charging');
    await cp.stopTransaction('Local');
    expect(cp.connector.status).toBe('Unavailable');
  });
});

describe('reservas', () => {
  it('ReserveNow -> Reserved; so o idTag reservado inicia e consome a reserva', async () => {
    const { cp, transport, clock } = await makeRig();
    const handle = createCallHandler(cp);
    const expiry = new Date(clock.now + 600_000).toISOString();
    expect(
      await handle('ReserveNow', { connectorId: 1, expiryDate: expiry, idTag: 'VIP', reservationId: 7 }),
    ).toEqual({ status: 'Accepted' });
    expect(cp.connector.status).toBe('Reserved');
    expect(await cp.startLocalSession('OUTRO')).toBe(false);
    expect(await cp.startLocalSession('VIP')).toBe(true);
    expect(transport.last('StartTransaction')!.payload.reservationId).toBe(7);
    expect(cp.reservation).toBeNull();
  });

  it('CancelReservation e expiracao devolvem Available', async () => {
    const { cp, clock } = await makeRig();
    const handle = createCallHandler(cp);
    const expiry = new Date(clock.now + 5_000).toISOString();
    await handle('ReserveNow', { connectorId: 1, expiryDate: expiry, idTag: 'A', reservationId: 1 });
    clock.now += 6_000;
    await vi.advanceTimersByTimeAsync(6_000);
    expect(cp.connector.status).toBe('Available');
    await handle('ReserveNow', {
      connectorId: 1,
      expiryDate: new Date(clock.now + 60_000).toISOString(),
      idTag: 'A',
      reservationId: 2,
    });
    expect(await handle('CancelReservation', { reservationId: 2 })).toEqual({ status: 'Accepted' });
    expect(cp.connector.status).toBe('Available');
  });
});

describe('smart charging', () => {
  const profile = (limit: number, extra: object = {}, start = Date.UTC(2026, 9, 6, 21, 29, 0)) => ({
    chargingProfileId: 1,
    stackLevel: 0,
    chargingProfilePurpose: 'TxDefaultProfile',
    chargingProfileKind: 'Absolute',
    chargingSchedule: {
      startSchedule: new Date(start).toISOString(),
      chargingRateUnit: 'W',
      chargingSchedulePeriod: [{ startPeriod: 0, limit }],
    },
    ...extra,
  });

  it('SetChargingProfile limita a potencia e ClearChargingProfile restaura', async () => {
    const { cp } = await makeRig();
    const handle = createCallHandler(cp);
    await cp.startLocalSession();
    const full = cp.connector.transaction!.powerKw;
    expect(
      await handle('SetChargingProfile', { connectorId: 1, csChargingProfiles: profile(7000) }),
    ).toEqual({ status: 'Accepted' });
    expect(cp.connector.transaction!.powerKw).toBeCloseTo(7);
    expect(await handle('ClearChargingProfile', { id: 1 })).toEqual({ status: 'Accepted' });
    expect(cp.connector.transaction!.powerKw).toBe(full);
    expect(await handle('ClearChargingProfile', { id: 1 })).toEqual({ status: 'Unknown' });
  });

  it('rejeita TxProfile sem transacao e perfil invalido', async () => {
    const { cp } = await makeRig();
    const handle = createCallHandler(cp);
    expect(
      await handle('SetChargingProfile', {
        connectorId: 1,
        csChargingProfiles: profile(7000, { chargingProfilePurpose: 'TxProfile' }),
      }),
    ).toEqual({ status: 'Rejected' });
    expect(
      await handle('SetChargingProfile', {
        connectorId: 1,
        csChargingProfiles: { ...profile(7000), stackLevel: 99 },
      }),
    ).toEqual({ status: 'Rejected' });
  });

  it('GetCompositeSchedule reflete o limite', async () => {
    const { cp } = await makeRig();
    const handle = createCallHandler(cp);
    await handle('SetChargingProfile', {
      connectorId: 0,
      csChargingProfiles: profile(11000, { chargingProfilePurpose: 'ChargePointMaxProfile' }),
    });
    const r: any = await handle('GetCompositeSchedule', { connectorId: 1, duration: 600 });
    expect(r.chargingSchedule.chargingSchedulePeriod[0]).toEqual({ startPeriod: 0, limit: 11000 });
  });
});

describe('lista local, trigger, falhas', () => {
  it('SendLocalList Full/Differential e versao', () => {
    const l = new LocalAuthList();
    expect(l.apply(1, 'Full', [{ idTag: 'A', idTagInfo: { status: 'Accepted' } }])).toBe('Accepted');
    expect(l.accepts('A', Date.now())).toBe(true);
    expect(l.apply(1, 'Differential', [])).toBe('VersionMismatch');
    expect(l.apply(2, 'Differential', [{ idTag: 'A' }])).toBe('Accepted');
    expect(l.accepts('A', Date.now())).toBe(false);
  });

  it('LocalPreAuthorize dispensa Authorize para idTag da lista', async () => {
    const { cp, transport } = await makeRig();
    const handle = createCallHandler(cp);
    await handle('SendLocalList', {
      listVersion: 1,
      updateType: 'Full',
      localAuthorizationList: [{ idTag: 'LOC', idTagInfo: { status: 'Accepted' } }],
    });
    await handle('ChangeConfiguration', { key: 'LocalPreAuthorize', value: 'true' });
    transport.calls.length = 0;
    expect(await cp.startLocalSession('LOC')).toBe(true);
    expect(transport.actions()).not.toContain('Authorize');
  });

  it('TriggerMessage envia a mensagem pedida', async () => {
    const { cp, transport } = await makeRig();
    const handle = createCallHandler(cp);
    transport.calls.length = 0;
    expect(await handle('TriggerMessage', { requestedMessage: 'Heartbeat' })).toEqual({
      status: 'Accepted',
    });
    expect(await handle('TriggerMessage', { requestedMessage: 'Foo' })).toEqual({
      status: 'NotImplemented',
    });
    await vi.advanceTimersByTimeAsync(100);
    await cp.settled();
    expect(transport.actions()).toEqual(['Heartbeat']);
  });

  it('falha injetada encerra a transacao e vai a Faulted; NoError limpa', async () => {
    const { cp, transport } = await makeRig();
    await cp.startLocalSession();
    await cp.setFault({ errorCode: 'GroundFailure', faulted: true });
    expect(cp.connector.status).toBe('Faulted');
    expect(transport.last('StopTransaction')!.payload.reason).toBe('Other');
    await cp.settled();
    expect(transport.last('StatusNotification')!.payload).toMatchObject({
      status: 'Faulted',
      errorCode: 'GroundFailure',
    });
    await cp.setFault({ errorCode: 'NoError' });
    expect(cp.connector.status).toBe('Available');
  });

  it('pausa EV/EVSE e retoma', async () => {
    const { cp } = await makeRig();
    await cp.startLocalSession();
    expect(cp.suspend('EV')).toBe(true);
    expect(cp.connector.status).toBe('SuspendedEV');
    expect(cp.resume()).toBe(true);
    expect(cp.connector.status).toBe('Charging');
  });
});
