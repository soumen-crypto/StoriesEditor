import { useState } from 'react'
import { type Json, type JsonObject, type Path, isObject, typeOf, defaultFor, clone } from '~/lib/jsonPath'
import { BooleanInput, DateTimeInput, Field, ImageField, Menu, NumberInput, StringInput, humanize, isImageObject, singular, type MenuItem } from './Fields'

export interface NodeActions {
  set: (path: Path, value: Json) => void
  remove: (path: Path) => void
  move: (arrayPath: Path, from: number, to: number) => void
  insert: (arrayPath: Path, index: number, value: Json) => void
  rename: (objectPath: Path, oldKey: string, newKey: string) => void
}

export type RenderArray = (keyName: string, value: Json[], path: Path) => React.ReactNode | null

const DATE_KEYS = new Set(['from', 'until', 'start', 'end', 'at'])
const IMAGE_EXTRA_KEYS = new Set(['url', 'alt', 'width', 'height'])

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
  const label = o.type ?? o.id ?? o.label ?? o.title ?? o.text ?? o.name ?? o.alt ?? o.url
  const keys = Object.keys(o)
  const l = typeof label === 'string' ? label.replace(/\n/g, ' ').slice(0, 40) : ''
  return l ? `${l} · ${keys.length} field${keys.length === 1 ? '' : 's'}` : `${keys.length} field${keys.length === 1 ? '' : 's'}`
}

/** Editor for a primitive value. */
export function PrimitiveEditor({ value, keyName, onChange }: { value: Json; keyName: string; onChange: (v: Json) => void }) {
  if (typeof value === 'string') {
    if (isDateLike(keyName, value)) return <DateTimeInput value={value} onChange={onChange} />
    return <StringInput value={value} keyName={keyName} onChange={onChange} />
  }
  if (typeof value === 'number') return <NumberInput value={value} onChange={onChange} />
  if (typeof value === 'boolean') return <BooleanInput value={value} onChange={onChange} />
  return <div className="input input-mono text-zinc-400">null</div>
}

const TYPES: Array<ReturnType<typeof typeOf>> = ['string', 'number', 'boolean', 'object', 'array', 'null']

function rowMenu(opts: { path: Path; keyName: string; actions: NodeActions; onRename?: () => void; current: ReturnType<typeof typeOf> }): Array<MenuItem | 'sep'> {
  const { path, actions, onRename, current } = opts
  const items: Array<MenuItem | 'sep'> = []
  if (onRename) items.push({ label: 'Rename field', onClick: onRename })
  for (const t of TYPES) if (t !== current) items.push({ label: `Change to ${t}`, onClick: () => actions.set(path, defaultFor(t)) })
  items.push('sep', { label: 'Remove', danger: true, onClick: () => actions.remove(path) })
  return items
}

function RenameInline({ name, onDone }: { name: string; onDone: (n: string | null) => void }) {
  const [draft, setDraft] = useState(name)
  return (
    <input
      autoFocus
      className="input input-mono"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onDone(draft && draft !== name ? draft : null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') onDone(null)
      }}
    />
  )
}

function AddField({ onAdd, existing }: { onAdd: (key: string, value: Json) => void; existing: string[] }) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [type, setType] = useState<ReturnType<typeof typeOf>>('string')
  const dup = existing.includes(key)
  if (!open) {
    return (
      <button type="button" className="btn btn-ghost btn-sm w-fit text-zinc-500" onClick={() => setOpen(true)}>
        + Field
      </button>
    )
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!key || dup) return
        onAdd(key, defaultFor(type))
        setKey('')
        setOpen(false)
      }}
    >
      <input type="text" autoFocus className="input input-mono !w-40" placeholder="fieldName" value={key} onChange={(e) => setKey(e.target.value)} />
      <select className="input !w-auto" value={type} onChange={(e) => setType(e.target.value as ReturnType<typeof typeOf>)}>
        {TYPES.filter((t) => t !== 'null').map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <button type="submit" className="btn btn-sm" disabled={!key || dup}>Add</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      {dup && <span className="text-xs text-amber-600">exists</span>}
    </form>
  )
}

/** One key/value row of an object. */
function ObjectRow({ k, v, path, actions, depth, renderArray }: { k: string; v: Json; path: Path; actions: NodeActions; depth: number; renderArray?: RenderArray }) {
  const [renaming, setRenaming] = useState(false)
  const rowPath = [...path, k]
  const menu = <Menu small items={rowMenu({ path: rowPath, keyName: k, actions, onRename: () => setRenaming(true), current: typeOf(v) })} />
  const label = renaming ? (
    <RenameInline
      name={k}
      onDone={(n) => {
        setRenaming(false)
        if (n) actions.rename(path, k, n)
      }}
    />
  ) : null

  if (isImageObject(v)) {
    const extraKeys = Object.keys(v).filter((x) => !IMAGE_EXTRA_KEYS.has(x))
    return (
      <Field label={humanize(k)} keyName={k} menu={menu}>
        {label}
        <ImageField
          value={v}
          path={rowPath}
          set={actions.set}
          extra={
            <div className="group grid gap-2 pt-1">
              {extraKeys.map((x) => (
                <ObjectRow key={x} k={x} v={v[x]!} path={rowPath} actions={actions} depth={depth + 1} renderArray={renderArray} />
              ))}
              <AddField existing={Object.keys(v)} onAdd={(nk, nv) => actions.set([...rowPath, nk], nv)} />
            </div>
          }
        />
      </Field>
    )
  }

  if (isObject(v) || Array.isArray(v)) {
    return (
      <Field label={humanize(k)} keyName={k} hint={summarize(v)} menu={menu}>
        {label}
        <JsonNode value={v} path={rowPath} keyName={k} actions={actions} depth={depth + 1} collapsedByDefault={depth >= 1} renderArray={renderArray} />
      </Field>
    )
  }

  return (
    <Field label={humanize(k)} keyName={k} menu={menu}>
      {label}
      <PrimitiveEditor value={v} keyName={k} onChange={(nv) => actions.set(rowPath, nv)} />
    </Field>
  )
}

