import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type Backend = 'ridu' | 'payload';

export function parseBackend(value: string | undefined): Backend {
  if (value === undefined || value === 'ridu') return 'ridu';
  if (value === 'payload') return 'payload';
  throw new Error('CMS_BACKEND must be ridu or payload.');
}

export function localOrigins(backend: Backend) {
  return backend === 'ridu'
    ? { cms: 'http://127.0.0.1:18087', web: 'http://127.0.0.1:4177' }
    : { cms: 'http://127.0.0.1:18088', web: 'http://127.0.0.1:4178' };
}

export async function localEnvironment(backend: Backend): Promise<Record<string, string>> {
  const directory = resolve('.data', backend);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const secretPath = resolve(directory, 'secret');
  let secret: string;
  try {
    secret = await readFile(secretPath, 'utf8');
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    secret = randomBytes(48).toString('base64url');
    await writeFile(secretPath, secret, { flag: 'wx', mode: 0o600 });
  }
  await chmod(secretPath, 0o600);
  if (secret.length < 32) throw new Error('The saved local secret is invalid.');
  const { cms, web } = localOrigins(backend);
  const uploads = resolve(directory, 'uploads');
  await mkdir(uploads, { recursive: true });
  return {
    PUBLIC_CMS_BACKEND: backend,
    PUBLIC_CMS_URL: cms,
    WEB_URL: web,
    CMS_URL: cms,
    QUIKMARQ_SHARE_SECRET: secret,
    PAYLOAD_SECRET: secret,
    DATABASE_URL: `file:${resolve(directory, 'quikmarq.sqlite')}`,
    UPLOAD_DIR: uploads,
    RIDU_SQLITE_PATH: resolve(directory, 'quikmarq.sqlite'),
    RIDU_UPLOAD_PATH: uploads,
    RIDU_ALLOWED_HOSTS: new URL(cms).host,
    RIDU_ALLOWED_ORIGINS: `${web},${cms}`,
    RIDU_SECURE_COOKIES: 'false',
    RIDU_READINESS_DRAIN_DELAY: '-1s',
    // Disposable browser journeys create many accounts through one loopback IP.
    RIDU_AUTH_RATE_LIMIT: '1000',
    WEB_BUILD_DIRECTORY: `build/${backend}`,
    WEB_ADAPTER: 'node',
    ORIGIN: web,
    HOST: '127.0.0.1',
    HOSTNAME: '127.0.0.1',
    S3_ENDPOINT: '',
    S3_REGION: '',
    S3_BUCKET: '',
    S3_ACCESS_KEY: '',
    S3_SECRET_KEY: '',
    S3_URL_STYLE: '',
    ENDPOINT: '',
    REGION: '',
    BUCKET: '',
    ACCESS_KEY_ID: '',
    SECRET_ACCESS_KEY: '',
  };
}
