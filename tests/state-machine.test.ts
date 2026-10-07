import { describe, expect, it, vi } from 'vitest';
import { ConnectorStateMachine, InvalidTransitionError } from '../src/simulator/state-machine';

describe('ConnectorStateMachine', () => {
  it('percorre o fluxo normal e notifica cada mudanca', () => {
    const listener = vi.fn();
    const m = new ConnectorStateMachine('Available', listener);
    for (const s of ['Preparing', 'Charging', 'Finishing', 'Available'] as const) m.transition(s);
    expect(listener.mock.calls.map((c) => c[0])).toEqual([
      'Preparing',
      'Charging',
      'Finishing',
      'Available',
    ]);
  });

  it('bloqueia transicoes invalidas', () => {
    const m = new ConnectorStateMachine('Available');
    expect(() => m.transition('Charging')).toThrow(InvalidTransitionError);
    expect(() => m.transition('Finishing')).toThrow(InvalidTransitionError);
    expect(m.state).toBe('Available');
  });

  it('mesmo estado e no-op sem notificacao', () => {
    const listener = vi.fn();
    const m = new ConnectorStateMachine('Available', listener);
    m.transition('Available');
    expect(listener).not.toHaveBeenCalled();
  });

  it('Faulted so volta para Available/Unavailable', () => {
    const m = new ConnectorStateMachine('Faulted');
    expect(m.canTransition('Charging')).toBe(false);
    expect(m.canTransition('Available')).toBe(true);
  });
});
