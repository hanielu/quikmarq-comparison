import { describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkUploadStorage, uploadStorage } from '../src/storage/uploads'
import { readAssetBytes } from '../src/content/media'

describe('demo upload storage', () => {
  test('production defaults to the persistent local directory and partial S3 cannot silently select it', () => {
    expect(uploadStorage({ NODE_ENV: 'production' })).toEqual({ kind: 'local', directory: '/data/uploads' })
    expect(uploadStorage({ NODE_ENV: 'production', UPLOAD_DIR: '/mounted/images' })).toEqual({ kind: 'local', directory: '/mounted/images' })
    const complete = {
      S3_ENDPOINT: 'https://s3.example.test', S3_REGION: 'auto', S3_BUCKET: 'uploads',
      S3_ACCESS_KEY: 'key', S3_SECRET_KEY: 'secret',
    }
    expect(uploadStorage(complete).kind).toBe('s3')
    for (const key of Object.keys(complete) as (keyof typeof complete)[]) expect(() => uploadStorage({ ...complete, [key]: '' })).toThrow('must be configured together')
  })

  test('readiness creates, writes, reads and cleans the selected local storage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quikmarq-payload-uploads-'))
    const uploads = join(directory, 'uploads')
    try {
      await checkUploadStorage({ kind: 'local', directory: uploads })
      expect(await readdir(uploads)).toEqual([])
      const file = join(directory, 'not-a-directory')
      await writeFile(file, 'occupied')
      await expect(checkUploadStorage({ kind: 'local', directory: file })).rejects.toThrow()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('private and shared media bytes resolve original and thumbnail files from local production storage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quikmarq-payload-media-'))
    const previous = process.env.UPLOAD_DIR
    process.env.UPLOAD_DIR = directory
    try {
      await writeFile(join(directory, 'photo.png'), Buffer.from('original'))
      await writeFile(join(directory, 'photo-320x320.png'), Buffer.from('thumbnail'))
      const asset = { filename: 'photo.png', sizes: { thumb: { filename: 'photo-320x320.png' } } }
      expect(Buffer.from((await readAssetBytes(asset, 'original'))!).toString()).toBe('original')
      expect(Buffer.from((await readAssetBytes(asset, 'thumb'))!).toString()).toBe('thumbnail')
      expect(await readAssetBytes({ filename: '../photo.png' }, 'original')).toBeNull()
    } finally {
      if (previous === undefined) delete process.env.UPLOAD_DIR
      else process.env.UPLOAD_DIR = previous
      await rm(directory, { recursive: true, force: true })
    }
  })
})
