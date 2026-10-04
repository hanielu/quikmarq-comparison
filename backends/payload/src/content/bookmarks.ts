import { APIError, type CollectionConfig, type PayloadRequest } from 'payload'
import { appOrAdmin, forceOwner, ownedGroup, ownerAccess, relationID } from './access'
import { claimRevision, guardDeleteRevision, initialRevision } from './revision'

let lastPosition = 0n
function nextPosition(): string {
  const now = BigInt(Date.now()) * 1_000_000n
  lastPosition = now > lastPosition ? now : lastPosition + 1n
  return lastPosition.toString(36).padStart(13, '0')
}

function imageIDs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(relationID).filter(Boolean)
}

async function validateImages(req: PayloadRequest, ids: string[], owner: string, group: string): Promise<void> {
  if (ids.length < 1 || ids.length > 4 || new Set(ids).size !== ids.length) throw new APIError('Choose one to four distinct images', 400)
  for (const id of ids) {
    const asset = await req.payload.findByID({ collection: 'assets', id, req, overrideAccess: true, depth: 0 }).catch(() => null)
    if (!asset || relationID(asset.owner) !== owner || relationID(asset.group) !== group) throw new APIError('Choose images from the bookmark group', 400)
  }
}

async function cleanupDetached(req: PayloadRequest, removed: string[], group: string): Promise<void> {
  for (const id of removed) {
    const references = await req.payload.count({ collection: 'bookmarks', where: { and: [{ group: { equals: group } }, { images: { equals: id } }] }, req, overrideAccess: true })
    if (references.totalDocs === 0) {
      const asset = await req.payload.findByID({ collection: 'assets', id, req, overrideAccess: true, depth: 0 }).catch(() => null)
      if (asset && relationID(asset.group) === group) await req.payload.delete({ collection: 'assets', id, req, overrideAccess: true })
    }
  }
}

export const Bookmarks: CollectionConfig = {
  slug: 'bookmarks',
  versions: { maxPerDoc: 1 },
  admin: { useAsTitle: 'title' },
  defaultSort: '-position',
  access: { create: appOrAdmin, read: ownerAccess('owner'), readVersions: ownerAccess('version.owner'), update: ownerAccess('owner'), delete: ownerAccess('owner') },
  fields: [
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true, index: true, maxDepth: 0 },
    { name: 'group', type: 'relationship', relationTo: 'groups', required: true, index: true, maxDepth: 0 },
    { name: 'kind', type: 'select', required: true, options: ['link', 'text', 'media'] },
    { name: 'position', type: 'text', required: true, index: true, admin: { hidden: true } },
    { name: 'url', type: 'text' },
    { name: 'title', type: 'text', maxLength: 500 },
    { name: 'description', type: 'textarea' },
    { name: 'favicon', type: 'text' },
    { name: 'previewImage', type: 'text' },
    { name: 'videoProvider', type: 'text' },
    { name: 'videoID', type: 'text' },
    { name: 'text', type: 'textarea' },
    { name: 'caption', type: 'textarea', admin: { description: 'Text shown on this media bookmark, shared by all its images.' } },
    { name: 'images', type: 'relationship', relationTo: 'assets', hasMany: true, maxRows: 4, maxDepth: 1 },
    { name: 'revision', type: 'number', required: true, defaultValue: 1, index: true, admin: { hidden: true } },
  ],
  hooks: {
    beforeValidate: [({ data, operation, originalDoc, req }) => {
      const next = data as Record<string, unknown>
      forceOwner(next, originalDoc?.owner, req)
      if (operation === 'create') initialRevision(next)
      if (next.kind !== undefined) {
        if (typeof next.kind !== 'string') throw new APIError('Choose a bookmark kind', 400)
        next.kind = next.kind.trim().toLowerCase()
      }
      return data
    }],
    beforeChange: [async ({ data, operation, originalDoc, req }) => {
      const next = data as Record<string, unknown>
      const owner = relationID(next.owner ?? originalDoc?.owner)
      const group = relationID(next.group ?? originalDoc?.group)
      await ownedGroup(req, group, owner)
      const kind = next.kind ?? originalDoc?.kind
      if (operation === 'update' && originalDoc && kind !== originalDoc.kind) throw new APIError('Bookmark kind cannot change', 400)
      if (kind === 'link') {
        const value = next.url ?? originalDoc?.url
        try {
          const url = new URL(String(value))
          if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error()
        } catch { throw new APIError('Add a valid HTTP or HTTPS URL', 400) }
        Object.assign(next, { text: null, caption: null, images: [] })
      } else if (kind === 'text') {
        if (!String(next.text ?? originalDoc?.text ?? '').trim()) throw new APIError('Write a note', 400)
        Object.assign(next, { url: null, favicon: null, previewImage: null, videoProvider: null, videoID: null, caption: null, images: [] })
      } else if (kind === 'media') {
        const ids = imageIDs(next.images ?? originalDoc?.images)
        await validateImages(req, ids, owner, group)
        Object.assign(next, { url: null, favicon: null, previewImage: null, videoProvider: null, videoID: null, text: null })
      } else throw new APIError('Choose a bookmark kind', 400)
      if (operation === 'create') next.position = nextPosition()
      else if (originalDoc) {
        next.position = group === relationID(originalDoc.group) ? originalDoc.position : nextPosition()
        next.revision = await claimRevision(req, 'bookmarks', String(originalDoc.id), Number(originalDoc.revision))
      }
      return data
    }],
    afterChange: [async ({ doc, previousDoc, operation, req }) => {
      if (operation === 'update' && previousDoc) {
        const retained = new Set(imageIDs(doc.images))
        await cleanupDetached(req, imageIDs(previousDoc.images).filter((id) => !retained.has(id)), relationID(previousDoc.group))
      }
      return doc
    }],
    beforeDelete: [async (args) => { await guardDeleteRevision(args, 'bookmarks') }],
    afterDelete: [async ({ doc, req }) => {
      await cleanupDetached(req, imageIDs(doc.images), relationID(doc.group))
      return doc
    }],
  },
}
