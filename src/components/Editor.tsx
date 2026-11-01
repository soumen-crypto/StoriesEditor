import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { writeFile } from '~/lib/files'
import {
  clone,
  deleteAt,
  getAt,
  insertAt,
  isObject,
  moveAt,
  renameKey,
  setAt,
  type Json,
  type JsonObject,
  type Path,
} from '~/lib/jsonPath'
import { blockTemplate, CONTENT_TYPES, frameTemplate, validateStory, type ValidationIssue } from '~/lib/schema'
import { DateTimeInput, Field, NumberInput, StringInput } from './Fields'
import { FramePreview } from './FramePreview'
import { JsonNode, PrimitiveEditor, summarize, type NodeActions, type RenderArray } from './JsonNode'

type Selection = { kind: 'campaign' } | { kind: 'frame'; index: number } | { kind: 'raw' }

const FRAME_IDENTITY_KEYS = ['id', 'title', 'templateId', 'templateVersion', 'layout', 'phase', 'availability']
const FRAME_SECTION_KEYS = ['background', 'header', 'art', 'content']
const CAMPAIGN_SIMPLE_KEYS = ['id', 'campaignId', 'title', 'subtitle', 'surface', 'priority', 'locale', 'version']
const CAMPAIGN_SECTION_KEYS = ['live', 'cover', 'defaults', 'theme', 'frames']

const PHASE_COLORS: Record<string, string> = {
  PRE: 'bg-amber-100 text-amber-800',
  DURING: 'bg-emerald-100 text-emerald-800',
  POST: 'bg-violet-100 text-violet-800',
}

function serialize(doc: Json) {
  return JSON.stringify(doc, null, 2) + '\n'
}

