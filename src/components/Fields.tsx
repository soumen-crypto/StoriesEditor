import { useId } from 'react'
import { ENUMS } from '~/lib/schema'

export function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="pt-1.5 text-xs font-medium text-zinc-600">
      {children}
      {hint && <div className="font-normal text-zinc-400">{hint}</div>}
    </div>
  )
}

/** Text input that offers known enum values for the given key, but accepts anything. */
export function StringInput({
  value,
  onChange,
  keyName,
  multiline,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  keyName?: string
  multiline?: boolean
  placeholder?: string
}) {
  const listId = useId()
  const options = keyName ? ENUMS[keyName] : undefined
  const isUrl = /url|uri/i.test(keyName ?? '') && /^https?:\/\//.test(value)
  if (multiline || value.includes('\n')) {
    return (
      <textarea
        value={value}
        rows={Math.min(8, Math.max(1, value.split('\n').length))}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    )
  }
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        list={options ? listId : undefined}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={options ? 'font-mono' : undefined}
      />
      {options && (
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
      {isUrl && (
        <a href={value} target="_blank" rel="noreferrer" title="Open in new tab" className="shrink-0">
          <img src={value} alt="" className="h-7 w-7 rounded border border-zinc-200 object-contain bg-white" />
        </a>
      )}
    </div>
  )
}

export function NumberInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : ''}
      step="any"
      onChange={(e) => {
        const n = e.target.valueAsNumber
        if (Number.isFinite(n)) onChange(n)
      }}
    />
  )
}

export function BooleanInput({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 pt-1 text-sm">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-zinc-900" />
      <span className="font-mono text-xs text-zinc-600">{String(value)}</span>
    </label>
  )
}

const ISO_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?([+-]\d{2}:\d{2}|Z)?$/

/**
 * ISO 8601 date-time with offset (e.g. 2026-11-10T10:00:00+04:00).
 * Shows a native picker alongside the raw text; the picker edit keeps the
 * existing seconds and timezone offset.
 */
export function DateTimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const m = ISO_RE.exec(value)
  const local = m ? m[1] : ''
  const seconds = m?.[2] ?? ':00'
  const offset = m?.[3] ?? '+04:00'
  return (
    <div className="grid gap-1 sm:grid-cols-[1fr_auto]">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`font-mono ${m ? '' : 'border-amber-400'}`}
        placeholder="2026-11-10T10:00:00+04:00"
      />
      <input
        type="datetime-local"
        value={local}
        step={1}
        onChange={(e) => {
          if (!e.target.value) return
          const v = e.target.value.length === 16 ? e.target.value + seconds : e.target.value
          onChange(v + offset)
        }}
        className="sm:w-56"
        title={`Keeps offset ${offset}`}
      />
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="json-row">
      <Label hint={hint}>{label}</Label>
      <div className="min-w-0">{children}</div>
      <div />
    </div>
  )
}
