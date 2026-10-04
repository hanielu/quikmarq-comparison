import { withPayload } from '@payloadcms/next/withPayload'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export default withPayload({ output: 'standalone', outputFileTracingRoot: resolve(here, '../..') })
