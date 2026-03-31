export class BrowserPlatformError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, options?: { code?: string; details?: Record<string, unknown> }) {
    super(message);
    this.name = 'BrowserPlatformError';
    this.code = options?.code ?? 'BROWSER_PLATFORM_ERROR';
    this.details = options?.details;
  }
}
