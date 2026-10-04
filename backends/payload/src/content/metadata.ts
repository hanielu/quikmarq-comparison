import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { BlockList, isIP } from 'node:net'
import type { Endpoint } from 'payload'

const blocked = new BlockList()
for (const [cidr, family] of [
  ['0.0.0.0/8', 'ipv4'], ['10.0.0.0/8', 'ipv4'], ['100.64.0.0/10', 'ipv4'], ['127.0.0.0/8', 'ipv4'],
  ['169.254.0.0/16', 'ipv4'], ['172.16.0.0/12', 'ipv4'], ['192.0.0.0/24', 'ipv4'], ['192.0.2.0/24', 'ipv4'],
  ['192.88.99.0/24', 'ipv4'], ['192.168.0.0/16', 'ipv4'], ['198.18.0.0/15', 'ipv4'], ['198.51.100.0/24', 'ipv4'],
  ['203.0.113.0/24', 'ipv4'], ['224.0.0.0/4', 'ipv4'], ['240.0.0.0/4', 'ipv4'],
  ['::/128', 'ipv6'], ['::1/128', 'ipv6'], ['::ffff:0:0/96', 'ipv6'], ['64:ff9b::/96', 'ipv6'],
  ['64:ff9b:1::/48', 'ipv6'], ['100::/64', 'ipv6'], ['2001::/23', 'ipv6'], ['2001:db8::/32', 'ipv6'],
  ['2002::/16', 'ipv6'], ['3fff::/20', 'ipv6'], ['fc00::/7', 'ipv6'], ['fe80::/10', 'ipv6'],
] as const) {
  const [address, bits] = cidr.split('/')
  blocked.addSubnet(address, Number(bits), family)
}

export function publicAddress(address: string): boolean {
  const family = isIP(address)
  if (!family) return false
  if (blocked.check(address, family === 4 ? 'ipv4' : 'ipv6')) return false
  if (family === 6 && !address.toLowerCase().startsWith('2')) return false
  return true
}

export function parsePublicURL(raw: string): URL {
  const input = raw.trim()
  if (!input || input.length > 2048) throw new Error('Invalid URL length')
  const url = new URL(input.includes('://') ? input : `https://${input}`)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported URL')
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!host || !host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost')) throw new Error('Unavailable host')
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error('Unavailable port')
  if (isIP(host) && !publicAddress(host)) throw new Error('Unavailable address')
  url.hash = ''
  return url
}

async function approvedAddresses(host: string): Promise<{ address: string; family: number }[]> {
  const records = await lookup(host, { all: true })
  if (!records.length || records.some((record) => !publicAddress(record.address))) throw new Error('Unavailable address')
  return records
}

async function beforeDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error('Timed out')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out')), remaining) })])
  } finally { if (timer) clearTimeout(timer) }
}

async function readPage(url: URL, deadline: number, redirects = 0): Promise<{ body: string; url: URL }> {
  if (redirects > 3) throw new Error('Too many redirects')
  const addresses = await beforeDeadline(approvedAddresses(url.hostname), deadline)
  const transport = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) { reject(new Error('Timed out')); return }
    const request = transport.get(url, {
      headers: { Accept: 'text/html', 'User-Agent': 'QuikmarqMetadata/1.0' },
      timeout: remaining,
      lookup: (_host, _options, callback) => callback(null, addresses[0].address, addresses[0].family),
      agent: false,
    }, (response) => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        try { resolve(readPage(parsePublicURL(new URL(response.headers.location, url).toString()), deadline, redirects + 1)) }
        catch (error) { reject(error) }
        return
      }
      const type = String(response.headers['content-type'] ?? '').toLowerCase()
      if (status < 200 || status >= 300 || (type && !type.startsWith('text/html'))) {
        response.resume(); reject(new Error('Not an HTML page')); return
      }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 1 << 20) { request.destroy(new Error('Page too large')); return }
        chunks.push(chunk)
      })
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        if (!type && !/^\s*(?:<!doctype\s+html|<html|<head)/i.test(body)) reject(new Error('Not an HTML page'))
        else resolve({ body, url })
      })
      response.on('error', reject)
    })
    const timer = setTimeout(() => request.destroy(new Error('Timed out')), remaining)
    request.on('close', () => clearTimeout(timer))
    request.on('timeout', () => request.destroy(new Error('Timed out')))
    request.on('error', reject)
  })
}

