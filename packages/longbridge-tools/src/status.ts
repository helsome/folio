import { executeLongBridge } from './executor.ts';
import { LongBridgeError } from './errors.ts';

export type LongBridgeStatusValue =
  | 'available'
  | 'not_installed'
  | 'not_authed'
  | 'timeout'
  | 'unknown';

export interface LongBridgeStatus {
  installed: boolean;
  authed: boolean;
  available: boolean;
  status: LongBridgeStatusValue;
  error?: {
    code: LongBridgeError['code'];
    message: string;
  };
}

function errorStatus(error: LongBridgeError): Pick<LongBridgeStatus, 'status' | 'error'> {
  if (error.code === 'LONGBRIDGE_NOT_INSTALLED') {
    return { status: 'not_installed', error: { code: error.code, message: error.message } };
  }
  if (error.code === 'LONGBRIDGE_NOT_AUTHED') {
    return { status: 'not_authed', error: { code: error.code, message: error.message } };
  }
  if (error.code === 'LONGBRIDGE_TIMEOUT') {
    return { status: 'timeout', error: { code: error.code, message: error.message } };
  }
  return { status: 'unknown', error: { code: error.code, message: error.message } };
}

export async function getLongBridgeStatus(): Promise<LongBridgeStatus> {
  try {
    await executeLongBridge(['--version'], { timeout: 5000 });
  } catch (error) {
    const status = errorStatus(error as LongBridgeError);
    return {
      installed: false,
      authed: false,
      available: false,
      ...status,
    };
  }

  try {
    await executeLongBridge(['portfolio', '--format', 'json'], { timeout: 5000 });
    return {
      installed: true,
      authed: true,
      available: true,
      status: 'available',
    };
  } catch (error) {
    const status = errorStatus(error as LongBridgeError);
    return {
      installed: true,
      authed: false,
      available: false,
      ...status,
    };
  }
}
