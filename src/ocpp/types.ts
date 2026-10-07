export type ConnectorStatus =
  | 'Available'
  | 'Preparing'
  | 'Charging'
  | 'SuspendedEV'
  | 'SuspendedEVSE'
  | 'Finishing'
  | 'Unavailable'
  | 'Faulted';

export type ChargePointErrorCode =
  | 'NoError'
  | 'ConnectorLockFailure'
  | 'EVCommunicationError'
  | 'GroundFailure'
  | 'HighTemperature'
  | 'InternalError'
  | 'OverCurrentFailure'
  | 'OverVoltage'
  | 'PowerMeterFailure'
  | 'PowerSwitchFailure'
  | 'UnderVoltage'
  | 'OtherError';

export type StopReason =
  | 'EmergencyStop'
  | 'EVDisconnected'
  | 'HardReset'
  | 'Local'
  | 'Other'
  | 'PowerLoss'
  | 'Reboot'
  | 'Remote'
  | 'SoftReset'
  | 'UnlockCommand'
  | 'DeAuthorized';

export type RegistrationStatus = 'Accepted' | 'Pending' | 'Rejected';
export type AuthorizationStatus = 'Accepted' | 'Blocked' | 'Expired' | 'Invalid' | 'ConcurrentTx';

export type OcppErrorCode =
  | 'NotImplemented'
  | 'NotSupported'
  | 'InternalError'
  | 'ProtocolError'
  | 'SecurityError'
  | 'FormationViolation'
  | 'PropertyConstraintViolation'
  | 'OccurenceConstraintViolation'
  | 'TypeConstraintViolation'
  | 'GenericError';

export interface BootNotificationRequest {
  chargePointVendor: string;
  chargePointModel: string;
  chargePointSerialNumber?: string;
  firmwareVersion?: string;
}
export interface BootNotificationResponse {
  status: RegistrationStatus;
  currentTime: string;
  interval: number;
}
export interface IdTagInfo {
  status: AuthorizationStatus;
  expiryDate?: string;
  parentIdTag?: string;
}
export interface AuthorizeResponse {
  idTagInfo: IdTagInfo;
}
export interface StartTransactionRequest {
  connectorId: number;
  idTag: string;
  meterStart: number;
  timestamp: string;
}
export interface StartTransactionResponse {
  transactionId: number;
  idTagInfo: IdTagInfo;
}
export interface StopTransactionRequest {
  transactionId: number;
  meterStop: number;
  timestamp: string;
  idTag?: string;
  reason?: StopReason;
}

export interface SampledValue {
  value: string;
  context?: string;
  format?: string;
  measurand?: string;
  phase?: string;
  location?: string;
  unit?: string;
}
export interface MeterValuesRequest {
  connectorId: number;
  transactionId?: number;
  meterValue: Array<{ timestamp: string; sampledValue: SampledValue[] }>;
}

export interface RemoteStartTransactionRequest {
  idTag: string;
  connectorId?: number;
}
export interface RemoteStopTransactionRequest {
  transactionId: number;
}
export interface ResetRequest {
  type: 'Soft' | 'Hard';
}
