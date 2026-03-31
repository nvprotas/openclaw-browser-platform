import { BrowserPlatformError } from '../core/errors.js';
import { startDaemonServer } from '../daemon/server.js';
import { handleDaemonEnsure, handleDaemonStatus } from './commands/daemon.js';
import { handleSessionClose, handleSessionContext, handleSessionOpen } from './commands/session.js';
import { printErrorJson, printJson } from './output.js';

export async function runCli(args: string[]): Promise<number> {
  try {
    if (args[0] === 'daemon' && args[1] === 'run') {
      await startDaemonServer();
      await new Promise(() => undefined);
      return 0;
    }

    if (args.includes('--help') || args.includes('-h') || args.length === 0) {
      printHelp();
      return 0;
    }

    if (args.includes('--version') || args.includes('-v')) {
      console.log('0.1.0');
      return 0;
    }

    const json = args.includes('--json');
    if (!json) {
      throw new BrowserPlatformError('Only --json output is implemented in this MVP skeleton', {
        code: 'JSON_REQUIRED'
      });
    }

    const command = await dispatch(args);
    printJson(command);
    return 0;
  } catch (error) {
    printErrorJson(error);
    return 1;
  }
}

async function dispatch(args: string[]): Promise<unknown> {
  if (args[0] === 'daemon' && args[1] === 'ensure') {
    return handleDaemonEnsure();
  }

  if (args[0] === 'daemon' && args[1] === 'status') {
    return handleDaemonStatus();
  }

  if (args[0] === 'session' && args[1] === 'open') {
    return handleSessionOpen(args);
  }

  if (args[0] === 'session' && args[1] === 'context') {
    return handleSessionContext(args);
  }

  if (args[0] === 'session' && args[1] === 'close') {
    return handleSessionClose(args);
  }

  throw new BrowserPlatformError(`Unknown command: ${args.join(' ')}`, { code: 'UNKNOWN_COMMAND' });
}

function printHelp(): void {
  console.log(`browser-platform\n\nUsage:\n  browser-platform daemon ensure --json\n  browser-platform daemon status --json\n  browser-platform session open --url <url> --json\n  browser-platform session context --session <id> --json\n  browser-platform session close --session <id> --json`);
}
