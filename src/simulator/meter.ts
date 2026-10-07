/** Energia (kWh) = potencia (kW) x tempo (h). */
export function energyKwh(powerKw: number, hours: number): number {
  return powerKw * hours;
}

/** SOC ganho (%) = energia recebida / capacidade x 100. */
export function socGainPercent(energyReceivedKwh: number, capacityKwh: number): number {
  return (energyReceivedKwh / capacityKwh) * 100;
}

/**
 * Corrente (A) a partir da potencia ativa (kW).
 * Trifasico: I = P / (sqrt(3) x V x FP). Monofasico: I = P / (V x FP).
 */
export function currentAmps(
  powerKw: number,
  voltage: number,
  phases: 1 | 3,
  powerFactor: number,
): number {
  const watts = powerKw * 1000;
  const factor = phases === 3 ? Math.sqrt(3) : 1;
  return watts / (factor * voltage * powerFactor);
}

/** Potencia ativa (kW) a partir da corrente: inverso de currentAmps. */
export function powerKw(
  current: number,
  voltage: number,
  phases: 1 | 3,
  powerFactor: number,
): number {
  const factor = phases === 3 ? Math.sqrt(3) : 1;
  return (factor * voltage * current * powerFactor) / 1000;
}

/** Registrador de energia acumulativo (monotonico) do medidor do carregador. */
export class EnergyMeter {
  private wh: number;

  constructor(initialWh = 0) {
    this.wh = initialWh;
  }

  get registerWh(): number {
    return this.wh;
  }

  /** Valor inteiro em Wh para meterStart/meterStop. */
  get registerWhRounded(): number {
    return Math.round(this.wh);
  }

  add(kwh: number): void {
    if (kwh > 0) this.wh += kwh * 1000;
  }
}
