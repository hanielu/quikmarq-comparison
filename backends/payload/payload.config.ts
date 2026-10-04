import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { s3Storage } from '@payloadcms/storage-s3'
import sharp from 'sharp'
import { buildConfig } from 'payload'
import { Admins, Users } from './src/content/users'
import { Groups } from './src/content/groups'
import { Bookmarks } from './src/content/bookmarks'
import { Assets } from './src/content/assets'
import { metadataEndpoint } from './src/content/metadata'
import { shareEndpoints } from './src/content/share'
import { migrations } from './src/migrations'
import { singleHostSQLiteAdapter } from './src/database/sqlite'
import { uploadPrefix, uploadStorage } from './src/storage/uploads'

const root = dirname(fileURLToPath(import.meta.url))
const databaseURL = process.env.DATABASE_URL ?? 'file:.data/development.sqlite'
const webOrigin = process.env.WEB_URL
const storage = uploadStorage()
if (process.env.NODE_ENV === 'production' && !process.env.PAYLOAD_SECRET) throw new Error('PAYLOAD_SECRET is required in production')

export default buildConfig({
  secret: process.env.PAYLOAD_SECRET ?? 'local-development-only-payload-secret-replace-in-production',
  serverURL: process.env.CMS_URL,
  admin: { user: Admins.slug },
  collections: [Admins, Users, Groups, Bookmarks, Assets],
  endpoints: [metadataEndpoint, ...shareEndpoints],
  cors: {
    origins: webOrigin ? [webOrigin] : [],
    headers: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'Content-Encoding', 'X-Payload-HTTP-Method-Override', 'If-Match'],
  },
  csrf: webOrigin ? [webOrigin] : [],
  sharp,
  upload: { limits: { fileSize: 4_000_000 } },
  db: singleHostSQLiteAdapter({
    client: { url: databaseURL },
    idType: 'uuid',
    transactionOptions: {},
    busyTimeout: 5000,
    wal: true,
    migrationDir: resolve(root, 'src/migrations'),
    prodMigrations: migrations,
  }),
  plugins: [s3Storage({
    enabled: storage.kind === 's3',
    alwaysInsertFields: true,
    collections: { assets: { prefix: uploadPrefix } },
    bucket: storage.kind === 's3' ? storage.bucket : '',
    config: {
      endpoint: storage.kind === 's3' ? storage.endpoint : undefined,
      region: storage.kind === 's3' ? storage.region : 'auto',
      forcePathStyle: false,
      credentials: {
        accessKeyId: storage.kind === 's3' ? storage.accessKeyId : '',
        secretAccessKey: storage.kind === 's3' ? storage.secretAccessKey : '',
      },
    },
  })],
  typescript: { outputFile: resolve(root, 'src/payload-types.ts'), declare: false },
})
