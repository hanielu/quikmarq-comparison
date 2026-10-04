import { APIError, type CollectionConfig } from 'payload'
import { appOrAdmin, forceOwner, ownerAccess, relationID } from './access'
import { claimRevision, guardDeleteRevision, initialRevision } from './revision'
import { groupShareEndpoints } from './share'

const rankPattern = /^[0-9a-z]{32}$/

export const Groups: CollectionConfig = {
  slug: 'groups',
  versions: { maxPerDoc: 1 },
  admin: { useAsTitle: 'name' },
  defaultSort: 'rank',
  access: { create: appOrAdmin, read: ownerAccess('owner'), readVersions: ownerAccess('version.owner'), update: ownerAccess('owner'), delete: ownerAccess('owner') },
  endpoints: groupShareEndpoints,
  fields: [
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true, index: true, maxDepth: 0 },
    { name: 'name', type: 'text', required: true, maxLength: 80 },
    { name: 'rank', type: 'text', required: true, index: true },
    { name: 'sharingEnabled', type: 'checkbox', defaultValue: false, admin: { hidden: true } },
    { name: 'shareVersion', type: 'number', defaultValue: 0, admin: { hidden: true } },
    { name: 'revision', type: 'number', required: true, defaultValue: 1, index: true, admin: { hidden: true } },
  ],
  hooks: {
    beforeValidate: [({ data, operation, originalDoc, req }) => {
      const next = data as Record<string, unknown>
      forceOwner(next, originalDoc?.owner, req)
      if (operation === 'create') {
        next.sharingEnabled = false
        next.shareVersion = 0
        initialRevision(next)
      } else if (req.context.quikmarqShareMutation !== true) {
        if (next.sharingEnabled !== undefined && next.sharingEnabled !== originalDoc?.sharingEnabled) throw new APIError('Sharing is managed by the share endpoint', 400)
        if (next.shareVersion !== undefined && next.shareVersion !== originalDoc?.shareVersion) throw new APIError('Sharing is managed by the share endpoint', 400)
      }
      if (next.rank !== undefined && (typeof next.rank !== 'string' || !rankPattern.test(next.rank))) throw new APIError('Rank must be a 32-character lowercase ordering key', 400)
      return data
    }],
    beforeChange: [async ({ data, operation, originalDoc, req }) => {
      if (operation === 'update' && originalDoc) {
        ;(data as Record<string, unknown>).revision = await claimRevision(req, 'groups', String(originalDoc.id), Number(originalDoc.revision))
      }
      return data
    }],
    beforeDelete: [async ({ id, req }) => {
      await guardDeleteRevision({ id, req } as Parameters<NonNullable<NonNullable<CollectionConfig['hooks']>['beforeDelete']>[number]>[0], 'groups')
      const group = await req.payload.findByID({ collection: 'groups', id, req, overrideAccess: true, depth: 0 })
      const owner = relationID(group.owner)
      const user = await req.payload.findByID({ collection: 'users', id: owner, req, overrideAccess: true, depth: 0 })
      const version = Number(user.groupMutationVersion ?? 0)
      const claimed = await req.payload.db.updateOne({
        collection: 'users', req,
        options: { atomic: true },
        where: { and: [{ id: { equals: owner } }, { groupMutationVersion: { equals: version } }] },
        data: { groupMutationVersion: version + 1 },
      })
      if (!claimed) throw new APIError('Group deletion conflicted with another change', 409)
      const owned = await req.payload.count({ collection: 'groups', where: { owner: { equals: owner } }, req, overrideAccess: true })
      if (owned.totalDocs <= 1) throw new APIError('Cannot delete the final group', 400)
      req.context.quikmarqCascade = true
      try {
        for (const collection of ['bookmarks', 'assets'] as const) {
          for (;;) {
            const page = await req.payload.find({ collection, where: { group: { equals: String(id) } }, limit: 100, req, overrideAccess: true, depth: 0 })
            if (page.docs.length === 0) break
            for (const doc of page.docs) await req.payload.delete({ collection, id: doc.id, req, overrideAccess: true })
          }
        }
      } finally {
        delete req.context.quikmarqCascade
      }
    }],
  },
}
