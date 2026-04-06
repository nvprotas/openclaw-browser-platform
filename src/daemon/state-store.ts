import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DaemonInfo } from './types.js';

function resolvePackageRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));

  if (moduleDir.includes(`${path.sep}dist${path.sep}`)) {
    return path.resolve(moduleDir, '..', '..', '..');
  }

  return path.resolve(moduleDir, '..', '..');
}

const DEFAULT_ROOT = path.resolve(resolvePackageRoot(), '.tmp/browser-platform');
const DAEMON_INFO_FILENAME = 'daemon.json';
const ENV_STATE_ROOT = 'BROWSER_PLATFORM_STATE_ROOT';

function resolveDefaultRoot(): string {
  const override = process.env[ENV_STATE_ROOT]?.trim();
  return override ? path.resolve(override) : DEFAULT_ROOT;
}

export class StateStore {
  constructor(private readonly rootDir = resolveDefaultRoot()) {}

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
