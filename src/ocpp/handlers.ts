import { OcppCallError } from './messages';
import type { IncomingCallHandler } from './client';
import type {
  RemoteStartTransactionRequest,
  RemoteStopTransactionRequest,
  ResetRequest,
} from './types';

/** O que o roteador de CALLs recebidos precisa do Charge Point. */
export interface CommandTarget {
  remoteStart(req: RemoteStartTransactionRequest): { status: string };
  remoteStop(req: RemoteStopTransactionRequest): { status: string };
  reset(req: ResetRequest): { status: string };
}

/**
 * Roteia CALLs CSMS -> Charge Point. Para suportar uma nova action
 * (ChangeAvailability, GetConfiguration, TriggerMessage...) basta adicionar um case.
 */
export function createCallHandler(target: CommandTarget): IncomingCallHandler {
  return async (action, payload) => {
    const body = (payload ?? {}) as never;
    switch (action) {
      case 'RemoteStartTransaction':
        return target.remoteStart(body);
      case 'RemoteStopTransaction':
        return target.remoteStop(body);
      case 'Reset':
        return target.reset(body);
      default:
        throw new OcppCallError('NotImplemented', `Action ${action} nao suportada`);
    }
  };
}
