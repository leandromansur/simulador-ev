import type { ConnectorStatus } from '../ocpp/types';

/** Transicoes permitidas (baseadas na tabela de estados do OCPP 1.6, sem Reserved). */
export const TRANSITIONS: Record<ConnectorStatus, readonly ConnectorStatus[]> = {
  Available: ['Preparing', 'Unavailable', 'Faulted'],
  Preparing: ['Charging', 'SuspendedEV', 'SuspendedEVSE', 'Available', 'Unavailable', 'Faulted'],
  Charging: ['SuspendedEV', 'SuspendedEVSE', 'Finishing', 'Available', 'Unavailable', 'Faulted'],
  SuspendedEV: ['Charging', 'SuspendedEVSE', 'Finishing', 'Available', 'Unavailable', 'Faulted'],
  SuspendedEVSE: ['Charging', 'SuspendedEV', 'Finishing', 'Available', 'Unavailable', 'Faulted'],
  Finishing: ['Available', 'Preparing', 'Unavailable', 'Faulted'],
  Unavailable: ['Available', 'Faulted'],
  Faulted: ['Available', 'Unavailable'],
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: ConnectorStatus,
    public readonly to: ConnectorStatus,
  ) {
    super(`Transicao invalida: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export type StateListener = (to: ConnectorStatus, from: ConnectorStatus) => void;

export class ConnectorStateMachine {
  private current: ConnectorStatus;

  constructor(
    initial: ConnectorStatus = 'Available',
    private readonly onChange?: StateListener,
  ) {
    this.current = initial;
  }

  get state(): ConnectorStatus {
    return this.current;
  }

  canTransition(to: ConnectorStatus): boolean {
    return TRANSITIONS[this.current].includes(to);
  }

  /** Aplica a transicao e notifica; lanca se invalida. Mesmo estado e no-op. */
  transition(to: ConnectorStatus): void {
    if (to === this.current) return;
    if (!this.canTransition(to)) throw new InvalidTransitionError(this.current, to);
    const from = this.current;
    this.current = to;
    this.onChange?.(to, from);
  }
}
