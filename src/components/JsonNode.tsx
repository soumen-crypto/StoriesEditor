import { useState } from 'react'
import { type Json, type Path, isObject, typeOf, defaultFor, clone } from '~/lib/jsonPath'
import { BooleanInput, DateTimeInput, NumberInput, StringInput } from './Fields'

export interface NodeActions {
  set: (path: Path, value: Json) => void
  remove: (path: Path) => void
  move: (arrayPath: Path, from: number, to: number) => void
  insert: (arrayPath: Path, index: number, value: Json) => void
  rename: (objectPath: Path, oldKey: string, newKey: string) => void
}

const MULTILINE_KEYS = new Set(['text', 'quote', 'subtitle', 'value'])
const DATE_KEYS = new Set(['from', 'until', 'start', 'end'])

function isDateLike(key: string, value: string) {
  return DATE_KEYS.has(key) && /^\d{4}-\d{2}-\d{2}T/.test(value)
}

/** Short one-line description of a value, for collapsed headers. */
export function summarize(v: Json | undefined): string {
  if (v === undefined) return ''
  if (v === null) return 'null'
  if (typeof v === 'string') return v.length > 60 ? v.slice(0, 57) + '…' : v
  if (typeof v !== 'object') return String(v)
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`
  const o = v as Record<string, Json>
  const label = o.type ?? o.id ?? o.label ?? o.title ?? o.text ?? o.name ?? o.url
  const keys = Object.keys(o)
  return (typeof label === 'string' ? label : '') + (typeof label === 'string' ? '  ·  ' : '') + `${keys.length} field${keys.length === 1 ? '' : 's'}`
}

/** Editor for a primitive value. */
export function PrimitiveEditor({
  value,
  keyName,
  onChange,
}: {
  value: Json
  keyName: string
  onChange: (v: Json) => void
}) {
  if (typeof value === 'string') {
    if (isDateLike(keyName, value)) return <DateTimeInput value={value} onChange={onChange} />
    return <StringInput value={value} keyName={keyName} multiline={MULTILINE_KEYS.has(keyName) && value.length > 50} onChange={onChange} />
  }
  if (typeof value === 'number') return <NumberInput value={value} onChange={onChange} />
  if (typeof value === 'boolean') return <BooleanInput value={value} onChange={onChange} />
  return <span className="pt-1.5 font-mono text-xs text-zinc-400">null</span>
}

function TypeMenu({ onPick }: { onPick: (t: ReturnType<typeof typeOf>) => void }) {
  return (
    <select
      className="!w-auto text-xs"
      defaultValue=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value as ReturnType<typeof typeOf>)
        e.target.value = ''
      }}
      title="Change type"
    >
      <option value="">type…</option>
      <option value="string">string</option>
      <option value="number">number</option>
      <option value="boolean">boolean</option>
      <option value="object">object</option>
      <option value="array">array</option>
      <option value="null">null</option>
    </select>
  )
}

function KeyLabel({ name, onRename }: { name: string; onRename?: (n: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  if (!onRename) return <div className="pt-1.5 font-mono text-xs font-medium text-zinc-700">{name}</div>
  if (editing) {
    return (
      <input
        autoFocus
        className="font-mono text-xs"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false)
          if (draft && draft !== name) onRename(draft)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setDraft(name)
            setEditing(false)
          }
        }}
      />
    )
  }
  return (
    <button
      type="button"
      className="pt-1.5 text-left font-mono text-xs font-medium text-zinc-700 hover:text-sky-700"
      title="Click to rename key"
      onDoubleClick={() => setEditing(true)}
      onClick={() => setEditing(true)}
    >
      {name}
    </button>
  )
}

function AddFieldRow({ onAdd, existing }: { onAdd: (key: string, value: Json) => void; existing: string[] }) {
  const [key, setKey] = useState('')
  const [type, setType] = useState<ReturnType<typeof typeOf>>('string')
  const dup = existing.includes(key)
  return (
    <form
      className="mt-1 flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!key || dup) return
        onAdd(key, defaultFor(type))
        setKey('')
      }}
    >
      <input
        type="text"
        className="!w-40 font-mono text-xs"
        placeholder="new field"
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <select className="!w-auto text-xs" value={type} onChange={(e) => setType(e.target.value as any)}>
        <option value="string">string</option>
        <option value="number">number</option>
        <option value="boolean">boolean</option>
        <option value="object">object</option>
        <option value="array">array</option>
      </select>
      <button type="submit" className="btn" disabled={!key || dup}>
        + Add field
      </button>
      {dup && <span className="text-xs text-amber-600">key exists</span>}
    </form>
  )
}

/**
 * Recursive JSON editor. Objects render as key/value rows, arrays as a
 * re-orderable list, primitives as type-appropriate inputs.
 */
export type RenderArray = (keyName: string, value: Json[], path: Path) => React.ReactNode | null

export function JsonNode({
  value,
  path,
  keyName,
  actions,
  depth = 0,
  collapsedByDefault = false,
  renderArray,
}: {
  value: Json
  path: Path
  keyName: string
  actions: NodeActions
  depth?: number
  collapsedByDefault?: boolean
  /** Optional override for how a named array is rendered (e.g. block lists). */
  renderArray?: RenderArray
}) {
  const [collapsed, setCollapsed] = useState(collapsedByDefault)

  if (Array.isArray(value) && renderArray) {
    const custom = renderArray(keyName, value, path)
    if (custom) return <>{custom}</>
  }

  if (isObject(value)) {
    const entries = Object.entries(value)
    return (
      <div className={depth > 0 ? 'rounded-md border border-zinc-200 bg-zinc-50/60 p-2' : ''}>
        {depth > 0 && (
          <button type="button" className="mb-1 flex w-full items-center gap-2 text-left text-xs text-zinc-500" onClick={() => setCollapsed((c) => !c)}>
            <span className="inline-block w-3">{collapsed ? '▸' : '▾'}</span>
            <span className="font-mono">{'{ }'}</span>
            <span className="truncate">{summarize(value)}</span>
          </button>
        )}
        {!collapsed && (
          <div className="grid gap-1.5">
            {entries.map(([k, v]) => (
              <div key={k} className="json-row">
                <KeyLabel name={k} onRename={(n) => actions.rename(path, k, n)} />
                <div className="min-w-0">
                  {isObject(v) || Array.isArray(v) ? (
                    <JsonNode value={v} path={[...path, k]} keyName={k} actions={actions} depth={depth + 1} collapsedByDefault={depth >= 2} renderArray={renderArray} />
                  ) : (
                    <PrimitiveEditor value={v} keyName={k} onChange={(nv) => actions.set([...path, k], nv)} />
                  )}
                </div>
                <div className="flex items-start gap-1 pt-0.5">
                  <TypeMenu onPick={(t) => actions.set([...path, k], defaultFor(t))} />
                  <button type="button" className="btn btn-icon" title="Remove field" onClick={() => actions.remove([...path, k])}>
                    ×
                  </button>
                </div>
              </div>
            ))}
            <AddFieldRow existing={Object.keys(value)} onAdd={(k, v) => actions.set([...path, k], v)} />
          </div>
        )}
      </div>
    )
  }

  if (Array.isArray(value)) {
    const allPrimitive = value.every((v) => v === null || typeof v !== 'object')
    return (
      <div className={depth > 0 ? 'rounded-md border border-zinc-200 bg-white p-2' : ''}>
        {depth > 0 && (
          <button type="button" className="mb-1 flex w-full items-center gap-2 text-left text-xs text-zinc-500" onClick={() => setCollapsed((c) => !c)}>
            <span className="inline-block w-3">{collapsed ? '▸' : '▾'}</span>
            <span className="font-mono">[ ]</span>
            <span>{summarize(value)}</span>
          </button>
        )}
        {!collapsed && (
          <div className="grid gap-1.5">
            {value.map((item, i) => (
              <div key={i} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
                <div className="pt-1.5 font-mono text-[11px] text-zinc-400">{i}</div>
                <div className="min-w-0">
                  {isObject(item) || Array.isArray(item) ? (
                    <JsonNode value={item} path={[...path, i]} keyName={keyName} actions={actions} depth={depth + 1} collapsedByDefault={depth >= 2} renderArray={renderArray} />
                  ) : (
                    <PrimitiveEditor value={item} keyName={keyName} onChange={(nv) => actions.set([...path, i], nv)} />
                  )}
                </div>
                <div className="flex items-start gap-1 pt-0.5">
                  <button type="button" className="btn btn-icon" title="Move up" disabled={i === 0} onClick={() => actions.move(path, i, i - 1)}>↑</button>
                  <button type="button" className="btn btn-icon" title="Move down" disabled={i === value.length - 1} onClick={() => actions.move(path, i, i + 1)}>↓</button>
                  <button type="button" className="btn btn-icon" title="Duplicate" onClick={() => actions.insert(path, i + 1, clone(item))}>⧉</button>
                  <button type="button" className="btn btn-icon" title="Remove" onClick={() => actions.remove([...path, i])}>×</button>
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const last = value[value.length - 1]
                  const next: Json = last === undefined ? (allPrimitive ? '' : {}) : typeof last === 'object' && last !== null ? clone(last) : defaultFor(typeOf(last))
                  actions.insert(path, value.length, next)
                }}
              >
                + Add item
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return <PrimitiveEditor value={value} keyName={keyName} onChange={(nv) => actions.set(path, nv)} />
}
