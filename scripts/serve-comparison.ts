import { resolve } from 'node:path';
import { localEnvironment, localOrigins } from './local-environment.ts';
import { launch } from './processes.ts';

for (const backend of ['ridu', 'payload'] as const) {
  const env = await localEnvironment(backend);
  const { cms, web } = localOrigins(backend);
  const command = backend === 'ridu'
    ? ['./dist/quikmarq-ridu', 'serve-with-migrations']
    : ['node', '.next/standalone/backends/payload/server.js'];
  launch(command, resolve('backends', backend), {
    ...env, NODE_ENV: 'production', PORT: new URL(cms).port,
  });
  launch(['node', `build/${backend}/index.js`], resolve('apps/web'), {
    ...env, NODE_ENV: 'production', PORT: new URL(web).port,
  });
  console.log(`${backend}: ${web} · CMS/admin: ${cms}/admin`);
}
