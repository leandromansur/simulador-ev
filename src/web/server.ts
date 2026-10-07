import http from 'node:http';
import type { ChargePoint } from '../simulator/charger';
import type { Logger } from '../utils/logger';
import { PAGE_HTML } from './page';

export interface WebServerOptions {
  port: number;
  host: string;
  chargePoint: ChargePoint;
  logger: Logger;
  csmsUrl: string;
}

const MAX_BODY = 10_000;

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
        return send(res, 200, { ...cp.snapshot(), csmsUrl: opts.csmsUrl });
      }
      if (req.method === 'GET' && url.pathname === '/api/logs') {
        return send(res, 200, { lines: logger.recent(150) });
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
            await cp.stopTransaction('Local');
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
            });
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
