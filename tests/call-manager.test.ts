import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallManager, backoffDelayMs } from '../src/ocpp/client';
import { OcppCallError } from '../src/ocpp/messages';

describe('CallManager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(timeoutMs = 1000) {
    const sent: any[] = [];
    let n = 0;
    const cm = new CallManager((f) => sent.push(JSON.parse(f)), timeoutMs, () => `id-${++n}`);
    return { cm, sent };
  }

  it('correlaciona CALLRESULT pelo UniqueId', async () => {
    const { cm, sent } = setup();
    const p1 = cm.call('Heartbeat', {});
    const p2 = cm.call('Authorize', { idTag: 'X' });
    expect(sent.map((s) => s[1])).toEqual(['id-1', 'id-2']);
    cm.handleResult('id-2', { b: 2 });
    cm.handleResult('id-1', { a: 1 });
    await expect(p1).resolves.toEqual({ a: 1 });
    await expect(p2).resolves.toEqual({ b: 2 });
    expect(cm.pendingCount).toBe(0);
  });

  it('rejeita em CALLERROR', async () => {
    const { cm } = setup();
    const p = cm.call('Heartbeat', {});
    cm.handleError('id-1', new OcppCallError('InternalError', 'x'));
    await expect(p).rejects.toMatchObject({ code: 'InternalError' });
  });

  it('expira por timeout e limpa a pendencia', async () => {
    const { cm } = setup(1000);
    const p = cm.call('Heartbeat', {});
    const assertion = expect(p).rejects.toThrow(/Timeout/);
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    expect(cm.pendingCount).toBe(0);
  });

  it('ignora resposta com UniqueId desconhecido', () => {
    const { cm } = setup();
    expect(cm.handleResult('nope', {})).toBeUndefined();
  });

  it('rejectAll derruba pendentes na desconexao', async () => {
    const { cm } = setup();
    const p = cm.call('Heartbeat', {});
    cm.rejectAll(new Error('fechou'));
    await expect(p).rejects.toThrow('fechou');
  });
});

describe('backoff de reconexao', () => {
  it('cresce exponencialmente e respeita o limite', () => {
    const d = [0, 1, 2, 3, 4, 5].map((a) => backoffDelayMs(a, 5000, 60000) / 1000);
    expect(d).toEqual([5, 10, 20, 40, 60, 60]);
  });
});
