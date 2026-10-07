import type { LogLevel } from './utils/logger';

export interface Config {
  chargePointId: string;
  csmsUrl: string;
  appendChargePointId: boolean;
  connectorId: number;
  idTag: string;
  vendor: string;
  model: string;
  serialNumber: string;
  firmwareVersion: string;
  chargerType: 'AC';
  maxPowerKw: number;
  voltage: number;
  phases: 1 | 3;
  powerFactor: number;
  batteryKwh: number;
  initialSoc: number;
  targetSoc: number;
  meterIntervalSeconds: number;
  heartbeatIntervalSeconds: number;
  reconnectIntervalSeconds: number;
  reconnectMaxIntervalSeconds: number;
  callTimeoutSeconds: number;
  logLevel: LogLevel;
  autoStartTransaction: boolean;
  autoStartDelaySeconds: number;
  /** 0 desativa a interface web. */
  webPort: number;
  webHost: string;
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Configuracao invalida:\n - ${problems.join('\n - ')}`);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

/** Monta a URL final do CSMS, anexando (ou nao) o ChargePointId. */
export function buildCsmsUrl(csmsUrl: string, chargePointId: string, append: boolean): string {
  if (!append) return csmsUrl;
  return `${csmsUrl.replace(/\/+$/, '')}/${encodeURIComponent(chargePointId)}`;
}

export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];

  const str = (name: string, def?: string): string => {
    const v = env[name]?.trim();
    if (v) return v;
    if (def !== undefined) return def;
    problems.push(`${name} e obrigatoria`);
    return '';
  };

  const num = (name: string, def: number, min: number, max = Infinity): number => {
    const raw = env[name]?.trim();
    if (!raw) return def;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max) {
      problems.push(`${name}=${raw} invalido (esperado numero entre ${min} e ${max})`);
      return def;
    }
    return n;
  };

  const bool = (name: string, def: boolean): boolean => {
    const raw = env[name]?.trim().toLowerCase();
    if (!raw) return def;
    if (['true', '1', 'yes'].includes(raw)) return true;
    if (['false', '0', 'no'].includes(raw)) return false;
    problems.push(`${name}=${raw} invalido (esperado true/false)`);
    return def;
  };

  const chargePointId = str('CHARGE_POINT_ID');
  const csmsUrl = str('CSMS_URL');
  if (csmsUrl && !/^wss?:\/\/[^\s/]+/i.test(csmsUrl)) {
    problems.push('CSMS_URL deve comecar com ws:// ou wss://');
  }

  const chargerType = str('CHARGER_TYPE', 'AC').toUpperCase();
  if (chargerType !== 'AC') {
    problems.push(`CHARGER_TYPE=${chargerType} ainda nao suportado (MVP somente AC)`);
  }

  const phasesRaw = num('PHASES', 3, 1, 3);
  if (phasesRaw !== 1 && phasesRaw !== 3) problems.push(`PHASES=${phasesRaw} invalido (use 1 ou 3)`);

  const level = str('LOG_LEVEL', 'info').toLowerCase();
  if (!['debug', 'info', 'warn', 'error'].includes(level)) {
    problems.push(`LOG_LEVEL=${level} invalido (debug|info|warn|error)`);
  }

  const initialSoc = num('VEHICLE_INITIAL_SOC', 30, 0, 100);
  const targetSoc = num('VEHICLE_TARGET_SOC', 90, 0, 100);
  if (targetSoc <= initialSoc) {
    problems.push(
      `VEHICLE_TARGET_SOC (${targetSoc}) deve ser maior que VEHICLE_INITIAL_SOC (${initialSoc})`,
    );
  }

  const reconnectIntervalSeconds = num('RECONNECT_INTERVAL_SECONDS', 5, 1);
  const reconnectMaxIntervalSeconds = num('RECONNECT_MAX_INTERVAL_SECONDS', 60, 1);
  if (reconnectMaxIntervalSeconds < reconnectIntervalSeconds) {
    problems.push('RECONNECT_MAX_INTERVAL_SECONDS deve ser >= RECONNECT_INTERVAL_SECONDS');
  }

  const config: Config = {
    chargePointId,
    csmsUrl,
    appendChargePointId: bool('APPEND_CHARGE_POINT_ID_TO_URL', true),
    connectorId: num('CONNECTOR_ID', 1, 1),
    idTag: str('ID_TAG', 'SIMULATOR001'),
    vendor: str('CHARGER_VENDOR', 'Inovative'),
    model: str('CHARGER_MODEL', 'EV-Simulator'),
    serialNumber: str('CHARGER_SERIAL_NUMBER', chargePointId || 'SIM-001'),
    firmwareVersion: str('CHARGER_FIRMWARE_VERSION', '0.1.0'),
    chargerType: 'AC',
    maxPowerKw: num('MAX_POWER_KW', 22, 0.1),
    voltage: num('VOLTAGE', 380, 1),
    phases: phasesRaw === 1 ? 1 : 3,
    powerFactor: num('POWER_FACTOR', 0.98, 0.01, 1),
    batteryKwh: num('VEHICLE_BATTERY_KWH', 60, 0.1),
    initialSoc,
    targetSoc,
    meterIntervalSeconds: num('METER_INTERVAL_SECONDS', 10, 1),
    heartbeatIntervalSeconds: num('HEARTBEAT_INTERVAL_SECONDS', 60, 1),
    reconnectIntervalSeconds,
    reconnectMaxIntervalSeconds,
    callTimeoutSeconds: num('OCPP_CALL_TIMEOUT_SECONDS', 30, 1),
    logLevel: level as LogLevel,
    autoStartTransaction: bool('AUTO_START_TRANSACTION', false),
    autoStartDelaySeconds: num('AUTO_START_DELAY_SECONDS', 5, 0),
    webPort: num('WEB_PORT', 8080, 0, 65535),
    webHost: str('WEB_HOST', '0.0.0.0'),
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
