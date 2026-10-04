import { APIError, type CollectionConfig, type PayloadRequest } from 'payload'
import { appOrAdmin, forceOwner, ownedGroup, ownerAccess, relationID } from './access'
import { absoluteAPIURL, filenameFor, mediaResponse, readAssetBytes, signCapability, verifyCapability, assetDirectory, type AssetFile } from './media'

type PrivateClaims = { t: 'private'; a: string; s: 'original' | 'thumb'; u: string; c: 'users' | 'admins'; sid: string; e: number }

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

async function ownedAsset(req: PayloadRequest, id: string) {
  if (!req.user || !appOrAdmin({ req } as Parameters<typeof appOrAdmin>[0])) return null
  const asset = await req.payload.findByID({ collection: 'assets', id, req, overrideAccess: false, depth: 0 }).catch(() => null)
  return asset
}

export const Assets: CollectionConfig = {
  slug: 'assets',
  admin: { useAsTitle: 'filename' },
  access: { create: appOrAdmin, read: ownerAccess('owner'), update: ownerAccess('owner'), delete: ownerAccess('owner') },
  upload: {
    staticDir: assetDirectory,
    mimeTypes: ['image/jpeg', 'image/png'],
    imageSizes: [{ name: 'thumb', width: 320, height: 320, fit: 'cover', withoutEnlargement: false }],
    pasteURL: false,
    modifyResponseHeaders: ({ headers }) => { headers.set('Cache-Control', 'private, no-store'); headers.set('X-Content-Type-Options', 'nosniff') },
  },
  fields: [
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true, index: true, maxDepth: 0 },
    { name: 'group', type: 'relationship', relationTo: 'groups', required: true, index: true, maxDepth: 0 },
    { name: 'alt', type: 'text', maxLength: 200, admin: { description: 'Accessibility text. The bookmark caption is the text shown in Quikmarq.' } },
  ],
  hooks: {
    beforeValidate: [({ data, originalDoc, req }) => {
      forceOwner(data as Record<string, unknown>, originalDoc?.owner, req)
      return data
    }],
    beforeChange: [async ({ data, operation, originalDoc, req }) => {
      const owner = relationID(data.owner ?? originalDoc?.owner)
      const group = relationID(data.group ?? originalDoc?.group)
      await ownedGroup(req, group, owner)
      if (operation === 'update' && originalDoc && group !== relationID(originalDoc.group)) throw new APIError('Upload a copy in the destination group', 400)
      if (req.file && (req.file.data.length > 4_000_000 || !['image/jpeg', 'image/png'].includes(req.file.mimetype))) throw new APIError('Images must be JPEG or PNG and at most 4 MB', 400)
      return data
    }],
    beforeDelete: [async ({ id, req }) => {
      if (req.context.quikmarqCascade === true) return
      const references = await req.payload.count({ collection: 'bookmarks', where: { images: { equals: String(id) } }, req, overrideAccess: true })
      if (references.totalDocs !== 0) throw new APIError('Asset is used by a bookmark', 409)
    }],
  },
  endpoints: [
    {
      path: '/signed-urls', method: 'post',
      handler: async (req) => {
        if (!req.user) return json({ error: 'Authentication required' }, 401)
        const sid = (req.user as typeof req.user & { _sid?: string })._sid
        if (!sid || !['users', 'admins'].includes(req.user.collection)) return json({ error: 'Session required' }, 401)
        const body: unknown = await req.json!().catch(() => null)
        if (!body || typeof body !== 'object' || Array.isArray(body) || !('items' in body) || !Array.isArray(body.items) || body.items.length > 100) return json({ error: 'Invalid items' }, 400)
        const urls: { id: string; url: string }[] = []
        for (const item of body.items) {
          if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string' || !item.id || (item.size !== undefined && item.size !== 'thumb')) return json({ error: 'Invalid item' }, 400)
          const asset = await ownedAsset(req, item.id)
          if (!asset || !filenameFor(asset as unknown as AssetFile, item.size ?? 'original')) continue
          const token = signCapability({ t: 'private', a: asset.id, s: item.size ?? 'original', u: req.user.id, c: req.user.collection, sid, e: Date.now() + 30 * 60_000 })
          urls.push({ id: item.id, url: absoluteAPIURL(req, `/api/assets/media/${token}`) })
        }
        return json({ urls })
      },
    },
    {
      path: '/media/:capability', method: 'get',
      handler: async (req) => {
        const token = req.routeParams?.capability
        const claims = typeof token === 'string' ? verifyCapability<PrivateClaims>(token, 'private') : null
        if (!claims || typeof claims.a !== 'string' || typeof claims.u !== 'string' || typeof claims.sid !== 'string' || !['users', 'admins'].includes(claims.c) || !['original', 'thumb'].includes(claims.s)) return json({ error: 'Not found' }, 404)
        const user = await req.payload.findByID({ collection: claims.c, id: claims.u, req, overrideAccess: true, depth: 0 }).catch(() => null)
        const session = user?.sessions?.find((entry) => entry.id === claims.sid)
        if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return json({ error: 'Not found' }, 404)
        const asset = await req.payload.findByID({ collection: 'assets', id: claims.a, req, overrideAccess: true, depth: 0 }).catch(() => null)
        if (!asset || (claims.c === 'users' && relationID(asset.owner) !== claims.u) || !filenameFor(asset as unknown as AssetFile, claims.s)) return json({ error: 'Not found' }, 404)
        const bytes = await readAssetBytes(asset as unknown as AssetFile, claims.s).catch(() => null)
        return bytes ? mediaResponse(bytes, String(asset.mimeType)) : json({ error: 'Not found' }, 404)
      },
    },
    {
      path: '/:id/duplicate', method: 'post',
      handler: async (req) => {
        const id = req.routeParams?.id
        if (typeof id !== 'string') return json({ error: 'Not found' }, 404)
        const source = await ownedAsset(req, id)
        if (!source) return json({ error: 'Not found' }, 404)
        const body: unknown = await req.json!().catch(() => null)
        if (!body || typeof body !== 'object' || Array.isArray(body) || !('group' in body) || typeof body.group !== 'string' || !body.group || ('alt' in body && (typeof body.alt !== 'string' || body.alt.length > 200))) return json({ error: 'Group or alt is invalid' }, 400)
        try {
          await ownedGroup(req, body.group, relationID(source.owner))
          const bytes = await readAssetBytes(source as unknown as AssetFile, 'original')
          if (!bytes || !source.filename || !source.mimeType) return json({ error: 'Source image unavailable' }, 503)
          const copy = await req.payload.create({
            collection: 'assets', req, overrideAccess: false,
            data: { owner: relationID(source.owner), group: body.group, alt: 'alt' in body && typeof body.alt === 'string' ? body.alt : source.alt },
            file: { data: Buffer.from(bytes), name: source.filename, mimetype: source.mimeType, size: bytes.byteLength },
          })
          return json(copy, 201)
        } catch { return json({ error: 'Could not duplicate image' }, 400) }
      },
    },
  ],
}
