import { Battery } from './battery';

const EPSILON_KWH = 1e-9;

export class Vehicle {
  battery: Battery;
  private plugged = false;

  constructor(
    capacityKwh: number,
    public initialSoc: number,
    public targetSoc: number,
  ) {
    if (targetSoc <= initialSoc) {
      throw new RangeError(`targetSoc (${targetSoc}) deve ser maior que initialSoc (${initialSoc})`);
    }
    this.battery = new Battery(capacityKwh, initialSoc);
  }

  get socPercent(): number {
    return this.battery.socPercent;
  }

  get isPluggedIn(): boolean {
    return this.plugged;
  }

  /** Conecta o veiculo; cada nova conexao representa um veiculo chegando com o SOC inicial. */
  plugIn(): void {
    this.battery.reset(this.initialSoc);
    this.plugged = true;
  }

  /** Troca a bateria (nova capacidade) mantendo o SOC inicial. */
  setCapacity(capacityKwh: number): void {
    this.battery = new Battery(capacityKwh, this.initialSoc);
  }

  unplug(): void {
    this.plugged = false;
  }

  energyToTargetKwh(): number {
    return this.battery.energyToSocKwh(this.targetSoc);
  }

  targetReached(): boolean {
    return this.energyToTargetKwh() <= EPSILON_KWH;
  }
}
