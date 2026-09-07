import { cp, mkdir, rm } from 'node:fs/promises';

// Sites applies bundled D1 migrations before uploading the Worker. Keep the
// authored migration history in src/ and stage an exact copy only in dist/.
const destination = new URL('../dist/.openai/drizzle/', import.meta.url);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(new URL('../src/server/migrations/', import.meta.url), destination, { recursive: true });
