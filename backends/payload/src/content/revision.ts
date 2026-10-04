import { APIError, type CollectionBeforeChangeHook, type CollectionBeforeDeleteHook } from 'payload'
import { isAdmin } from './access'

// The claim is performed by the adapter's atomic updateOne in Payload's request
// transaction. A second writer cannot claim the same revision. Payload's normal
// update follows in that same transaction and persists the incremented value.
export async function claimRevision(req: Parameters<CollectionBeforeChangeHook>[0]['req'], collection: 'groups' | 'bookmarks', id: string, current: number): Promise<number> {
  const raw = typeof req.context.quikmarqExpectedRevision === 'number'
    ? String(req.context.quikmarqExpectedRevision)
    : req.headers.get('if-match') ?? (isAdmin(req) ? String(current) : null)
  if (!raw) throw new APIError('If-Match revision is required', 428)
  const match = /^(?:"([0-9]+)"|([0-9]+))$/.exec(raw)
  if (!match) throw new APIError('If-Match must contain a numeric revision', 400)
  const expected = Number(match[1] ?? match[2])
  if (!Number.isSafeInteger(expected) || expected < 1 || expected !== current) throw new APIError('Document changed; reload and retry', 409)
  const claimed = await req.payload.db.updateOne({
    collection,
    data: { revision: expected + 1 },
    options: { atomic: true },
    req,
    where: { and: [{ id: { equals: id } }, { revision: { equals: expected } }] },
  })
  if (!claimed) throw new APIError('Document changed; reload and retry', 409)
  return expected + 1
}

export function initialRevision(data: Record<string, unknown>): void {
  data.revision = 1
}

export async function guardDeleteRevision(args: Parameters<CollectionBeforeDeleteHook>[0], collection: 'groups' | 'bookmarks'): Promise<void> {
  if (args.req.context.quikmarqCascade === true) return
  const doc = await args.req.payload.findByID({ collection, id: args.id, req: args.req, overrideAccess: true, depth: 0 })
  await claimRevision(args.req, collection, String(args.id), Number(doc.revision))
}
