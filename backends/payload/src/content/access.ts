import type { Access, PayloadRequest } from 'payload'
import { APIError } from 'payload'

export function isAdmin(req: PayloadRequest): boolean {
  return req.user?.collection === 'admins'
}

export function isAppUser(req: PayloadRequest): boolean {
  return req.user?.collection === 'users'
}

export const adminOnly: Access = ({ req }) => isAdmin(req)

export const appOrAdmin: Access = ({ req }) => isAdmin(req) || isAppUser(req)

export function ownerAccess(field: 'owner' | 'id' | 'version.owner'): Access {
  return ({ req }) => {
    if (isAdmin(req)) return true
    if (!isAppUser(req)) return false
    return { [field]: { equals: req.user!.id } }
  }
}

export function requireActor(req: PayloadRequest): string {
  if (!isAppUser(req) && !isAdmin(req)) throw new APIError('Authentication required', 401)
  return String(req.user!.id)
}

export function relationID(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id
  return ''
}

export function forceOwner(data: Record<string, unknown>, originalOwner: unknown, req: PayloadRequest): void {
  if (originalOwner !== undefined) {
    const owner = relationID(originalOwner)
    if (data.owner !== undefined && relationID(data.owner) !== owner) throw new APIError('Owner cannot change', 400)
    data.owner = owner
    return
  }
  if (isAdmin(req)) {
    if (!relationID(data.owner)) throw new APIError('Owner is required', 400)
    return
  }
  if (typeof req.context.quikmarqInboxOwner === 'string' && relationID(data.owner) === req.context.quikmarqInboxOwner) return
  if (!isAppUser(req)) throw new APIError('Authentication required', 401)
  if (data.owner !== undefined && relationID(data.owner) !== req.user!.id) throw new APIError('Owner must match the signed-in account', 400)
  data.owner = req.user!.id
}

export async function ownedGroup(req: PayloadRequest, id: string, owner: string): Promise<void> {
  if (!id) throw new APIError('Choose a group', 400)
  const group = await req.payload.findByID({ collection: 'groups', id, req, overrideAccess: true, depth: 0 }).catch(() => null)
  if (!group || relationID(group.owner) !== owner) throw new APIError('Choose a group owned by this account', 400)
}
