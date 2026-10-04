import { spawnSync } from 'node:child_process';
import { localEnvironment } from './local-environment.ts';

function run(args: string[], env: Record<string, string>) {
  const result = spawnSync('bun', args, { env: { ...process.env, ...env }, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
for (const backend of ['ridu', 'payload'] as const) {
  const env = await localEnvironment(backend);
  run(['run', `build:${backend}`], { ...env, NODE_ENV: 'production' });
  run(['run', 'build:web'], env);
}
