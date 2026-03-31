import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface TraceArtifactRef {
  tracePath: string;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export class TraceWriter {
  constructor(private readonly rootDir: string) {}

  async writeStep(sessionId: string, stepType: string, payload: unknown): Promise<TraceArtifactRef> {
    const dir = path.join(this.rootDir, sessionId);
    await mkdir(dir, { recursive: true });
    const tracePath = path.join(dir, `${timestamp()}-${stepType}.json`);
    await writeFile(tracePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return { tracePath };
  }
}
