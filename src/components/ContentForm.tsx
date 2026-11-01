import { useEffect, useRef } from 'react'
import { clone, isObject, type Json, type JsonObject, type Path } from '~/lib/jsonPath'
import { Field, ImageField, Menu, humanize, isImageObject, singular } from './Fields'
import { PrimitiveEditor, summarize, type NodeActions } from './JsonNode'

/**
 * "Content" view of a frame: only the things people change day to day —
 * copy, labels, values, images — grouped per block, with layout and style
 * props left to the Structure view.
 */

/** Block-level props that are layout/style rather than content (hidden here when primitive). */
const STRUCTURAL = new Set([
  'id', 'type', 'marginTop', 'width', 'maxWidth', 'align', 'required', 'style', 'size', 'lineHeight', 'color',
  'textAlign', 'maxLines', 'padding', 'variant', 'columns', 'valueSize', 'height', 'imageHeight', 'barColor',
  'fit', 'shape', 'cornerRadius', 'background', 'border', 'density', 'leading', 'tileHeight', 'gap', 'gapColor',
  'flex', 'pulse', 'onGlass', 'separator', 'indicator', 'snap', 'bleedEnd', 'itemWidth', 'itemHeight',
  'imageWidth', 'portraitSize', 'cells', 'dotDiameter', 'pitch', 'cellWidth', 'cellHeight', 'gapX', 'gapY',
  'fill', 'animation', 'showPercent', 'ticks', 'diameter', 'mirrorInRtl', 'rotation', 'pin', 'x', 'y', 'w', 'h',
])

export function pathKey(path: Path) {
  return path.join('.')
}

export function blockSummary(b: Json): string {
  if (!isObject(b)) return ''
  const txt = b.text ?? b.label ?? b.title ?? b.quote ?? b.value ?? b.start ?? b.word
  if (typeof txt === 'string') return txt.replace(/\n/g, ' ↵ ').slice(0, 70)
  if (Array.isArray(b.children)) return `${b.children.length} child block${b.children.length === 1 ? '' : 's'}`
  if (Array.isArray(b.buttons)) return b.buttons.map((x) => (isObject(x) ? String(x.label ?? '') : '')).join(', ')
  if (Array.isArray(b.items)) return `${b.items.length} items`
  if (Array.isArray(b.rows)) return `${b.rows.length} rows`
  if (Array.isArray(b.bars)) return `${b.bars.length} bars`
  if (Array.isArray(b.options)) return `${b.options.length} options`
  if (isObject(b.image) && typeof b.image.alt === 'string') return b.image.alt
  if (b.type === 'SPACER') return 'flexible space'
  return summarize(b)
}

export function ContentForm({ blocks, path, actions, focus, depth = 0 }: { blocks: Json[]; path: Path; actions: NodeActions; focus?: string; depth?: number }) {
  if (blocks.length === 0) return <div className="text-sm text-zinc-500">No blocks in this frame yet. Add some in the Structure tab.</div>
  return (
    <div className="grid gap-3">
      {blocks.map((b, i) => (
        <BlockSection key={i} block={b} path={[...path, i]} actions={actions} focus={focus} depth={depth} />
      ))}
    </div>
  )
}

