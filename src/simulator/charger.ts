import type { Config } from '../config';
import type { Transport } from '../ocpp/client';
import {
  OcppCallError,
  buildMeterValuesPayload,
  buildSampledValues,
  type MeterSample,
} from '../ocpp/messages';
import type {
  BootNotificationResponse,
  ChargePointErrorCode,
  ConnectorStatus,
  RemoteStartTransactionRequest,
  RemoteStopTransactionRequest,
  ResetRequest,
  StartTransactionResponse,
  StopReason,
  StopTransactionRequest,
} from '../ocpp/types';
import type { Logger } from '../utils/logger';
import { Connector } from './connector';
import { EnergyMeter, currentAmps, energyKwh } from './meter';
import { Vehicle } from './vehicle';
import { ConfigurationStore } from './configuration';
import { LocalAuthList, type Reservation } from './local-list';
import {
  ChargingProfileStore,
  MAX_PROFILES,
  validateProfile,
  type ChargingProfile,
  type Electrical,
} from './smart-charging';

const NOT_SUPPORTED = ['NotSupported', 'NotImplemented'];
const TICK_INTERVAL_MS = 1000;
const MS_PER_HOUR = 3_600_000;
const DEFAULT_BOOT_RETRY_MS = 30_000;
const SHUTDOWN_STOP_TIMEOUT_MS = 5_000;

type Status = 'Accepted' | 'Rejected';

/** Charge Point simulado: orquestra OCPP, conector, veiculo e medidor. */
export class ChargePoint {
  readonly connector: Connector;
  readonly vehicle: Vehicle;
  readonly meter = new EnergyMeter();
  registered = false;

  readonly config: ConfigurationStore;
  readonly profiles = new ChargingProfileStore();
  readonly localList = new LocalAuthList();
  readonly authCache = new Set<string>();
  reservation: Reservation | null = null;
  errorCode: ChargePointErrorCode = 'NoError';
  inoperative = false;
  diagnosticsStatus = 'Idle';
  firmwareStatus = 'Idle';
  /** Comportamentos injetaveis para testar o CSMS. */
  behavior = { firmwareFails: false, diagnosticsFails: false, unlockFails: false };

  private inoperativePending = false;
  private suspendedByProfile = false;
  private pendingReservationId: number | undefined;
  private reservationTimer: ReturnType<typeof setTimeout> | null = null;
  private alignedTimer: ReturnType<typeof setTimeout> | null = null;

  private epoch = 0;
  private starting = false;
  private meterValuesUnsupported = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private autoStartTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private pendingStops: StopTransactionRequest[] = [];
  private readonly background = new Set<Promise<unknown>>();

  constructor(
    private readonly cfg: Config,
    private readonly transport: Transport,
    private readonly log: Logger,
    private readonly clock: () => number = Date.now,
  ) {
    this.config = new ConfigurationStore({
      heartbeatIntervalSeconds: cfg.heartbeatIntervalSeconds,
      meterIntervalSeconds: cfg.meterIntervalSeconds,
      connectors: 1,
    });
    this.config.onChange = (key, value) => this.onConfigChanged(key, value);
    this.vehicle = new Vehicle(cfg.batteryKwh, cfg.initialSoc, cfg.targetSoc);
    this.connector = new Connector(cfg.connectorId, (to, from) => {
      this.log.info(`STATE: ${from} -> ${to}`);
      this.sendStatus(to);
    });
  }

  // ---- Ciclo de conexao -------------------------------------------------

  onConnected(): void {
    this.meterValuesUnsupported = false;
    this.startBoot();
  }

  onDisconnected(): void {
    this.registered = false;
    this.epoch++;
    this.clearSessionlessTimers();
    this.log.warn('Charge Point offline; heartbeat pausado');
  }

  /** Aguarda as tarefas assincronas em andamento (util em testes). */
  async settled(): Promise<void> {
    while (this.background.size > 0) await Promise.all([...this.background]);
  }

  async shutdown(): Promise<void> {
    this.epoch++;
    this.clearSessionlessTimers();
    if (this.connector.transaction) {
      await Promise.race([
        this.stopTransaction('Other'),
        new Promise((resolve) => setTimeout(resolve, SHUTDOWN_STOP_TIMEOUT_MS)),
      ]);
    }
    this.clearChargeTimers();
  }

  // ---- BootNotification / Heartbeat ------------------------------------

  private startBoot(): void {
    this.epoch++;
    this.registered = false;
    this.clearSessionlessTimers();
    this.track(this.boot(this.epoch));
  }

  private async boot(epoch: number): Promise<void> {
    let retryMs = DEFAULT_BOOT_RETRY_MS;
    try {
      const res: BootNotificationResponse = await this.transport.call(
        'BootNotification',
        this.bootPayload(),
      );
      if (epoch !== this.epoch) return;
      this.log.info(`BootNotification.conf Status: ${res.status}`, {
        interval: res.interval,
        currentTime: res.currentTime,
      });
      if (res.status === 'Accepted') {
        this.onRegistered(res);
        return;
      }
      this.log.warn(`Boot ${res.status}; nova tentativa conforme interval do CSMS`);
      if (res.interval > 0) retryMs = res.interval * 1000;
    } catch (err) {
      if (epoch !== this.epoch) return;
      this.log.error(`BootNotification falhou: ${(err as Error).message}`);
      retryMs = this.cfg.reconnectIntervalSeconds * 1000;
    }
    this.bootTimer = setTimeout(() => {
      this.bootTimer = null;
      if (epoch === this.epoch) this.track(this.boot(epoch));
    }, retryMs);
  }

