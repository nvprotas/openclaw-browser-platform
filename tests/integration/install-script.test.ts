import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const installScriptPath = path.join(repoRoot, 'install.sh');
const skillTemplatePath = path.join(repoRoot, 'openclaw/skill-template/SKILL.md');
const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }

    await rm(dir, { recursive: true, force: true });
  }
});

async function makeStub(binDir: string, name: string, content: string) {
  const filePath = path.join(binDir, name);
  await writeFile(filePath, content, 'utf8');
  await chmod(filePath, 0o755);
}

describe('install.sh OpenClaw integration', () => {
  it('installs the bundled workspace skill and runs smoke commands from the OpenClaw workspace cwd', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'browser-platform-install-test-'));
    tempDirs.push(tempRoot);

    const openclawHome = path.join(tempRoot, '.openclaw');
    const workspace = path.join(openclawHome, 'workspace');
    const binDir = path.join(tempRoot, 'bin');
    const logPath = path.join(tempRoot, 'tool-log.txt');

    await mkdir(binDir, { recursive: true });
    await mkdir(workspace, { recursive: true });

    await makeStub(
      binDir,
      'npm',
      `#!/usr/bin/env bash
set -euo pipefail
printf 'npm cwd=%s args=%s\n' "$PWD" "$*" >> ${JSON.stringify(logPath)}
`
    );

    await makeStub(
      binDir,
      'npx',
      `#!/usr/bin/env bash
set -euo pipefail
printf 'npx cwd=%s args=%s\n' "$PWD" "$*" >> ${JSON.stringify(logPath)}
`
    );

    await makeStub(
      binDir,
      'openclaw',
      `#!/usr/bin/env bash
set -euo pipefail
printf 'openclaw cwd=%s args=%s\n' "$PWD" "$*" >> ${JSON.stringify(logPath)}
`
    );

    await makeStub(
      binDir,
      'browser-platform',
      `#!/usr/bin/env bash
set -euo pipefail
printf 'browser-platform cwd=%s args=%s\n' "$PWD" "$*" >> ${JSON.stringify(logPath)}
printf '{"ok":true}'
`
    );

    await execFileAsync('bash', [installScriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        HOME: tempRoot,
        OPENCLAW_HOME: openclawHome,
        OPENCLAW_WORKSPACE: workspace,
        RUN_TESTS: '0',
        RESTART_GATEWAY: '1',
        RUN_SMOKE_TEST: '1',
        SKILL_MODE: 'workspace'
      }
    });

    const installedSkill = await readFile(path.join(workspace, 'skills/browser-platform/SKILL.md'), 'utf8');
    const bundledSkill = await readFile(skillTemplatePath, 'utf8');
    expect(installedSkill).toBe(bundledSkill);

    const log = await readFile(logPath, 'utf8');
    expect(log).toContain(`npm cwd=${repoRoot} args=ci`);
    expect(log).toContain(`npm cwd=${repoRoot} args=run build`);
    expect(log).toContain(`npm cwd=${repoRoot} args=link`);
    expect(log).toContain(`npx cwd=${repoRoot} args=playwright install chromium`);
    expect(log).toContain(`openclaw cwd=${repoRoot} args=gateway restart`);
    expect(log).toContain(`browser-platform cwd=${workspace} args=daemon ensure --json`);
    expect(log).toContain(`browser-platform cwd=${workspace} args=daemon status --json`);
  });

  it('supports shared skill mode without writing into the workspace skills directory', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'browser-platform-install-test-'));
    tempDirs.push(tempRoot);

    const openclawHome = path.join(tempRoot, '.openclaw');
    const workspace = path.join(openclawHome, 'workspace');
    const binDir = path.join(tempRoot, 'bin');

    await mkdir(binDir, { recursive: true });
    await mkdir(workspace, { recursive: true });

    await makeStub(binDir, 'npm', '#!/usr/bin/env bash\nset -euo pipefail\n');
    await makeStub(binDir, 'npx', '#!/usr/bin/env bash\nset -euo pipefail\n');

    await execFileAsync('bash', [installScriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        HOME: tempRoot,
        OPENCLAW_HOME: openclawHome,
        OPENCLAW_WORKSPACE: workspace,
        RUN_TESTS: '0',
        RESTART_GATEWAY: '0',
        RUN_SMOKE_TEST: '0',
        SKILL_MODE: 'shared'
      }
    });

    const sharedSkill = await readFile(path.join(openclawHome, 'skills/browser-platform/SKILL.md'), 'utf8');
    const bundledSkill = await readFile(skillTemplatePath, 'utf8');
    expect(sharedSkill).toBe(bundledSkill);

    await expect(readFile(path.join(workspace, 'skills/browser-platform/SKILL.md'), 'utf8')).rejects.toThrow();
  });
});
