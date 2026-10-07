import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Logger } from '../src/utils/logger';
import { createWebServer } from '../src/web/server';
import { makeRig } from './helpers';

let close: (() => void) | null = null;
afterEach(() => close?.());

async function boot() {
  const rig = await makeRig();
  const logger = new Logger('SIM-001', 'error');
  const server = createWebServer({
    port: 0, host: '127.0.0.1', chargePoint: rig.cp, logger, csmsUrl: 'ws://x/ocpp/SIM-001',
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  close = () => server.close();
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown = {}, headers: Record<string, string> = { 'x-simulator': '1' }) =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { ...rig, base, post };
}

describe('interface web', () => {
  it('serve a pagina e o estado', async () => {
    const { base } = await boot();
    expect(await (await fetch(base + '/')).text()).toContain('Simulador EV');
    const s = await (await fetch(base + '/api/state')).json();
    expect(s).toMatchObject({ chargePointId: 'SIM-001', status: 'Available', registered: true, connected: true });
  });

  it('inicia, mostra a carga, ajusta potencia e para', async () => {
    const { base, post, cp, transport, advance } = await boot();
    expect((await post('/api/start', { idTag: 'WEB1' })).status).toBe(200);
    expect(transport.last('Authorize')!.payload.idTag).toBe('WEB1');
    expect((await post('/api/start')).status).toBe(409); // ja ha transacao

    advance(60_000);
    expect((await post('/api/settings', { maxPowerKw: 11 })).status).toBe(200);
    cp.tick();
    const s = await (await fetch(base + '/api/state')).json();
    expect(s.status).toBe('Charging');
    expect(s.electrical.powerKw).toBe(11);
    expect(s.transaction.transactionId).toBe(4242);

    expect((await post('/api/unplug')).status).toBe(200);
    await cp.settled();
    expect(transport.last('StopTransaction')!.payload.reason).toBe('EVDisconnected');
    expect((await post('/api/stop')).status).toBe(409);
  });

  it('valida parametros e exige o cabecalho anti-CSRF', async () => {
    const { post } = await boot();
    expect((await post('/api/settings', { targetSoc: 10 })).status).toBe(400); // alvo <= inicial
    expect((await post('/api/settings', { maxPowerKw: 9999 })).status).toBe(400);
    expect((await post('/api/reset', { type: 'X' })).status).toBe(400);
    expect((await post('/api/stop', {}, {})).status).toBe(403);
  });
});
