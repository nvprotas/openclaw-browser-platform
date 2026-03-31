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
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(runCli(['wat'])).resolves.toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Unknown command: wat');

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });
});
