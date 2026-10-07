import { ConfigError, buildCsmsUrl, loadConfig } from './config';
import { OcppClient } from './ocpp/client';
import { createCallHandler } from './ocpp/handlers';
import { ChargePoint } from './simulator/charger';
import { Logger } from './utils/logger';

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
  const url = buildCsmsUrl(config.csmsUrl, config.chargePointId, config.appendChargePointId);

  const client = new OcppClient({
    url,
    callTimeoutMs: config.callTimeoutSeconds * 1000,
    reconnectBaseMs: config.reconnectIntervalSeconds * 1000,
    reconnectMaxMs: config.reconnectMaxIntervalSeconds * 1000,
    logger,
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

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} recebido; encerrando`);
    await chargePoint.shutdown();
    client.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
