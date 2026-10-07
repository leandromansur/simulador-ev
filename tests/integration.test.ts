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
  const wss = new WebSocketServer({
    port: 0,
    handleProtocols: (set) => {
      protocols.push(...set);
      return set.has('ocpp1.6') ? 'ocpp1.6' : false;
    },
  });
  wss.on('connection', (ws) => {
    sockets.push(ws);
    ws.on('message', (raw) => {
      const [type, id, action, payload] = JSON.parse(raw.toString());
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
  return { wss, received, sockets, protocols, port: () => (wss.address() as AddressInfo).port };
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
});
