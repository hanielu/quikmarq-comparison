import { expect, test } from 'bun:test';
import { railwayProject } from '../../deploy/railway-project.ts';

function nodes(backend: 'ridu' | 'payload' | 'both') {
  const definition = railwayProject(backend);
  return definition.resources?.flat() ?? [];
}

test('each one-click installation owns one CMS, one shared frontend and one durable volume', () => {
  for (const backend of ['ridu', 'payload'] as const) {
    const resources = nodes(backend);
    expect(resources.filter((resource) => resource.type === 'service').map((resource) => resource.name)).toEqual([`${backend}-cms`, `${backend}-web`]);
    const volumes = resources.filter((resource) => resource.type === 'volume');
    expect(volumes.map((resource) => resource.name)).toEqual([`${backend}-data`]);
    const cms = resources.find((resource) => resource.type === 'service' && resource.name === `${backend}-cms`);
    expect(cms?.type).toBe('service');
    if (cms?.type !== 'service') throw new Error('Missing CMS service');
    expect(cms.volumeAttachments?.[`${backend}-data`]?.mountPath).toBe('/data');
    expect(cms.deploy?.sleepApplication).toBe(false);
    expect(cms.deploy?.numReplicas ?? cms.deploy?.multiRegionConfig?.['us-west2']?.numReplicas).toBe(1);
  }
});

test('both versions keep independent volumes and select their own backend in the shared web source', () => {
  const resources = nodes('both');
  expect(resources.filter((resource) => resource.type === 'volume').map((resource) => resource.name)).toEqual(['ridu-data', 'payload-data']);
  for (const backend of ['ridu', 'payload'] as const) {
    const web = resources.find((resource) => resource.type === 'service' && resource.name === `${backend}-web`);
    if (web?.type !== 'service') throw new Error('Missing frontend');
    expect(web.build?.dockerfilePath).toBe('apps/web/Dockerfile');
    expect(web.variables?.PUBLIC_CMS_BACKEND).toEqual({ type: 'literal', value: backend });
    expect(JSON.stringify(web.variables?.PUBLIC_CMS_URL)).toContain(`${backend}-cms.RAILWAY_PUBLIC_DOMAIN`);
  }
});

test('templates preserve independent secrets rather than committing values', () => {
  for (const backend of ['ridu', 'payload'] as const) {
    const cms = nodes(backend).find((resource) => resource.type === 'service' && resource.name === `${backend}-cms`);
    if (cms?.type !== 'service') throw new Error('Missing CMS');
    expect(cms.variables?.QUIKMARQ_SHARE_SECRET).toEqual({ type: 'preserve' });
    if (backend === 'payload') expect(cms.variables?.PAYLOAD_SECRET).toEqual({ type: 'preserve' });
  }
});
