import { describe, expect, it } from 'vitest';
import { Battery } from '../src/simulator/battery';
import {
  EnergyMeter,
  currentAmps,
  energyKwh,
  powerKw,
  socGainPercent,
} from '../src/simulator/meter';
import { Vehicle } from '../src/simulator/vehicle';

describe('calculos eletricos', () => {
  it('corrente trifasica: I = P / (sqrt3 V FP)', () => {
    expect(currentAmps(22, 380, 3, 0.98)).toBeCloseTo(34.1, 1);
  });

  it('corrente monofasica: I = P / (V FP)', () => {
    expect(currentAmps(7.2, 230, 1, 1)).toBeCloseTo(31.3, 1);
  });

  it('potencia e inverso da corrente', () => {
    const i = currentAmps(22, 380, 3, 0.98);
    expect(powerKw(i, 380, 3, 0.98)).toBeCloseTo(22, 6);
  });

  it('energia = potencia x tempo', () => {
    expect(energyKwh(22, 0.5)).toBe(11);
  });

  it('SOC ganho = energia / capacidade x 100', () => {
    expect(socGainPercent(6, 60)).toBe(10);
  });
});

describe('Battery / Vehicle', () => {
  it('SOC limitado a 0..100', () => {
    const b = new Battery(60, 95);
    expect(b.charge(100)).toBeCloseTo(3, 9);
    expect(b.socPercent).toBe(100);
    expect(new Battery(60, 150).socPercent).toBe(100);
    expect(new Battery(60, -5).socPercent).toBe(0);
  });

  it('veiculo rejeita alvo <= inicial', () => {
    expect(() => new Vehicle(60, 50, 40)).toThrow(RangeError);
    expect(() => new Vehicle(60, 50, 50)).toThrow(RangeError);
  });

  it('detecta SOC alvo e reinicia no plugIn', () => {
    const v = new Vehicle(60, 30, 90);
    v.plugIn();
    expect(v.energyToTargetKwh()).toBeCloseTo(36, 9);
    v.battery.charge(36);
    expect(v.targetReached()).toBe(true);
    v.plugIn();
    expect(v.socPercent).toBeCloseTo(30, 9);
  });
});

describe('EnergyMeter', () => {
  it('e monotonico e ignora valores negativos', () => {
    const m = new EnergyMeter(1000);
    m.add(1);
    m.add(-5);
    expect(m.registerWh).toBe(2000);
  });
});