  private onRegistered(res: BootNotificationResponse): void {
    this.registered = true;
    const interval = res.interval > 0 ? res.interval : this.cfg.heartbeatIntervalSeconds;
    this.config.setQuiet('HeartbeatInterval', String(interval));
    this.startHeartbeat(interval);
    this.restartAligned();
    this.sendStatus(this.inoperative ? 'Unavailable' : 'Available', 'NoError', 0);
    this.sendStatus(this.connector.status);
    this.track(this.flushPendingStops());
    if (this.cfg.autoStartTransaction && this.connector.status === 'Available') {
      this.log.info(`AUTO_START_TRANSACTION: iniciando em ${this.cfg.autoStartDelaySeconds}s`);
      this.autoStartTimer = setTimeout(() => {
        this.autoStartTimer = null;
        this.track(this.startLocalSession());
      }, this.cfg.autoStartDelaySeconds * 1000);
    }
  }

  private startHeartbeat(intervalSeconds: number): void {
    this.stopHeartbeat();
    this.log.info(`Heartbeat a cada ${intervalSeconds}s`);
    this.heartbeatTimer = setInterval(() => {
      if (!this.registered || !this.transport.isConnected()) return;
      this.track(
        this.transport.call('Heartbeat', {}).then((r) => {
          this.log.debug(`Heartbeat.conf currentTime=${r?.currentTime}`);
        }),
      );
    }, intervalSeconds * 1000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  // ---- StatusNotification ----------------------------------------------

  private sendStatus(
    status: ConnectorStatus,
    errorCode: ChargePointErrorCode = this.errorCode,
    connectorId: number = this.connector.id,
    extra: { info?: string; vendorErrorCode?: string } = {},
  ): void {
    if (!this.registered || !this.transport.isConnected()) return;
    this.track(
      this.transport.call('StatusNotification', {
        connectorId,
        errorCode,
        status,
        timestamp: new Date(this.clock()).toISOString(),
        ...(extra.info ? { info: extra.info.slice(0, 50) } : {}),
        ...(extra.vendorErrorCode ? { vendorErrorCode: extra.vendorErrorCode.slice(0, 50) } : {}),
      }),
    );
  }

  // ---- Sessao de carga --------------------------------------------------

  /** Reserva o conector de forma sincrona (evita transacoes simultaneas). */
  private prepare(idTag?: string): boolean {
    if (this.starting || this.connector.transaction) return false;
    const r = this.reservation;
    const reservedForTag =
      this.connector.status === 'Reserved' &&
      !!r &&
      idTag !== undefined &&
      (idTag === r.idTag || (!!r.parentIdTag && idTag === r.parentIdTag));
    if (this.connector.status !== 'Available' && !reservedForTag) return false;
    this.pendingReservationId = reservedForTag ? r!.reservationId : undefined;
    this.starting = true;
    this.vehicle.plugIn();
    this.connector.machine.transition('Preparing');
    return true;
  }

  private abortPreparing(): void {
    this.vehicle.unplug();
    this.pendingReservationId = undefined;
    if (this.connector.status === 'Preparing') {
      this.connector.machine.transition(this.reservation ? 'Reserved' : 'Available');
    }
    this.applyPendingAvailability();
  }

  /** Veiculo conectado localmente: Authorize -> StartTransaction -> Charging. */
  async startLocalSession(idTag: string = this.cfg.idTag): Promise<boolean> {
    if (!this.registered || !this.transport.isConnected()) {
      this.log.warn('Sessao local ignorada: Charge Point nao registrado');
      return false;
    }
    if (!this.prepare(idTag)) {
      this.log.warn(`Sessao local ignorada: conector em ${this.connector.status}`);
      return false;
    }
    try {
      // CSMS Inovative ainda nao implementa Authorize (NotSupported): a autorizacao
      // passa a ser decidida pelo StartTransaction.
      let status: string | undefined = 'Accepted';
      try {
        if (this.preAuthorized(idTag)) {
          this.log.info(`LocalPreAuthorize: idTag=${idTag} aceito localmente (sem Authorize)`);
        } else {
          status = (await this.transport.call('Authorize', { idTag }))?.idTagInfo?.status;
          if (status === 'Accepted' && this.config.getBool('AuthorizationCacheEnabled')) {
            this.authCache.add(idTag);
          }
        }
      } catch (err) {
        if (!(err instanceof OcppCallError) || !NOT_SUPPORTED.includes(err.code)) throw err;
        this.log.warn('CSMS nao suporta Authorize; seguindo direto para StartTransaction');
      }
      if (status !== 'Accepted') {
        this.log.warn(`Authorize nao aceito para idTag=${idTag}: ${status}`);
        this.abortPreparing();
        return false;
      }
      return await this.beginTransaction(idTag);
    } catch (err) {
      this.log.error(`Authorize falhou: ${(err as Error).message}`);
      this.abortPreparing();
      return false;
    } finally {
      this.starting = false;
    }
  }

  private async beginTransaction(idTag: string): Promise<boolean> {
    try {
      const meterStart = this.meter.registerWhRounded;
      const reservationId = this.pendingReservationId;
      const res: StartTransactionResponse = await this.transport.call('StartTransaction', {
        connectorId: this.connector.id,
        idTag,
        meterStart,
        timestamp: new Date(this.clock()).toISOString(),
        ...(reservationId !== undefined ? { reservationId } : {}),
      });
      if (res?.idTagInfo?.status !== 'Accepted' || typeof res.transactionId !== 'number') {
        this.log.warn(`StartTransaction recusada: ${res?.idTagInfo?.status}`);
        this.abortPreparing();
        return false;
      }
      const now = this.clock();
      this.connector.transaction = {
        transactionId: res.transactionId,
        idTag,
        startedAtMs: now,
        meterStartWh: meterStart,
        sessionEnergyKwh: 0,
        lastTickMs: now,
        powerKw: this.cfg.maxPowerKw,
      };
      if (reservationId !== undefined) this.clearReservation();
      this.pendingReservationId = undefined;
      this.connector.transaction.powerKw = this.effectivePowerKw();
      this.connector.machine.transition('Charging');
      this.log.info(`Transacao iniciada transactionId=${res.transactionId} idTag=${idTag}`);
      this.startChargeTimers();
      return true;
    } catch (err) {
      this.log.error(`StartTransaction falhou: ${(err as Error).message}`);
      this.connector.transaction = null;
      this.abortPreparing();
      return false;
    }
  }

  private startChargeTimers(): void {
    this.clearChargeTimers();
    this.tickTimer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    if (this.cfg.meterIntervalSeconds > 0) {
      this.meterTimer = setInterval(
        () => this.track(this.sendMeterValues()),
        this.cfg.meterIntervalSeconds * 1000,
      );
    }
  }

  private clearChargeTimers(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.tickTimer = null;
    this.meterTimer = null;
  }

  private clearSessionlessTimers(): void {
    this.stopHeartbeat();
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.autoStartTimer) clearTimeout(this.autoStartTimer);
    this.bootTimer = null;
    this.autoStartTimer = null;
    if (this.alignedTimer) clearTimeout(this.alignedTimer);
    this.alignedTimer = null;
  }

  private electrical(): Electrical {
    return { voltage: this.cfg.voltage, phases: this.cfg.phases, powerFactor: this.cfg.powerFactor };
  }

  private txContext() {
    const tx = this.connector.transaction;
    return tx ? { transactionId: tx.transactionId, startedAtMs: tx.startedAtMs } : null;
  }

  /** Potencia efetiva (kW): limite do carregador reduzido pelos perfis de carga ativos. */
  effectivePowerKw(): number {
    const limit = this.profiles.limitKw(this.clock(), this.txContext(), this.electrical());
    return limit === undefined ? this.cfg.maxPowerKw : Math.max(0, Math.min(this.cfg.maxPowerKw, limit));
  }

  /** Integra energia/SOC pelo tempo real transcorrido desde o ultimo tick. */
  private accumulate(): void {
    const tx = this.connector.transaction;
    if (!tx || this.connector.status !== 'Charging') return;
    const now = this.clock();
    const hours = Math.max(0, now - tx.lastTickMs) / MS_PER_HOUR;
    tx.lastTickMs = now;
    // Nunca ultrapassa o SOC alvo: limita a energia ao que falta.
    const delivered = Math.min(energyKwh(tx.powerKw, hours), this.vehicle.energyToTargetKwh());
    const absorbed = this.vehicle.battery.charge(delivered);
    tx.sessionEnergyKwh += absorbed;
    this.meter.add(absorbed);
    tx.powerKw = this.effectivePowerKw();
  }

  /** Avanca a simulacao; encerra a carga ao atingir o SOC alvo. */
  tick(): void {
    this.accumulate();
    const tx = this.connector.transaction;
    if (!tx) return;
    if (this.connector.status === 'Charging') {
      if (this.vehicle.targetReached()) {
        this.log.info(`SOC alvo atingido (${this.vehicle.socPercent.toFixed(1)}%)`);
        this.track(this.stopTransaction('Local'));
      } else if (tx.powerKw <= 0) {
        this.suspendedByProfile = true;
        this.connector.machine.transition('SuspendedEVSE');
      }
    } else if (this.connector.status === 'SuspendedEVSE' && this.suspendedByProfile) {
      if (this.effectivePowerKw() > 0) this.resume();
    }
  }

  /** MeterValues periodico da transacao ativa. */
  async sendMeterValues(): Promise<void> {
    const tx = this.connector.transaction;
    const st = this.connector.status;
    if (!tx || (st !== 'Charging' && st !== 'SuspendedEV' && st !== 'SuspendedEVSE')) return;
    await this.sendMeterSample('Sample.Periodic', this.config.getList('MeterValuesSampledData'));
  }

  private buildSample(context: string, measurands: string[]): MeterSample {
    const tx = this.connector.transaction;
    const charging = !!tx && this.connector.status === 'Charging';
    const powerKw = charging ? tx!.powerKw : 0;
    const voltage = this.cfg.voltage;
    const offeredKw = this.effectivePowerKw();
    return {
      connectorId: this.connector.id,
      transactionId: tx?.transactionId,
      timestamp: new Date(this.clock()),
      energyWh: this.meter.registerWh,
      powerW: powerKw * 1000,
      currentA: currentAmps(powerKw, voltage, this.cfg.phases, this.cfg.powerFactor),
      voltageV: voltage,
      socPercent: this.vehicle.socPercent,
      measurands,
      context,
      offeredPowerW: offeredKw * 1000,
      offeredCurrentA: currentAmps(offeredKw, voltage, this.cfg.phases, this.cfg.powerFactor),
      powerFactor: this.cfg.powerFactor,
      frequencyHz: 60,
      temperatureC: 28 + powerKw * 0.6,
    };
  }

  /** Envia MeterValues (com ou sem transacao) com os measurands informados. */
  async sendMeterSample(context: string, measurands: string[]): Promise<void> {
    this.accumulate();
    const sample = this.buildSample(context, measurands);
    if (this.connector.transaction) {
      this.log.info(
        `SOC: ${sample.socPercent.toFixed(1)}% | Voltage: ${sample.voltageV.toFixed(1)} V | ` +
          `Current: ${sample.currentA.toFixed(1)} A | Power: ${(sample.powerW / 1000).toFixed(1)} kW | ` +
          `Energy: ${this.connector.transaction.sessionEnergyKwh.toFixed(2)} kWh`,
      );
    }
    if (!this.registered || !this.transport.isConnected()) {
      this.log.warn('MeterValues nao enviado: offline');
      return;
    }
    if (this.meterValuesUnsupported) return;
    try {
      await this.transport.call('MeterValues', buildMeterValuesPayload(sample));
    } catch (err) {
      if (!(err instanceof OcppCallError) || !NOT_SUPPORTED.includes(err.code)) throw err;
      this.meterValuesUnsupported = true;
      this.log.warn('CSMS nao suporta MeterValues; envio desativado ate reconectar');
    }
  }

  /** Charging -> Finishing -> StopTransaction -> Available. */
  async stopTransaction(reason: StopReason): Promise<void> {
    const tx = this.connector.transaction;
    if (!tx) return;
    this.accumulate();
    this.connector.transaction = null; // impede parada duplicada
    this.clearChargeTimers();
    this.suspendedByProfile = false;
    this.connector.machine.transition('Finishing');

    const stopData = this.config.getList('StopTxnSampledData');
    const req: StopTransactionRequest = {
      transactionId: tx.transactionId,
      meterStop: this.meter.registerWhRounded,
      timestamp: new Date(this.clock()).toISOString(),
      idTag: tx.idTag,
      reason,
      ...(stopData.length > 0
        ? {
            transactionData: [
              {
                timestamp: new Date(this.clock()).toISOString(),
                sampledValue: buildSampledValues({
                  ...this.buildSample('Transaction.End', stopData),
                  transactionId: tx.transactionId,
                }),
              },
            ],
          }
        : {}),
    };
    this.log.info(
      `Encerrando transactionId=${tx.transactionId} reason=${reason} energia=${tx.sessionEnergyKwh.toFixed(
        2,
      )} kWh`,
    );
    await this.sendStop(req);
    this.profiles.clearTxProfiles(tx.transactionId);
    this.vehicle.unplug();
    if (this.connector.status === 'Finishing') {
      this.connector.machine.transition(this.reservation ? 'Reserved' : 'Available');
    }
    this.applyPendingAvailability();
  }

  private async sendStop(req: StopTransactionRequest): Promise<void> {
    if (this.registered && this.transport.isConnected()) {
      try {
        await this.transport.call('StopTransaction', req);
        return;
      } catch (err) {
        this.log.error(`StopTransaction falhou: ${(err as Error).message}`);
      }
    }
    this.pendingStops.push(req);
    this.log.warn(`StopTransaction ${req.transactionId} enfileirado ate reconectar`);
  }

  private async flushPendingStops(): Promise<void> {
    while (this.pendingStops.length > 0 && this.registered) {
      try {
        await this.transport.call('StopTransaction', this.pendingStops[0]);
        this.pendingStops.shift();
      } catch (err) {
        this.log.error(`Reenvio de StopTransaction falhou: ${(err as Error).message}`);
        return;
      }
    }
  }

  // ---- Comandos do CSMS -------------------------------------------------

  remoteStart(
    req: RemoteStartTransactionRequest & { chargingProfile?: ChargingProfile },
  ): { status: Status } {
    if (typeof req?.idTag !== 'string' || req.idTag.length === 0 || req.idTag.length > 20) {
      throw new OcppCallError('FormationViolation', 'idTag invalido');
    }
    if (req.connectorId !== undefined && req.connectorId !== this.connector.id) {
      return { status: 'Rejected' };
    }
    if (req.chargingProfile) {
      const err = validateProfile(req.chargingProfile);
      if (err || req.chargingProfile.chargingProfilePurpose !== 'TxProfile') {
        this.log.warn(`RemoteStartTransaction rejeitada: chargingProfile invalido (${err ?? 'purpose'})`);
        return { status: 'Rejected' };
      }
    }
    if (!this.registered || !this.prepare(req.idTag)) {
      this.log.warn(`RemoteStartTransaction rejeitada (estado ${this.connector.status})`);
      return { status: 'Rejected' };
    }
    const idTag = req.idTag;
    this.track(
      (async () => {
        try {
          if (this.config.getBool('AuthorizeRemoteTxRequests')) {
            const auth = await this.transport.call('Authorize', { idTag });
            if (auth?.idTagInfo?.status !== 'Accepted') {
              this.log.warn(`Authorize (remoto) nao aceito: ${auth?.idTagInfo?.status}`);
              this.abortPreparing();
              return;
            }
          }
          if (req.chargingProfile) this.profiles.set(this.connector.id, req.chargingProfile);
          await this.beginTransaction(idTag);
        } catch (err) {
          this.log.error(`RemoteStart falhou: ${(err as Error).message}`);
          this.abortPreparing();
        } finally {
          this.starting = false;
        }
      })(),
    );
    return { status: 'Accepted' };
  }

  remoteStop(req: RemoteStopTransactionRequest): { status: Status } {
    const tx = this.connector.transaction;
    if (!tx || tx.transactionId !== req?.transactionId) {
      this.log.warn(`RemoteStopTransaction rejeitada (transactionId=${req?.transactionId})`);
      return { status: 'Rejected' };
    }
    this.track(this.stopTransaction('Remote'));
    return { status: 'Accepted' };
  }

  reset(req: ResetRequest): { status: Status } {
    if (req?.type !== 'Soft' && req?.type !== 'Hard') return { status: 'Rejected' };
    this.track(this.performReset(req.type));
    return { status: 'Accepted' };
  }

  /** Reset logico: nunca reinicia o container. */
  private async performReset(type: 'Soft' | 'Hard'): Promise<void> {
    this.log.info(`Reset ${type} (logico)`);
    await this.stopTransaction(type === 'Soft' ? 'SoftReset' : 'HardReset');
    this.clearChargeTimers();
    this.starting = false;
    this.vehicle.unplug();
    if (this.connector.status !== 'Available') this.connector.machine.transition('Available');
    if (type === 'Hard') {
      this.registered = false;
      this.epoch++;
      this.clearSessionlessTimers();
      this.transport.reconnect(); // novo BootNotification ocorre em onConnected
    } else {
      this.startBoot();
    }
  }

  // ---- Interface (web) --------------------------------------------------

  /** Estado atual para exibicao. */
  snapshot() {
    const tx = this.connector.transaction;
    const charging = !!tx && this.connector.status === 'Charging';
    const powerKw = charging ? tx.powerKw : 0;
    return {
      chargePointId: this.cfg.chargePointId,
      connected: this.transport.isConnected(),
      registered: this.registered,
      connectorId: this.connector.id,
      status: this.connector.status,
      transaction: tx
        ? {
            transactionId: tx.transactionId,
            idTag: tx.idTag,
            startedAt: new Date(tx.startedAtMs).toISOString(),
            durationSeconds: Math.round((this.clock() - tx.startedAtMs) / 1000),
            sessionEnergyKwh: tx.sessionEnergyKwh,
          }
        : null,
      electrical: {
        voltage: charging ? this.cfg.voltage : 0,
        currentA: charging
          ? currentAmps(powerKw, this.cfg.voltage, this.cfg.phases, this.cfg.powerFactor)
          : 0,
        powerKw,
        meterWh: this.meter.registerWh,
      },
      vehicle: {
        plugged: this.vehicle.isPluggedIn,
        socPercent: this.vehicle.socPercent,
        initialSoc: this.vehicle.initialSoc,
        targetSoc: this.vehicle.targetSoc,
        batteryKwh: this.vehicle.battery.capacityKwh,
      },
      settings: {
        maxPowerKw: this.cfg.maxPowerKw,
        idTag: this.cfg.idTag,
        voltage: this.cfg.voltage,
        phases: this.cfg.phases,
        powerFactor: this.cfg.powerFactor,
        batteryKwh: this.vehicle.battery.capacityKwh,
        vendor: this.cfg.vendor,
        model: this.cfg.model,
        serialNumber: this.cfg.serialNumber,
        firmwareVersion: this.cfg.firmwareVersion,
      },
      errorCode: this.errorCode,
      inoperative: this.inoperative,
      effectivePowerKw: this.effectivePowerKw(),
      diagnosticsStatus: this.diagnosticsStatus,
      firmwareStatus: this.firmwareStatus,
      behavior: this.behavior,
      reservation: this.reservation,
      profiles: this.profiles.list(),
      localList: { version: this.localList.version, entries: this.localList.entries() },
      authCache: [...this.authCache],
      configuration: this.config.list(),
    };
  }

  /** Ajusta parametros em tempo real; lanca RangeError se invalido. */
  updateSettings(s: {
    maxPowerKw?: number;
    initialSoc?: number;
    targetSoc?: number;
    voltage?: number;
    phases?: number;
    powerFactor?: number;
    batteryKwh?: number;
    idTag?: string;
    vendor?: string;
    model?: string;
    serialNumber?: string;
    firmwareVersion?: string;
  }): void {
    const tx = this.connector.transaction;
    if (s.maxPowerKw !== undefined) {
      if (!(s.maxPowerKw >= 0.1 && s.maxPowerKw <= 350)) {
        throw new RangeError('maxPowerKw deve estar entre 0.1 e 350');
      }
    }
    if (s.voltage !== undefined && !(s.voltage >= 1 && s.voltage <= 1000)) {
      throw new RangeError('voltage deve estar entre 1 e 1000');
    }
    if (s.phases !== undefined && s.phases !== 1 && s.phases !== 3) {
      throw new RangeError('phases deve ser 1 ou 3');
    }
    if (s.powerFactor !== undefined && !(s.powerFactor >= 0.01 && s.powerFactor <= 1)) {
      throw new RangeError('powerFactor deve estar entre 0.01 e 1');
    }
    if (s.batteryKwh !== undefined) {
      if (!(s.batteryKwh >= 0.1 && s.batteryKwh <= 1000)) {
        throw new RangeError('batteryKwh deve estar entre 0.1 e 1000');
      }
      if (tx) throw new RangeError('capacidade da bateria so muda sem transacao ativa');
    }
    const initial = s.initialSoc ?? this.vehicle.initialSoc;
    const target = s.targetSoc ?? this.vehicle.targetSoc;
    if (!(initial >= 0 && initial < 100) || !(target > 0 && target <= 100)) {
      throw new RangeError('SOC deve estar entre 0 e 100');
    }
    if (target <= initial) throw new RangeError('SOC alvo deve ser maior que o SOC inicial');
    if (tx && s.targetSoc !== undefined && target <= this.vehicle.socPercent) {
      throw new RangeError('SOC alvo deve ser maior que o SOC atual durante a carga');
    }
    this.accumulate(); // fecha o trecho anterior com os parametros antigos
    if (s.maxPowerKw !== undefined) this.cfg.maxPowerKw = s.maxPowerKw;
    if (s.voltage !== undefined) this.cfg.voltage = s.voltage;
    if (s.phases !== undefined) this.cfg.phases = s.phases;
    if (s.powerFactor !== undefined) this.cfg.powerFactor = s.powerFactor;
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 50) : undefined);
    this.cfg.idTag = text(s.idTag) ?? this.cfg.idTag;
    this.cfg.vendor = text(s.vendor) ?? this.cfg.vendor;
    this.cfg.model = text(s.model) ?? this.cfg.model;
    this.cfg.serialNumber = text(s.serialNumber) ?? this.cfg.serialNumber;
    this.cfg.firmwareVersion = text(s.firmwareVersion) ?? this.cfg.firmwareVersion;
    if (tx) tx.powerKw = this.effectivePowerKw();
    this.vehicle.initialSoc = initial;
    this.vehicle.targetSoc = target;
    if (s.batteryKwh !== undefined) {
      this.cfg.batteryKwh = s.batteryKwh;
      this.vehicle.setCapacity(s.batteryKwh);
    }
    if (!tx && !this.vehicle.isPluggedIn) this.vehicle.battery.reset(initial);
    this.log.info('Configuracoes alteradas', {
      maxPowerKw: this.cfg.maxPowerKw,
      initialSoc: initial,
      targetSoc: target,
      voltage: this.cfg.voltage,
      phases: this.cfg.phases,
    });
  }

  /** Veiculo desconectado pelo usuario: encerra a transacao com EVDisconnected. */
  async unplugVehicle(): Promise<boolean> {
    if (!this.connector.transaction) return false;
    if (!this.config.getBool('StopTransactionOnEVSideDisconnect')) {
      this.log.info('StopTransactionOnEVSideDisconnect=false: transacao mantida em SuspendedEV');
      return this.suspend('EV');
    }
    await this.stopTransaction('EVDisconnected');
    return true;
  }

  // ---- Configuracao OCPP / comandos estendidos --------------------------

  /** Envia qualquer CALL ao CSMS (usado pela interface para mensagens manuais). */
  rawCall(action: string, payload: unknown): Promise<any> {
    return this.transport.call(action, payload);
  }

  bootPayload() {
    return {
      chargePointVendor: this.cfg.vendor,
      chargePointModel: this.cfg.model,
      chargePointSerialNumber: this.cfg.serialNumber,
      firmwareVersion: this.cfg.firmwareVersion,
    };
  }

  private onConfigChanged(key: string, value: string): void {
    const n = Number(value);
    switch (key) {
      case 'HeartbeatInterval':
        if (this.registered) {
          if (n > 0) this.startHeartbeat(n);
          else this.stopHeartbeat();
        }
        break;
      case 'MeterValueSampleInterval':
        this.cfg.meterIntervalSeconds = n;
        if (this.connector.transaction) this.startChargeTimers();
        break;
      case 'ClockAlignedDataInterval':
        this.restartAligned();
        break;
    }
    this.log.info(`Configuracao ${key}=${value}`);
  }

  /** MeterValues alinhado ao relogio (ClockAlignedDataInterval). */
  private restartAligned(): void {
    if (this.alignedTimer) clearTimeout(this.alignedTimer);
    this.alignedTimer = null;
    const seconds = this.config.getInt('ClockAlignedDataInterval');
    if (!(seconds > 0)) return;
    const ms = seconds * 1000;
    const wait = ms - (this.clock() % ms);
    this.alignedTimer = setTimeout(() => {
      if (this.registered) {
        this.track(this.sendMeterSample('Sample.Clock', this.config.getList('MeterValuesAlignedData')));
      }
      this.restartAligned();
    }, wait);
  }

  private preAuthorized(idTag: string): boolean {
    if (!this.config.getBool('LocalPreAuthorize')) return false;
    if (this.config.getBool('LocalAuthListEnabled') && this.localList.accepts(idTag, this.clock())) {
      return true;
    }
    return this.config.getBool('AuthorizationCacheEnabled') && this.authCache.has(idTag);
  }

  getConfiguration(req: { key?: string[] }) {
    if (req?.key !== undefined && !Array.isArray(req.key)) {
      throw new OcppCallError('TypeConstraintViolation', 'key deve ser uma lista');
    }
    return this.config.query(req?.key);
  }

  changeConfiguration(req: { key: string; value: string }): { status: string } {
    if (typeof req?.key !== 'string' || typeof req?.value !== 'string') {
      throw new OcppCallError('FormationViolation', 'key e value sao obrigatorios');
    }
    const status = this.config.change(req.key, req.value);
    if (status === 'Accepted' || status === 'RebootRequired') {
      // ja logado por onConfigChanged
    } else {
      this.log.warn(`ChangeConfiguration ${req.key}=${req.value} -> ${status}`);
    }
    return { status };
  }

  clearCache(): { status: string } {
    if (!this.config.getBool('AuthorizationCacheEnabled')) return { status: 'Rejected' };
    this.authCache.clear();
    this.log.info('Authorization Cache limpo');
    return { status: 'Accepted' };
  }

  // Disponibilidade -------------------------------------------------------

  changeAvailability(req: { connectorId: number; type: string }): { status: string } {
    if (req?.type !== 'Inoperative' && req?.type !== 'Operative') {
      throw new OcppCallError('FormationViolation', 'type invalido');
    }
    if (req.connectorId !== 0 && req.connectorId !== this.connector.id) return { status: 'Rejected' };
    if (req.type === 'Operative') {
      this.inoperative = false;
      this.inoperativePending = false;
      if (this.connector.status === 'Unavailable') {
        this.connector.machine.transition(this.reservation ? 'Reserved' : 'Available');
      }
      if (req.connectorId === 0) this.sendStatus('Available', this.errorCode, 0);
      return { status: 'Accepted' };
    }
    this.inoperative = true;
    if (req.connectorId === 0) this.sendStatus('Unavailable', this.errorCode, 0);
    const st = this.connector.status;
    if (this.connector.transaction || this.starting || st === 'Preparing') {
      this.inoperativePending = true;
      return { status: 'Scheduled' };
    }
    if (st !== 'Unavailable' && this.connector.machine.canTransition('Unavailable')) {
      this.connector.machine.transition('Unavailable');
    }
    return { status: 'Accepted' };
  }

  private applyPendingAvailability(): void {
    if (!this.inoperative) return;
    this.inoperativePending = false;
    if (this.connector.status !== 'Unavailable' && this.connector.machine.canTransition('Unavailable')) {
      this.connector.machine.transition('Unavailable');
    }
  }

  // Falhas / pausas -------------------------------------------------------

  /** Injeta (ou limpa) um erro do carregador; `faulted` muda o conector para Faulted. */
  async setFault(f: {
    errorCode: ChargePointErrorCode;
    faulted?: boolean;
    info?: string;
    vendorErrorCode?: string;
  }): Promise<void> {
    this.errorCode = f.errorCode;
    if (f.errorCode === 'NoError') {
      if (this.connector.status === 'Faulted') {
        this.connector.machine.transition(this.inoperative ? 'Unavailable' : 'Available');
      } else {
        this.sendStatus(this.connector.status, 'NoError');
      }
      return;
    }
    if (f.faulted === false) {
      this.sendStatus(this.connector.status, f.errorCode, this.connector.id, f);
      return;
    }
    if (this.connector.transaction) await this.stopTransaction('Other');
    this.vehicle.unplug();
    if (this.connector.status === 'Faulted') {
      this.sendStatus('Faulted', f.errorCode, this.connector.id, f);
    } else if (this.connector.machine.canTransition('Faulted')) {
      this.connector.machine.transition('Faulted');
    }
  }

  /** Pausa a carga pelo lado do veiculo (SuspendedEV) ou do carregador (SuspendedEVSE). */
  suspend(by: 'EV' | 'EVSE'): boolean {
    if (!this.connector.transaction || this.connector.status !== 'Charging') return false;
    this.accumulate();
    this.suspendedByProfile = false;
    this.connector.machine.transition(by === 'EV' ? 'SuspendedEV' : 'SuspendedEVSE');
    return true;
  }

  resume(): boolean {
    const tx = this.connector.transaction;
    const st = this.connector.status;
    if (!tx || (st !== 'SuspendedEV' && st !== 'SuspendedEVSE')) return false;
    tx.lastTickMs = this.clock();
    tx.powerKw = this.effectivePowerKw();
    this.suspendedByProfile = false;
    this.connector.machine.transition('Charging');
    return true;
  }

  // Reservas --------------------------------------------------------------

  reserveNow(req: Reservation): { status: string } {
    if (
      !Number.isInteger(req?.reservationId) ||
      typeof req?.idTag !== 'string' ||
      !req.idTag ||
      !Number.isFinite(Date.parse(req?.expiryDate))
    ) {
      throw new OcppCallError('FormationViolation', 'ReserveNow invalido');
    }
    if (req.connectorId === 0 || req.connectorId !== this.connector.id) return { status: 'Rejected' };
    if (Date.parse(req.expiryDate) <= this.clock()) return { status: 'Rejected' };
    const st = this.connector.status;
    if (st === 'Faulted') return { status: 'Faulted' };
    if (st === 'Unavailable') return { status: 'Unavailable' };
    const sameReservation = this.reservation?.reservationId === req.reservationId;
    if (!sameReservation && (st !== 'Available' || this.reservation)) return { status: 'Occupied' };
    this.reservation = { ...req };
    this.scheduleReservationExpiry();
    if (st === 'Available') this.connector.machine.transition('Reserved');
    this.log.info(`Reserva ${req.reservationId} para idTag=${req.idTag} ate ${req.expiryDate}`);
    return { status: 'Accepted' };
  }

  cancelReservation(req: { reservationId: number }): { status: string } {
    if (!this.reservation || this.reservation.reservationId !== req?.reservationId) {
      return { status: 'Rejected' };
    }
    this.clearReservation();
    return { status: 'Accepted' };
  }

  private scheduleReservationExpiry(): void {
    if (this.reservationTimer) clearTimeout(this.reservationTimer);
    const r = this.reservation;
    if (!r) return;
    const wait = Math.min(Math.max(0, Date.parse(r.expiryDate) - this.clock()), 2_000_000_000);
    this.reservationTimer = setTimeout(() => {
      this.log.info(`Reserva ${r.reservationId} expirou`);
      this.clearReservation();
    }, wait);
  }

  private clearReservation(): void {
    if (this.reservationTimer) clearTimeout(this.reservationTimer);
    this.reservationTimer = null;
    this.reservation = null;
    if (this.connector.status === 'Reserved') {
      this.connector.machine.transition(this.inoperative ? 'Unavailable' : 'Available');
    }
  }

  // Smart Charging --------------------------------------------------------

  setChargingProfile(req: {
    connectorId: number;
    csChargingProfiles: ChargingProfile;
  }): { status: string } {
    const profile = req?.csChargingProfiles;
    const err = validateProfile(profile);
    if (err) {
      this.log.warn(`SetChargingProfile rejeitado: ${err}`);
      return { status: 'Rejected' };
    }
    const cid = req.connectorId;
    if (cid !== 0 && cid !== this.connector.id) return { status: 'Rejected' };
    const tx = this.connector.transaction;
    switch (profile.chargingProfilePurpose) {
      case 'ChargePointMaxProfile':
        if (cid !== 0) return { status: 'Rejected' };
        break;
      case 'TxProfile':
        if (cid === 0 || !tx) return { status: 'Rejected' };
        if (profile.transactionId !== undefined && profile.transactionId !== tx.transactionId) {
          return { status: 'Rejected' };
        }
        break;
    }
    const replacing = this.profiles
      .list()
      .some((i) => i.profile.chargingProfileId === profile.chargingProfileId);
    if (!replacing && this.profiles.count >= MAX_PROFILES) return { status: 'Rejected' };
    this.accumulate();
    this.profiles.set(cid, profile);
    if (tx) tx.powerKw = this.effectivePowerKw();
    this.log.info(
      `ChargingProfile ${profile.chargingProfileId} (${profile.chargingProfilePurpose}, stack ${profile.stackLevel}) aplicado; limite efetivo ${this.effectivePowerKw().toFixed(1)} kW`,
    );
    return { status: 'Accepted' };
  }

  clearChargingProfile(req: {
    id?: number;
    connectorId?: number;
    chargingProfilePurpose?: ChargingProfile['chargingProfilePurpose'];
    stackLevel?: number;
  }): { status: string } {
    this.accumulate();
    const removed = this.profiles.clear({
      id: req?.id,
      connectorId: req?.connectorId,
      purpose: req?.chargingProfilePurpose,
      stackLevel: req?.stackLevel,
    });
    const tx = this.connector.transaction;
    if (tx) tx.powerKw = this.effectivePowerKw();
    this.log.info(`ClearChargingProfile removeu ${removed} perfil(is)`);
    return { status: removed > 0 ? 'Accepted' : 'Unknown' };
  }

  getCompositeSchedule(req: {
    connectorId: number;
    duration: number;
    chargingRateUnit?: 'W' | 'A';
  }) {
    if (req?.connectorId !== 0 && req?.connectorId !== this.connector.id) return { status: 'Rejected' };
    if (!Number.isInteger(req.duration) || req.duration <= 0 || req.duration > 604_800) {
      throw new OcppCallError('PropertyConstraintViolation', 'duration invalido');
    }
    const now = this.clock();
    const schedule = this.profiles.composite(
      now,
      req.duration,
      req.chargingRateUnit === 'A' ? 'A' : 'W',
      this.txContext(),
      this.electrical(),
      this.cfg.maxPowerKw,
    );
    return {
      status: 'Accepted',
      connectorId: req.connectorId,
      scheduleStart: new Date(now).toISOString(),
      chargingSchedule: schedule,
    };
  }

  // Local Authorization List ---------------------------------------------

  getLocalListVersion(): { listVersion: number } {
    return { listVersion: this.config.getBool('LocalAuthListEnabled') ? this.localList.version : -1 };
  }

  sendLocalList(req: {
    listVersion: number;
    updateType: 'Full' | 'Differential';
    localAuthorizationList?: Array<{ idTag: string; idTagInfo?: never }>;
  }): { status: string } {
    if (!this.config.getBool('LocalAuthListEnabled')) return { status: 'NotSupported' };
    const status = this.localList.apply(
      req?.listVersion,
      req?.updateType,
      req?.localAuthorizationList as never,
    );
    this.log.info(`SendLocalList v${req?.listVersion} ${req?.updateType} -> ${status}`);
    return { status };
  }

  // Manutencao ------------------------------------------------------------

  unlockConnector(req: { connectorId: number }): { status: string } {
    if (req?.connectorId !== this.connector.id) return { status: 'NotSupported' };
    if (this.behavior.unlockFails) return { status: 'UnlockFailed' };
    if (this.connector.transaction) this.track(this.stopTransaction('UnlockCommand'));
    return { status: 'Unlocked' };
  }

  dataTransferIn(req: { vendorId: string; messageId?: string; data?: string }) {
    if (typeof req?.vendorId !== 'string' || !req.vendorId) {
      throw new OcppCallError('FormationViolation', 'vendorId obrigatorio');
    }
    this.log.info(`DataTransfer recebido vendorId=${req.vendorId} messageId=${req.messageId ?? '-'}`);
    return req.vendorId === this.cfg.vendor
      ? { status: 'Accepted', data: req.data }
      : { status: 'UnknownVendorId' };
  }

  triggerMessage(req: { requestedMessage: string; connectorId?: number }): { status: string } {
    const m = req?.requestedMessage;
    const cid = req?.connectorId;
    if (cid !== undefined && cid !== this.connector.id && cid !== 0) return { status: 'Rejected' };
    const run = (fn: () => Promise<unknown> | void): { status: string } => {
      setTimeout(() => this.track(Promise.resolve().then(fn)), 50);
      return { status: 'Accepted' };
    };
    switch (m) {
      case 'BootNotification':
        return run(() => this.transport.call('BootNotification', this.bootPayload()));
      case 'Heartbeat':
        return run(() => this.transport.call('Heartbeat', {}));
      case 'StatusNotification':
        return run(() => this.sendStatus(this.connector.status, this.errorCode, cid ?? this.connector.id));
      case 'MeterValues':
        return run(() => this.sendMeterSample('Trigger', this.config.getList('MeterValuesSampledData')));
      case 'DiagnosticsStatusNotification':
        return run(() => this.notify('DiagnosticsStatusNotification', this.diagnosticsStatus));
      case 'FirmwareStatusNotification':
        return run(() => this.notify('FirmwareStatusNotification', this.firmwareStatus));
      default:
        return { status: 'NotImplemented' };
    }
  }

  private async notify(action: string, status: string): Promise<void> {
    if (action === 'DiagnosticsStatusNotification') this.diagnosticsStatus = status;
    else this.firmwareStatus = status;
    if (!this.registered || !this.transport.isConnected()) return;
    try {
      await this.transport.call(action, { status });
    } catch (err) {
      this.log.error(`${action} falhou: ${(err as Error).message}`);
    }
  }

  getDiagnostics(req: { location: string }): { fileName?: string } {
    if (typeof req?.location !== 'string' || !/^[a-z][a-z0-9+.-]*:\/\//i.test(req.location)) {
      throw new OcppCallError('PropertyConstraintViolation', 'location invalido');
    }
    const fileName = `diagnostics-${this.cfg.chargePointId}-${new Date(this.clock())
      .toISOString()
      .replace(/[-:.]/g, '')}.zip`;
    this.track(
      (async () => {
        await this.notify('DiagnosticsStatusNotification', 'Uploading');
        await sleep(2000);
        await this.notify(
          'DiagnosticsStatusNotification',
          this.behavior.diagnosticsFails ? 'UploadFailed' : 'Uploaded',
        );
      })(),
    );
    return { fileName };
  }

  updateFirmware(req: { location: string; retrieveDate: string }): Record<string, never> {
    if (typeof req?.location !== 'string' || !/^[a-z][a-z0-9+.-]*:\/\//i.test(req.location)) {
      throw new OcppCallError('PropertyConstraintViolation', 'location invalido');
    }
    const wait = Math.min(Math.max(0, Date.parse(req.retrieveDate) - this.clock() || 0), 30_000);
    this.track(
      (async () => {
        await sleep(wait);
        await this.notify('FirmwareStatusNotification', 'Downloading');
        await sleep(1500);
        if (this.behavior.firmwareFails) {
          await this.notify('FirmwareStatusNotification', 'DownloadFailed');
          return;
        }
        await this.notify('FirmwareStatusNotification', 'Downloaded');
        await sleep(500);
        await this.notify('FirmwareStatusNotification', 'Installing');
        await sleep(1500);
        await this.notify('FirmwareStatusNotification', 'Installed');
        const m = /(\d+\.\d+(?:\.\d+)*)/.exec(req.location);
        this.cfg.firmwareVersion = m ? m[1] : bumpVersion(this.cfg.firmwareVersion);
        this.log.info(`Firmware atualizado para ${this.cfg.firmwareVersion}; reiniciando (Boot)`);
        if (this.connector.transaction) await this.stopTransaction('Reboot');
        this.startBoot();
      })(),
    );
    return {};
  }

  // ---- util -------------------------------------------------------------

  private track(p: Promise<unknown>): void {
    const t: Promise<unknown> = p
      .catch((err) => this.log.error(`Erro em tarefa assincrona: ${(err as Error).message}`))
      .finally(() => this.background.delete(t));
    this.background.add(t);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function bumpVersion(v: string): string {
  const parts = v.split('.');
  const last = Number(parts[parts.length - 1]);
  if (Number.isInteger(last)) parts[parts.length - 1] = String(last + 1);
  else parts.push('1');
  return parts.join('.');
}
