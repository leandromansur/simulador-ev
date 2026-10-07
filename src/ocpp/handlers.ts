import { OcppCallError } from './messages';
import type { IncomingCallHandler } from './client';
import type {
  RemoteStartTransactionRequest,
  RemoteStopTransactionRequest,
  ResetRequest,
} from './types';

type Reply = unknown;

/** O que o roteador de CALLs recebidos precisa do Charge Point. */
export interface CommandTarget {
  remoteStart(req: RemoteStartTransactionRequest): { status: string };
  remoteStop(req: RemoteStopTransactionRequest): { status: string };
  reset(req: ResetRequest): { status: string };
  // Opcionais: o roteador responde NotImplemented quando ausentes.
  changeAvailability?(req: never): Reply;
  changeConfiguration?(req: never): Reply;
  getConfiguration?(req: never): Reply;
  clearCache?(): Reply;
  triggerMessage?(req: never): Reply;
  unlockConnector?(req: never): Reply;
  dataTransferIn?(req: never): Reply;
  getLocalListVersion?(): Reply;
  sendLocalList?(req: never): Reply;
  reserveNow?(req: never): Reply;
  cancelReservation?(req: never): Reply;
  setChargingProfile?(req: never): Reply;
  clearChargingProfile?(req: never): Reply;
  getCompositeSchedule?(req: never): Reply;
  getDiagnostics?(req: never): Reply;
  updateFirmware?(req: never): Reply;
}

/** Roteia CALLs CSMS -> Charge Point (OCPP 1.6: todas as mensagens do CSMS). */
export function createCallHandler(target: CommandTarget): IncomingCallHandler {
  const need = <T>(fn: T | undefined, action: string): T => {
    if (!fn) throw new OcppCallError('NotImplemented', `Action ${action} nao suportada`);
    return fn;
  };
  return async (action, payload) => {
    const body = (payload ?? {}) as never;
    switch (action) {
      case 'RemoteStartTransaction':
        return target.remoteStart(body);
      case 'RemoteStopTransaction':
        return target.remoteStop(body);
      case 'Reset':
        return target.reset(body);
      case 'ChangeAvailability':
        return need(target.changeAvailability, action).call(target, body);
      case 'ChangeConfiguration':
        return need(target.changeConfiguration, action).call(target, body);
      case 'GetConfiguration':
        return need(target.getConfiguration, action).call(target, body);
      case 'ClearCache':
        return need(target.clearCache, action).call(target);
      case 'TriggerMessage':
        return need(target.triggerMessage, action).call(target, body);
      case 'UnlockConnector':
        return need(target.unlockConnector, action).call(target, body);
      case 'DataTransfer':
        return need(target.dataTransferIn, action).call(target, body);
      case 'GetLocalListVersion':
        return need(target.getLocalListVersion, action).call(target);
      case 'SendLocalList':
        return need(target.sendLocalList, action).call(target, body);
      case 'ReserveNow':
        return need(target.reserveNow, action).call(target, body);
      case 'CancelReservation':
        return need(target.cancelReservation, action).call(target, body);
      case 'SetChargingProfile':
        return need(target.setChargingProfile, action).call(target, body);
      case 'ClearChargingProfile':
        return need(target.clearChargingProfile, action).call(target, body);
      case 'GetCompositeSchedule':
        return need(target.getCompositeSchedule, action).call(target, body);
      case 'GetDiagnostics':
        return need(target.getDiagnostics, action).call(target, body);
      case 'UpdateFirmware':
        return need(target.updateFirmware, action).call(target, body);
      default:
        throw new OcppCallError('NotImplemented', `Action ${action} nao suportada`);
    }
  };
}
