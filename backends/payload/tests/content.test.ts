import { describe, expect, test } from 'bun:test'
import type { PayloadRequest } from 'payload'
import { Assets } from '../src/content/assets'
import { Bookmarks } from '../src/content/bookmarks'
import { Groups } from '../src/content/groups'
import { parseMetadata, parsePublicURL, publicAddress } from '../src/content/metadata'
import { signCapability, verifyCapability } from '../src/content/media'
import { claimRevision } from '../src/content/revision'
import { shareEndpoints } from '../src/content/share'

process.env.QUIKMARQ_SHARE_SECRET = 'tests-only-share-secret-12345678901234567890'

type RequestFixture = {
  user?: null | { id: string; collection: 'users' | 'admins'; _sid?: string }
  headers?: Headers
  context?: Record<string, unknown>
  json?: () => Promise<unknown>
  payload?: { db: { updateOne: (input: unknown) => Promise<unknown> } }
}

function testRequest(fields: RequestFixture): PayloadRequest {
  return fields as unknown as PayloadRequest
}

describe('metadata boundary', () => {
  test('blocks private and special destinations before making a request', () => {
    for (const host of ['127.0.0.1', '10.2.3.4', '169.254.169.254', '192.168.1.2', '::1', 'fc00::1']) expect(publicAddress(host)).toBe(false)
    for (const value of ['http://127.0.0.1/', 'https://example.local/', 'https://user:pass@example.com/', 'http://example.com:8080/']) expect(() => parsePublicURL(value)).toThrow()
    expect(parsePublicURL('example.com/path#fragment').toString()).toBe('https://example.com/path')
  })

  test('extracts only a narrow metadata shape', () => {
    const result = parseMetadata('<title>Fallback</title><meta property="og:title" content="Example &amp; Co"><meta name="description" content="A note"><link rel="icon" href="/icon.png">', new URL('https://example.com/article'))
    expect(result).toEqual({ normalizedURL: 'https://example.com/article', title: 'Example & Co', description: 'A note', favicon: 'https://example.com/icon.png', previewImage: '' })
  })
})

describe('capabilities', () => {
  test('are signed, typed, canonical, and expire', () => {
    const token = signCapability({ t: 'private', a: 'one', e: Date.now() + 1000 })
    expect(verifyCapability<{ a: string }>(token, 'private')?.a).toBe('one')
    expect(verifyCapability(token, 'share-media')).toBeNull()
    expect(verifyCapability(`${token}x`, 'private')).toBeNull()
    expect(verifyCapability(signCapability({ t: 'private', a: 'one', e: Date.now() - 1 }), 'private')).toBeNull()
    expect(verifyCapability({ token }, 'private')).toBeNull()
  })
})

describe('HTTP input and revision contract', () => {
  test('version reads keep the owner predicate on the stored snapshot', async () => {
    for (const collection of [Groups, Bookmarks]) {
      const access = collection.access!.readVersions!
      expect(await access({ req: testRequest({ user: { collection: 'users', id: 'owner' } }) })).toEqual({ 'version.owner': { equals: 'owner' } })
      expect(await access({ req: testRequest({ user: null }) })).toBe(false)
    }
  })

  test('rejects malformed public share tokens with the same 404', async () => {
    const handler = shareEndpoints.find((endpoint) => endpoint.path === '/share/resolve')!.handler!
    const response = await handler(testRequest({ json: async () => ({ token: {} }) }))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Share not found' })
  })

  test('rejects malformed signed URL batches before database access', async () => {
    if (!Array.isArray(Assets.endpoints)) throw new Error('Asset endpoints missing')
    const handler = Assets.endpoints.find((endpoint) => endpoint.path === '/signed-urls')!.handler!
    const response = await handler(testRequest({ user: { collection: 'users', id: 'owner', _sid: 'session' }, json: async () => ({ items: [{ id: 42 }] }) }))
    expect(response.status).toBe(400)
  })

  test('claims the expected revision with one atomic store predicate', async () => {
    let args: unknown
    const req = testRequest({
      headers: new Headers({ 'If-Match': '3' }), context: {}, user: { id: 'owner', collection: 'users' },
      payload: { db: { updateOne: async (input: unknown) => { args = input; return { id: 'document' } } } },
    })
    expect(await claimRevision(req, 'groups', 'document', 3)).toBe(4)
    expect(args).toMatchObject({ collection: 'groups', options: { atomic: true }, where: { and: [{ id: { equals: 'document' } }, { revision: { equals: 3 } }] } })
    await expect(claimRevision(req, 'groups', 'document', 4)).rejects.toHaveProperty('status', 409)
  })
})
