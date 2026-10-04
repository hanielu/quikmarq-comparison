import type { CollectionConfig } from 'payload'
import { adminOnly, ownerAccess } from './access'

export const Admins: CollectionConfig = {
  slug: 'admins',
  auth: { useSessions: true },
  admin: { useAsTitle: 'email' },
  access: {
    read: adminOnly,
    update: adminOnly,
    delete: adminOnly,
    create: async ({ req }) => {
      if (req.user?.collection === 'admins') return true
      const count = await req.payload.count({ collection: 'admins', overrideAccess: true, req })
      return count.totalDocs === 0
    },
  },
  fields: [],
}

export const Users: CollectionConfig = {
  slug: 'users',
  auth: { useSessions: true },
  admin: { hidden: true, useAsTitle: 'email' },
  access: {
    create: () => true,
    read: ownerAccess('id'),
    update: ownerAccess('id'),
    delete: () => false,
  },
  fields: [
    { name: 'displayName', type: 'text', required: true, maxLength: 80 },
    { name: 'groupMutationVersion', type: 'number', defaultValue: 0, admin: { hidden: true }, access: { read: () => false, create: () => false, update: () => false } },
  ],
  hooks: {
    afterChange: [async ({ doc, operation, req }) => {
      if (operation !== 'create') return doc
      req.context.quikmarqInboxOwner = String(doc.id)
      try {
        await req.payload.create({
          collection: 'groups',
          data: { owner: doc.id, name: 'Inbox', rank: 'hzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', revision: 1, sharingEnabled: false, shareVersion: 0 },
          req,
          overrideAccess: true,
        })
      } finally {
        delete req.context.quikmarqInboxOwner
      }
      return doc
    }],
  },
}
