import { execFile } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

async function runFile(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {}
) {
  return execFileAsync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024
  });
}

async function runGit(args: string[], cwd: string) {
  return runFile('git', args, cwd);
}

async function commitAll(cwd: string, message: string) {
  await runGit(['add', '.'], cwd);
  await runGit(
    [
      '-c',
      'user.name=Test User',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-m',
      message
    ],
    cwd
  );
}

describe('install.sh bootstrap update', () => {
  it('discards dirty target changes before forced branch checkout', async () => {
    const rootDir = await mkdtemp(
      path.join(os.tmpdir(), 'openclaw-install-test-')
    );
    const bootstrapScript = path.join(rootDir, 'bootstrap-install.sh');
    const originDir = path.join(rootDir, 'origin');
    const targetDir = path.join(rootDir, 'target');
    const markerPath = path.join(rootDir, 'installed.txt');

    await copyFile(path.join(process.cwd(), 'install.sh'), bootstrapScript);
    await chmod(bootstrapScript, 0o755);

    await mkdir(path.join(originDir, 'openclaw', 'skill-template'), {
      recursive: true
    });
    await mkdir(path.join(originDir, 'tests', 'unit'), { recursive: true });
    await writeFile(
      path.join(originDir, 'install.sh'),
      '#!/usr/bin/env bash\nset -euo pipefail\nprintf "installed\\n" > "${INSTALL_MARKER:?}"\n',
      'utf8'
    );
    await writeFile(
      path.join(originDir, 'openclaw', 'skill-template', 'SKILL.md'),
      'remote skill v1\n',
      'utf8'
    );
    await writeFile(
      path.join(originDir, 'tests', 'unit', 'litres-checkout-guidance.test.ts'),
      'remote test v1\n',
      'utf8'
    );

    await runGit(['init'], originDir);
    await runGit(['checkout', '-b', 'main'], originDir);
    await commitAll(originDir, 'Initial test repo');

    await runGit(['clone', '--branch', 'main', originDir, targetDir], rootDir);

    await writeFile(
      path.join(targetDir, 'openclaw', 'skill-template', 'SKILL.md'),
      'local skill dirty\n',
      'utf8'
    );
    await writeFile(
      path.join(targetDir, 'tests', 'unit', 'litres-checkout-guidance.test.ts'),
      'local test dirty\n',
      'utf8'
    );

    await writeFile(
      path.join(originDir, 'openclaw', 'skill-template', 'SKILL.md'),
      'remote skill v2\n',
      'utf8'
    );
    await writeFile(
      path.join(originDir, 'tests', 'unit', 'litres-checkout-guidance.test.ts'),
      'remote test v2\n',
      'utf8'
    );
    await commitAll(originDir, 'Update target files');

    await runFile('bash', [bootstrapScript], rootDir, {
      BRANCH: 'main',
      FORCE_UPDATE: '1',
      INSTALL_MARKER: markerPath,
      REPO_URL: originDir,
      TARGET_DIR: targetDir
    });

    await expect(
      readFile(
        path.join(targetDir, 'openclaw', 'skill-template', 'SKILL.md'),
        'utf8'
      )
    ).resolves.toBe('remote skill v2\n');
    await expect(
      readFile(
        path.join(
          targetDir,
          'tests',
          'unit',
          'litres-checkout-guidance.test.ts'
        ),
        'utf8'
      )
    ).resolves.toBe('remote test v2\n');
    await expect(readFile(markerPath, 'utf8')).resolves.toBe('installed\n');

    const status = await runGit(['status', '--short'], targetDir);
    expect(status.stdout).toBe('');
  });
});
