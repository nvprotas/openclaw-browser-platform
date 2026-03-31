import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DaemonInfo } from './types.js';

const DEFAULT_ROOT = path.resolve(process.cwd(), '.tmp/browser-platform');
const DAEMON_INFO_FILENAME = 'daemon.json';

export class StateStore {
  constructor(private readonly rootDir = DEFAULT_ROOT) {}

  get root(): string {
    return this.rootDir;
  }

  get daemonInfoPath(): string {
    return path.join(this.rootDir, DAEMON_INFO_FILENAME);
  }

  async ensure(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }

  async readDaemonInfo(): Promise<DaemonInfo | null> {
    try {
      const raw = await readFile(this.daemonInfoPath, 'utf8');
      return JSON.parse(raw) as DaemonInfo;
    } catch {
      return null;
    }
  }

  async writeDaemonInfo(info: DaemonInfo): Promise<void> {
    await this.ensure();
    await writeFile(this.daemonInfoPath, `${JSON.stringify(info, null, 2)}\n`, 'utf8');
  }
}

export function getDefaultStateStore(): StateStore {
  return new StateStore();
}
