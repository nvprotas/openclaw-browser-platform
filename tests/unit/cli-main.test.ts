import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../../src/cli/main.js';

describe('runCli', () => {
  it('returns 0 for help', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(runCli(['--help'])).resolves.toBe(0);
    expect(logSpy).toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it('returns 1 for unknown commands', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(runCli(['wat', '--json'])).resolves.toBe(1);
    expect(logSpy).toHaveBeenCalled();

    logSpy.mockRestore();
  });
});
