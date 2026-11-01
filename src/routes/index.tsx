import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { duplicateFile, listFiles } from '~/lib/files'

export const Route = createFileRoute('/')({
  loader: () => listFiles(),
  component: Home,
})

function Home() {
  const files = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  async function onDuplicate(from: string) {
    const suggested = from.replace(/\.json$/, '-copy.json')
    const to = window.prompt('New file name', suggested)
    if (!to) return
    try {
      await duplicateFile({ data: { from, to } })
      await router.invalidate()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Story editor</h1>
        <p className="mt-1 text-sm text-zinc-600">
          JSON files in <code className="rounded bg-zinc-200 px-1">data/</code>. Edits are saved straight back to disk.
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {files.length === 0 ? (
        <div className="card p-6 text-sm text-zinc-600">
          No <code>.json</code> files found. Drop one into <code>data/</code> and refresh.
        </div>
      ) : (
        <ul className="grid gap-3">
          {files.map((f) => (
            <li key={f.name} className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <Link to="/edit/$file" params={{ file: f.name }} className="font-medium text-sky-700 hover:underline">
                  {f.name}
                </Link>
                <div className="mt-0.5 truncate text-sm text-zinc-700">{f.title || <em>untitled</em>}</div>
                <div className="mt-1 text-xs text-zinc-500">
                  {f.id && <span className="mr-3">id {f.id}</span>}
                  <span className="mr-3">{f.frames} frames</span>
                  {f.version !== null && <span className="mr-3">v{f.version}</span>}
                  <span>modified {new Date(f.modified).toLocaleString()}</span>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button className="btn" onClick={() => onDuplicate(f.name)}>Duplicate</button>
                <Link to="/edit/$file" params={{ file: f.name }} className="btn btn-primary">Edit</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
