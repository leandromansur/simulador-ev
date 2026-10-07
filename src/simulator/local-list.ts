import type { IdTagInfo } from '../ocpp/types';

export interface LocalAuthEntry {
  idTag: string;
  idTagInfo?: IdTagInfo;
}

export const LOCAL_LIST_MAX = 100;

/** Local Authorization List (OCPP 1.6 SendLocalList / GetLocalListVersion). */
export class LocalAuthList {
  version = 0;
  private readonly map = new Map<string, IdTagInfo>();

  get size(): number {
    return this.map.size;
  }

  entries(): Array<{ idTag: string; idTagInfo: IdTagInfo }> {
    return [...this.map].map(([idTag, idTagInfo]) => ({ idTag, idTagInfo }));
  }

  /** Retorna o status da resposta de SendLocalList. */
  apply(
    listVersion: number,
    type: 'Full' | 'Differential',
    list: LocalAuthEntry[] = [],
  ): 'Accepted' | 'Failed' | 'VersionMismatch' {
    if (!Number.isInteger(listVersion) || (type !== 'Full' && type !== 'Differential')) return 'Failed';
    if (type === 'Differential' && listVersion <= this.version) return 'VersionMismatch';
    const next = new Map(type === 'Full' ? [] : this.map);
    for (const e of list) {
      if (typeof e?.idTag !== 'string' || !e.idTag) return 'Failed';
      if (e.idTagInfo) next.set(e.idTag, e.idTagInfo);
      else next.delete(e.idTag);
    }
    if (next.size > LOCAL_LIST_MAX) return 'Failed';
    this.map.clear();
    for (const [k, v] of next) this.map.set(k, v);
    this.version = listVersion;
    return 'Accepted';
  }

  /** true se o idTag esta na lista com status Accepted e nao expirado. */
  accepts(idTag: string, nowMs: number): boolean {
    const info = this.map.get(idTag);
    if (!info || info.status !== 'Accepted') return false;
    return !info.expiryDate || Date.parse(info.expiryDate) > nowMs;
  }
}

export interface Reservation {
  reservationId: number;
  connectorId: number;
  idTag: string;
  parentIdTag?: string;
  expiryDate: string;
}
