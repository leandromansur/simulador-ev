import type { Config } from '../src/config';
import type { Transport } from '../src/ocpp/client';
import { ChargePoint } from '../src/simulator/charger';
import { Logger } from '../src/utils/logger';

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    chargePointId: 'SIM-001',
    csmsUrl: 'ws://localhost:9000/ocpp',
    appendChargePointId: true,
    connectorId: 1,
    idTag: 'SIMULATOR001',
    vendor: 'Inovative',
    model: 'EV-Simulator',
    serialNumber: 'SIM-001',
    firmwareVersion: '0.1.0',
    chargerType: 'AC',
    maxPowerKw: 22,
    voltage: 380,
    phases: 3,
    powerFactor: 0.98,
    batteryKwh: 60,
    initialSoc: 30,
    targetSoc: 90,
    meterIntervalSeconds: 10,
    heartbeatIntervalSeconds: 60,
    reconnectIntervalSeconds: 5,
    reconnectMaxIntervalSeconds: 60,
    callTimeoutSeconds: 30,
    logLevel: 'error',
    autoStartTransaction: false,
    autoStartDelaySeconds: 5,
    ...over,
  };
}

export interface RecordedCall {
  action: string;
  payload: any;
}

export class FakeTransport implements Transport {
  calls: RecordedCall[] = [];
  connected = true;
  reconnects = 0;
  nextTransactionId = 4242;
  authStatus = 'Accepted';
  startStatus = 'Accepted';
  bootStatus = 'Accepted';
  bootInterval = 300;

  async call(action: string, payload: unknown): Promise<any> {
    if (!this.connected) throw new Error('offline');
    this.calls.push({ action, payload });
    switch (action) {
      case 'BootNotification':
        return {
          status: this.bootStatus,
          currentTime: new Date().toISOString(),
          interval: this.bootInterval,
        };
      case 'Authorize':
        return { idTagInfo: { status: this.authStatus } };
      case 'StartTransaction':
        return {
          transactionId: this.nextTransactionId,
          idTagInfo: { status: this.startStatus },
        };
      case 'Heartbeat':
        return { currentTime: new Date().toISOString() };
      default:
        return {};
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  reconnect(): void {
    this.reconnects++;
  }

  actions(): string[] {
    return this.calls.map((c) => c.action);
  }

  last(action: string): RecordedCall | undefined {
    return [...this.calls].reverse().find((c) => c.action === action);
  }
}

export interface Rig {
  cp: ChargePoint;
  transport: FakeTransport;
  clock: { now: number };
  advance(ms: number): void;
}

/** Charge Point ja registrado, com relogio manual. */
export async function makeRig(over: Partial<Config> = {}): Promise<Rig> {
  const transport = new FakeTransport();
  const clock = { now: Date.UTC(2026, 9, 6, 21, 30, 0) };
  const cp = new ChargePoint(
    testConfig(over),
    transport,
    new Logger('SIM-001', 'error'),
    () => clock.now,
  );
  cp.onConnected();
  await cp.settled();
  return { cp, transport, clock, advance: (ms) => (clock.now += ms) };
}
