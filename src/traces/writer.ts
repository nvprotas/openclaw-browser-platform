import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface TraceArtifactRef {
  tracePath: string;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export class TraceWriter {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly rootDir: string) {}

  async writeStep(
    sessionId: string,
    stepType: string,
    payload: unknown
  ): Promise<TraceArtifactRef> {
    const dir = path.join(this.rootDir, sessionId);
    const tracePath = path.join(dir, `${timestamp()}-${stepType}.json`);

    const write = async (): Promise<void> => {
      await mkdir(dir, { recursive: true });
      await writeFile(
        tracePath,
        `${JSON.stringify(payload, null, 2)}\n`,
        'utf8'
      );
    };

    this.queue = this.queue.then(write, write);
    void this.queue.catch(() => undefined);

    return { tracePath };
  }

  async flush(): Promise<void> {
    await this.queue.catch(() => undefined);
  }
}
