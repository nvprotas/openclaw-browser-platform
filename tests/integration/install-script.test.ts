import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const installScriptPath = path.join(repoRoot, 'install.sh');
const skillTemplatePath = path.join(
  repoRoot,
  'openclaw/skill-template/SKILL.md'
);
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

async function execGit(cwd: string, args: string[]) {
  await execFileAsync('git', args, { cwd });
}

async function makeSystemPackageStubs(binDir: string, logPath: string) {
  await makeStub(
    binDir,
    'apt-get',
    `#!/usr/bin/env bash
set -euo pipefail
printf 'apt-get cwd=%s args=%s\n' "$PWD" "$*" >> ${JSON.stringify(logPath)}
`
  );

  await makeStub(
    binDir,
    'sudo',
    `#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -gt 0 ] && [ "$1" = "env" ]; then
  shift
  while [ "$#" -gt 0 ]; do
    case "$1" in
      *=*) shift ;;
      *) break ;;
    esac
  done
fi
"$@"
`
  );
}

describe('install.sh OpenClaw integration', () => {
  it('updates an existing shallow clone to a slash-named branch in bootstrap mode', async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), 'browser-platform-install-test-')
    );
    tempDirs.push(tempRoot);

    const branch = 'feature/slash-named-branch';
    const remoteRepo = path.join(tempRoot, 'remote-source');
    const targetDir = path.join(tempRoot, 'target');
    const binDir = path.join(tempRoot, 'bin');
    const logPath = path.join(tempRoot, 'tool-log.txt');

    await mkdir(path.join(remoteRepo, 'openclaw/skill-template'), {
      recursive: true
    });
    await mkdir(binDir, { recursive: true });

    await writeFile(
      path.join(remoteRepo, 'install.sh'),
      await readFile(installScriptPath, 'utf8'),
      'utf8'
    );
    await writeFile(
      path.join(remoteRepo, 'package.json'),
      '{"name":"fixture","version":"0.0.0"}\n',
      'utf8'
    );
    await writeFile(
      path.join(remoteRepo, 'openclaw/skill-template/SKILL.md'),
      'fixture skill\n',
      'utf8'
    );

    await execGit(remoteRepo, ['init']);
    await execGit(remoteRepo, ['config', 'user.email', 'test@example.com']);
    await execGit(remoteRepo, ['config', 'user.name', 'Test User']);
    await execGit(remoteRepo, ['checkout', '-B', 'master']);
    await execGit(remoteRepo, ['add', '.']);
    await execGit(remoteRepo, ['commit', '-m', 'Initial fixture']);
    await execGit(remoteRepo, ['checkout', '-b', branch]);
    await writeFile(
      path.join(remoteRepo, 'branch-marker.txt'),
      'feature branch\n',
      'utf8'
    );
    await execGit(remoteRepo, ['add', '.']);
    await execGit(remoteRepo, ['commit', '-m', 'Add branch marker']);

    const repoUrl = `file://${remoteRepo}`;
    await execFileAsync(
      'git',
      ['clone', '--depth=1', '--branch', 'master', repoUrl, targetDir],
      {
        cwd: tempRoot
      }
    );

    await makeStub(
      binDir,
      'npm',
      `#!/usr/bin/env bash
set -euo pipefail
printf 'npm cwd=%s args=%s\n' "$PWD" "$*" >> ${JSON.stringify(logPath)}
`
    );

    await execFileAsync(
      'bash',
      ['-c', 'cat "$1" | bash', 'bootstrap', installScriptPath],
      {
        cwd: tempRoot,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          HOME: tempRoot,
          REPO_URL: repoUrl,
          BRANCH: branch,
          TARGET_DIR: targetDir,
          FORCE_UPDATE: '1',
          RUN_TESTS: '0',
          RESTART_GATEWAY: '0',
          RUN_SMOKE_TEST: '0',
          SKILL_MODE: 'skip',
          INSTALL_CAMOUFOX: '0'
        }
      }
    );

    const { stdout } = await execFileAsync('git', [
      '-C',
      targetDir,
      'branch',
      '--show-current'
    ]);
    expect(stdout.trim()).toBe(branch);
    await execFileAsync('git', [
      '-C',
      targetDir,
      'rev-parse',
      '--verify',
      `refs/remotes/origin/${branch}`
    ]);

    const log = await readFile(logPath, 'utf8');
    expect(log).toContain(`npm cwd=${targetDir} args=ci`);
    expect(log).toContain(`npm cwd=${targetDir} args=run build`);
    expect(log).toContain(`npm cwd=${targetDir} args=link`);
  });

  it('installs the bundled workspace skill and runs smoke commands from the OpenClaw workspace cwd', async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), 'browser-platform-install-test-')
    );
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
        SKILL_MODE: 'workspace',
        INSTALL_CAMOUFOX: '0'
      }
    });

    const installedSkill = await readFile(
      path.join(workspace, 'skills/browser-platform/SKILL.md'),
      'utf8'
    );
    const bundledSkill = await readFile(skillTemplatePath, 'utf8');
    expect(installedSkill).toBe(bundledSkill);

    const log = await readFile(logPath, 'utf8');
    expect(log).toContain(`npm cwd=${repoRoot} args=ci`);
    expect(log).toContain(`npm cwd=${repoRoot} args=run build`);
    expect(log).toContain(`npm cwd=${repoRoot} args=link`);
    expect(log).toContain(`openclaw cwd=${repoRoot} args=gateway restart`);
    expect(log).toContain(
      `browser-platform cwd=${workspace} args=daemon ensure --json`
    );
    expect(log).toContain(
      `browser-platform cwd=${workspace} args=daemon status --json`
    );
  });

  it('supports shared skill mode without writing into the workspace skills directory', async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), 'browser-platform-install-test-')
    );
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
        SKILL_MODE: 'shared',
        INSTALL_CAMOUFOX: '0'
      }
    });

    const sharedSkill = await readFile(
      path.join(openclawHome, 'skills/browser-platform/SKILL.md'),
      'utf8'
    );
    const bundledSkill = await readFile(skillTemplatePath, 'utf8');
    expect(sharedSkill).toBe(bundledSkill);

    await expect(
      readFile(path.join(workspace, 'skills/browser-platform/SKILL.md'), 'utf8')
    ).rejects.toThrow();
  });

  it('installs and verifies camoufox by default', async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), 'browser-platform-install-test-')
    );
    tempDirs.push(tempRoot);

    const openclawHome = path.join(tempRoot, '.openclaw');
    const workspace = path.join(openclawHome, 'workspace');
    const binDir = path.join(tempRoot, 'bin');
    const logPath = path.join(tempRoot, 'tool-log.txt');

    await mkdir(binDir, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await makeSystemPackageStubs(binDir, logPath);

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
      'python',
      `#!/usr/bin/env bash
set -euo pipefail
printf 'python cwd=%s args=%s\n' "$PWD" "$*" >> ${JSON.stringify(logPath)}
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
        RESTART_GATEWAY: '0',
        RUN_SMOKE_TEST: '0',
        SKILL_MODE: 'workspace'
      }
    });

    const log = await readFile(logPath, 'utf8');
    expect(log).toContain(
      `python cwd=${repoRoot} args=-m pip install --user -U camoufox[geoip]`
    );
    expect(log).toContain(`python cwd=${repoRoot} args=-m camoufox fetch`);
    expect(log).toContain(`python cwd=${repoRoot} args=-m camoufox version`);
  });

  it('falls back to python3 for camoufox install when python is unavailable', async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), 'browser-platform-install-test-')
    );
    tempDirs.push(tempRoot);

    const openclawHome = path.join(tempRoot, '.openclaw');
    const workspace = path.join(openclawHome, 'workspace');
    const binDir = path.join(tempRoot, 'bin');
    const logPath = path.join(tempRoot, 'tool-log.txt');

    await mkdir(binDir, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await makeSystemPackageStubs(binDir, logPath);

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
      'python3',
      `#!/usr/bin/env bash
set -euo pipefail
printf 'python3 cwd=%s args=%s\n' "$PWD" "$*" >> ${JSON.stringify(logPath)}
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
        RESTART_GATEWAY: '0',
        RUN_SMOKE_TEST: '0',
        SKILL_MODE: 'workspace'
      }
    });

    const log = await readFile(logPath, 'utf8');
    expect(log).toContain(
      `python3 cwd=${repoRoot} args=-m pip install --user -U camoufox[geoip]`
    );
    expect(log).toContain(`python3 cwd=${repoRoot} args=-m camoufox fetch`);
    expect(log).toContain(`python3 cwd=${repoRoot} args=-m camoufox version`);
  });

  it('creates a dedicated camoufox venv for externally managed python', async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), 'browser-platform-install-test-')
    );
    tempDirs.push(tempRoot);

    const openclawHome = path.join(tempRoot, '.openclaw');
    const workspace = path.join(openclawHome, 'workspace');
    const binDir = path.join(tempRoot, 'bin');
    const logPath = path.join(tempRoot, 'tool-log.txt');
    const venvPython = path.join(
      openclawHome,
      'venvs',
      'camoufox',
      'bin',
      'python'
    );

    await mkdir(binDir, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await makeSystemPackageStubs(binDir, logPath);

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
      'python3',
      `#!/usr/bin/env bash
set -euo pipefail
printf 'python3 cwd=%s args=%s\n' "$PWD" "$*" >> ${JSON.stringify(logPath)}
if [ "$1" = "-m" ] && [ "$2" = "pip" ] && [ "\${3:-}" = "install" ]; then
  printf 'error: externally-managed-environment\n' >&2
  exit 1
fi
if [ "$1" = "-m" ] && [ "$2" = "venv" ]; then
  mkdir -p "$3/bin"
  cat > "$3/bin/python" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'venv-python cwd=%s args=%s\n' "$PWD" "$*" >> ${JSON.stringify(logPath)}
EOF
  chmod +x "$3/bin/python"
  exit 0
fi
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
        RESTART_GATEWAY: '0',
        RUN_SMOKE_TEST: '0',
        SKILL_MODE: 'workspace'
      }
    });

    const log = await readFile(logPath, 'utf8');
    expect(log).toContain(
      `python3 cwd=${repoRoot} args=-m pip install --user -U camoufox[geoip]`
    );
    expect(log).toContain(
      `python3 cwd=${repoRoot} args=-m venv ${path.join(openclawHome, 'venvs', 'camoufox')}`
    );
    expect(log).toContain(
      `venv-python cwd=${repoRoot} args=-m pip install -U camoufox[geoip]`
    );
    expect(log).toContain(`venv-python cwd=${repoRoot} args=-m camoufox fetch`);
    expect(log).toContain(
      `venv-python cwd=${repoRoot} args=-m camoufox version`
    );
    expect(await readFile(venvPython, 'utf8')).toContain('venv-python');
  });
});
