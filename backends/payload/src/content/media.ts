import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import type { PayloadRequest } from 'payload'
import { uploadPrefix as prefix, uploadS3Client, uploadStorage } from '../storage/uploads'

export const assetDirectory = process.env.UPLOAD_DIR ?? (process.env.NODE_ENV === 'production' ? '/data/uploads' : '.data/uploads')

function secret(): Buffer {
  const value = process.env.QUIKMARQ_SHARE_SECRET ?? ''
  if (value.length < 32) throw new Error('QUIKMARQ_SHARE_SECRET must contain at least 32 bytes')
  return Buffer.from(value)
}

export function signCapability(value: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url')
  const mac = createHmac('sha256', secret()).update(body).digest('base64url')
  return `${body}.${mac}`
}

export function verifyCapability<T>(value: unknown, kind: string, maxLength = 4096): T | null {
  if (typeof value !== 'string' || value.length > maxLength) return null
  const parts = value.split('.')
  if (parts.length !== 2) return null
  const expected = createHmac('sha256', secret()).update(parts[0]).digest()
  let actual: Buffer
  try { actual = Buffer.from(parts[1], 'base64url') } catch { return null }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const parsed = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Record<string, unknown>
    if (parsed.t !== kind || (kind !== 'share' && (typeof parsed.e !== 'number' || parsed.e <= Date.now()))) return null
    if (Buffer.from(JSON.stringify(parsed)).toString('base64url') !== parts[0]) return null
    return parsed as T
  } catch { return null }
}

let s3: S3Client | undefined
export type AssetFile = { filename?: string | null; mimeType?: string | null; sizes?: { thumb?: { filename?: string | null } | null } | null; prefix?: string | null }

export function filenameFor(asset: AssetFile, size: 'original' | 'thumb'): string | null {
  const filename = size === 'thumb' ? asset.sizes?.thumb?.filename : asset.filename
  if (!filename || basename(filename) !== filename) return null
  return filename
}

export async function readAssetBytes(asset: AssetFile, size: 'original' | 'thumb'): Promise<Uint8Array | null> {
  const filename = filenameFor(asset, size)
  if (!filename) return null
  const storage = uploadStorage()
  if (storage.kind === 's3') {
    const client = s3 ??= uploadS3Client(storage)
    const storedPrefix = asset.prefix || prefix
    if (storedPrefix !== prefix && !storedPrefix.startsWith(`${prefix}/`)) return null
    const response = await client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: `${storedPrefix}/${filename}` }))
    return response.Body ? new Uint8Array(await response.Body.transformToByteArray()) : null
  }
  return new Uint8Array(await readFile(join(/*turbopackIgnore: true*/ storage.directory, filename)))
}

export function mediaResponse(bytes: Uint8Array, mimeType: string): Response {
  return new Response(Buffer.from(bytes), {
    headers: { 'Content-Type': mimeType, 'Content-Length': String(bytes.byteLength), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}

export function absoluteAPIURL(req: PayloadRequest, path: string): string {
  if (!process.env.CMS_URL) throw new Error('CMS_URL is required for media links')
  return new URL(path, process.env.CMS_URL).toString()
}