export function Editor({ fileName, initialText }: { fileName: string; initialText: string }) {
  const [doc, setDoc] = useState<Json>(() => JSON.parse(initialText))
  const [savedText, setSavedText] = useState(initialText)
  const history = useRef<{ past: Json[]; future: Json[] }>({ past: [], future: [] })
  const [, bump] = useState(0)
  const [selection, setSelection] = useState<Selection>({ kind: 'frame', index: 0 })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [bumpVersion, setBumpVersion] = useState(true)
  const [filter, setFilter] = useState('')
  const [showIssues, setShowIssues] = useState(false)

  const text = useMemo(() => serialize(doc), [doc])
  const dirty = text !== savedText
  const issues = useMemo(() => validateStory(doc), [doc])
  const root = isObject(doc) ? doc : {}
  const frames: Json[] = Array.isArray(root.frames) ? root.frames : []

  // --- history -------------------------------------------------------------
  const commit = useCallback((next: Json | ((d: Json) => Json)) => {
    setDoc((prev) => {
      const value = typeof next === 'function' ? next(prev) : next
      if (value === prev) return prev
      history.current.past.push(prev)
      if (history.current.past.length > 100) history.current.past.shift()
      history.current.future = []
      return value
    })
    bump((n) => n + 1)
  }, [])

  const undo = useCallback(() => {
    const prev = history.current.past.pop()
    if (prev === undefined) return
    setDoc((cur) => {
      history.current.future.push(cur)
      return prev
    })
    bump((n) => n + 1)
  }, [])

  const redo = useCallback(() => {
    const next = history.current.future.pop()
    if (next === undefined) return
    setDoc((cur) => {
      history.current.past.push(cur)
      return next
    })
    bump((n) => n + 1)
  }, [])

  const actions: NodeActions = useMemo(
    () => ({
      set: (path, value) => commit((d) => setAt(d, path, value)),
      remove: (path) => commit((d) => deleteAt(d, path)),
      move: (arrayPath, from, to) => commit((d) => moveAt(d, arrayPath, from, to)),
      insert: (arrayPath, index, value) => commit((d) => insertAt(d, arrayPath, index, value)),
      rename: (objectPath, oldKey, newKey) => commit((d) => renameKey(d, objectPath, oldKey, newKey)),
    }),
    [commit],
  )

  // --- save / download -----------------------------------------------------
  const save = useCallback(async () => {
    if (saving) return
    setSaving(true)
    try {
      let next = doc
      if (bumpVersion && isObject(next) && typeof next.version === 'number') {
        next = { ...next, version: next.version + 1 }
      }
      const out = serialize(next)
      await writeFile({ data: { name: fileName, text: out } })
      if (next !== doc) commit(next)
      setSavedText(out)
      setToast({ kind: 'ok', text: `Saved ${fileName}` })
    } catch (e: any) {
      setToast({ kind: 'err', text: e?.message ?? String(e) })
    } finally {
      setSaving(false)
    }
  }, [doc, fileName, saving, bumpVersion, commit])

  function download() {
    const blob = new Blob([text], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = fileName
    a.click()
    URL.revokeObjectURL(a.href)
  }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 's') {
        e.preventDefault()
        void save()
      } else if (e.key === 'z' && !e.shiftKey) {
        const el = document.activeElement as HTMLElement | null
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
        e.preventDefault()
        undo()
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        const el = document.activeElement as HTMLElement | null
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, undo, redo])

  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  // --- frame operations ----------------------------------------------------
  function addFrame(afterIndex?: number) {
    const ids = new Set(frames.map((f) => (isObject(f) ? String(f.id) : '')))
    let n = frames.length + 1
    let id = `${String(n).padStart(2, '0')}-new-frame`
    while (ids.has(id)) id = `${String(++n).padStart(2, '0')}-new-frame`
    const index = afterIndex === undefined ? frames.length : afterIndex + 1
    commit((d) => insertAt(d, ['frames'], index, frameTemplate(id)))
    setSelection({ kind: 'frame', index })
  }

  function duplicateFrame(index: number) {
    const src = frames[index]
    if (!isObject(src)) return
    const copy = clone(src)
    copy.id = `${copy.id}-copy`
    commit((d) => insertAt(d, ['frames'], index + 1, copy))
    setSelection({ kind: 'frame', index: index + 1 })
  }

  function removeFrame(index: number) {
    const f = frames[index]
    const label = isObject(f) ? `${f.id}` : `#${index + 1}`
    if (!window.confirm(`Delete frame ${label}?`)) return
    commit((d) => deleteAt(d, ['frames', index]))
    setSelection({ kind: 'frame', index: Math.max(0, Math.min(index, frames.length - 2)) })
  }

  function moveFrame(from: number, to: number) {
    commit((d) => moveAt(d, ['frames'], from, to))
    setSelection({ kind: 'frame', index: to })
  }

  // Block lists (frame.content, CARD.children, GLASS_PANEL.children) get a richer editor.
  const renderArray: RenderArray = useCallback(
    (keyName, value, path) => {
      if (keyName !== 'content' && keyName !== 'children') return null
      return <BlockList blocks={value} path={path} actions={actions} renderArray={renderArray} />
    },
    [actions],
  )

  const issuesByFrame = useMemo(() => {
    const m = new Map<number, number>()
    for (const i of issues) {
      const mm = /^frames\.(\d+)/.exec(i.path)
      if (mm) m.set(Number(mm[1]), (m.get(Number(mm[1])) ?? 0) + 1)
    }
    return m
  }, [issues])

  const visibleFrames = frames
    .map((f, index) => ({ f, index }))
    .filter(({ f }) => {
      if (!filter) return true
      const q = filter.toLowerCase()
      return isObject(f) && [f.id, f.title, f.templateId, f.phase].some((v) => typeof v === 'string' && v.toLowerCase().includes(q))
    })

  const selectedFrame = selection.kind === 'frame' ? frames[selection.index] : undefined

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-2">
        <Link to="/" className="text-sm text-zinc-500 hover:text-zinc-900">← Files</Link>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium">{fileName}</span>
          {dirty && <span className="h-2 w-2 rounded-full bg-amber-500" title="Unsaved changes" />}
        </div>
        <div className="ml-2 text-xs text-zinc-500">
          {typeof root.title === 'string' && <span>{root.title}</span>}
          {typeof root.version === 'number' && <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 font-mono">v{root.version}</span>}
        </div>
        <button
          type="button"
          className={`ml-2 text-xs ${issues.length ? 'text-red-600' : 'text-emerald-600'} hover:underline`}
          onClick={() => setShowIssues((s) => !s)}
        >
          {issues.length ? `${issues.length} issue${issues.length === 1 ? '' : 's'}` : 'valid'}
        </button>
        <div className="flex-1" />
        <button className="btn" onClick={undo} disabled={history.current.past.length === 0} title="Undo (Ctrl+Z)">Undo</button>
        <button className="btn" onClick={redo} disabled={history.current.future.length === 0} title="Redo (Ctrl+Shift+Z)">Redo</button>
        <label className="ml-2 flex items-center gap-1.5 text-xs text-zinc-600">
          <input type="checkbox" checked={bumpVersion} onChange={(e) => setBumpVersion(e.target.checked)} className="accent-zinc-900" />
          bump version
        </label>
        <button className="btn" onClick={download}>Download</button>
        <button className="btn btn-primary" onClick={() => void save()} disabled={saving || !dirty} title="Save (Ctrl+S)">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      {showIssues && (
        <div className="max-h-48 overflow-auto border-b border-red-200 bg-red-50 px-4 py-2 text-xs">
          {issues.length === 0 ? (
            <div className="text-emerald-700">No validation issues.</div>
          ) : (
            <ul className="grid gap-0.5">
              {issues.map((i, n) => (
                <li key={n}>
                  <IssueLink issue={i} onSelect={setSelection} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-white">
          <button
            type="button"
            onClick={() => setSelection({ kind: 'campaign' })}
            className={`border-b border-zinc-200 px-3 py-2 text-left text-sm ${selection.kind === 'campaign' ? 'bg-zinc-900 text-white' : 'hover:bg-zinc-50'}`}
          >
            <div className="font-medium">Campaign</div>
            <div className={`text-xs ${selection.kind === 'campaign' ? 'text-zinc-300' : 'text-zinc-500'}`}>title, cover, live window, defaults</div>
          </button>
          <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
            <input type="text" placeholder="Filter frames…" value={filter} onChange={(e) => setFilter(e.target.value)} className="text-xs" />
            <span className="shrink-0 text-xs text-zinc-500">{frames.length}</span>
          </div>
          <ol className="min-h-0 flex-1 overflow-auto">
            {visibleFrames.map(({ f, index }) => {
              const fo = isObject(f) ? f : {}
              const active = selection.kind === 'frame' && selection.index === index
              const count = issuesByFrame.get(index)
              return (
                <li key={index}>
                  <button
                    type="button"
                    onClick={() => setSelection({ kind: 'frame', index })}
                    className={`flex w-full items-start gap-2 border-b border-zinc-100 px-3 py-2 text-left ${active ? 'bg-sky-50' : 'hover:bg-zinc-50'}`}
                  >
                    <span className="w-5 shrink-0 pt-0.5 font-mono text-[11px] text-zinc-400">{index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{String(fo.title ?? fo.id ?? 'untitled')}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1">
                        <span className={`chip ${PHASE_COLORS[String(fo.phase)] ?? 'bg-zinc-100 text-zinc-600'}`}>{String(fo.phase ?? '?')}</span>
                        <span className="truncate font-mono text-[11px] text-zinc-500">{String(fo.templateId ?? '')}</span>
                        {count ? <span className="chip bg-red-100 text-red-700">{count}</span> : null}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
          <div className="flex gap-2 border-t border-zinc-200 p-2">
            <button className="btn flex-1 justify-center" onClick={() => addFrame()}>+ Frame</button>
            <button className={`btn ${selection.kind === 'raw' ? 'btn-primary' : ''}`} onClick={() => setSelection({ kind: 'raw' })}>Raw JSON</button>
          </div>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1 overflow-auto p-5">
          {selection.kind === 'campaign' && <CampaignEditor root={root} actions={actions} />}
          {selection.kind === 'raw' && <RawEditor text={text} onApply={(v) => commit(v)} />}
          {selection.kind === 'frame' &&
            (isObject(selectedFrame) ? (
              <FrameEditor
                key={selection.index}
                frame={selectedFrame}
                index={selection.index}
                total={frames.length}
                actions={actions}
                renderArray={renderArray}
                onMove={(to) => moveFrame(selection.index, to)}
                onDuplicate={() => duplicateFrame(selection.index)}
                onDelete={() => removeFrame(selection.index)}
                onAddAfter={() => addFrame(selection.index)}
              />
            ) : (
              <div className="text-sm text-zinc-500">
                No frames yet. <button className="btn ml-2" onClick={() => addFrame()}>+ Add a frame</button>
              </div>
            ))}
        </main>

        {/* Preview */}
        {selection.kind === 'frame' && isObject(selectedFrame) && (
          <PreviewPane frame={selectedFrame} story={root} index={selection.index} count={frames.length} />
        )}
      </div>

      {toast && (
        <div className={`fixed bottom-4 right-4 rounded-md px-3 py-2 text-sm shadow-lg ${toast.kind === 'ok' ? 'bg-zinc-900 text-white' : 'bg-red-600 text-white'}`}>
          {toast.text}
        </div>
      )}
    </div>
  )
}

function IssueLink({ issue, onSelect }: { issue: ValidationIssue; onSelect: (s: Selection) => void }) {
  const m = /^frames\.(\d+)/.exec(issue.path)
  return (
    <button
      type="button"
      className="text-left text-red-700 hover:underline"
      onClick={() => onSelect(m ? { kind: 'frame', index: Number(m[1]) } : { kind: 'campaign' })}
    >
      <span className="font-mono">{issue.path || '(root)'}</span> — {issue.message}
    </button>
  )
}

/** Phone shapes to preview on: the 9:16 design artboard and taller screens (extra du goes to the SPACER). */
const DEVICES: Array<{ label: string; height: number }> = [
  { label: '9:16 design (1920)', height: 1920 },
  { label: '19.5:9 phone (2340)', height: 2340 },
  { label: '20:9 phone (2400)', height: 2400 },
]

function PreviewPane({ frame, story, index, count }: { frame: JsonObject; story: JsonObject; index: number; count: number }) {
  const [height, setHeight] = useState(1920)
  const [chrome, setChrome] = useState(true)
  const [large, setLarge] = useState(false)
  const width = large ? 440 : 300
  return (
    <aside className={`hidden shrink-0 overflow-auto border-l border-zinc-200 bg-zinc-50 p-5 xl:block ${large ? 'w-[480px]' : 'w-[340px]'}`}>
      <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
        <span className="font-medium">Preview</span>
        <select className="!w-auto text-xs" value={height} onChange={(e) => setHeight(Number(e.target.value))}>
          {DEVICES.map((d) => (
            <option key={d.height} value={d.height}>{d.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={chrome} onChange={(e) => setChrome(e.target.checked)} className="accent-zinc-900" /> chrome
        </label>
        <button type="button" className="btn btn-icon" title={large ? 'Smaller' : 'Larger'} onClick={() => setLarge((l) => !l)}>{large ? '−' : '+'}</button>
      </div>
      <FramePreview frame={frame} story={story} width={width} artboardHeight={height} showChrome={chrome} frameIndex={index} frameCount={count} />
      <Availability frame={frame} live={story.live} />
      <p className="mt-3 text-[11px] leading-snug text-zinc-400">
        Rendered with the app's rules: 1080-du artboard, 240/72/300 column, pinned art, design tokens and type ramp. Images load from their URLs; animations are shown at rest.
      </p>
    </aside>
  )
}

function Availability({ frame, live }: { frame: JsonObject; live: Json | undefined }) {
  const a = isObject(frame.availability) ? frame.availability : null
  const l = isObject(live) ? live : null
  if (!a) return null
  const fmt = (v: unknown) => {
    if (typeof v !== 'string') return '—'
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? v : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  }
  let warn: string | null = null
  if (l && typeof a.from === 'string' && typeof l.until === 'string' && new Date(a.from) > new Date(l.until)) warn = 'Starts after the campaign live window ends.'
  if (l && typeof a.until === 'string' && typeof l.from === 'string' && new Date(a.until) < new Date(l.from)) warn = 'Ends before the campaign live window starts.'
  return (
    <div className="mt-4 text-xs text-zinc-600">
      <div className="font-medium text-zinc-500">Shown</div>
      <div>{fmt(a.from)}</div>
      <div>→ {fmt(a.until)}</div>
      {l && (
        <div className="mt-2 font-medium text-zinc-500">Campaign live</div>
      )}
      {l && <div>{fmt(l.from)} → {fmt(l.until)}</div>}
      {warn && <div className="mt-1 text-zinc-500">{warn}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="card">
      <header className="flex items-center justify-between border-b border-zinc-100 px-4 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

function CampaignEditor({ root, actions }: { root: JsonObject; actions: NodeActions }) {
  const extraKeys = Object.keys(root).filter((k) => !CAMPAIGN_SIMPLE_KEYS.includes(k) && !CAMPAIGN_SECTION_KEYS.includes(k))
  const live = isObject(root.live) ? root.live : {}
  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <Section title="Campaign">
        <div className="grid gap-2">
          {CAMPAIGN_SIMPLE_KEYS.map((k) =>
            k in root ? (
              <Field key={k} label={k}>
                <PrimitiveEditor value={root[k]!} keyName={k} onChange={(v) => actions.set([k], v)} />
              </Field>
            ) : null,
          )}
        </div>
      </Section>
      <Section title="Live window" >
        <div className="grid gap-2">
          <Field label="from">
            <DateTimeInput value={String(live.from ?? '')} onChange={(v) => actions.set(['live', 'from'], v)} />
          </Field>
          <Field label="until">
            <DateTimeInput value={String(live.until ?? '')} onChange={(v) => actions.set(['live', 'until'], v)} />
          </Field>
        </div>
      </Section>
      <Section title="Cover">
        <JsonNode value={root.cover ?? {}} path={['cover']} keyName="cover" actions={actions} />
      </Section>
      <Section title="Defaults">
        <JsonNode value={root.defaults ?? {}} path={['defaults']} keyName="defaults" actions={actions} />
      </Section>
      <Section title="Theme">
        <JsonNode value={root.theme ?? {}} path={['theme']} keyName="theme" actions={actions} />
      </Section>
      {extraKeys.length > 0 && (
        <Section title="Other fields">
          <div className="grid gap-2">
            {extraKeys.map((k) => (
              <div key={k} className="json-row">
                <div className="pt-1.5 font-mono text-xs font-medium text-zinc-700">{k}</div>
                <JsonNode value={root[k]!} path={[k]} keyName={k} actions={actions} depth={1} />
                <button className="btn btn-icon" onClick={() => actions.remove([k])} title="Remove">×</button>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function FrameEditor({
  frame,
  index,
  total,
  actions,
  renderArray,
  onMove,
  onDuplicate,
  onDelete,
  onAddAfter,
}: {
  frame: JsonObject
  index: number
  total: number
  actions: NodeActions
  renderArray: RenderArray
  onMove: (to: number) => void
  onDuplicate: () => void
  onDelete: () => void
  onAddAfter: () => void
}) {
  const base: Path = ['frames', index]
  const availability = isObject(frame.availability) ? frame.availability : {}
  const extraKeys = Object.keys(frame).filter((k) => !FRAME_IDENTITY_KEYS.includes(k) && !FRAME_SECTION_KEYS.includes(k))

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-500">Frame {index + 1} of {total}</span>
        <div className="flex-1" />
        <button className="btn" disabled={index === 0} onClick={() => onMove(index - 1)}>↑ Move up</button>
        <button className="btn" disabled={index === total - 1} onClick={() => onMove(index + 1)}>↓ Move down</button>
        <button className="btn" onClick={onDuplicate}>Duplicate</button>
        <button className="btn" onClick={onAddAfter}>+ Frame after</button>
        <button className="btn btn-danger" onClick={onDelete}>Delete</button>
      </div>

      <Section title="Frame">
        <div className="grid gap-2">
          <Field label="id" hint="unique">
            <StringInput value={String(frame.id ?? '')} onChange={(v) => actions.set([...base, 'id'], v)} />
          </Field>
          <Field label="title" hint="internal name">
            <StringInput value={String(frame.title ?? '')} onChange={(v) => actions.set([...base, 'title'], v)} />
          </Field>
          <Field label="templateId">
            <StringInput keyName="templateId" value={String(frame.templateId ?? '')} onChange={(v) => actions.set([...base, 'templateId'], v)} />
          </Field>
          <Field label="templateVersion">
            <NumberInput value={Number(frame.templateVersion ?? 1)} onChange={(v) => actions.set([...base, 'templateVersion'], v)} />
          </Field>
          <Field label="layout">
            <StringInput keyName="layout" value={String(frame.layout ?? '')} onChange={(v) => actions.set([...base, 'layout'], v)} />
          </Field>
          <Field label="phase">
            <StringInput keyName="phase" value={String(frame.phase ?? '')} onChange={(v) => actions.set([...base, 'phase'], v)} />
          </Field>
          <Field label="available from">
            <DateTimeInput value={String(availability.from ?? '')} onChange={(v) => actions.set([...base, 'availability', 'from'], v)} />
          </Field>
          <Field label="available until">
            <DateTimeInput value={String(availability.until ?? '')} onChange={(v) => actions.set([...base, 'availability', 'until'], v)} />
          </Field>
        </div>
      </Section>

      <Section title="Background">
        <JsonNode value={frame.background ?? { type: 'SOLID', color: 'canvas' }} path={[...base, 'background']} keyName="background" actions={actions} />
      </Section>

      <Section
        title="Header"
        actions={
          'header' in frame ? (
            <button className="btn" onClick={() => actions.remove([...base, 'header'])}>Use default</button>
          ) : (
            <button className="btn" onClick={() => actions.set([...base, 'header'], { style: 'GLASS' })}>Override</button>
          )
        }
      >
        {'header' in frame ? (
          <JsonNode value={frame.header!} path={[...base, 'header']} keyName="header" actions={actions} />
        ) : (
          <div className="text-xs text-zinc-500">Inherits <code>defaults.header</code> from the campaign.</div>
        )}
      </Section>

      <Section
        title="Art"
        actions={
          'art' in frame ? (
            <button className="btn" onClick={() => actions.remove([...base, 'art'])}>Remove</button>
          ) : (
            <button className="btn" onClick={() => actions.set([...base, 'art'], [{ type: 'DISC', x: 500, y: 760, w: 760, h: 760, color: 'pale', pin: 'BOTTOM' }])}>
              + Add art layer
            </button>
          )
        }
      >
        {'art' in frame ? (
          <JsonNode value={frame.art!} path={[...base, 'art']} keyName="art" actions={actions} />
        ) : (
          <div className="text-xs text-zinc-500">No decorative art layers.</div>
        )}
      </Section>

      <Section title="Content">
        <BlockList blocks={Array.isArray(frame.content) ? frame.content : []} path={[...base, 'content']} actions={actions} renderArray={renderArray} />
      </Section>

      {extraKeys.length > 0 && (
        <Section title="Other fields">
          <div className="grid gap-2">
            {extraKeys.map((k) => (
              <div key={k} className="json-row">
                <div className="pt-1.5 font-mono text-xs font-medium text-zinc-700">{k}</div>
                <div className="min-w-0">
                  {isObject(frame[k]) || Array.isArray(frame[k]) ? (
                    <JsonNode value={frame[k]!} path={[...base, k]} keyName={k} actions={actions} depth={1} renderArray={renderArray} />
                  ) : (
                    <PrimitiveEditor value={frame[k]!} keyName={k} onChange={(v) => actions.set([...base, k], v)} />
                  )}
                </div>
                <button className="btn btn-icon" onClick={() => actions.remove([...base, k])} title="Remove">×</button>
              </div>
            ))}
          </div>
        </Section>
      )}

      <AddFieldInline existing={Object.keys(frame)} onAdd={(k, v) => actions.set([...base, k], v)} />
    </div>
  )
}

function AddFieldInline({ existing, onAdd }: { existing: string[]; onAdd: (k: string, v: Json) => void }) {
  const [key, setKey] = useState('')
  return (
    <form
      className="flex items-center gap-2 text-xs text-zinc-500"
      onSubmit={(e) => {
        e.preventDefault()
        if (!key || existing.includes(key)) return
        onAdd(key, '')
        setKey('')
      }}
    >
      <span>Add a top-level field to this frame:</span>
      <input type="text" className="!w-44 font-mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder="fieldName" />
      <button type="submit" className="btn" disabled={!key || existing.includes(key)}>+ Add</button>
    </form>
  )
}

// ---------------------------------------------------------------------------

function blockSummary(b: Json): string {
  if (!isObject(b)) return ''
  const txt = b.text ?? b.label ?? b.title ?? b.quote ?? b.value ?? b.start
  if (typeof txt === 'string') return txt.replace(/\n/g, ' ↵ ').slice(0, 70)
  if (Array.isArray(b.children)) return `${b.children.length} child block${b.children.length === 1 ? '' : 's'}`
  if (Array.isArray(b.buttons)) return b.buttons.map((x) => (isObject(x) ? x.label : '')).join(', ')
  if (Array.isArray(b.items)) return `${b.items.length} items`
  if (Array.isArray(b.rows)) return `${b.rows.length} rows`
  if (isObject(b.image) && typeof b.image.alt === 'string') return b.image.alt
  return summarize(b)
}

function BlockList({ blocks, path, actions, renderArray }: { blocks: Json[]; path: Path; actions: NodeActions; renderArray: RenderArray }) {
  const [open, setOpen] = useState<Record<number, boolean>>({})
  const [adding, setAdding] = useState(false)
  return (
    <div className="grid gap-2">
      {blocks.map((b, i) => {
        const bo = isObject(b) ? b : {}
        const isOpen = open[i] ?? false
        return (
          <div key={i} className="rounded-md border border-zinc-200 bg-white">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen((o) => ({ ...o, [i]: !isOpen }))}>
                <span className="inline-block w-3 text-xs text-zinc-400">{isOpen ? '▾' : '▸'}</span>
                <span className="chip bg-zinc-900 text-white">{String(bo.type ?? '?')}</span>
                {typeof bo.style === 'string' && <span className="chip bg-zinc-100 text-zinc-600">{bo.style}</span>}
                <span className="truncate text-xs text-zinc-600">{blockSummary(b)}</span>
              </button>
              <button type="button" className="btn btn-icon" title="Move up" disabled={i === 0} onClick={() => actions.move(path, i, i - 1)}>↑</button>
              <button type="button" className="btn btn-icon" title="Move down" disabled={i === blocks.length - 1} onClick={() => actions.move(path, i, i + 1)}>↓</button>
              <button type="button" className="btn btn-icon" title="Duplicate" onClick={() => actions.insert(path, i + 1, clone(b))}>⧉</button>
              <button type="button" className="btn btn-icon" title="Remove" onClick={() => actions.remove([...path, i])}>×</button>
            </div>
            {isOpen && (
              <div className="border-t border-zinc-100 p-3">
                <JsonNode value={b} path={[...path, i]} keyName="block" actions={actions} renderArray={renderArray} />
              </div>
            )}
          </div>
        )
      })}
      {adding ? (
        <div className="flex flex-wrap gap-1.5 rounded-md border border-dashed border-zinc-300 p-2">
          {CONTENT_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className="btn font-mono"
              onClick={() => {
                actions.insert(path, blocks.length, blockTemplate(t))
                setOpen((o) => ({ ...o, [blocks.length]: true }))
                setAdding(false)
              }}
            >
              {t}
            </button>
          ))}
          <button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="btn w-fit" onClick={() => setAdding(true)}>+ Add block</button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function RawEditor({ text, onApply }: { text: string; onApply: (doc: Json) => void }) {
  const [draft, setDraft] = useState(text)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setDraft(text)
    setError(null)
  }, [text])
  const changed = draft !== text
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">Raw JSON</span>
        <span className="text-xs text-zinc-500">Edit the whole document; apply to load it into the editor.</span>
        <div className="flex-1" />
        <button className="btn" disabled={!changed} onClick={() => setDraft(text)}>Revert</button>
        <button
          className="btn btn-primary"
          disabled={!changed}
          onClick={() => {
            try {
              onApply(JSON.parse(draft))
              setError(null)
            } catch (e: any) {
              setError(e?.message ?? String(e))
            }
          }}
        >
          Apply
        </button>
      </div>
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      <textarea
        className="min-h-0 flex-1 resize-none text-xs"
        style={{ fieldSizing: 'fixed' } as React.CSSProperties}
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
      />
    </div>
  )
}
