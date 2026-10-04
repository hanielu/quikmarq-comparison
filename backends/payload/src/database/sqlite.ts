import { sqliteAdapter, type SQLiteAdapterArgs } from '@payloadcms/db-sqlite'
import type { BaseDatabaseAdapter } from 'payload'

type TransactionMethods = Pick<BaseDatabaseAdapter, 'beginTransaction' | 'commitTransaction' | 'rollbackTransaction'>
type TransactionID = number | string

/**
 * This application runs one SQLite file in one Node process. libSQL opens a new
 * connection for each transaction, so Payload's connection-level busy_timeout
 * does not protect subsequent BEGINs. Queue transaction starts asynchronously
 * instead of blocking Node's event loop while another write awaits a hook.
 */
export function serializeSQLiteTransactions(adapter: TransactionMethods): void {
  const begin = adapter.beginTransaction.bind(adapter)
  const commit = adapter.commitTransaction.bind(adapter)
  const rollback = adapter.rollbackTransaction.bind(adapter)
  const active = new Map<TransactionID, { release: () => void; ending?: Promise<void> }>()
  let previous = Promise.resolve()

  adapter.beginTransaction = async (options) => {
    let release!: () => void
    const turn = new Promise<void>((resolve) => { release = resolve })
    const wait = previous
    previous = turn
    await wait
    try {
      const id = await begin(options)
      if (id == null) {
        release()
        return id
      }
      active.set(id, { release })
      return id
    } catch (error) {
      release()
      throw error
    }
  }

  async function end(incomingID: Parameters<typeof commit>[0], operation: typeof commit): Promise<void> {
    const id = await incomingID
    const slot = active.get(id)
    if (!slot) return operation(id)
    if (slot.ending) return slot.ending
    const ending = (async () => {
      try {
        // The official Drizzle/libSQL adapter attempts rollback before a
        // failed commit settles. Do not admit another writer before that end.
        await operation(id)
      } finally {
        active.delete(id)
        slot.release()
      }
    })()
    slot.ending = ending
    return ending
  }

  adapter.commitTransaction = (id) => end(id, commit)
  adapter.rollbackTransaction = (id) => end(id, rollback)
}

export function singleHostSQLiteAdapter(args: SQLiteAdapterArgs) {
  const official = sqliteAdapter(args)
  return {
    ...official,
    init(initArgs: Parameters<typeof official.init>[0]) {
      const adapter = official.init(initArgs)
      serializeSQLiteTransactions(adapter)
      return adapter
    },
  }
}
