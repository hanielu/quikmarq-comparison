import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildConfig, createLocalReq, getPayload, type BaseDatabaseAdapter, type CollectionConfig } from 'payload'
import sharp from 'sharp'
import { Assets } from '../src/content/assets'
import { Bookmarks } from '../src/content/bookmarks'
import { Groups } from '../src/content/groups'
import { singleHostSQLiteAdapter, serializeSQLiteTransactions } from '../src/database/sqlite'
import { Admins, Users } from '../src/content/users'

type TransactionMethods = Pick<BaseDatabaseAdapter, 'beginTransaction' | 'commitTransaction' | 'rollbackTransaction'>

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('single-host SQLite transaction boundary', () => {
  test('queues starts until commit or rollback, without queueing reads', async () => {
    const calls: string[] = []
    let sequence = 0
    const adapter: TransactionMethods & { read: () => string } = {
      beginTransaction: async () => { const id = ++sequence; calls.push(`begin:${id}`); return id },
      commitTransaction: async (id) => { calls.push(`commit:${await id}`) },
      rollbackTransaction: async (id) => { calls.push(`rollback:${await id}`) },
      read: () => 'available',
    }
    serializeSQLiteTransactions(adapter)
    const first = await adapter.beginTransaction()
    const second = adapter.beginTransaction()
    await Promise.resolve()
    expect(adapter.read()).toBe('available')
    expect(calls).toEqual(['begin:1'])
    await adapter.commitTransaction(first!)
    const secondID = await second
    expect(calls).toEqual(['begin:1', 'commit:1', 'begin:2'])
    await adapter.rollbackTransaction(secondID!)
    expect(calls.at(-1)).toBe('rollback:2')
  })

  test('releases the turn after begin, commit, or rollback failure', async () => {
    for (const failure of ['begin', 'commit', 'rollback'] as const) {
      let sequence = 0
      const adapter: TransactionMethods = {
        beginTransaction: async () => {
          sequence++
          if (failure === 'begin' && sequence === 1) throw new Error('begin failed')
          return sequence
        },
        commitTransaction: async () => { if (failure === 'commit') throw new Error('commit failed') },
        rollbackTransaction: async () => { if (failure === 'rollback') throw new Error('rollback failed') },
      }
      serializeSQLiteTransactions(adapter)
      if (failure === 'begin') {
        await expect(adapter.beginTransaction()).rejects.toThrow('begin failed')
        const next = await adapter.beginTransaction()
        expect(next).toBe(2)
        await adapter.rollbackTransaction(next!)
      } else {
        const first = await adapter.beginTransaction()
        const waiting = adapter.beginTransaction()
        await expect(failure === 'commit' ? adapter.commitTransaction(first!) : adapter.rollbackTransaction(first!)).rejects.toThrow(`${failure} failed`)
        const next = await waiting
        expect(next).toBe(2)
        await (failure === 'commit' ? adapter.rollbackTransaction(next!) : adapter.commitTransaction(next!))
      }
    }
  })

  test('does not release a turn early when the same transaction is finalized twice', async () => {
    const gate = deferred()
    let begun = 0
    let commits = 0
    let rollbacks = 0
    const adapter: TransactionMethods = {
      beginTransaction: async () => ++begun,
      commitTransaction: async () => { commits++; await gate.promise },
      rollbackTransaction: async () => { rollbacks++ },
    }
    serializeSQLiteTransactions(adapter)
    const first = await adapter.beginTransaction()
    const ending = adapter.commitTransaction(Promise.resolve(first!))
    const duplicate = adapter.rollbackTransaction(Promise.resolve(first!))
    const waiting = adapter.beginTransaction()
    await Promise.resolve()
    expect(begun).toBe(1)
    gate.resolve()
    await Promise.all([ending, duplicate])
    expect(commits).toBe(1)
    expect(rollbacks).toBe(0)
    expect(await waiting).toBe(2)
    await adapter.rollbackTransaction(2)
  })
})

