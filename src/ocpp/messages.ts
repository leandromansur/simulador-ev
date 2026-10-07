import type { MeterValuesRequest, OcppErrorCode, SampledValue } from './types';

export const MessageType = { CALL: 2, CALLRESULT: 3, CALLERROR: 4 } as const;

export type OcppMessage =
  | { type: 'CALL'; uniqueId: string; action: string; payload: unknown }
  | { type: 'CALLRESULT'; uniqueId: string; payload: unknown }
  | {
      type: 'CALLERROR';
      uniqueId: string;
      errorCode: string;
      errorDescription: string;
      errorDetails: unknown;
    };

/** Falha ao interpretar um frame recebido. */
export class OcppProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcppProtocolError';
  }
}

/** Erro OCPP (CALLERROR) recebido do CSMS ou a ser enviado por um handler. */
export class OcppCallError extends Error {
  constructor(
    public readonly code: OcppErrorCode | string,
    public readonly description: string = '',
    public readonly details: unknown = {},
  ) {
    super(`${code}${description ? `: ${description}` : ''}`);
    this.name = 'OcppCallError';
  }
}

export function buildCall(uniqueId: string, action: string, payload: unknown): string {
  return JSON.stringify([MessageType.CALL, uniqueId, action, payload]);
}

export function buildCallResult(uniqueId: string, payload: unknown = {}): string {
  return JSON.stringify([MessageType.CALLRESULT, uniqueId, payload]);
}

export function buildCallError(
  uniqueId: string,
  code: string,
  description = '',
  details: unknown = {},
): string {
  return JSON.stringify([MessageType.CALLERROR, uniqueId, code, description, details]);
}

export function parseMessage(raw: string): OcppMessage {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new OcppProtocolError('frame nao e JSON valido');
  }
  if (!Array.isArray(data) || data.length < 3) {
    throw new OcppProtocolError('frame deve ser um array OCPP-J');
  }
  const [type, uniqueId] = data;
  if (typeof uniqueId !== 'string' || uniqueId.length === 0) {
    throw new OcppProtocolError('UniqueId ausente ou invalido');
  }

  switch (type) {
    case MessageType.CALL:
      if (data.length !== 4 || typeof data[2] !== 'string') {
        throw new OcppProtocolError('CALL malformado');
      }
      return { type: 'CALL', uniqueId, action: data[2], payload: data[3] };
    case MessageType.CALLRESULT:
      if (data.length !== 3) throw new OcppProtocolError('CALLRESULT malformado');
      return { type: 'CALLRESULT', uniqueId, payload: data[2] };
    case MessageType.CALLERROR:
      if (data.length !== 5 || typeof data[2] !== 'string') {
        throw new OcppProtocolError('CALLERROR malformado');
      }
      return {
        type: 'CALLERROR',
        uniqueId,
        errorCode: data[2],
        errorDescription: typeof data[3] === 'string' ? data[3] : '',
        errorDetails: data[4],
      };
    default:
      throw new OcppProtocolError(`MessageTypeId desconhecido: ${String(type)}`);
  }
}

export interface MeterSample {
  connectorId: number;
  transactionId?: number;
  timestamp: Date;
  energyWh: number;
  powerW: number;
  currentA: number;
  voltageV: number;
  socPercent: number;
  /** Measurands a enviar; padrao = os cinco basicos. */
  measurands?: string[];
  context?: string;
  offeredPowerW?: number;
  offeredCurrentA?: number;
  powerFactor?: number;
  frequencyHz?: number;
  temperatureC?: number;
}

const DEFAULT_MEASURANDS = [
  'Energy.Active.Import.Register',
  'Power.Active.Import',
  'Current.Import',
  'Voltage',
  'SoC',
];

/** Amostras (SampledValue) para os measurands pedidos, com unidades do OCPP 1.6. */
export function buildSampledValues(s: MeterSample): SampledValue[] {
  const base = { context: s.context ?? 'Sample.Periodic', format: 'Raw' };
  const outlet = { ...base, location: 'Outlet' };
  const table: Record<string, SampledValue> = {
    'Energy.Active.Import.Register': { ...outlet, value: String(Math.round(s.energyWh)), measurand: 'Energy.Active.Import.Register', unit: 'Wh' },
    'Power.Active.Import': { ...outlet, value: String(Math.round(s.powerW)), measurand: 'Power.Active.Import', unit: 'W' },
    'Current.Import': { ...outlet, value: s.currentA.toFixed(2), measurand: 'Current.Import', unit: 'A' },
    'Current.Offered': { ...outlet, value: (s.offeredCurrentA ?? 0).toFixed(2), measurand: 'Current.Offered', unit: 'A' },
    'Power.Offered': { ...outlet, value: String(Math.round(s.offeredPowerW ?? 0)), measurand: 'Power.Offered', unit: 'W' },
    Voltage: { ...outlet, value: s.voltageV.toFixed(1), measurand: 'Voltage', unit: 'V' },
    Frequency: { ...outlet, value: (s.frequencyHz ?? 60).toFixed(2), measurand: 'Frequency' },
    'Power.Factor': { ...outlet, value: (s.powerFactor ?? 1).toFixed(2), measurand: 'Power.Factor' },
    Temperature: { ...outlet, value: (s.temperatureC ?? 30).toFixed(1), measurand: 'Temperature', unit: 'Celsius' },
    SoC: { ...base, value: s.socPercent.toFixed(1), measurand: 'SoC', location: 'EV', unit: 'Percent' },
  };
  const wanted = s.measurands && s.measurands.length > 0 ? s.measurands : DEFAULT_MEASURANDS;
  return wanted.filter((m) => m in table).map((m) => table[m]);
}

/** Monta o payload de MeterValues com os measurands e unidades do OCPP 1.6. */
export function buildMeterValuesPayload(s: MeterSample): MeterValuesRequest {
  return {
    connectorId: s.connectorId,
    ...(s.transactionId !== undefined ? { transactionId: s.transactionId } : {}),
    meterValue: [{ timestamp: s.timestamp.toISOString(), sampledValue: buildSampledValues(s) }],
  };
}
