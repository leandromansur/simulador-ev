import { ConfigError, buildCsmsUrl, loadConfig } from './config';
import { OcppClient } from './ocpp/client';
import { createCallHandler } from './ocpp/handlers';
import { ChargePoint } from './simulator/charger';
import { Logger } from './utils/logger';
import { startWebServer } from './web/server';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const logger = new Logger(config.chargePointId, config.logLevel);
  let url = buildCsmsUrl(config.csmsUrl, config.chargePointId, config.appendChargePointId);

  const client = new OcppClient({
    url,
    callTimeoutMs: config.callTimeoutSeconds * 1000,
    reconnectBaseMs: config.reconnectIntervalSeconds * 1000,
    reconnectMaxMs: config.reconnectMaxIntervalSeconds * 1000,
    logger,
    basicAuth: config.csmsPassword
      ? { user: config.chargePointId, password: config.csmsPassword }
      : undefined,
  });
  const chargePoint = new ChargePoint(config, client, logger);

  client.onConnected = () => chargePoint.onConnected();
  client.onDisconnected = () => chargePoint.onDisconnected();
  client.onCall = createCallHandler(chargePoint);

  logger.info('Simulador EV OCPP 1.6J iniciando', {
    connectorId: config.connectorId,
    maxPowerKw: config.maxPowerKw,
    autoStart: config.autoStartTransaction,
  });
  client.start();

  const webServer =
    config.webPort > 0
      ? startWebServer({
          port: config.webPort,
          host: config.webHost,
          chargePoint,
          logger,
          csmsUrl: () => url,
          reconfigure: (c) => {
            if (typeof c.chargePointId === 'string' && c.chargePointId.trim()) {
              config.chargePointId = c.chargePointId.trim();
              logger.chargePointId = config.chargePointId;
            }
            if (typeof c.csmsUrl === 'string' && c.csmsUrl.trim()) {
              if (!/^wss?:\/\/[^\s/]+/i.test(c.csmsUrl.trim())) {
                throw new RangeError('CSMS_URL deve comecar com ws:// ou wss://');
              }
              config.csmsUrl = c.csmsUrl.trim();
            }
            if (typeof c.password === 'string') config.csmsPassword = c.password;
            if (typeof c.append === 'boolean') config.appendChargePointId = c.append;
            url = buildCsmsUrl(config.csmsUrl, config.chargePointId, config.appendChargePointId);
            logger.info(`Conexao reconfigurada: ${url}`);
            client.setConnection(
              url,
              config.csmsPassword
                ? { user: config.chargePointId, password: config.csmsPassword }
                : undefined,
            );
            return url;
          },
        })
      : null;

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} recebido; encerrando`);
    await chargePoint.shutdown();
    client.stop();
    webServer?.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
