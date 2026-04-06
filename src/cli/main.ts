import { BrowserPlatformError } from '../core/errors.js';
import { startDaemonServer } from '../daemon/server.js';
import { handleDaemonEnsure, handleDaemonStatus } from './commands/daemon.js';
import {
  handleSessionAct,
  handleSessionClose,
  handleSessionContext,
  handleSessionObserve,
  handleSessionOpen,
  handleSessionSnapshot
} from './commands/session.js';
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

    const jsonFlagCount = args.filter((value) => value === '--json').length;
    const json = jsonFlagCount >= 1;
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

  if (args[0] === 'session' && args[1] === 'observe') {
    return handleSessionObserve(args);
  }

  if (args[0] === 'session' && args[1] === 'act') {
    return handleSessionAct(args);
  }

  if (args[0] === 'session' && args[1] === 'snapshot') {
    return handleSessionSnapshot(args);
  }

  if (args[0] === 'session' && args[1] === 'close') {
    return handleSessionClose(args);
  }

  throw new BrowserPlatformError(`Unknown command: ${args.join(' ')}`, { code: 'UNKNOWN_COMMAND' });
}

function printHelp(): void {
  console.log(`browser-platform\n\nUsage:\n  browser-platform daemon ensure --json\n  browser-platform daemon status --json\n  browser-platform session open --url <url> [--profile <id>] [--scenario <id>] [--backend camoufox] [--storage-state <path>] --json\n  browser-platform session context --session <id> --json\n  browser-platform session observe --session <id> --json\n  browser-platform session act --session <id> --json '<payload>'\n  browser-platform session snapshot --session <id> --json\n  browser-platform session close --session <id> --json\n\nNotes:\n  --profile + --scenario is the canonical session model.\n  --backend currently supports only camoufox.\n  --storage-state is a legacy/debug/import override and should not be the default path.`);
}
