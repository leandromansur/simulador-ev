import { describe, expect, it } from 'vitest';
import {
  OcppProtocolError,
  buildCall,
  buildCallError,
  buildCallResult,
  buildMeterValuesPayload,
  parseMessage,
} from '../src/ocpp/messages';

describe('serializacao e parsing OCPP-J', () => {
  it('serializa CALL', () => {
    expect(JSON.parse(buildCall('abc', 'BootNotification', { a: 1 }))).toEqual([
      2,
      'abc',
      'BootNotification',
      { a: 1 },
    ]);
  });

  it('faz parsing de CALL', () => {
    const m = parseMessage('[2,"id1","Reset",{"type":"Soft"}]');
    expect(m).toEqual({ type: 'CALL', uniqueId: 'id1', action: 'Reset', payload: { type: 'Soft' } });
  });

  it('faz parsing de CALLRESULT', () => {
    const m = parseMessage(buildCallResult('id2', { status: 'Accepted' }));
    expect(m).toEqual({ type: 'CALLRESULT', uniqueId: 'id2', payload: { status: 'Accepted' } });
  });

  it('faz parsing de CALLERROR', () => {
    const m = parseMessage(buildCallError('id3', 'NotImplemented', 'nope'));
    expect(m).toMatchObject({
      type: 'CALLERROR',
      uniqueId: 'id3',
      errorCode: 'NotImplemented',
      errorDescription: 'nope',
    });
  });

  it.each(['nao json', '{}', '[2,"x"]', '[9,"x",{}]', '[2,"",{}]', '[2,"x",5,{}]'])(
    'rejeita frame invalido: %s',
    (raw) => {
      expect(() => parseMessage(raw)).toThrow(OcppProtocolError);
    },
  );
});

describe('MeterValues', () => {
  it('usa measurands, unidades e timestamp UTC do OCPP 1.6', () => {
    const p = buildMeterValuesPayload({
      connectorId: 1,
      transactionId: 7,
      timestamp: new Date('2026-10-06T21:30:00.000Z'),
      energyWh: 4270.4,
      powerW: 20300,
      currentA: 31.44,
      voltageV: 381.2,
      socPercent: 42.34,
    });
    expect(p.transactionId).toBe(7);
    expect(p.meterValue[0].timestamp).toBe('2026-10-06T21:30:00.000Z');
    const byMeasurand = Object.fromEntries(
      p.meterValue[0].sampledValue.map((s) => [s.measurand, s]),
    );
    expect(byMeasurand['Energy.Active.Import.Register']).toMatchObject({ value: '4270', unit: 'Wh' });
    expect(byMeasurand['Power.Active.Import']).toMatchObject({ value: '20300', unit: 'W' });
    expect(byMeasurand['Current.Import']).toMatchObject({ value: '31.44', unit: 'A' });
    expect(byMeasurand['Voltage']).toMatchObject({ value: '381.2', unit: 'V' });
    expect(byMeasurand['SoC']).toMatchObject({ value: '42.3', unit: 'Percent' });
  });
});
