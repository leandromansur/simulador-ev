import { currentAmps, powerKw } from './meter';

export type ProfilePurpose = 'ChargePointMaxProfile' | 'TxDefaultProfile' | 'TxProfile';

export interface SchedulePeriod {
  startPeriod: number;
  limit: number;
  numberOfPhases?: number;
}

export interface ChargingSchedule {
  duration?: number;
  startSchedule?: string;
  chargingRateUnit: 'W' | 'A';
  chargingSchedulePeriod: SchedulePeriod[];
  minChargingRate?: number;
}

export interface ChargingProfile {
  chargingProfileId: number;
  transactionId?: number;
  stackLevel: number;
  chargingProfilePurpose: ProfilePurpose;
  chargingProfileKind: 'Absolute' | 'Recurring' | 'Relative';
  recurrencyKind?: 'Daily' | 'Weekly';
  validFrom?: string;
  validTo?: string;
  chargingSchedule: ChargingSchedule;
}

export interface StoredProfile {
  connectorId: number;
  profile: ChargingProfile;
}

export interface Electrical {
  voltage: number;
  phases: 1 | 3;
  powerFactor: number;
}

export interface TxContext {
  transactionId: number;
  startedAtMs: number;
}

export const MAX_STACK_LEVEL = 10;
export const MAX_PERIODS = 24;
export const MAX_PROFILES = 20;

const DAY_S = 86_400;
const WEEK_S = 604_800;

/** Valida o ChargingProfile (retorna mensagem de erro ou undefined). */
export function validateProfile(p: ChargingProfile): string | undefined {
  if (!p || typeof p !== 'object') return 'csChargingProfiles ausente';
  if (!Number.isInteger(p.chargingProfileId)) return 'chargingProfileId invalido';
  if (!Number.isInteger(p.stackLevel) || p.stackLevel < 0 || p.stackLevel > MAX_STACK_LEVEL) {
    return 'stackLevel fora do limite';
  }
  if (!['ChargePointMaxProfile', 'TxDefaultProfile', 'TxProfile'].includes(p.chargingProfilePurpose)) {
    return 'chargingProfilePurpose invalido';
  }
  if (!['Absolute', 'Recurring', 'Relative'].includes(p.chargingProfileKind)) {
    return 'chargingProfileKind invalido';
  }
  if (p.chargingProfileKind === 'Recurring' && !p.recurrencyKind) return 'recurrencyKind obrigatorio';
  const s = p.chargingSchedule;
  if (!s || (s.chargingRateUnit !== 'W' && s.chargingRateUnit !== 'A')) return 'chargingRateUnit invalido';
  const periods = s.chargingSchedulePeriod;
  if (!Array.isArray(periods) || periods.length === 0 || periods.length > MAX_PERIODS) {
    return 'chargingSchedulePeriod invalido';
  }
  if (periods[0].startPeriod !== 0) return 'primeiro startPeriod deve ser 0';
  for (let i = 0; i < periods.length; i++) {
    const per = periods[i];
    if (typeof per.limit !== 'number' || per.limit < 0 || typeof per.startPeriod !== 'number') {
      return 'periodo invalido';
    }
    if (i > 0 && per.startPeriod <= periods[i - 1].startPeriod) return 'startPeriod nao crescente';
  }
  return undefined;
}

/** Converte limite do schedule para kW. */
function toKw(limit: number, unit: 'W' | 'A', e: Electrical): number {
  return unit === 'W' ? limit / 1000 : powerKw(limit, e.voltage, e.phases, e.powerFactor);
}

/** Limite (kW) do perfil no instante, ou undefined se o perfil nao esta ativo. */
function profileLimitKw(
  p: ChargingProfile,
  nowMs: number,
  tx: TxContext | null,
  e: Electrical,
): number | undefined {
  if (p.validFrom && nowMs < Date.parse(p.validFrom)) return undefined;
  if (p.validTo && nowMs > Date.parse(p.validTo)) return undefined;
  const s = p.chargingSchedule;
  let startMs: number;
  if (p.chargingProfileKind === 'Relative') {
    startMs = tx?.startedAtMs ?? nowMs;
  } else {
    if (!s.startSchedule) return undefined;
    startMs = Date.parse(s.startSchedule);
    if (!Number.isFinite(startMs)) return undefined;
  }
  let elapsed = Math.floor((nowMs - startMs) / 1000);
  if (elapsed < 0) return undefined;
  if (p.chargingProfileKind === 'Recurring') {
    elapsed %= p.recurrencyKind === 'Weekly' ? WEEK_S : DAY_S;
  }
  if (s.duration !== undefined && elapsed >= s.duration) return undefined;
  let current: SchedulePeriod | undefined;
  for (const per of s.chargingSchedulePeriod) if (per.startPeriod <= elapsed) current = per;
  return current ? toKw(current.limit, s.chargingRateUnit, e) : undefined;
}

