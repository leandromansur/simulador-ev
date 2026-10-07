import http from 'node:http';
import type { ChargePoint } from '../simulator/charger';
import type { Logger } from '../utils/logger';
import { PAGE_HTML } from './page';

export interface WebServerOptions {
  port: number;
  host: string;
  chargePoint: ChargePoint;
  logger: Logger;
  csmsUrl: string | (() => string);
  /** Troca ChargePointId/URL/senha em tempo de execucao; devolve a URL final. */
  reconfigure?: (c: {
    chargePointId?: string;
    csmsUrl?: string;
    password?: string;
    append?: boolean;
  }) => string;
}

const MAX_BODY = 200_000;

function send(res: http.ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': `${type}; charset=utf-8`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(type === 'application/json' ? JSON.stringify(body) : String(body));
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > MAX_BODY) {
        reject(new RangeError('corpo muito grande'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new RangeError('JSON invalido'));
      }
    });
    req.on('error', reject);
  });
}

/** Cria o servidor (sem escutar). Rotas: / , GET /api/state, GET /api/logs, POST /api/*. */
export function createWebServer(opts: WebServerOptions): http.Server {
  const { chargePoint: cp, logger } = opts;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        return send(res, 200, PAGE_HTML, 'text/html');
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const csmsUrl = typeof opts.csmsUrl === 'function' ? opts.csmsUrl() : opts.csmsUrl;
        return send(res, 200, { ...cp.snapshot(), csmsUrl });
      }
      if (req.method === 'GET' && url.pathname === '/api/logs') {
        const n = Math.min(1000, Math.max(1, Number(url.searchParams.get('n')) || 300));
        return send(res, 200, { lines: logger.recent(n) });
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        // Cabecalho customizado forca preflight CORS e bloqueia CSRF de outros sites.
        if (req.headers['x-simulator'] !== '1') {
          return send(res, 403, { error: 'cabecalho X-Simulator ausente' });
        }
        const body = await readJson(req);
        switch (url.pathname) {
          case '/api/start': {
            const idTag = typeof body.idTag === 'string' && body.idTag ? body.idTag : undefined;
            const ok = await cp.startLocalSession(idTag);
            return send(res, ok ? 200 : 409, { ok, error: ok ? undefined : 'Nao foi possivel iniciar (veja os logs)' });
          }
          case '/api/stop': {
            const tx = cp.connector.transaction;
            if (!tx) return send(res, 409, { ok: false, error: 'Nenhuma transacao ativa' });
            const reasons = ['Local', 'EmergencyStop', 'PowerLoss', 'Other', 'DeAuthorized', 'Reboot'];
            await cp.stopTransaction(reasons.includes(body.reason) ? body.reason : 'Local');
            return send(res, 200, { ok: true });
          }
          case '/api/unplug': {
            const ok = await cp.unplugVehicle();
            return send(res, ok ? 200 : 409, { ok, error: ok ? undefined : 'Nenhuma transacao ativa' });
          }
          case '/api/reset': {
            const r = cp.reset({ type: body.type });
            return send(res, r.status === 'Accepted' ? 200 : 400, { ok: r.status === 'Accepted' });
          }
          case '/api/settings': {
            const num = (v: unknown) => (v === undefined || v === '' || v === null ? undefined : Number(v));
            cp.updateSettings({
              maxPowerKw: num(body.maxPowerKw),
              initialSoc: num(body.initialSoc),
              targetSoc: num(body.targetSoc),
              voltage: num(body.voltage),
              phases: num(body.phases),
              powerFactor: num(body.powerFactor),
              batteryKwh: num(body.batteryKwh),
              idTag: body.idTag,
              vendor: body.vendor,
              model: body.model,
              serialNumber: body.serialNumber,
              firmwareVersion: body.firmwareVersion,
            });
            const meterInterval = num(body.meterInterval);
            if (meterInterval !== undefined) {
              cp.config.force('MeterValueSampleInterval', String(Math.max(0, Math.floor(meterInterval))));
            }
            return send(res, 200, { ok: true });
          }
          case '/api/call': {
            if (typeof body.action !== 'string' || !/^[A-Za-z]{3,40}$/.test(body.action)) {
              throw new RangeError('action invalida');
            }
            try {
              const response = await cp.rawCall(body.action, body.payload ?? {});
              return send(res, 200, { ok: true, response });
            } catch (err) {
              return send(res, 200, { ok: false, error: (err as Error).message });
            }
          }
          case '/api/suspend': {
            const ok = cp.suspend(body.by === 'EVSE' ? 'EVSE' : 'EV');
            return send(res, ok ? 200 : 409, { ok, error: ok ? undefined : 'So e possivel pausar durante a carga' });
          }
          case '/api/resume': {
            const ok = cp.resume();
            return send(res, ok ? 200 : 409, { ok, error: ok ? undefined : 'Carga nao esta pausada' });
          }
          case '/api/fault': {
            await cp.setFault({
              errorCode: body.errorCode,
              faulted: body.faulted !== false,
              info: body.info,
              vendorErrorCode: body.vendorErrorCode,
            });
            return send(res, 200, { ok: true });
          }
          case '/api/availability': {
            const r = cp.changeAvailability({
              connectorId: body.connectorId === 0 ? 0 : cp.connector.id,
              type: body.type,
            });
            return send(res, 200, { ok: r.status !== 'Rejected', status: r.status });
          }
          case '/api/config': {
            if (typeof body.key !== 'string' || typeof body.value !== 'string') {
              throw new RangeError('key e value sao obrigatorios');
            }
            if (body.force) {
              cp.config.force(body.key, body.value);
              return send(res, 200, { ok: true });
            }
            const status = cp.config.change(body.key, body.value);
            return send(res, 200, {
              ok: status === 'Accepted' || status === 'RebootRequired',
              error: status === 'Accepted' ? undefined : status,
            });
          }
          case '/api/behavior': {
            for (const k of ['firmwareFails', 'diagnosticsFails', 'unlockFails'] as const) {
              if (typeof body[k] === 'boolean') cp.behavior[k] = body[k];
            }
            return send(res, 200, { ok: true });
          }
          case '/api/connection': {
            if (!opts.reconfigure) return send(res, 501, { ok: false, error: 'indisponivel' });
            const finalUrl = opts.reconfigure({
              chargePointId: body.chargePointId,
              csmsUrl: body.csmsUrl,
              password: body.password,
              append: body.append,
            });
            return send(res, 200, { ok: true, url: finalUrl });
          }
          case '/api/local-state': {
            // atalhos locais (limpar cache/perfis/reserva)
            if (body.clear === 'cache') cp.authCache.clear();
            if (body.clear === 'profiles') cp.profiles.clear({});
            if (body.clear === 'reservation' && cp.reservation) {
              cp.cancelReservation({ reservationId: cp.reservation.reservationId });
            }
            return send(res, 200, { ok: true });
          }
        }
      }
      send(res, 404, { error: 'nao encontrado' });
    } catch (err) {
      const status = err instanceof RangeError ? 400 : 500;
      send(res, status, { ok: false, error: (err as Error).message });
    }
  });
}

export function startWebServer(opts: WebServerOptions): http.Server {
  const server = createWebServer(opts);
  server.listen(opts.port, opts.host, () => {
    opts.logger.info(`Interface web em http://${opts.host}:${opts.port}`);
  });
  return server;
}
