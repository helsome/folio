import { execa } from 'execa';
import { LongBridgeError } from './errors';

export interface ExecutorOptions {
  timeout?: number;
}

export async function executeLongBridge(
  args: string[],
  options: ExecutorOptions = {}
): Promise<string> {
  const { timeout = 30000 } = options;

  try {
    const { stdout } = await execa('longbridge', args, {
      timeout,
    });
    return stdout;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('ENOENT')) {
        throw new LongBridgeError('Run installation script', 'LONGBRIDGE_NOT_INSTALLED');
      }
      if (error.message.includes('timeout')) {
        throw new LongBridgeError('Check network or retry', 'LONGBRIDGE_TIMEOUT');
      }
      if (error.message.includes('not authenticated')) {
        throw new LongBridgeError('Run longbridge auth login', 'LONGBRIDGE_NOT_AUTHED');
      }
    }
    throw error;
  }
}