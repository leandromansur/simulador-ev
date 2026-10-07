import type { Config } from '../config';
import type { Transport } from '../ocpp/client';
import { OcppCallError, buildMeterValuesPayload } from '../ocpp/messages';
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

  private epoch = 0;
  private starting = false;
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
    this.vehicle = new Vehicle(cfg.batteryKwh, cfg.initialSoc, cfg.targetSoc);
    this.connector = new Connector(cfg.connectorId, (to, from) => {
      this.log.info(`STATE: ${from} -> ${to}`);
      this.sendStatus(to);
    });
  }

  // ---- Ciclo de conexao -------------------------------------------------

  onConnected(): void {
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
      const res: BootNotificationResponse = await this.transport.call('BootNotification', {
        chargePointVendor: this.cfg.vendor,
        chargePointModel: this.cfg.model,
        chargePointSerialNumber: this.cfg.serialNumber,
        firmwareVersion: this.cfg.firmwareVersion,
      });
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
    this.startHeartbeat(interval);
    this.sendStatus('Available', 'NoError', 0);
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
    errorCode: ChargePointErrorCode = 'NoError',
    connectorId: number = this.connector.id,
  ): void {
    if (!this.registered || !this.transport.isConnected()) return;
    this.track(
      this.transport.call('StatusNotification', {
        connectorId,
        errorCode,
        status,
        timestamp: new Date(this.clock()).toISOString(),
      }),
    );
  }

  // ---- Sessao de carga --------------------------------------------------

  /** Reserva o conector de forma sincrona (evita transacoes simultaneas). */
  private prepare(): boolean {
    if (this.starting || this.connector.transaction || this.connector.status !== 'Available') {
      return false;
    }
    this.starting = true;
    this.vehicle.plugIn();
    this.connector.machine.transition('Preparing');
    return true;
  }

  private abortPreparing(): void {
    this.vehicle.unplug();
    if (this.connector.status === 'Preparing') this.connector.machine.transition('Available');
  }

  /** Veiculo conectado localmente: Authorize -> StartTransaction -> Charging. */
  async startLocalSession(idTag: string = this.cfg.idTag): Promise<boolean> {
    if (!this.registered || !this.transport.isConnected()) {
      this.log.warn('Sessao local ignorada: Charge Point nao registrado');
      return false;
    }
    if (!this.prepare()) {
      this.log.warn(`Sessao local ignorada: conector em ${this.connector.status}`);
      return false;
    }
    try {
      const auth = await this.transport.call('Authorize', { idTag });
      const status = auth?.idTagInfo?.status;
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
      const res: StartTransactionResponse = await this.transport.call('StartTransaction', {
        connectorId: this.connector.id,
        idTag,
        meterStart,
        timestamp: new Date(this.clock()).toISOString(),
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
    this.meterTimer = setInterval(
      () => this.track(this.sendMeterValues()),
      this.cfg.meterIntervalSeconds * 1000,
    );
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
  }

  /** Avanca a simulacao; encerra a carga ao atingir o SOC alvo. */
  tick(): void {
    this.accumulate();
    if (this.connector.transaction && this.connector.status === 'Charging') {
      if (this.vehicle.targetReached()) {
        this.log.info(`SOC alvo atingido (${this.vehicle.socPercent.toFixed(1)}%)`);
        this.track(this.stopTransaction('Local'));
      }
    }
  }

  async sendMeterValues(): Promise<void> {
    const tx = this.connector.transaction;
    if (!tx || this.connector.status !== 'Charging') return;
    this.accumulate();
    const voltage = this.cfg.voltage;
    const current = currentAmps(tx.powerKw, voltage, this.cfg.phases, this.cfg.powerFactor);
    const soc = this.vehicle.socPercent;
    this.log.info(
      `SOC: ${soc.toFixed(1)}% | Voltage: ${voltage.toFixed(1)} V | Current: ${current.toFixed(1)} A | ` +
        `Power: ${tx.powerKw.toFixed(1)} kW | Energy: ${tx.sessionEnergyKwh.toFixed(2)} kWh`,
    );
    if (!this.registered || !this.transport.isConnected()) {
      this.log.warn('MeterValues nao enviado: offline');
      return;
    }
    await this.transport.call(
      'MeterValues',
      buildMeterValuesPayload({
        connectorId: this.connector.id,
        transactionId: tx.transactionId,
        timestamp: new Date(this.clock()),
        energyWh: this.meter.registerWh,
        powerW: tx.powerKw * 1000,
        currentA: current,
        voltageV: voltage,
        socPercent: soc,
      }),
    );
  }

  /** Charging -> Finishing -> StopTransaction -> Available. */
  async stopTransaction(reason: StopReason): Promise<void> {
    const tx = this.connector.transaction;
    if (!tx) return;
    this.accumulate();
    this.connector.transaction = null; // impede parada duplicada
    this.clearChargeTimers();
    this.connector.machine.transition('Finishing');

    const req: StopTransactionRequest = {
      transactionId: tx.transactionId,
      meterStop: this.meter.registerWhRounded,
      timestamp: new Date(this.clock()).toISOString(),
      idTag: tx.idTag,
      reason,
    };
    this.log.info(
      `Encerrando transactionId=${tx.transactionId} reason=${reason} energia=${tx.sessionEnergyKwh.toFixed(
        2,
      )} kWh`,
    );
    await this.sendStop(req);
    this.vehicle.unplug();
    if (this.connector.status === 'Finishing') this.connector.machine.transition('Available');
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

  remoteStart(req: RemoteStartTransactionRequest): { status: Status } {
    if (typeof req?.idTag !== 'string' || req.idTag.length === 0 || req.idTag.length > 20) {
      throw new OcppCallError('FormationViolation', 'idTag invalido');
    }
    if (req.connectorId !== undefined && req.connectorId !== this.connector.id) {
      return { status: 'Rejected' };
    }
    if (!this.registered || !this.prepare()) {
      this.log.warn(`RemoteStartTransaction rejeitada (estado ${this.connector.status})`);
      return { status: 'Rejected' };
    }
    this.track(
      this.beginTransaction(req.idTag).finally(() => {
        this.starting = false;
      }),
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
      settings: { maxPowerKw: this.cfg.maxPowerKw, idTag: this.cfg.idTag },
    };
  }

  /** Ajusta potencia e SOC em tempo real; lanca RangeError se invalido. */
  updateSettings(s: { maxPowerKw?: number; initialSoc?: number; targetSoc?: number }): void {
    const tx = this.connector.transaction;
    if (s.maxPowerKw !== undefined) {
      if (!(s.maxPowerKw >= 0.1 && s.maxPowerKw <= 350)) {
        throw new RangeError('maxPowerKw deve estar entre 0.1 e 350');
      }
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
    if (s.maxPowerKw !== undefined) {
      this.accumulate(); // fecha o trecho anterior com a potencia antiga
      this.cfg.maxPowerKw = s.maxPowerKw;
      if (tx) tx.powerKw = s.maxPowerKw;
    }
    this.vehicle.initialSoc = initial;
    this.vehicle.targetSoc = target;
    if (!tx && !this.vehicle.isPluggedIn) this.vehicle.battery.reset(initial);
    this.log.info('Configuracoes alteradas', {
      maxPowerKw: this.cfg.maxPowerKw,
      initialSoc: initial,
      targetSoc: target,
    });
  }

  /** Veiculo desconectado pelo usuario: encerra a transacao com EVDisconnected. */
  async unplugVehicle(): Promise<boolean> {
    if (!this.connector.transaction) return false;
    await this.stopTransaction('EVDisconnected');
    return true;
  }

  // ---- util -------------------------------------------------------------

  private track(p: Promise<unknown>): void {
    const t: Promise<unknown> = p
      .catch((err) => this.log.error(`Erro em tarefa assincrona: ${(err as Error).message}`))
      .finally(() => this.background.delete(t));
    this.background.add(t);
  }
}
