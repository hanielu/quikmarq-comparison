import { type Endpoint, type PayloadRequest, type Where } from 'payload'
import type { Group } from '../payload-types'
import { relationID } from './access'
import { absoluteAPIURL, filenameFor, mediaResponse, readAssetBytes, signCapability, verifyCapability, type AssetFile } from './media'

type ShareClaims = { t: 'share'; g: string; v: number }
type SharedMediaClaims = { t: 'share-media'; g: string; v: number; a: string; s: 'original' | 'thumb'; e: number }

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

function shareToken(group: { id: string | number; shareVersion?: unknown }): string {
  return signCapability({ t: 'share', g: String(group.id), v: Number(group.shareVersion) })
}

async function accessibleGroup(req: PayloadRequest): Promise<Group | null> {
  if (!req.user || typeof req.routeParams?.id !== 'string') return null
  return req.payload.findByID({ collection: 'groups', id: req.routeParams.id, req, overrideAccess: false, depth: 0 }).catch(() => null)
}

async function currentShare(req: PayloadRequest, claims: ShareClaims) {
  const group = await req.payload.findByID({ collection: 'groups', id: claims.g, req, overrideAccess: true, depth: 0 }).catch(() => null)
  return group?.sharingEnabled && group.shareVersion === claims.v && relationID(group.owner) ? group : null
}

export const groupShareEndpoints: Endpoint[] = [
  {
    path: '/:id/share', method: 'get', handler: async (req) => {
      const group = await accessibleGroup(req)
      if (!group) return json({ error: 'Group not found' }, 404)
      return json(group.sharingEnabled ? { sharingEnabled: true, token: shareToken(group) } : { sharingEnabled: false })
    },
  },
  {
    path: '/:id/share', method: 'post', handler: async (req) => {
      const group = await accessibleGroup(req)
      if (!group) return json({ error: 'Group not found' }, 404)
      const body: unknown = await req.json!().catch(() => null)
      if (!body || typeof body !== 'object' || Array.isArray(body) || !('rotate' in body) || typeof body.rotate !== 'boolean') return json({ error: 'Invalid request' }, 400)
      if (group.sharingEnabled && !body.rotate) return json({ sharingEnabled: true, token: shareToken(group) })
      req.context.quikmarqShareMutation = true
      req.context.quikmarqExpectedRevision = group.revision
      try {
        const updated = await req.payload.update({ collection: 'groups', id: group.id, req, overrideAccess: false, data: { sharingEnabled: true, shareVersion: Number(group.shareVersion ?? 0) + 1 } })
        return json({ sharingEnabled: true, token: shareToken(updated) })
      } catch { return json({ error: 'Share state changed; retry' }, 409) }
      finally { delete req.context.quikmarqShareMutation; delete req.context.quikmarqExpectedRevision }
    },
  },
  {
    path: '/:id/share', method: 'delete', handler: async (req) => {
      const group = await accessibleGroup(req)
      if (!group) return json({ error: 'Group not found' }, 404)
      req.context.quikmarqShareMutation = true
      req.context.quikmarqExpectedRevision = group.revision
      try {
        await req.payload.update({ collection: 'groups', id: group.id, req, overrideAccess: false, data: { sharingEnabled: false, shareVersion: Number(group.shareVersion ?? 0) + 1 } })
        return json({ sharingEnabled: false })
      } catch { return json({ error: 'Share state changed; retry' }, 409) }
      finally { delete req.context.quikmarqShareMutation; delete req.context.quikmarqExpectedRevision }
    },
  },
]

function publicBookmark(doc: Record<string, unknown>, images: Record<string, unknown>[]) {
  const fields = ['id', 'group', 'kind', 'position', 'url', 'title', 'description', 'favicon', 'previewImage', 'videoProvider', 'videoID', 'text', 'caption']
  return Object.fromEntries([...fields.map((key) => [key, doc[key]]), ['images', images]])
}

