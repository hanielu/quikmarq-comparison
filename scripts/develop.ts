import { resolve } from 'node:path';
import { localEnvironment, localOrigins, parseBackend, type Backend } from './local-environment.ts';
import { launch } from './processes.ts';

const selected: Backend[] = process.argv.includes('--all')
  ? ['ridu', 'payload']
  : [parseBackend(process.env.CMS_BACKEND)];
for (const backend of selected) {
  const env = await localEnvironment(backend);
  const origins = localOrigins(backend);
  const command = ['bun', 'run', 'dev'];
  launch(command, resolve('backends', backend), { ...env, PORT: new URL(origins.cms).port });
  launch(['bun', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', new URL(origins.web).port], resolve('apps/web'), env);
  console.log(`${backend}: ${origins.web} · CMS/admin: ${origins.cms}/admin`);
}
