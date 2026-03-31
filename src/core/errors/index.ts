export class BrowserPlatformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserPlatformError';
  }
}
