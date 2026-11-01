import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { writeFile } from '~/lib/files'
import { clone, deleteAt, insertAt, isObject, moveAt, renameKey, setAt, type Json, type JsonObject, type Path } from '~/lib/jsonPath'
import { blockTemplate, CONTENT_TYPES, frameTemplate, validateStory, type ValidationIssue } from '~/lib/schema'
import { useElementWidth } from '~/lib/useElementWidth'
import { ContentForm, blockSummary, pathKey } from './ContentForm'
import { DateTimeInput, Field, ImageField, Menu, NumberInput, StringInput, isImageObject } from './Fields'
import { FramePreview } from './FramePreview'
import { JsonNode, ObjectRows, PrimitiveEditor, type NodeActions, type RenderArray } from './JsonNode'

type Selection = { kind: 'campaign' } | { kind: 'frame'; index: number } | { kind: 'raw' }
type Tab = 'content' | 'structure' | 'settings'

const FRAME_IDENTITY_KEYS = new Set(['id', 'title', 'templateId', 'templateVersion', 'layout', 'phase', 'availability', 'durationMs', 'minRenderer', 'interactive'])
const FRAME_SECTION_KEYS = new Set(['background', 'header', 'art', 'content'])
const CAMPAIGN_SIMPLE_KEYS = ['id', 'campaignId', 'title', 'subtitle', 'surface', 'priority', 'locale', 'version']
const CAMPAIGN_SECTION_KEYS = new Set([...CAMPAIGN_SIMPLE_KEYS, 'live', 'cover', 'defaults', 'theme', 'frames'])

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
  const [tab, setTab] = useState<Tab>('content')
  const [focusBlock, setFocusBlock] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [bumpVersion, setBumpVersion] = useState(true)
  const [filter, setFilter] = useState('')
  const [showIssues, setShowIssues] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

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
      if (bumpVersion && isObject(next) && typeof next.version === 'number') next = { ...next, version: next.version + 1 }
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
      if (e.key === 'Escape') {
        setSidebarOpen(false)
        setPreviewOpen(false)
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const el = document.activeElement as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
      if (e.key === 's') {
        e.preventDefault()
        void save()
      } else if (e.key === 'z' && !e.shiftKey && !typing) {
        e.preventDefault()
        undo()
      } else if (((e.key === 'z' && e.shiftKey) || e.key === 'y') && !typing) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, undo, redo])

  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  // --- frame operations ----------------------------------------------------
  function select(s: Selection) {
    setSelection(s)
    setSidebarOpen(false)
    setFocusBlock(undefined)
  }

  function addFrame(afterIndex?: number) {
    const ids = new Set(frames.map((f) => (isObject(f) ? String(f.id) : '')))
    let n = frames.length + 1
    let id = `${String(n).padStart(2, '0')}-new-frame`
    while (ids.has(id)) id = `${String(++n).padStart(2, '0')}-new-frame`
    const index = afterIndex === undefined ? frames.length : afterIndex + 1
    commit((d) => insertAt(d, ['frames'], index, frameTemplate(id)))
    select({ kind: 'frame', index })
    setTab('settings')
  }

  function duplicateFrame(index: number) {
    const src = frames[index]
    if (!isObject(src)) return
    const copy = clone(src)
    copy.id = `${copy.id}-copy`
    commit((d) => insertAt(d, ['frames'], index + 1, copy))
    select({ kind: 'frame', index: index + 1 })
  }

  function removeFrame(index: number) {
    const f = frames[index]
    const label = isObject(f) ? `${f.id}` : `#${index + 1}`
    if (!window.confirm(`Delete frame ${label}?`)) return
    commit((d) => deleteAt(d, ['frames', index]))
    select({ kind: 'frame', index: Math.max(0, Math.min(index, frames.length - 2)) })
  }

  function moveFrame(from: number, to: number) {
    commit((d) => moveAt(d, ['frames'], from, to))
    select({ kind: 'frame', index: to })
  }

  // Block lists (frame.content, CARD.children, GLASS_PANEL.children) get a richer editor.
  const renderArray: RenderArray = useCallback(
    (keyName, value, path) => {
      if (keyName !== 'content' && keyName !== 'children') return null
      return <BlockList blocks={value} path={path} actions={actions} renderArray={renderArray} focus={focusBlock} />
    },
    [actions, focusBlock],
  )

  const issuesByFrame = useMemo(() => {
    const m = new Map<number, number>()
    for (const i of issues) {
      const mm = /^frames\.(\d+)/.exec(i.path)
      if (mm) m.set(Number(mm[1]), (m.get(Number(mm[1])) ?? 0) + 1)
    }
    return m
  }, [issues])

  const selectedFrame = selection.kind === 'frame' ? frames[selection.index] : undefined
  const frameSelected = selection.kind === 'frame' && isObject(selectedFrame)

  function onPreviewBlock(path: Path) {
    setFocusBlock(pathKey(path))
    if (tab === 'settings') setTab('content')
    setPreviewOpen(false)
  }

  const sidebar = (
    <Sidebar
      root={root}
      frames={frames}
      selection={selection}
      filter={filter}
      setFilter={setFilter}
      issuesByFrame={issuesByFrame}
      onSelect={select}
      onAddFrame={() => addFrame()}
    />
  )

  const previewProps = frameSelected
    ? { frame: selectedFrame as JsonObject, story: root, index: selection.kind === 'frame' ? selection.index : 0, count: frames.length, onBlockClick: onPreviewBlock, selectedPath: focusBlock }
    : null

  return (
    <div className="flex h-dvh flex-col">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-3">
        <button type="button" className="btn btn-ghost btn-icon md:hidden" title="Frames" onClick={() => setSidebarOpen(true)}>
          <MenuIcon />
        </button>
        <Link to="/" className="hidden text-sm text-zinc-500 hover:text-zinc-900 sm:inline">← Files</Link>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-sm font-medium">{fileName}</span>
          {dirty && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Unsaved changes" />}
          {typeof root.version === 'number' && <span className="hidden rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-500 sm:inline">v{root.version}</span>}
        </div>
        <button type="button" className={`chip ${issues.length ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`} onClick={() => setShowIssues((s) => !s)}>
          {issues.length ? `${issues.length} issue${issues.length === 1 ? '' : 's'}` : 'valid'}
        </button>
        <div className="flex-1" />
        <button className="btn btn-ghost hidden sm:inline-flex" onClick={undo} disabled={history.current.past.length === 0} title="Undo (Ctrl+Z)">Undo</button>
        <button className="btn btn-ghost hidden sm:inline-flex" onClick={redo} disabled={history.current.future.length === 0} title="Redo (Ctrl+Shift+Z)">Redo</button>
        {frameSelected && (
          <button className="btn xl:hidden" onClick={() => setPreviewOpen(true)}>Preview</button>
        )}
        <button className="btn btn-primary" onClick={() => void save()} disabled={saving || !dirty} title="Save (Ctrl+S)">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <Menu
          items={[
            { label: 'Undo', onClick: undo, disabled: history.current.past.length === 0 },
            { label: 'Redo', onClick: redo, disabled: history.current.future.length === 0 },
            'sep',
            { label: `${bumpVersion ? '✓ ' : ''}Bump version on save`, onClick: () => setBumpVersion((v) => !v) },
            { label: 'Download JSON', onClick: download },
            { label: 'Edit raw JSON', onClick: () => select({ kind: 'raw' }) },
            'sep',
            { label: 'Back to files', onClick: () => (window.location.href = '/') },
          ]}
        />
      </header>

      {showIssues && (
        <div className="max-h-40 shrink-0 overflow-auto border-b border-red-200 bg-red-50 px-4 py-2 text-xs">
          {issues.length === 0 ? (
            <div className="text-emerald-700">No validation issues.</div>
          ) : (
            <ul className="grid gap-0.5">
              {issues.map((i, n) => (
                <li key={n}>
                  <IssueLink issue={i} onSelect={(s) => { select(s); setTab('settings') }} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Sidebar: static on md+, drawer below */}
        <aside className="hidden w-72 shrink-0 flex-col border-r border-zinc-200 bg-white md:flex">{sidebar}</aside>
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <div className="absolute inset-0 bg-black/30" onClick={() => setSidebarOpen(false)} />
            <aside className="relative flex h-full w-80 max-w-[85vw] flex-col bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2">
                <span className="text-sm font-semibold">Frames</span>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setSidebarOpen(false)} title="Close">×</button>
              </div>
              {sidebar}
            </aside>
          </div>
        )}

        {/* Main */}
        <main className="min-w-0 flex-1 overflow-auto">
          <div className="form mx-auto max-w-3xl p-3 sm:p-5">
            {selection.kind === 'campaign' && <CampaignEditor root={root} actions={actions} />}
            {selection.kind === 'raw' && <RawEditor text={text} onApply={(v) => commit(v)} />}
            {selection.kind === 'frame' &&
              (isObject(selectedFrame) ? (
                <FrameEditor
                  key={selection.index}
                  frame={selectedFrame}
                  index={selection.index}
                  total={frames.length}
                  tab={tab}
                  setTab={setTab}
                  focus={focusBlock}
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
          </div>
        </main>

        {/* Preview: pane on xl+, sheet below */}
        {previewProps && (
          <aside className="hidden w-[clamp(300px,27vw,520px)] shrink-0 flex-col overflow-auto border-l border-zinc-200 bg-zinc-100/70 xl:flex">
            <PreviewPanel {...previewProps} />
          </aside>
        )}
      </div>

      {previewOpen && previewProps && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/40 xl:hidden" onClick={() => setPreviewOpen(false)}>
          <div className="mt-auto flex max-h-[94dvh] flex-col rounded-t-2xl bg-zinc-100 sm:mx-auto sm:my-auto sm:w-[560px] sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2">
              <span className="text-sm font-semibold">Preview</span>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setPreviewOpen(false)} title="Close">×</button>
            </div>
            <div className="min-h-0 overflow-auto">
              <PreviewPanel {...previewProps} />
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 rounded-md px-3 py-2 text-sm shadow-lg ${toast.kind === 'ok' ? 'bg-zinc-900 text-white' : 'bg-red-600 text-white'}`}>{toast.text}</div>
      )}
    </div>
  )
}

function MenuIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M2 4h12M2 8h12M2 12h12" />
    </svg>
  )
}

// ---------------------------------------------------------------------------

function Sidebar({
  root,
  frames,
  selection,
  filter,
  setFilter,
  issuesByFrame,
  onSelect,
  onAddFrame,
}: {
  root: JsonObject
  frames: Json[]
  selection: Selection
  filter: string
  setFilter: (v: string) => void
  issuesByFrame: Map<number, number>
  onSelect: (s: Selection) => void
  onAddFrame: () => void
}) {
  const visible = frames
    .map((f, index) => ({ f, index }))
    .filter(({ f }) => {
      if (!filter) return true
      const q = filter.toLowerCase()
      return isObject(f) && [f.id, f.title, f.templateId, f.phase].some((v) => typeof v === 'string' && v.toLowerCase().includes(q))
    })
  return (
    <>
      <button
        type="button"
        onClick={() => onSelect({ kind: 'campaign' })}
        className={`border-b border-zinc-200 px-3 py-2.5 text-left ${selection.kind === 'campaign' ? 'bg-zinc-900 text-white' : 'hover:bg-zinc-50'}`}
      >
        <div className="text-sm font-medium">{typeof root.title === 'string' ? root.title : 'Campaign'}</div>
        <div className={`text-xs ${selection.kind === 'campaign' ? 'text-zinc-300' : 'text-zinc-500'}`}>Campaign settings, cover, live window</div>
      </button>
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <input type="search" className="input" placeholder="Filter frames…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="shrink-0 text-xs text-zinc-500">{frames.length}</span>
      </div>
      <ol className="min-h-0 flex-1 overflow-auto">
        {visible.map(({ f, index }) => {
          const fo = isObject(f) ? f : {}
          const active = selection.kind === 'frame' && selection.index === index
          const count = issuesByFrame.get(index)
          return (
            <li key={index}>
              <button type="button" onClick={() => onSelect({ kind: 'frame', index })} className={`sidebar-item ${active ? 'active' : ''}`}>
                <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-[11px] text-zinc-400">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{String(fo.title ?? fo.id ?? 'untitled')}</span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <span className={`chip ${PHASE_COLORS[String(fo.phase)] ?? 'bg-zinc-100 text-zinc-600'}`}>{String(fo.phase ?? '?')}</span>
                    <span className="truncate font-mono text-[11px] text-zinc-500">{String(fo.templateId ?? '')}</span>
                    {count ? <span className="chip bg-red-100 text-red-700">{count}</span> : null}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
        {visible.length === 0 && <li className="px-3 py-4 text-xs text-zinc-500">No frames match.</li>}
      </ol>
      <div className="border-t border-zinc-200 p-2">
        <button className="btn w-full" onClick={onAddFrame}>+ New frame</button>
      </div>
    </>
  )
}

function IssueLink({ issue, onSelect }: { issue: ValidationIssue; onSelect: (s: Selection) => void }) {
  const m = /^frames\.(\d+)/.exec(issue.path)
  return (
    <button type="button" className="text-left text-red-700 hover:underline" onClick={() => onSelect(m ? { kind: 'frame', index: Number(m[1]) } : { kind: 'campaign' })}>
      <span className="font-mono">{issue.path || '(root)'}</span> — {issue.message}
    </button>
  )
}

// ---------------------------------------------------------------------------

const DEVICES: Array<{ label: string; height: number }> = [
  { label: '9:16 design', height: 1920 },
  { label: '19.5:9 phone', height: 2340 },
  { label: '20:9 phone', height: 2400 },
]

function PreviewPanel({ frame, story, index, count, onBlockClick, selectedPath }: { frame: JsonObject; story: JsonObject; index: number; count: number; onBlockClick: (p: Path) => void; selectedPath?: string }) {
  const [height, setHeight] = useState(1920)
  const [chrome, setChrome] = useState(true)
  const [ref, w] = useElementWidth<HTMLDivElement>(300)
  const width = Math.max(200, Math.min(w, 520))
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <select className="input !w-auto" value={height} onChange={(e) => setHeight(Number(e.target.value))}>
          {DEVICES.map((d) => (
            <option key={d.height} value={d.height}>{d.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={chrome} onChange={(e) => setChrome(e.target.checked)} /> app chrome
        </label>
      </div>
      <div ref={ref} className="w-full">
        <FramePreview frame={frame} story={story} width={width} artboardHeight={height} showChrome={chrome} frameIndex={index} frameCount={count} basePath={['frames', index, 'content']} onBlockClick={onBlockClick} selectedPath={selectedPath} />
      </div>
      <Availability frame={frame} live={story.live} />
      <p className="text-[11px] leading-snug text-zinc-400">Tap a block to jump to it in the form. Rendered with the app's layout rules; animations shown at rest.</p>
    </div>
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
  let note: string | null = null
  if (l && typeof a.from === 'string' && typeof l.until === 'string' && new Date(a.from) > new Date(l.until)) note = 'Starts after the campaign live window ends.'
  if (l && typeof a.until === 'string' && typeof l.from === 'string' && new Date(a.until) < new Date(l.from)) note = 'Ends before the campaign live window starts.'
  return (
    <div className="grid gap-1 text-xs text-zinc-600">
      <div><span className="font-medium text-zinc-500">Shown</span> {fmt(a.from)} → {fmt(a.until)}</div>
      {l && <div><span className="font-medium text-zinc-500">Campaign live</span> {fmt(l.from)} → {fmt(l.until)}</div>}
      {note && <div className="text-amber-700">{note}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------

function Section({ title, children, actions, description }: { title: string; description?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      <header className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-xs text-zinc-500">{description}</p>}
        </div>
        {actions}
      </header>
      <div className="grid gap-2.5 p-4">{children}</div>
    </section>
  )
}

function CampaignEditor({ root, actions }: { root: JsonObject; actions: NodeActions }) {
  const live = isObject(root.live) ? root.live : {}
  const extraKeys = Object.keys(root).filter((k) => !CAMPAIGN_SECTION_KEYS.has(k))
  return (
    <div className="grid gap-4">
      <h1 className="text-lg font-semibold">Campaign</h1>
      <Section title="Story">
        {CAMPAIGN_SIMPLE_KEYS.map((k) =>
          k in root ? (
            <Field key={k} label={k === 'campaignId' ? 'Campaign ID' : k === 'id' ? 'Story ID' : k.charAt(0).toUpperCase() + k.slice(1)} keyName={k}>
              <PrimitiveEditor value={root[k]!} keyName={k} onChange={(v) => actions.set([k], v)} />
            </Field>
          ) : null,
        )}
      </Section>
      <Section title="Live window" description="When the story ring shows as live.">
        <Field label="From"><DateTimeInput value={String(live.from ?? '')} onChange={(v) => actions.set(['live', 'from'], v)} /></Field>
        <Field label="Until"><DateTimeInput value={String(live.until ?? '')} onChange={(v) => actions.set(['live', 'until'], v)} /></Field>
      </Section>
      <Section title="Cover" description="Shown on the story ring.">
        {isImageObject(root.cover) ? <ImageField value={root.cover} path={['cover']} set={actions.set} /> : <JsonNode value={root.cover ?? {}} path={['cover']} keyName="cover" actions={actions} />}
      </Section>
      <Section title="Defaults" description="Frame duration and the header logo frames inherit.">
        <JsonNode value={root.defaults ?? {}} path={['defaults']} keyName="defaults" actions={actions} />
      </Section>
      <Section title="Theme" description="Colour token overrides, e.g. navy → #1F66D0.">
        <JsonNode value={root.theme ?? {}} path={['theme']} keyName="theme" actions={actions} />
      </Section>
      {extraKeys.length > 0 && (
        <Section title="Other fields">
          <ObjectRows value={root} path={[]} actions={actions} skip={CAMPAIGN_SECTION_KEYS} />
        </Section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function FrameEditor({
  frame,
  index,
  total,
  tab,
  setTab,
  focus,
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
  tab: Tab
  setTab: (t: Tab) => void
  focus?: string
  actions: NodeActions
  renderArray: RenderArray
  onMove: (to: number) => void
  onDuplicate: () => void
  onDelete: () => void
  onAddAfter: () => void
}) {
  const base: Path = ['frames', index]
  const availability = isObject(frame.availability) ? frame.availability : {}
  const content = Array.isArray(frame.content) ? frame.content : []
  const otherKeys = new Set([...FRAME_IDENTITY_KEYS, ...FRAME_SECTION_KEYS])

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-zinc-500">
            Frame {index + 1} of {total} · <span className="font-mono">{String(frame.templateId ?? '')}</span>
            {typeof frame.phase === 'string' && <span className={`chip ml-2 ${PHASE_COLORS[frame.phase] ?? ''}`}>{frame.phase}</span>}
          </div>
          <h1 className="truncate text-lg font-semibold">{String(frame.title || frame.id || 'Untitled frame')}</h1>
        </div>
        <div className="flex items-center gap-1">
          <button className="btn btn-icon" disabled={index === 0} onClick={() => onMove(index - 1)} title="Move frame up">↑</button>
          <button className="btn btn-icon" disabled={index === total - 1} onClick={() => onMove(index + 1)} title="Move frame down">↓</button>
          <Menu
            items={[
              { label: 'Duplicate frame', onClick: onDuplicate },
              { label: 'New frame after this', onClick: onAddAfter },
              'sep',
              { label: 'Delete frame', danger: true, onClick: onDelete },
            ]}
            title="Frame actions"
          />
        </div>
      </div>

      <div className="tabs" role="tablist">
        {(['content', 'structure', 'settings'] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'content' ? 'Content' : t === 'structure' ? 'Structure' : 'Settings'}
          </button>
        ))}
      </div>

      {tab === 'content' && <ContentForm blocks={content} path={[...base, 'content']} actions={actions} focus={focus} />}

      {tab === 'structure' && (
        <>
          <Section title="Background">
            <JsonNode value={frame.background ?? { type: 'SOLID', color: 'canvas' }} path={[...base, 'background']} keyName="background" actions={actions} />
          </Section>
          <Section
            title="Header"
            actions={
              'header' in frame ? (
                <button className="btn btn-sm" onClick={() => actions.remove([...base, 'header'])}>Use campaign default</button>
              ) : (
                <button className="btn btn-sm" onClick={() => actions.set([...base, 'header'], { style: 'GLASS' })}>Override</button>
              )
            }
          >
            {'header' in frame ? <JsonNode value={frame.header!} path={[...base, 'header']} keyName="header" actions={actions} /> : <div className="text-xs text-zinc-500">Inherits the logo and style from the campaign defaults.</div>}
          </Section>
          <Section
            title="Art"
            description="Decorative layers drawn under the content column, pinned to an edge."
            actions={
              'art' in frame ? (
                <button className="btn btn-sm" onClick={() => actions.remove([...base, 'art'])}>Remove all</button>
              ) : (
                <button className="btn btn-sm" onClick={() => actions.set([...base, 'art'], [{ type: 'DISC', x: 500, y: 760, w: 760, h: 760, color: 'pale', pin: 'BOTTOM' }])}>+ Add art</button>
              )
            }
          >
            {'art' in frame ? <JsonNode value={frame.art!} path={[...base, 'art']} keyName="art" actions={actions} /> : <div className="text-xs text-zinc-500">No art layers.</div>}
          </Section>
          <Section title="Content blocks" description="Every block with all of its properties. Reorder, duplicate, add or remove blocks here.">
            <BlockList blocks={content} path={[...base, 'content']} actions={actions} renderArray={renderArray} focus={focus} />
          </Section>
        </>
      )}

      {tab === 'settings' && (
        <>
          <Section title="Identity">
            <Field label="Frame ID" hint="unique" keyName="id"><StringInput mono value={String(frame.id ?? '')} onChange={(v) => actions.set([...base, 'id'], v)} /></Field>
            <Field label="Title" hint="internal name" keyName="title"><StringInput multiline={false} value={String(frame.title ?? '')} onChange={(v) => actions.set([...base, 'title'], v)} /></Field>
            <Field label="Template" keyName="templateId"><StringInput keyName="templateId" value={String(frame.templateId ?? '')} onChange={(v) => actions.set([...base, 'templateId'], v)} /></Field>
            <Field label="Template version" keyName="templateVersion"><NumberInput value={Number(frame.templateVersion ?? 1)} onChange={(v) => actions.set([...base, 'templateVersion'], v)} /></Field>
            <Field label="Layout" keyName="layout"><StringInput keyName="layout" value={String(frame.layout ?? '')} onChange={(v) => actions.set([...base, 'layout'], v)} /></Field>
            <Field label="Phase" keyName="phase"><StringInput keyName="phase" value={String(frame.phase ?? '')} onChange={(v) => actions.set([...base, 'phase'], v)} /></Field>
          </Section>
          <Section title="Availability" description="The app shows the frame only inside this window.">
            <Field label="From"><DateTimeInput value={String(availability.from ?? '')} onChange={(v) => actions.set([...base, 'availability', 'from'], v)} /></Field>
            <Field label="Until"><DateTimeInput value={String(availability.until ?? '')} onChange={(v) => actions.set([...base, 'availability', 'until'], v)} /></Field>
          </Section>
          <Section title="Playback">
            <Field label="Duration" hint="ms, blank = campaign default" keyName="durationMs">
              <StringInput mono value={frame.durationMs === undefined ? '' : String(frame.durationMs)} onChange={(v) => (v.trim() === '' ? actions.remove([...base, 'durationMs']) : Number.isFinite(Number(v)) && actions.set([...base, 'durationMs'], Number(v)))} placeholder="7000" />
            </Field>
            <Field label="Min renderer" hint="drop on older apps" keyName="minRenderer">
              <StringInput mono value={frame.minRenderer === undefined ? '' : String(frame.minRenderer)} onChange={(v) => (v.trim() === '' ? actions.remove([...base, 'minRenderer']) : Number.isFinite(Number(v)) && actions.set([...base, 'minRenderer'], Number(v)))} placeholder="1" />
            </Field>
          </Section>
          <Section title="Other fields" description="Anything else on this frame.">
            <ObjectRows value={frame} path={base} actions={actions} skip={otherKeys} renderArray={renderArray} />
          </Section>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function BlockList({ blocks, path, actions, renderArray, focus }: { blocks: Json[]; path: Path; actions: NodeActions; renderArray: RenderArray; focus?: string }) {
  const [open, setOpen] = useState<Record<number, boolean>>({})
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    if (!focus) return
    const prefix = pathKey(path) + '.'
    if (!focus.startsWith(prefix)) return
    const idx = Number(focus.slice(prefix.length).split('.')[0])
    if (Number.isFinite(idx)) setOpen((o) => ({ ...o, [idx]: true }))
  }, [focus, path])
  return (
    <div className="grid gap-2">
      {blocks.map((b, i) => {
        const bo = isObject(b) ? b : {}
        const isOpen = open[i] ?? false
        const key = pathKey([...path, i])
        return (
          <div key={i} id={`blk-${[...path, i].join('-')}`} className={`item-card ${focus === key ? 'ring-2 ring-sky-400' : ''}`}>
            <div className="item-head">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen((o) => ({ ...o, [i]: !isOpen }))}>
                <span className="inline-block w-3 text-zinc-400">{isOpen ? '▾' : '▸'}</span>
                <span className="chip bg-zinc-900 text-white">{String(bo.type ?? '?')}</span>
                {typeof bo.style === 'string' && <span className="chip bg-zinc-100 text-zinc-600">{bo.style}</span>}
                <span className="truncate">{blockSummary(b)}</span>
              </button>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Move up" disabled={i === 0} onClick={() => actions.move(path, i, i - 1)}>↑</button>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Move down" disabled={i === blocks.length - 1} onClick={() => actions.move(path, i, i + 1)}>↓</button>
              <Menu
                small
                items={[
                  { label: 'Duplicate', onClick: () => actions.insert(path, i + 1, clone(b)) },
                  'sep',
                  { label: 'Remove block', danger: true, onClick: () => actions.remove([...path, i]) },
                ]}
              />
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
        <div className="flex flex-wrap gap-1.5 rounded-lg border border-dashed border-zinc-300 p-2">
          {CONTENT_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className="btn btn-sm font-mono"
              onClick={() => {
                actions.insert(path, blocks.length, blockTemplate(t))
                setOpen((o) => ({ ...o, [blocks.length]: true }))
                setAdding(false)
              }}
            >
              {t}
            </button>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
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
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Raw JSON</h1>
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
      <textarea className="input input-mono h-[70dvh] resize-y text-xs" style={{ fieldSizing: 'fixed' } as React.CSSProperties} value={draft} spellCheck={false} onChange={(e) => setDraft(e.target.value)} />
    </div>
  )
}