function BlockSection({ block, path, actions, focus, depth }: { block: Json; path: Path; actions: NodeActions; focus?: string; depth: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const key = pathKey(path)
  const focused = focus === key
  useEffect(() => {
    if (!focused || !ref.current) return
    ref.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    ref.current.classList.remove('flash')
    void ref.current.offsetWidth
    ref.current.classList.add('flash')
  }, [focused])

  if (!isObject(block)) return null
  const type = typeof block.type === 'string' ? block.type : '?'
  const hasContent = Object.keys(block).some((k) => k !== 'children' && k !== 'content' && isContentKey(k, block[k]!))
  const children = Array.isArray(block.children) ? block.children : null

  return (
    <section ref={ref} id={`blk-${path.join('-')}`} className={`card ${depth > 0 ? 'bg-zinc-50/60' : ''} ${focused ? 'ring-2 ring-sky-400' : ''}`}>
      <header className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2">
        <span className="chip bg-zinc-900 text-white">{type}</span>
        {typeof block.style === 'string' && <span className="chip bg-zinc-100 text-zinc-600">{block.style}</span>}
        <span className="truncate text-xs text-zinc-500">{blockSummary(block)}</span>
      </header>
      <div className="grid gap-2.5 p-3">
        {hasContent ? <ContentFields value={block} path={path} actions={actions} isBlock /> : children ? null : <div className="text-xs text-zinc-400">Nothing to edit here, this block is layout only.</div>}
        {children && (
          <div className="group grid gap-3 pt-1">
            <ContentForm blocks={children} path={[...path, 'children']} actions={actions} focus={focus} depth={depth + 1} />
          </div>
        )}
      </div>
    </section>
  )
}

function isContentKey(k: string, v: Json) {
  if (v !== null && typeof v === 'object') return true
  return !STRUCTURAL.has(k)
}

function ContentFields({ value, path, actions, isBlock = false }: { value: JsonObject; path: Path; actions: NodeActions; isBlock?: boolean }) {
  const entries = Object.entries(value).filter(([k, v]) => {
    if (k === 'children' || k === 'content') return false
    if (isBlock) return isContentKey(k, v)
    return true
  })
  return (
    <>
      {entries.map(([k, v]) => {
        const p = [...path, k]
        if (isImageObject(v)) {
          return (
            <Field key={k} label={humanize(k)} keyName={k}>
              <ImageField value={v} path={p} set={actions.set} />
            </Field>
          )
        }
        if (isObject(v)) {
          return (
            <div key={k} className="grid gap-2">
              <div className="text-xs font-medium text-zinc-600">{humanize(k)}</div>
              <div className="group grid gap-2">
                <ContentFields value={v} path={p} actions={actions} />
              </div>
            </div>
          )
        }
        if (Array.isArray(v)) {
          const allPrimitive = v.every((x) => x === null || typeof x !== 'object')
          const itemLabel = singular(k)
          return (
            <div key={k} className="grid gap-2">
              <div className="text-xs font-medium text-zinc-600">{humanize(k)}</div>
              {v.map((item, i) => {
                const menu = (
                  <Menu
                    small
                    items={[
                      { label: 'Move up', disabled: i === 0, onClick: () => actions.move(p, i, i - 1) },
                      { label: 'Move down', disabled: i === v.length - 1, onClick: () => actions.move(p, i, i + 1) },
                      { label: 'Duplicate', onClick: () => actions.insert(p, i + 1, clone(item)) },
                      'sep',
                      { label: 'Remove', danger: true, onClick: () => actions.remove([...p, i]) },
                    ]}
                  />
                )
                if (isImageObject(item)) {
                  return (
                    <Field key={i} label={`${itemLabel} ${i + 1}`} menu={menu}>
                      <ImageField value={item} path={[...p, i]} set={actions.set} />
                    </Field>
                  )
                }
                if (isObject(item)) {
                  return (
                    <div key={i} className="item-card">
                      <div className="item-head">
                        <span className="font-medium text-zinc-700">{itemLabel} {i + 1}</span>
                        <span className="truncate text-zinc-400">{summarize(item)}</span>
                        <div className="ml-auto">{menu}</div>
                      </div>
                      <div className="grid gap-2 border-t border-zinc-100 p-2.5">
                        <ContentFields value={item} path={[...p, i]} actions={actions} />
                      </div>
                    </div>
                  )
                }
                return (
                  <Field key={i} label={`${itemLabel} ${i + 1}`} menu={menu}>
                    <PrimitiveEditor value={item} keyName={k} onChange={(nv) => actions.set([...p, i], nv)} />
                  </Field>
                )
              })}
              <button
                type="button"
                className="btn btn-ghost btn-sm w-fit text-zinc-500"
                onClick={() => {
                  const last = v[v.length - 1]
                  actions.insert(p, v.length, last === undefined ? (allPrimitive ? '' : {}) : typeof last === 'object' && last !== null ? clone(last) : last)
                }}
              >
                + {itemLabel}
              </button>
            </div>
          )
        }
        return (
          <Field key={k} label={humanize(k)} keyName={k}>
            <PrimitiveEditor value={v} keyName={k} onChange={(nv) => actions.set(p, nv)} />
          </Field>
        )
      })}
    </>
  )
}