export class ChargingProfileStore {
  private items: StoredProfile[] = [];

  list(): StoredProfile[] {
    return [...this.items];
  }

  get count(): number {
    return this.items.length;
  }

  /** Substitui perfil com mesmo id, ou mesmo (purpose, stackLevel, connector). */
  set(connectorId: number, profile: ChargingProfile): void {
    this.items = this.items.filter(
      (i) =>
        i.profile.chargingProfileId !== profile.chargingProfileId &&
        !(
          i.connectorId === connectorId &&
          i.profile.chargingProfilePurpose === profile.chargingProfilePurpose &&
          i.profile.stackLevel === profile.stackLevel
        ),
    );
    this.items.push({ connectorId, profile });
  }

  clear(f: {
    id?: number;
    connectorId?: number;
    purpose?: ProfilePurpose;
    stackLevel?: number;
  }): number {
    const before = this.items.length;
    this.items = this.items.filter((i) => {
      const match =
        (f.id === undefined || i.profile.chargingProfileId === f.id) &&
        (f.connectorId === undefined || i.connectorId === f.connectorId) &&
        (f.purpose === undefined || i.profile.chargingProfilePurpose === f.purpose) &&
        (f.stackLevel === undefined || i.profile.stackLevel === f.stackLevel);
      return !match;
    });
    return before - this.items.length;
  }

  /** Remove perfis TxProfile da transacao encerrada. */
  clearTxProfiles(transactionId: number): void {
    this.items = this.items.filter(
      (i) =>
        !(i.profile.chargingProfilePurpose === 'TxProfile' && i.profile.transactionId === transactionId),
    );
  }

  /**
   * Limite efetivo (kW) no instante: min(ChargePointMax, TxProfile ?? TxDefault).
   * undefined = sem limitacao por perfis.
   */
  limitKw(nowMs: number, tx: TxContext | null, e: Electrical): number | undefined {
    const pick = (purpose: ProfilePurpose): number | undefined => {
      const candidates = this.items
        .filter((i) => i.profile.chargingProfilePurpose === purpose)
        .filter((i) => purpose !== 'TxProfile' || (tx && (i.profile.transactionId ?? tx.transactionId) === tx.transactionId))
        .sort((a, b) => b.profile.stackLevel - a.profile.stackLevel);
      for (const c of candidates) {
        const v = profileLimitKw(c.profile, nowMs, tx, e);
        if (v !== undefined) return v;
      }
      return undefined;
    };
    const max = pick('ChargePointMaxProfile');
    const txLimit = (tx ? pick('TxProfile') : undefined) ?? pick('TxDefaultProfile');
    if (max === undefined) return txLimit;
    if (txLimit === undefined) return max;
    return Math.min(max, txLimit);
  }

  /** Agenda composta amostrada (para GetCompositeSchedule). */
  composite(
    nowMs: number,
    durationS: number,
    unit: 'W' | 'A',
    tx: TxContext | null,
    e: Electrical,
    maxKw: number,
  ): ChargingSchedule {
    const step = Math.max(60, Math.ceil(durationS / 200));
    const periods: SchedulePeriod[] = [];
    for (let t = 0; t < durationS; t += step) {
      const kw = Math.min(maxKw, this.limitKw(nowMs + t * 1000, tx, e) ?? maxKw);
      const limit =
        unit === 'W'
          ? Math.round(kw * 1000)
          : Math.round(currentAmps(kw, e.voltage, e.phases, e.powerFactor) * 10) / 10;
      const last = periods[periods.length - 1];
      if (!last || last.limit !== limit) periods.push({ startPeriod: t, limit });
    }
    return {
      duration: durationS,
      startSchedule: new Date(nowMs).toISOString(),
      chargingRateUnit: unit,
      chargingSchedulePeriod: periods,
    };
  }
}