export const shareEndpoints: Endpoint[] = [
  {
    path: '/share/resolve', method: 'post', handler: async (req) => {
      const body: unknown = await req.json!().catch(() => null)
      if (!body || typeof body !== 'object' || Array.isArray(body) || !('token' in body) || typeof body.token !== 'string' || ('page' in body && (!Number.isInteger(body.page) || Number(body.page) < 1 || Number(body.page) > 10_000)) || ('limit' in body && (!Number.isInteger(body.limit) || Number(body.limit) < 1)) || ('query' in body && typeof body.query !== 'string') || ('kind' in body && typeof body.kind !== 'string')) return json({ error: 'Share not found' }, 404)
      const claims = verifyCapability<ShareClaims>(body.token, 'share', 1024)
      if (!claims || typeof claims.g !== 'string' || !Number.isInteger(claims.v) || claims.v < 1) return json({ error: 'Share not found' }, 404)
      const group = await currentShare(req, claims)
      if (!group) return json({ error: 'Share not found' }, 404)
      const page = 'page' in body ? Number(body.page) : 1
      const limit = 'limit' in body ? Math.min(100, Number(body.limit)) : 30
      const query = 'query' in body ? String(body.query).trim() : ''
      const kind = 'kind' in body ? String(body.kind) : ''
      if (query.length > 200 || (kind && !['link', 'text', 'media'].includes(kind))) return json({ error: 'Share not found' }, 404)
      const clauses: Where[] = [{ group: { equals: group.id } }, { owner: { equals: relationID(group.owner) } }]
      if (kind) clauses.push({ kind: { equals: kind } })
      if (query) clauses.push({ or: ['title', 'url', 'description', 'text', 'caption'].map((field) => ({ [field]: { contains: query } })) })
      const results = await req.payload.find({ collection: 'bookmarks', where: { and: clauses }, sort: '-position', page, limit, req, overrideAccess: true, depth: 0 })
      const docs = []
      for (const bookmark of results.docs) {
        const images: Record<string, unknown>[] = []
        for (const id of Array.isArray(bookmark.images) ? bookmark.images.map(relationID) : []) {
          const asset = await req.payload.findByID({ collection: 'assets', id, req, overrideAccess: true, depth: 0 }).catch(() => null)
          if (!asset || relationID(asset.group) !== group.id || relationID(asset.owner) !== relationID(group.owner)) return json({ error: 'Shared media unavailable' }, 503)
          const makeURL = (size: 'original' | 'thumb') => absoluteAPIURL(req, `/api/share/media/${signCapability({ t: 'share-media', g: group.id, v: claims.v, a: asset.id, s: size, e: Date.now() + 10 * 60_000 })}`)
          images.push({ id: asset.id, url: makeURL('original'), thumbnailURL: filenameFor(asset as unknown as AssetFile, 'thumb') ? makeURL('thumb') : makeURL('original'), alt: asset.alt, width: asset.width, height: asset.height })
        }
        docs.push(publicBookmark(bookmark as unknown as Record<string, unknown>, images))
      }
      if (!await currentShare(req, claims)) return json({ error: 'Share not found' }, 404)
      return json({
        group: { id: group.id, name: group.name }, docs,
        pagination: { page: results.page, limit: results.limit, totalDocs: results.totalDocs, totalPages: results.totalPages, hasNextPage: results.hasNextPage, hasPrevPage: results.hasPrevPage },
      })
    },
  },
  {
    path: '/share/media/:capability', method: 'get', handler: async (req) => {
      const token = req.routeParams?.capability
      const claims = typeof token === 'string' ? verifyCapability<SharedMediaClaims>(token, 'share-media') : null
      if (!claims || !claims.a || !claims.g || !Number.isInteger(claims.v) || !['original', 'thumb'].includes(claims.s)) return json({ error: 'Share not found' }, 404)
      const group = await currentShare(req, { t: 'share', g: claims.g, v: claims.v })
      if (!group) return json({ error: 'Share not found' }, 404)
      const asset = await req.payload.findByID({ collection: 'assets', id: claims.a, req, overrideAccess: true, depth: 0 }).catch(() => null)
      if (!asset || relationID(asset.group) !== group.id || relationID(asset.owner) !== relationID(group.owner)) return json({ error: 'Share not found' }, 404)
      const bytes = await readAssetBytes(asset as unknown as AssetFile, claims.s).catch(() => null)
      return bytes ? mediaResponse(bytes, String(asset.mimeType)) : json({ error: 'Share not found' }, 404)
    },
  },
]
