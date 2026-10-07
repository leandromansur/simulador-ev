/** Chaves de configuracao OCPP 1.6 (GetConfiguration / ChangeConfiguration). */

export type ChangeResult = 'Accepted' | 'Rejected' | 'RebootRequired' | 'NotSupported';

export const SUPPORTED_MEASURANDS = [
  'Energy.Active.Import.Register',
  'Power.Active.Import',
  'Current.Import',
  'Current.Offered',
  'Power.Offered',
  'Voltage',
  'Frequency',
  'Power.Factor',
  'Temperature',
  'SoC',
] as const;

type Kind = 'int' | 'bool' | 'csv' | 'string' | 'measurands';

interface Entry {
  value: string;
  readonly: boolean;
  kind: Kind;
  reboot?: boolean;
  min?: number;
}

export interface ConfigKeyView {
  key: string;
  readonly: boolean;
  value: string;
}

const def = (value: string, kind: Kind, extra: Partial<Entry> = {}): Entry => ({
  value,
  readonly: false,
  kind,
  ...extra,
});
const ro = (value: string, kind: Kind = 'string'): Entry => ({ value, readonly: true, kind });

export interface ConfigurationDefaults {
  heartbeatIntervalSeconds: number;
  meterIntervalSeconds: number;
  connectors: number;
}

export class ConfigurationStore {
  private readonly entries = new Map<string, Entry>();
  /** Chamado apos cada alteracao aceita (para aplicar ao comportamento do simulador). */
  onChange: (key: string, value: string) => void = () => {};

  constructor(d: ConfigurationDefaults) {
    const base = 'Energy.Active.Import.Register,Power.Active.Import,Current.Import,Voltage,SoC';
    const table: Record<string, Entry> = {
      // Core
      AllowOfflineTxForUnknownId: def('false', 'bool'),
      AuthorizationCacheEnabled: def('false', 'bool'),
      AuthorizeRemoteTxRequests: def('false', 'bool'),
      BlinkRepeat: def('0', 'int', { min: 0 }),
      ClockAlignedDataInterval: def('0', 'int', { min: 0 }),
      ConnectionTimeOut: def('60', 'int', { min: 1 }),
      ConnectorPhaseRotation: def('0.NotApplicable', 'csv'),
      ConnectorPhaseRotationMaxLength: ro('1', 'int'),
      GetConfigurationMaxKeys: ro('99', 'int'),
      HeartbeatInterval: def(String(d.heartbeatIntervalSeconds), 'int', { min: 0 }),
      LightIntensity: def('100', 'int', { min: 0 }),
      LocalAuthorizeOffline: def('true', 'bool'),
      LocalPreAuthorize: def('false', 'bool'),
      MaxEnergyOnInvalidId: def('0', 'int', { min: 0 }),
      MeterValuesAlignedData: def('Energy.Active.Import.Register', 'measurands'),
      MeterValuesAlignedDataMaxLength: ro('10', 'int'),
      MeterValuesSampledData: def(base, 'measurands'),
      MeterValuesSampledDataMaxLength: ro('10', 'int'),
      MeterValueSampleInterval: def(String(d.meterIntervalSeconds), 'int', { min: 0 }),
      MinimumStatusDuration: def('0', 'int', { min: 0 }),
      NumberOfConnectors: ro(String(d.connectors), 'int'),
      ResetRetries: def('1', 'int', { min: 0 }),
      StopTransactionOnEVSideDisconnect: def('true', 'bool'),
      StopTransactionOnInvalidId: def('true', 'bool'),
      StopTxnAlignedData: def('', 'measurands'),
      StopTxnAlignedDataMaxLength: ro('10', 'int'),
      StopTxnSampledData: def('', 'measurands'),
      StopTxnSampledDataMaxLength: ro('10', 'int'),
      SupportedFeatureProfiles: ro(
        'Core,FirmwareManagement,LocalAuthListManagement,Reservation,SmartCharging,RemoteTrigger',
      ),
      SupportedFeatureProfilesMaxLength: ro('6', 'int'),
      TransactionMessageAttempts: def('3', 'int', { min: 1 }),
      TransactionMessageRetryInterval: def('10', 'int', { min: 1 }),
      UnlockConnectorOnEVSideDisconnect: def('true', 'bool'),
      WebSocketPingInterval: def('0', 'int', { min: 0 }),
      // Local Auth List
      LocalAuthListEnabled: def('true', 'bool'),
      LocalAuthListMaxLength: ro('100', 'int'),
      SendLocalListMaxLength: ro('100', 'int'),
      // Reservation
      ReserveConnectorZeroSupported: ro('false', 'bool'),
      // Smart Charging
      ChargeProfileMaxStackLevel: ro('10', 'int'),
      ChargingScheduleAllowedChargingRateUnit: ro('Current,Power', 'csv'),
      ChargingScheduleMaxPeriods: ro('24', 'int'),
      MaxChargingProfilesInstalled: ro('20', 'int'),
    };
    for (const [k, v] of Object.entries(table)) this.entries.set(k, v);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): string | undefined {
    return this.entries.get(key)?.value;
  }

  getInt(key: string, fallback = 0): number {
    const n = Number(this.get(key));
    return Number.isFinite(n) ? n : fallback;
  }

  getBool(key: string): boolean {
    return this.get(key) === 'true';
  }

  getList(key: string): string[] {
    return (this.get(key) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  list(): ConfigKeyView[] {
    return [...this.entries].map(([key, e]) => ({ key, readonly: e.readonly, value: e.value }));
  }

  /** Resposta de GetConfiguration. Sem `keys`, devolve todas. */
  query(keys?: string[]): { configurationKey: ConfigKeyView[]; unknownKey?: string[] } {
    if (!keys || keys.length === 0) return { configurationKey: this.list() };
    const configurationKey: ConfigKeyView[] = [];
    const unknownKey: string[] = [];
    for (const key of keys) {
      const e = this.entries.get(key);
      if (e) configurationKey.push({ key, readonly: e.readonly, value: e.value });
      else unknownKey.push(key);
    }
    return unknownKey.length ? { configurationKey, unknownKey } : { configurationKey };
  }

  /** ChangeConfiguration vindo do CSMS. */
  change(key: string, value: string): ChangeResult {
    const e = this.entries.get(key);
    if (!e) return 'NotSupported';
    if (e.readonly || typeof value !== 'string' || !this.valid(e, value)) return 'Rejected';
    e.value = value;
    this.onChange(key, value);
    return e.reboot ? 'RebootRequired' : 'Accepted';
  }

  /** Atualiza sem disparar onChange (valor imposto pelo proprio simulador). */
  setQuiet(key: string, value: string): void {
    const e = this.entries.get(key);
    if (e) e.value = value;
  }

  /** Alteracao local (interface): ignora readonly e permite criar chaves novas. */
  force(key: string, value: string): void {
    const e = this.entries.get(key);
    if (e) e.value = value;
    else this.entries.set(key, { value, readonly: false, kind: 'string' });
    this.onChange(key, value);
  }

  private valid(e: Entry, value: string): boolean {
    switch (e.kind) {
      case 'int': {
        if (!/^-?\d+$/.test(value)) return false;
        return Number(value) >= (e.min ?? Number.MIN_SAFE_INTEGER);
      }
      case 'bool':
        return value === 'true' || value === 'false';
      case 'measurands': {
        if (value === '') return true;
        const items = value.split(',').map((s) => s.trim());
        return items.every((m) => (SUPPORTED_MEASURANDS as readonly string[]).includes(m));
      }
      default:
        return value.length <= 500;
    }
  }
}
