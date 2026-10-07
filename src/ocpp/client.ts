import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { Logger } from '../utils/logger';
import { redactUrl } from '../utils/logger';
import {
  OcppCallError,
  OcppProtocolError,
  buildCall,
  buildCallError,
  buildCallResult,
  parseMessage,
} from './messages';

export const OCPP_SUBPROTOCOL = 'ocpp1.6';

/** Contrato usado pelo charger; permite testar sem WebSocket real. */
export interface Transport {
  call(action: string, payload: unknown): Promise<any>;
  isConnected(): boolean;
  /** Derruba a conexao atual e reconecta (usado no Hard Reset). */
  reconnect(): void;
}

export type IncomingCallHandler = (action: string, payload: unknown) => Promise<unknown>;

interface Pending {
  action: string;
  resolve: (payload: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Correlaciona CALL x CALLRESULT/CALLERROR por UniqueId, com timeout. */
export class CallManager {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly send: (frame: string) => void,
    private readonly timeoutMs: number,
    private readonly newId: () => string = randomUUID,
    private readonly onSend?: (action: string, uniqueId: string, payload: unknown) => void,
  ) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  call(action: string, payload: unknown): Promise<any> {
    const uniqueId = this.newId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(uniqueId);
        reject(new Error(`Timeout aguardando resposta de ${action} (${uniqueId})`));
      }, this.timeoutMs);
      this.pending.set(uniqueId, { action, resolve, reject, timer });
      try {
        this.onSend?.(action, uniqueId, payload);
        this.send(buildCall(uniqueId, action, payload));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(uniqueId);
        reject(err as Error);
      }
    });
  }

  /** Retorna a action correlacionada, ou undefined se o UniqueId e desconhecido. */
  handleResult(uniqueId: string, payload: unknown): string | undefined {
    const p = this.take(uniqueId);
    p?.resolve(payload);
    return p?.action;
  }

  handleError(uniqueId: string, err: OcppCallError): string | undefined {
    const p = this.take(uniqueId);
    p?.reject(err);
    return p?.action;
  }

  rejectAll(reason: Error): void {
    for (const id of [...this.pending.keys()]) this.take(id)?.reject(reason);
  }

  private take(uniqueId: string): Pending | undefined {
    const p = this.pending.get(uniqueId);
    if (!p) return undefined;
    clearTimeout(p.timer);
    this.pending.delete(uniqueId);
    return p;
  }
}

/** Backoff progressivo: base * 2^tentativa, limitado a max. */
export function backoffDelayMs(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(baseMs * 2 ** attempt, maxMs);
}

export interface OcppClientOptions {
  url: string;
  callTimeoutMs: number;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
  logger: Logger;
}

export class OcppClient implements Transport {
  onConnected: () => void = () => {};
  onDisconnected: () => void = () => {};
  onCall: IncomingCallHandler = async () => {
    throw new OcppCallError('NotImplemented');
  };

  private ws: WebSocket | null = null;
  private calls: CallManager | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private quickReconnect = false;

  constructor(private readonly opts: OcppClientOptions) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close(1000);
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  reconnect(): void {
    this.quickReconnect = true;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close(1000);
  }

  call(action: string, payload: unknown): Promise<any> {
    if (!this.isConnected() || !this.calls) {
      return Promise.reject(new Error(`Sem conexao com o CSMS (${action})`));
    }
    return this.calls.call(action, payload);
  }

  private connect(): void {
    const { logger, url } = this.opts;
    logger.info(`CONNECTING ${redactUrl(url)} (subprotocol ${OCPP_SUBPROTOCOL})`);
    const ws = new WebSocket(url, OCPP_SUBPROTOCOL, { handshakeTimeout: 15000 });
    this.ws = ws;

    const calls = new CallManager(
      (frame) => ws.send(frame),
      this.opts.callTimeoutMs,
      randomUUID,
      (action, uniqueId, payload) => {
        logger.info(`OCPP -> ${action} uniqueId=${uniqueId}`);
        logger.debug(`OCPP -> ${action} payload`, payload);
      },
    );
    this.calls = calls;

    ws.on('open', () => {
      if (ws.protocol !== OCPP_SUBPROTOCOL) {
        logger.error(`Subprotocolo negociado "${ws.protocol}" != ${OCPP_SUBPROTOCOL}; fechando`);
        ws.close(1002);
        return;
      }
      this.attempt = 0;
      logger.info(`CONNECTED subprotocol=${ws.protocol}`);
      this.onConnected();
    });

    ws.on('message', (data) => void this.handleFrame(ws, calls, data.toString()));

    ws.on('error', (err) => logger.error(`WebSocket erro: ${err.message || (err as NodeJS.ErrnoException).code || String(err)}`));

    ws.on('close', (code) => {
      if (this.ws !== ws) return;
      logger.warn(`DISCONNECTED code=${code}`);
      calls.rejectAll(new Error('Conexao encerrada'));
      this.ws = null;
      this.calls = null;
      this.onDisconnected();
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const { reconnectBaseMs, reconnectMaxMs, logger } = this.opts;
    const delay = this.quickReconnect
      ? 1000
      : backoffDelayMs(this.attempt++, reconnectBaseMs, reconnectMaxMs);
    this.quickReconnect = false;
    logger.info(`RECONNECT em ${Math.round(delay / 1000)}s (tentativa ${this.attempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.connect();
    }, delay);
  }

  private async handleFrame(ws: WebSocket, calls: CallManager, raw: string): Promise<void> {
    const { logger } = this.opts;
    let msg;
    try {
      msg = parseMessage(raw);
    } catch (err) {
      const reason = err instanceof OcppProtocolError ? err.message : String(err);
      logger.warn(`Frame invalido ignorado: ${reason}`, { raw: raw.slice(0, 200) });
      return;
    }

    switch (msg.type) {
      case 'CALLRESULT': {
        const action = calls.handleResult(msg.uniqueId, msg.payload);
        logger.info(`OCPP <- ${action ?? '(desconhecido)'}.conf uniqueId=${msg.uniqueId}`);
        logger.debug('OCPP <- payload', msg.payload);
        return;
      }
      case 'CALLERROR': {
        const action = calls.handleError(
          msg.uniqueId,
          new OcppCallError(msg.errorCode, msg.errorDescription, msg.errorDetails),
        );
        logger.error(
          `OCPP <- ${action ?? '(desconhecido)'} CALLERROR ${msg.errorCode} ${msg.errorDescription}`,
          { uniqueId: msg.uniqueId },
        );
        return;
      }
      case 'CALL': {
        logger.info(`OCPP <- ${msg.action} uniqueId=${msg.uniqueId}`);
        logger.debug('OCPP <- payload', msg.payload);
        let frame: string;
        try {
          frame = buildCallResult(msg.uniqueId, await this.onCall(msg.action, msg.payload));
          logger.info(`OCPP -> ${msg.action}.conf uniqueId=${msg.uniqueId}`);
        } catch (err) {
          const e =
            err instanceof OcppCallError ? err : new OcppCallError('InternalError', String(err));
          frame = buildCallError(msg.uniqueId, e.code, e.description, e.details);
          logger.warn(`OCPP -> ${msg.action} CALLERROR ${e.code} ${e.description}`);
        }
        if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      }
    }
  }
}
