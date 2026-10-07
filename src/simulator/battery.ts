const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export class Battery {
  private energyKwh: number;

  constructor(
    public readonly capacityKwh: number,
    initialSocPercent: number,
  ) {
    if (!(capacityKwh > 0)) throw new RangeError('capacityKwh deve ser > 0');
    this.energyKwh = (clamp(initialSocPercent, 0, 100) / 100) * capacityKwh;
  }

  /** SOC em %, sempre entre 0 e 100. */
  get socPercent(): number {
    return clamp((this.energyKwh / this.capacityKwh) * 100, 0, 100);
  }

  /** Energia (kWh) que ainda cabe ate chegar a socPercent informado. */
  energyToSocKwh(targetSocPercent: number): number {
    const target = (clamp(targetSocPercent, 0, 100) / 100) * this.capacityKwh;
    return Math.max(0, target - this.energyKwh);
  }

  /** Adiciona energia recebida; retorna o que de fato foi absorvido (limitado a 100%). */
  charge(kwh: number): number {
    if (kwh <= 0) return 0;
    const absorbed = Math.min(kwh, this.capacityKwh - this.energyKwh);
    this.energyKwh += absorbed;
    return absorbed;
  }

  reset(socPercent: number): void {
    this.energyKwh = (clamp(socPercent, 0, 100) / 100) * this.capacityKwh;
  }
}
