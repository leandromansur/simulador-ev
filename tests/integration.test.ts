import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { OcppClient } from '../src/ocpp/client';
import { createCallHandler } from '../src/ocpp/handlers';
import { ChargePoint } from '../src/simulator/charger';
import { Logger } from '../src/utils/logger';
import { testConfig } from './helpers';

/** CSMS minimo em processo, apenas para o teste (nao faz parte do projeto). */
function startMockCsms() {
  const received: Array<{ action: string; payload: any }> = [];
  const sockets: WebSocket[] = [];
  const protocols: string[] = [];
  const authHeaders: Array<string | undefined> = [];
  const replies = new Map<string, (payload: any) => void>();
  const wss = new WebSocketServer({
    port: 0,
    handleProtocols: (set) => {
      protocols.push(...set);
      return set.has('ocpp1.6') ? 'ocpp1.6' : false;
    },
  });
  wss.on('connection', (ws, req) => {
    sockets.push(ws);
    authHeaders.push(req.headers.authorization);
    ws.on('message', (raw) => {
      const [type, id, action, payload] = JSON.parse(raw.toString());
      if (type === 3) return void replies.get(id)?.(action);
      if (type === 4) return void replies.get(id)?.({ error: action });
      if (type !== 2) return;
      received.push({ action, payload });
      const reply: Record<string, unknown> = {
        BootNotification: { status: 'Accepted', currentTime: new Date().toISOString(), interval: 60 },
        Authorize: { idTagInfo: { status: 'Accepted' } },
        StartTransaction: { transactionId: 555, idTagInfo: { status: 'Accepted' } },
      };
      ws.send(JSON.stringify([3, id, reply[action] ?? {}]));
    });
  });
  /** CSMS -> Charge Point: envia um CALL e devolve o payload do CALLRESULT. */
  const sendCall = (action: string, payload: unknown) =>
    new Promise<any>((resolve) => {
      const id = 'srv-' + Math.random().toString(36).slice(2);
      replies.set(id, resolve);
      sockets[sockets.length - 1].send(JSON.stringify([2, id, action, payload]));
    });
  return { wss, received, sockets, protocols, authHeaders, sendCall, port: () => (wss.address() as AddressInfo).port };
}

const until = async (cond: () => boolean, ms = 5000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout aguardando condicao');
    await new Promise((r) => setTimeout(r, 20));
  }
};

let cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.forEach((f) => f());
  cleanup = [];
});

describe('integracao WebSocket (CSMS simulado em processo)', () => {
  it('negocia ocpp1.6, faz Boot/Status/Start e reconecta apos queda sem duplicar', async () => {
    const csms = startMockCsms();
    const logger = new Logger('SIM-001', 'error');
    const client = new OcppClient({
      url: `ws://127.0.0.1:${csms.port()}/ocpp/SIM-001`,
      callTimeoutMs: 5000,
      reconnectBaseMs: 100,
      reconnectMaxMs: 200,
      logger,
    });
    const cp = new ChargePoint(testConfig(), client, logger);
    client.onConnected = () => cp.onConnected();
    client.onDisconnected = () => cp.onDisconnected();
    client.onCall = createCallHandler(cp);
    cleanup.push(() => {
      void cp.shutdown();
      client.stop();
      csms.wss.close();
    });

    client.start();
    await until(() => csms.received.some((m) => m.action === 'StatusNotification'));
    expect(csms.protocols).toContain('ocpp1.6');
    expect(csms.received[0].action).toBe('BootNotification');

    expect(await cp.startLocalSession()).toBe(true);
    expect(cp.connector.transaction!.transactionId).toBe(555);

    // CSMS derruba a conexao: o simulador deve reconectar e fazer novo Boot
    const bootsBefore = csms.received.filter((m) => m.action === 'BootNotification').length;
    csms.sockets[0].terminate();
    await until(
      () => csms.received.filter((m) => m.action === 'BootNotification').length === bootsBefore + 1,
    );
    expect(cp.connector.status).toBe('Charging'); // transacao preservada
  });

  it('continua tentando quando o CSMS esta indisponivel', async () => {
    const logger = new Logger('SIM-001', 'error');
    const client = new OcppClient({
      url: 'ws://127.0.0.1:1/ocpp/SIM-001',
      callTimeoutMs: 1000,
      reconnectBaseMs: 50,
      reconnectMaxMs: 100,
      logger,
    });
    let disconnects = 0;
    client.onDisconnected = () => disconnects++;
    cleanup.push(() => client.stop());
    client.start();
    await until(() => disconnects >= 3);
  });

  it('envia Basic Auth e atende comandos do CSMS pelo WebSocket real', async () => {
    const csms = startMockCsms();
    const logger = new Logger('SIM-001', 'error');
    const client = new OcppClient({
      url: `ws://127.0.0.1:${csms.port()}/SIM-001`,
      callTimeoutMs: 5000,
      reconnectBaseMs: 100,
      reconnectMaxMs: 200,
      logger,
      basicAuth: { user: 'SIM-001', password: 's3' },
    });
    const cp = new ChargePoint(testConfig(), client, logger);
    client.onConnected = () => cp.onConnected();
    client.onDisconnected = () => cp.onDisconnected();
    client.onCall = createCallHandler(cp);
    cleanup.push(() => {
      void cp.shutdown();
      client.stop();
      csms.wss.close();
    });
    client.start();
    await until(() => csms.received.some((m) => m.action === 'StatusNotification'));
    expect(csms.authHeaders[0]).toBe('Basic ' + Buffer.from('SIM-001:s3').toString('base64'));

    const cfg: any = await csms.sendCall('GetConfiguration', { key: ['HeartbeatInterval'] });
    expect(cfg.configurationKey[0].key).toBe('HeartbeatInterval');
    expect(await csms.sendCall('ChangeConfiguration', { key: 'ConnectionTimeOut', value: '90' })).toEqual({
      status: 'Accepted',
    });
    expect(await csms.sendCall('ChangeAvailability', { connectorId: 1, type: 'Inoperative' })).toEqual({
      status: 'Accepted',
    });
    expect(cp.connector.status).toBe('Unavailable');
    expect(await csms.sendCall('TriggerMessage', { requestedMessage: 'Heartbeat' })).toEqual({
      status: 'Accepted',
    });
    await until(() => csms.received.some((m) => m.action === 'Heartbeat'));
    expect(await csms.sendCall('Foo', {})).toEqual({ error: 'NotImplemented' });
  });
});
