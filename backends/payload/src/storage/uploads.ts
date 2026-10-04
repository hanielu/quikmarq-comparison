import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

export const uploadPrefix = 'quikmarq-payload/uploads'

type UploadEnvironment = Partial<Pick<NodeJS.ProcessEnv, 'S3_ENDPOINT' | 'S3_REGION' | 'S3_BUCKET' | 'S3_ACCESS_KEY' | 'S3_SECRET_KEY' | 'UPLOAD_DIR' | 'NODE_ENV'>>

export type UploadStorage =
  | { kind: 'local'; directory: string }
  | { kind: 's3'; endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }

/** Local storage is the demo default; S3 is selected only by a complete configuration. */
export function uploadStorage(env: UploadEnvironment = process.env): UploadStorage {
  const values = [env.S3_ENDPOINT, env.S3_REGION, env.S3_BUCKET, env.S3_ACCESS_KEY, env.S3_SECRET_KEY]
  if (values.some(Boolean) && !values.every(Boolean)) throw new Error('S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, and S3_SECRET_KEY must be configured together')
  if (values.every(Boolean)) return {
    kind: 's3', endpoint: env.S3_ENDPOINT!, region: env.S3_REGION!, bucket: env.S3_BUCKET!,
    accessKeyId: env.S3_ACCESS_KEY!, secretAccessKey: env.S3_SECRET_KEY!,
  }
  return { kind: 'local', directory: env.UPLOAD_DIR ?? (env.NODE_ENV === 'production' ? '/data/uploads' : '.data/uploads') }
}

export function uploadS3Client(storage: Extract<UploadStorage, { kind: 's3' }>): S3Client {
  return new S3Client({
    endpoint: storage.endpoint, region: storage.region, forcePathStyle: false,
    credentials: { accessKeyId: storage.accessKeyId, secretAccessKey: storage.secretAccessKey },
  })
}

/** Exercise the selected storage, including the permissions needed to upload and delete. */
export async function checkUploadStorage(storage: UploadStorage = uploadStorage()): Promise<void> {
  const name = `.readyz-${randomUUID()}`
  const bytes = Buffer.from('quikmarq-upload-storage')
  if (storage.kind === 'local') {
    await mkdir(storage.directory, { recursive: true })
    const path = join(storage.directory, name)
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
    try {
      if (!(await readFile(path)).equals(bytes)) throw new Error('Upload storage did not preserve its readiness probe')
    } finally {
      await unlink(path)
    }
    return
  }
  const client = uploadS3Client(storage)
  const Key = `${uploadPrefix}/${name}`
  try {
    await client.send(new PutObjectCommand({ Bucket: storage.bucket, Key, Body: bytes, ContentType: 'application/octet-stream' }))
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: storage.bucket, Key }))
      if (!result.Body || !Buffer.from(await result.Body.transformToByteArray()).equals(bytes)) throw new Error('Upload storage did not preserve its readiness probe')
    } finally {
      await client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key }))
    }
  } finally {
    client.destroy()
  }
}
