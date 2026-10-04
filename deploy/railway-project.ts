import { github, preserve, project, service, volume, type ProjectDefinition } from 'railway/iac';

export type DemoSelection = 'ridu' | 'payload' | 'both';

export function railwayProject(selection: DemoSelection, repository = 'hanielu/quikmarq-comparison'): ProjectDefinition {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('QUIKMARQ_SOURCE_REPO must be an owner/repository name.');
  }
  const selected = selection === 'both' ? ['ridu', 'payload'] as const : [selection];
  const resources: NonNullable<ProjectDefinition['resources']> = [];
  for (const backend of selected) {
    const apiName = `${backend}-cms`;
    const webName = `${backend}-web`;
    const cmsOrigin = `https://\${{${apiName}.RAILWAY_PUBLIC_DOMAIN}}`;
    const webOrigin = `https://\${{${webName}.RAILWAY_PUBLIC_DOMAIN}}`;
    const data = volume(`${backend}-data`, { region: 'us-west2', sizeMB: 1024 });
    const api = service(apiName, {
      source: github(repository, { branch: 'main' }),
      build: { builder: 'DOCKERFILE', dockerfilePath: `backends/${backend}/Dockerfile` },
      healthcheck: '/readyz',
      healthcheckTimeout: 300,
      replicas: { 'us-west2': 1 },
      deploy: { sleepApplication: false, restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 3, overlapSeconds: 0, drainingSeconds: 30 },
      volumeMounts: { '/data': data },
      env: {
        PORT: '8080',
        NODE_ENV: 'production',
        QUIKMARQ_SHARE_SECRET: preserve(),
        ...(backend === 'ridu' ? {
          RIDU_SQLITE_PATH: '/data/quikmarq.sqlite',
          RIDU_UPLOAD_PATH: '/data/uploads',
          RIDU_ALLOWED_HOSTS: `\${{${apiName}.RAILWAY_PUBLIC_DOMAIN}},healthcheck.railway.app`,
          RIDU_ALLOWED_ORIGINS: `${webOrigin},${cmsOrigin}`,
          RIDU_READINESS_DRAIN_DELAY: '-1s',
        } : {
          DATABASE_URL: 'file:/data/quikmarq.sqlite',
          UPLOAD_DIR: '/data/uploads',
          CMS_URL: cmsOrigin,
          WEB_URL: webOrigin,
          PAYLOAD_SECRET: preserve(),
        }),
      },
    });
    const web = service(webName, {
      source: github(repository, { branch: 'main' }),
      build: { builder: 'DOCKERFILE', dockerfilePath: 'apps/web/Dockerfile' },
      healthcheck: '/readyz',
      healthcheckTimeout: 300,
      replicas: { 'us-west2': 1 },
      deploy: { sleepApplication: false, restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 3 },
      env: {
        PORT: '3000',
        HOST: '0.0.0.0',
        ORIGIN: webOrigin,
        PUBLIC_CMS_BACKEND: backend,
        PUBLIC_CMS_URL: cmsOrigin,
      },
    });
    resources.push(api, web, data);
  }
  return project(selection === 'both' ? 'quikmarq-comparison' : `quikmarq-comparison-${selection}`, { resources });
}

export function parseSelection(value: string | undefined): DemoSelection {
  if (value === undefined || value === 'both') return 'both';
  if (value === 'ridu' || value === 'payload') return value;
  throw new Error('DEMO_BACKENDS must be ridu, payload or both.');
}
