import { BrowserPlatformError } from '../core/errors.js';

export function requireFlag(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) {
    throw new BrowserPlatformError(`Missing required flag: ${flag}`, { code: 'MISSING_FLAG' });
  }

  return args[index + 1] ?? '';
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}
