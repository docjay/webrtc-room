import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { localD1 } from './local-db.mjs';
import worker from '../dist/server/index.js';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const positionalPort = args.find(
  (value, index) => !value.startsWith('-') && args[index - 1] !== '--host',
);
const requestedHost = process.env.HOST ?? option('--host') ?? '127.0.0.1';
const requestedPort = process.env.PORT ?? option('--port') ?? positionalPort ?? '4173';
const port = Number(requestedPort);
if (!Number.isInteger(port) || port < 0 || port >= 65_536)
  throw new Error(`invalid PORT: ${requestedPort}`);
if (!requestedHost) throw new Error('invalid HOST');
const db = await localD1();
const types = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const result = await worker.fetch(
      new Request(url, {
        method: request.method,
        headers: request.headers,
        body: ['GET', 'HEAD'].includes(request.method ?? '') ? undefined : Buffer.concat(chunks),
      }),
      { DB: db, ENVIRONMENT: 'development', OWNER_ID: process.env.LOCAL_OWNER_ID },
      { waitUntil: (promise) => void promise.catch(() => undefined) },
    );
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
    return;
  }
  const requested =
    url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^[/\\]+/, '');
  const file = join(process.cwd(), 'dist/client', requested);
  try {
    if (!file.startsWith(join(process.cwd(), 'dist/client'))) throw new Error('bad path');
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(await readFile(join(process.cwd(), 'dist/client/index.html')));
  }
});
server.listen(port, requestedHost, () =>
  console.log(`Local Worker/D1 server listening at http://${requestedHost}:${port}`),
);
