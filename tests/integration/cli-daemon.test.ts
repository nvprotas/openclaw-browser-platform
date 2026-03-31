import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const cliPath = path.join(repoRoot, 'dist/bin/browser-platform.js');
const tempDirs: string[] = [];

beforeAll(async () => {
  await execFileAsync('npm', ['run', 'build'], { cwd: repoRoot });
});

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }

    try {
      const raw = await readFile(path.join(dir, '.tmp/browser-platform/daemon.json'), 'utf8');
      const info = JSON.parse(raw) as { pid: number };
      process.kill(info.pid, 'SIGTERM');
    } catch {
      // ignore cleanup failures
    }

    await rm(dir, { recursive: true, force: true });
  }
});

async function runCli(cwd: string, args: string[]) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], { cwd });
  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    json: stdout.trim() ? (JSON.parse(stdout) as Record<string, unknown>) : null
  };
}

describe('browser-platform CLI + daemon skeleton', () => {
  it(
    'keeps session state across separate CLI invocations',
    async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'browser-platform-test-'));
    tempDirs.push(cwd);

    const ensure = await runCli(cwd, ['daemon', 'ensure', '--json']);
    expect(ensure.json?.ok).toBe(true);
    expect(ensure.json?.daemon).toMatchObject({
      alreadyRunning: false,
      sessionCount: 0
    });

    const status = await runCli(cwd, ['daemon', 'status', '--json']);
    expect(status.json).toMatchObject({
      ok: true,
      daemon: {
        running: true,
        sessionCount: 0
      }
    });

    const open = await runCli(cwd, ['session', 'open', '--url', 'https://example.com', '--json']);
    expect(open.json?.ok).toBe(true);
    const sessionId = String((open.json?.session as { sessionId: string }).sessionId);

    const context = await runCli(cwd, ['session', 'context', '--session', sessionId, '--json']);
    expect(context.json).toMatchObject({
      ok: true,
      session: {
        sessionId,
        url: 'https://example.com',
        status: 'open'
      }
    });

    const statusAfterOpen = await runCli(cwd, ['daemon', 'status', '--json']);
    expect(statusAfterOpen.json).toMatchObject({
      ok: true,
      daemon: {
        running: true,
        sessionCount: 1
      }
    });

    const close = await runCli(cwd, ['session', 'close', '--session', sessionId, '--json']);
    expect(close.json).toMatchObject({
      ok: true,
      session: {
        sessionId,
        status: 'closed'
      }
    });

    const statusAfterClose = await runCli(cwd, ['daemon', 'status', '--json']);
    expect(statusAfterClose.json).toMatchObject({
      ok: true,
      daemon: {
        running: true,
        sessionCount: 0
      }
    });
    },
    20_000
  );
});
