import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

export interface FileSummary {
  name: string
  title: string
  id: string
  frames: number
  version: number | null
  modified: string
  size: number
}

const fileName = z
  .string()
  .regex(/^[A-Za-z0-9._-]+\.json$/, 'file name must be letters, digits, ., _, - and end in .json')

async function dataDir() {
  const path = await import('node:path')
  const fs = await import('node:fs/promises')
  const dir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data')
  await fs.mkdir(dir, { recursive: true })
  return dir
}

async function resolveFile(name: string) {
  const path = await import('node:path')
  const dir = await dataDir()
  const full = path.resolve(dir, path.basename(name))
  if (!full.startsWith(dir)) throw new Error('invalid path')
  return full
}

export const listFiles = createServerFn({ method: 'GET' }).handler(async (): Promise<FileSummary[]> => {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const dir = await dataDir()
  const entries = (await fs.readdir(dir)).filter((n) => n.endsWith('.json')).sort()
  const out: FileSummary[] = []
  for (const name of entries) {
    const full = path.join(dir, name)
    const stat = await fs.stat(full)
    let title = ''
    let id = ''
    let frames = 0
    let version: number | null = null
    try {
      const doc = JSON.parse(await fs.readFile(full, 'utf8'))
      title = typeof doc?.title === 'string' ? doc.title : ''
      id = typeof doc?.id === 'string' ? doc.id : ''
      frames = Array.isArray(doc?.frames) ? doc.frames.length : 0
      version = typeof doc?.version === 'number' ? doc.version : null
    } catch {
      title = '(invalid JSON)'
    }
    out.push({ name, title, id, frames, version, modified: stat.mtime.toISOString(), size: stat.size })
  }
  return out
})

export const readFile = createServerFn({ method: 'GET' })
  .validator(z.object({ name: fileName }))
  .handler(async ({ data }) => {
    const fs = await import('node:fs/promises')
    const full = await resolveFile(data.name)
    const text = await fs.readFile(full, 'utf8')
    return { name: data.name, text }
  })

export const writeFile = createServerFn({ method: 'POST' })
  .validator(z.object({ name: fileName, text: z.string() }))
  .handler(async ({ data }) => {
    const fs = await import('node:fs/promises')
    // Refuse to write anything that is not valid JSON, whatever the client sent.
    JSON.parse(data.text)
    const full = await resolveFile(data.name)
    await fs.writeFile(full, data.text.endsWith('\n') ? data.text : data.text + '\n', 'utf8')
    const stat = await fs.stat(full)
    return { name: data.name, modified: stat.mtime.toISOString(), size: stat.size }
  })

export const duplicateFile = createServerFn({ method: 'POST' })
  .validator(z.object({ from: fileName, to: fileName }))
  .handler(async ({ data }) => {
    const fs = await import('node:fs/promises')
    const src = await resolveFile(data.from)
    const dst = await resolveFile(data.to)
    try {
      await fs.access(dst)
      throw new Error(`${data.to} already exists`)
    } catch (e: any) {
      if (e?.code !== 'ENOENT') throw e
    }
    await fs.copyFile(src, dst)
    return { name: data.to }
  })