function decode(value: string): string {
  return value.replace(/&#(x[0-9a-f]+|[0-9]+);?|&([a-z]+);?/gi, (match, numeric, named) => {
    if (numeric) {
      const code = numeric[0].toLowerCase() === 'x' ? parseInt(numeric.slice(1), 16) : parseInt(numeric, 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' } as Record<string, string>)[named.toLowerCase()] ?? match
  })
}

function clean(value: string): string {
  return decode(value.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim().slice(0, 1000)
}

function attribute(tag: string, name: string): string {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? ''
}

function mediaURL(page: URL, value: string): string {
  if (!value) return ''
  try { return parsePublicURL(new URL(value, page).toString()).toString() } catch { return '' }
}

function videoIdentity(url: URL): { videoProvider?: string; videoID?: string } {
  const host = url.hostname.replace(/^www\./, '')
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
    const id = host === 'youtu.be' ? url.pathname.slice(1) : (url.searchParams.get('v') ?? /^\/(?:shorts|embed)\/([^/]+)/.exec(url.pathname)?.[1])
    if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return { videoProvider: 'youtube', videoID: id }
  }
  if ((host === 'vimeo.com' || host === 'player.vimeo.com') && /^\d{1,20}$/.test(url.pathname.split('/').filter(Boolean).at(-1) ?? '')) return { videoProvider: 'vimeo', videoID: url.pathname.split('/').filter(Boolean).at(-1) }
  return {}
}

export function parseMetadata(body: string, page: URL) {
  const tags = body.match(/<(?:meta|link)\b[^>]*>/gi) ?? []
  const title = clean(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? '')
  let result = { normalizedURL: page.toString(), title, description: '', favicon: '', previewImage: '', ...videoIdentity(page) }
  for (const tag of tags) {
    const property = attribute(tag, 'property').toLowerCase()
    const name = attribute(tag, 'name').toLowerCase()
    const content = attribute(tag, 'content')
    if (property === 'og:title' && content) result.title = clean(content)
    if ((property === 'og:description' || name === 'description') && !result.description) result.description = clean(content)
    if (property === 'og:image' && !result.previewImage) result.previewImage = mediaURL(page, content)
    if (attribute(tag, 'rel').toLowerCase().includes('icon') && !result.favicon) result.favicon = mediaURL(page, attribute(tag, 'href'))
  }
  if (!result.favicon) result.favicon = `${page.origin}/favicon.ico`
  return result
}

let active = 0
export const metadataEndpoint: Endpoint = {
  path: '/bookmark-metadata', method: 'post', handler: async (req) => {
    if (!req.user || !['users', 'admins'].includes(req.user.collection)) return Response.json({ error: 'Authentication required' }, { status: 401 })
    const input = await req.json!().catch(() => null) as { url?: unknown } | null
    if (!input || typeof input.url !== 'string') return Response.json({ error: 'Invalid request' }, { status: 400 })
    let target: URL
    try { target = parsePublicURL(input.url) } catch { return Response.json({ error: 'Invalid URL' }, { status: 400 }) }
    if (active >= 4) return Response.json({ error: 'Metadata service busy' }, { status: 503 })
    active++
    try {
      const page = await readPage(target, Date.now() + 5000)
      return Response.json(parseMetadata(page.body, page.url), { headers: { 'Cache-Control': 'private, no-store' } })
    } catch { return Response.json({ error: 'Could not read page metadata' }, { status: 502 }) }
    finally { active-- }
  },
}
