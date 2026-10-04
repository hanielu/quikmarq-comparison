import { spawnSync } from 'node:child_process'
import { cp, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const command = createRequire(import.meta.url).resolve('next/dist/bin/next')
const result = spawnSync(process.execPath, [command, 'build'], { cwd: root, env: process.env, stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)

const target = resolve(root, '.next/standalone/backends/payload/.next/static')
await mkdir(dirname(target), { recursive: true })
await cp(resolve(root, '.next/static'), target, { recursive: true })
