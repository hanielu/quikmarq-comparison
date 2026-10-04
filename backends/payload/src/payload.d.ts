import type { Config } from './payload-types'

declare module 'payload' {
  interface GeneratedTypes extends Config {}
}
