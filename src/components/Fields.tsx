import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ENUMS } from '~/lib/schema'
import { isObject, type Json, type JsonObject, type Path } from '~/lib/jsonPath'

// ---------------------------------------------------------------------------
// Labels

const ACRONYMS: Record<string, string> = { id: 'ID', url: 'URL', uri: 'URI', cta: 'CTA', rfid: 'RFID', ms: 'ms', kv: 'KV', rtl: 'RTL', x: 'X', y: 'Y', w: 'W', h: 'H' }

/** "marginTop" → "Margin top", "durationMs" → "Duration ms", "url" → "URL". */
export function humanize(key: string): string {
  if (ACRONYMS[key]) return ACRONYMS[key]!
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => ACRONYMS[w] ?? w)
  const s = words.join(' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** "rows" → "Row", "items" → "Item", "cells" → "Cell", "buttons" → "Button". */
export function singular(key: string): string {
  const h = humanize(key)
  return h.endsWith('s') && !h.endsWith('ss') ? h.slice(0, -1) : h
}

export function isImageObject(v: Json | undefined): v is JsonObject {
  return isObject(v) && typeof v.url === 'string' && ('width' in v || 'height' in v || 'alt' in v)
}

// ---------------------------------------------------------------------------
// Field layout

export function Field({ label, hint, keyName, menu, children }: { label: string; hint?: string; keyName?: string; menu?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label" title={keyName && keyName !== label ? keyName : undefined}>
        {label}
        {hint && <span className="hint">{hint}</span>}
      </div>
      <div className="field-control">{children}</div>
      <div className="field-menu">{menu}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Primitive inputs

const MULTILINE_KEYS = new Set(['text', 'quote', 'subtitle', 'description', 'body'])

export function StringInput({
  value,
  onChange,
  keyName,
  multiline,
  placeholder,
  mono,
}: {
  value: string
  onChange: (v: string) => void
  keyName?: string
  multiline?: boolean
  placeholder?: string
  mono?: boolean
}) {
  const listId = useId()
  const options = keyName ? ENUMS[keyName] : undefined
  const isMultiline = multiline ?? ((keyName ? MULTILINE_KEYS.has(keyName) : false) || value.includes('\n') || value.length > 70)
  if (isMultiline) {
    return <textarea className="input" value={value} rows={1} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
  }
  return (
    <>
      <input
        type="text"
        className={`input ${mono || options ? 'input-mono' : ''}`}
        value={value}
        list={options ? listId : undefined}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {options && (
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </>
  )
}

export function NumberInput({ value, onChange, placeholder }: { value: number; onChange: (v: number) => void; placeholder?: string }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => {
    setDraft((d) => (Number(d) === value ? d : String(value)))
  }, [value])
  return (
    <input
      type="text"
      inputMode="decimal"
      className="input input-mono"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => {
        setDraft(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(n)
      }}
      onBlur={() => setDraft(String(value))}
    />
  )
}

export function BooleanInput({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="inline-flex h-9 items-center gap-2 text-sm text-zinc-700">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label ?? (value ? 'Yes' : 'No')}</span>
    </label>
  )
}

const ISO_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?([+-]\d{2}:\d{2}|Z)?$/

/**
 * ISO 8601 date-time with offset, e.g. 2026-11-10T10:00:00+04:00.
 * One text input plus a calendar button that opens the native picker;
 * picking keeps the existing seconds and timezone offset.
 */
export function DateTimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const picker = useRef<HTMLInputElement>(null)
  const [inline, setInline] = useState(false)
  const m = ISO_RE.exec(value)
  const local = m ? m[1] : ''
  const seconds = m?.[2] ?? ':00'
  const offset = m?.[3] ?? '+04:00'
  const apply = (v: string) => {
    if (!v) return
    onChange((v.length === 16 ? v + seconds : v) + offset)
  }
  return (
    <div className="relative">
      <div className="flex gap-1">
        <input
          type="text"
          className={`input input-mono ${value && !m ? 'border-amber-400' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="2026-11-10T10:00:00+04:00"
          spellCheck={false}
        />
        <button
          type="button"
          className="btn btn-icon"
          title={`Pick a date and time (keeps offset ${offset})`}
          onClick={() => {
            const el = picker.current
            if (el && typeof el.showPicker === 'function') {
              try {
                el.showPicker()
                return
              } catch {
                /* fall through to inline */
              }
            }
            setInline((v) => !v)
          }}
        >
          <CalendarIcon />
        </button>
      </div>
      <input ref={picker} type="datetime-local" className="picker-hidden" tabIndex={-1} aria-hidden value={local} step={1} onChange={(e) => apply(e.target.value)} />
      {inline && <input type="datetime-local" className="input mt-1" value={local} step={1} onChange={(e) => apply(e.target.value)} />}
    </div>
  )
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="2" y="3" width="12" height="11" rx="2" />
      <path d="M2 7h12M5 1.5v3M11 1.5v3" />
    </svg>
  )
}

export function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Menu (small popover)

export interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

export function Menu({ items, title = 'More', small }: { items: Array<MenuItem | 'sep'>; title?: string; small?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button type="button" className={`btn btn-ghost btn-icon ${small ? 'btn-sm' : ''}`} title={title} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreIcon />
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((it, i) =>
            it === 'sep' ? (
              <div key={i} className="menu-sep" />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={`menu-item ${it.danger ? 'text-red-700' : ''}`}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false)
                  it.onClick()
                }}
              >
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Image field: url + thumbnail, alt, width × height, with the rest on demand.

export function ImageField({
  value,
  path,
  set,
  extra,
}: {
  value: JsonObject
  path: Path
  set: (path: Path, v: Json) => void
  /** Rendered when the user expands "more fields" (e.g. the generic rows for the other keys). */
  extra?: ReactNode
}) {
  const [more, setMore] = useState(false)
  const [probe, setProbe] = useState<string | null>(null)
  const url = typeof value.url === 'string' ? value.url : ''
  const ok = /^https?:\/\//.test(url)

  function measure() {
    if (!ok) return
    setProbe('…')
    const img = new Image()
    img.onload = () => {
      set([...path, 'width'], img.naturalWidth)
      set([...path, 'height'], img.naturalHeight)
      setProbe(null)
    }
    img.onerror = () => setProbe('Could not load')
    img.src = url
  }

  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <a href={ok ? url : undefined} target="_blank" rel="noreferrer" className="block h-9 w-12 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100" title="Open image">
          {ok && <img src={url} alt="" className="h-full w-full object-contain" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
        </a>
        <input type="url" className="input input-mono" value={url} placeholder="https://…" onChange={(e) => set([...path, 'url'], e.target.value)} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <input type="text" className="input" value={typeof value.alt === 'string' ? value.alt : ''} placeholder="Alt text" onChange={(e) => set([...path, 'alt'], e.target.value)} />
        <div className="flex items-center gap-1">
          <input type="text" inputMode="numeric" className="input input-mono !w-16 text-center" value={typeof value.width === 'number' ? value.width : ''} placeholder="w" onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) set([...path, 'width'], n) }} />
          <span className="text-xs text-zinc-400">×</span>
          <input type="text" inputMode="numeric" className="input input-mono !w-16 text-center" value={typeof value.height === 'number' ? value.height : ''} placeholder="h" onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) set([...path, 'height'], n) }} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
        <button type="button" className="hover:text-zinc-900 hover:underline disabled:opacity-40" disabled={!ok} onClick={measure}>
          {probe ?? 'Read size from image'}
        </button>
        {extra && (
          <button type="button" className="hover:text-zinc-900 hover:underline" onClick={() => setMore((m) => !m)}>
            {more ? 'Fewer fields' : 'More fields'}
          </button>
        )}
        {value.critical === true && <span className="chip bg-zinc-100 text-zinc-500">critical</span>}
        {value.decorative === true && <span className="chip bg-zinc-100 text-zinc-500">decorative</span>}
      </div>
      {more && extra}
    </div>
  )
}
