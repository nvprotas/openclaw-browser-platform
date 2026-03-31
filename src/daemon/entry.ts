import { startDaemonServer } from './server.js';

await startDaemonServer();
await new Promise(() => undefined);
