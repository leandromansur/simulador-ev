import { describe, expect, it } from 'vitest';
import { ConfigError, buildCsmsUrl, loadConfig } from '../src/config';

const base = { CHARGE_POINT_ID: 'SIM-001', CSMS_URL: 'ws://host.docker.internal:9000/ocpp' };

describe('config', () => {
  it('aplica defaults', () => {
    const c = loadConfig(base);
    expect(c.maxPowerKw).toBe(22);
    expect(c.appendChargePointId).toBe(true);
    expect(c.autoStartTransaction).toBe(false);
  });

  it('exige CHARGE_POINT_ID e CSMS_URL', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it('rejeita URL sem ws/wss, alvo <= inicial e tipo DC', () => {
    expect(() => loadConfig({ ...base, CSMS_URL: 'http://x' })).toThrow(/ws:\/\//);
    expect(() =>
      loadConfig({ ...base, VEHICLE_INITIAL_SOC: '80', VEHICLE_TARGET_SOC: '50' }),
    ).toThrow(/VEHICLE_TARGET_SOC/);
    expect(() => loadConfig({ ...base, CHARGER_TYPE: 'DC' })).toThrow(/CHARGER_TYPE/);
  });

  it('monta a URL com ou sem ChargePointId', () => {
    expect(buildCsmsUrl('ws://h:9000/ocpp', 'SIM-001', true)).toBe('ws://h:9000/ocpp/SIM-001');
    expect(buildCsmsUrl('ws://h:9000/ocpp/', 'SIM-001', true)).toBe('ws://h:9000/ocpp/SIM-001');
    expect(buildCsmsUrl('ws://h:9000/ocpp', 'SIM-001', false)).toBe('ws://h:9000/ocpp');
    expect(buildCsmsUrl('wss://h/ocpp', 'A B', true)).toBe('wss://h/ocpp/A%20B');
  });
});
