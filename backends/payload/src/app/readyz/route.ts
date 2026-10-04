import config from '@payload-config'
import { getPayload } from 'payload'
import { checkUploadStorage } from '../../storage/uploads'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  try {
    const payload = await getPayload({ config })
    await payload.count({ collection: 'groups', overrideAccess: true })
    await checkUploadStorage()
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