describe('native Payload writes', () => {
  let cleanup: (() => Promise<void>) | undefined
  afterAll(async () => { await cleanup?.() })

  test('overlapping signups, nested Inbox creation, revision claims, and group cascade retain one transaction each', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quikmarq-payload-sqlite-'))
    const entered = deferred()
    const releaseHook = deferred()
    let holdFirst = true
    const SlowGroups: CollectionConfig = {
      ...Groups,
      hooks: {
        ...Groups.hooks,
        afterChange: [
          ...(Groups.hooks?.afterChange ?? []),
          async ({ doc, operation }) => {
            if (operation === 'create' && holdFirst) {
              holdFirst = false
              entered.resolve()
              await releaseHook.promise
            }
            return doc
          },
        ],
      },
    }
    const config = buildConfig({
      secret: 'tests-only-payload-secret-12345678901234567890',
      admin: { user: 'admins' },
      collections: [Admins, Users, SlowGroups, Bookmarks, Assets],
      sharp,
      db: singleHostSQLiteAdapter({ client: { url: `file:${join(directory, 'content.sqlite')}` }, idType: 'uuid', transactionOptions: {}, wal: true, busyTimeout: 5000 }),
    })
    const payload = await getPayload({ config })
    cleanup = async () => { await payload.destroy(); await rm(directory, { recursive: true, force: true }) }
    const first = payload.create({ collection: 'users', data: { email: 'first@example.test', password: 'correct-horse-battery', displayName: 'First' } })
    await entered.promise
    const second = payload.create({ collection: 'users', data: { email: 'second@example.test', password: 'correct-horse-battery', displayName: 'Second' } })
    try {
      const visible = await Promise.race([
        payload.count({ collection: 'users', overrideAccess: true }).then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1000)),
      ])
      expect(visible).toBe(true)
    } finally {
      releaseHook.resolve()
    }
    const users = await Promise.all([first, second])
    for (const user of users) {
      const groups = await payload.find({ collection: 'groups', where: { owner: { equals: user.id } }, overrideAccess: true })
      expect(groups.docs.map((group) => group.name)).toEqual(['Inbox'])
    }

    const actor = { ...users[0], collection: 'users' as const }
    const source = await payload.create({
      collection: 'groups',
      data: { owner: actor.id, name: 'Source', rank: 'a'.repeat(32), revision: 1 },
      req: await createLocalReq({ user: actor }, payload),
    })
    const [firstEdit, secondEdit] = await Promise.allSettled([
      payload.update({
        collection: 'groups', id: source.id, data: { name: 'First edit' },
        req: await createLocalReq({ user: actor, req: { headers: new Headers({ 'If-Match': '1' }) } }, payload),
      }),
      payload.update({
        collection: 'groups', id: source.id, data: { name: 'Second edit' },
        req: await createLocalReq({ user: actor, req: { headers: new Headers({ 'If-Match': '1' }) } }, payload),
      }),
    ])
    const edits = [firstEdit, secondEdit]
    expect(edits.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(edits.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(edits.find((result) => result.status === 'rejected')).toHaveProperty('reason.status', 409)
    const changed = await payload.findByID({ collection: 'groups', id: source.id, overrideAccess: true })
    expect(changed.revision).toBe(2)
    await payload.create({
      collection: 'bookmarks',
      data: { owner: actor.id, group: source.id, kind: 'text', text: 'Nested deletion', position: '0', revision: 1 },
      req: await createLocalReq({ user: actor }, payload),
    })
    await payload.delete({
      collection: 'groups', id: source.id,
      req: await createLocalReq({ user: actor, req: { headers: new Headers({ 'If-Match': '2' }) } }, payload),
    })
    expect((await payload.count({ collection: 'bookmarks', where: { group: { equals: source.id } }, overrideAccess: true })).totalDocs).toBe(0)
    expect((await payload.count({ collection: 'groups', where: { owner: { equals: actor.id } }, overrideAccess: true })).totalDocs).toBe(1)
  })
})
