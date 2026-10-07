import type { ConnectorStatus } from '../ocpp/types';
import { ConnectorStateMachine, type StateListener } from './state-machine';

export interface ActiveTransaction {
  transactionId: number;
  idTag: string;
  startedAtMs: number;
  meterStartWh: number;
  /** Energia entregue na sessao (kWh) - diferente do registrador acumulativo do medidor. */
  sessionEnergyKwh: number;
  lastTickMs: number;
  powerKw: number;
}

export class Connector {
  readonly machine: ConnectorStateMachine;
  transaction: ActiveTransaction | null = null;

  constructor(
    public readonly id: number,
    onChange?: StateListener,
  ) {
    this.machine = new ConnectorStateMachine('Available', onChange);
  }

  get status(): ConnectorStatus {
    return this.machine.state;
  }
}