/**
 * Recursive JSON editor. Objects render as label/value rows, arrays as a
 * re-orderable list of cards, primitives as type-appropriate inputs.
 */
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

  const toggle = depth > 0 && (
    <button type="button" className="mb-1 flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-900" onClick={() => setCollapsed((c) => !c)}>
      <span className="inline-block w-3">{collapsed ? '▸' : '▾'}</span>
      {collapsed ? 'Show' : 'Hide'}
    </button>
  )

  if (isObject(value)) {
    const entries = Object.entries(value)
    return (
      <div className={depth > 0 ? 'group' : ''}>
        {toggle}
        {!collapsed && (
          <div className="grid gap-2">
            {entries.map(([k, v]) => (
              <ObjectRow key={k} k={k} v={v} path={path} actions={actions} depth={depth} renderArray={renderArray} />
            ))}
            <AddField existing={Object.keys(value)} onAdd={(k, v) => actions.set([...path, k], v)} />
          </div>
        )}
      </div>
    )
  }

  if (Array.isArray(value)) {
    const allPrimitive = value.every((v) => v === null || typeof v !== 'object')
    const itemLabel = singular(keyName)
    return (
      <div className={depth > 0 ? 'group' : ''}>
        {toggle}
        {!collapsed && (
          <div className="grid gap-2">
            {value.map((item, i) => {
              const controls = (
                <div className="ml-auto flex items-center gap-0.5">
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Move up" disabled={i === 0} onClick={() => actions.move(path, i, i - 1)}>↑</button>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Move down" disabled={i === value.length - 1} onClick={() => actions.move(path, i, i + 1)}>↓</button>
                  <Menu
                    small
                    items={[
                      { label: 'Duplicate', onClick: () => actions.insert(path, i + 1, clone(item)) },
                      { label: 'Insert after', onClick: () => actions.insert(path, i + 1, allPrimitive ? '' : {}) },
                      'sep',
                      { label: 'Remove', danger: true, onClick: () => actions.remove([...path, i]) },
                    ]}
                  />
                </div>
              )
              if (isObject(item) || Array.isArray(item)) {
                return (
                  <div key={i} className="item-card">
                    <div className="item-head">
                      <span className="font-medium text-zinc-700">{itemLabel} {i + 1}</span>
                      <span className="truncate text-zinc-400">{summarize(item)}</span>
                      {controls}
                    </div>
                    <div className="border-t border-zinc-100 p-2.5">
                      {isImageObject(item) ? (
                        <ImageField value={item} path={[...path, i]} set={actions.set} />
                      ) : (
                        <JsonNode value={item} path={[...path, i]} keyName={keyName} actions={actions} depth={depth + 1} renderArray={renderArray} />
                      )}
                    </div>
                  </div>
                )
              }
              return (
                <div key={i} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <PrimitiveEditor value={item} keyName={keyName} onChange={(nv) => actions.set([...path, i], nv)} />
                  </div>
                  {controls}
                </div>
              )
            })}
            <button
              type="button"
              className="btn btn-ghost btn-sm w-fit text-zinc-500"
              onClick={() => {
                const last = value[value.length - 1]
                const next: Json = last === undefined ? (allPrimitive ? '' : {}) : typeof last === 'object' && last !== null ? clone(last) : defaultFor(typeOf(last))
                actions.insert(path, value.length, next)
              }}
            >
              + {itemLabel}
            </button>
          </div>
        )}
      </div>
    )
  }

  return <PrimitiveEditor value={value} keyName={keyName} onChange={(nv) => actions.set(path, nv)} />
}

/** Rows for the keys of an object that are not in `skip`. */
export function ObjectRows({ value, path, actions, skip, renderArray }: { value: JsonObject; path: Path; actions: NodeActions; skip?: Set<string>; renderArray?: RenderArray }) {
  const keys = Object.keys(value).filter((k) => !skip?.has(k))
  return (
    <div className="grid gap-2">
      {keys.map((k) => (
        <ObjectRow key={k} k={k} v={value[k]!} path={path} actions={actions} depth={0} renderArray={renderArray} />
      ))}
      <AddField existing={Object.keys(value)} onAdd={(k, v) => actions.set([...path, k], v)} />
    </div>
  )
}
