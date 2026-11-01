import { createContext, useContext, useState, type CSSProperties, type ReactNode } from 'react'
import { isObject, type Json, type JsonObject } from '~/lib/jsonPath'

/**
 * Frame preview that follows the Compose Multiplatform rendering contract
 * (ev-world-stories SDUI design, §3, §4, §6, §12, §13):
 *
 *  - 1080-du artboard; 1 du = 1 CSS px here, then the whole board is scaled.
 *  - z-order: background → art (pinned) → content column (240 / 72 / 300) → app chrome.
 *  - Header row 56 du (logo 50), then blocks top to bottom; SPACER(flex) absorbs
 *    the extra height on tall screens (extra_du = artboardHeight − 1920).
 *  - Colour tokens, story-level overrides, and the Exo 2 / DM Sans type ramp.
 *  - Glass is a plain 92% white fill, no blur, as in the app.
 *
 * It is still a preview: images come from the network, the countdown uses the
 * browser clock, and animations are shown in their resting state.
 */

export const ARTBOARD_W = 1080
export const ARTBOARD_H = 1920
const PAD_TOP = 240
const PAD_SIDE = 72
const PAD_BOTTOM = 300

const TOKENS: Record<string, string> = {
  canvas: '#F6F8FB',
  paper: '#FFFFFF',
  mist: '#EEF2F8',
  hair: '#E4E9F1',
  ink: '#16233A',
  navy: '#263D63',
  body: '#4B5974',
  mute: '#8A97AD',
  blue: '#4294FF',
  blueInk: '#1F66D0',
  pale: '#E8F0FF',
  paleStrong: '#D6E5FF',
  lime: '#87C445',
  limeInk: '#4E7F1A',
  limeBg: '#EEF7E4',
  glass: '#FFFFFFEB',
  glassBorder: '#FFFFFFCC',
}

const EXO = "'Exo 2', 'Segoe UI', sans-serif"
const DM = "'DM Sans', 'Segoe UI', sans-serif"

interface TextToken {
  font: string
  weight: number
  size: number
  lh: number
  tracking: number
  color: string
  tnum?: boolean
}

const TEXT_STYLES: Record<string, TextToken> = {
  XL: { font: EXO, weight: 500, size: 200, lh: 0.92, tracking: -0.03, color: 'ink', tnum: true },
  H1_LG: { font: EXO, weight: 500, size: 132, lh: 0.96, tracking: -0.022, color: 'ink' },
  H1: { font: EXO, weight: 500, size: 116, lh: 1.0, tracking: -0.022, color: 'ink' },
  H1_SM: { font: EXO, weight: 500, size: 100, lh: 1.02, tracking: -0.022, color: 'ink' },
  H2: { font: EXO, weight: 500, size: 84, lh: 1.04, tracking: -0.018, color: 'ink' },
  H3: { font: EXO, weight: 500, size: 58, lh: 1.1, tracking: -0.012, color: 'ink' },
  LEDE: { font: DM, weight: 400, size: 36, lh: 1.4, tracking: 0, color: 'body' },
  LEDE_INK: { font: DM, weight: 400, size: 36, lh: 1.4, tracking: 0, color: 'ink' },
  KICK: { font: DM, weight: 400, size: 30, lh: 1.3, tracking: 0, color: 'body' },
  NOTE: { font: DM, weight: 400, size: 24, lh: 1.35, tracking: 0, color: 'mute' },
  QUOTE: { font: DM, weight: 400, size: 46, lh: 1.3, tracking: -0.005, color: 'ink' },
  LIVE: { font: DM, weight: 500, size: 30, lh: 1.0, tracking: 0, color: 'ink' },
}

// ---------------------------------------------------------------------------
// Theme context: colour resolution with story overrides, glass flag, extra du.

interface Theme {
  colors: Record<string, string>
  extraDu: number
  now: Date
}

const ThemeCtx = createContext<Theme>({ colors: TOKENS, extraDu: 0, now: new Date() })

/** Path of the block being rendered (for click-to-select) and the selection callbacks. */
type Path = Array<string | number>
const PathCtx = createContext<Path>([])
const SelectCtx = createContext<{ onSelect?: (path: Path) => void; selected?: string }>({})

function useColor() {
  const t = useContext(ThemeCtx)
  return (ref: unknown, fallback = 'ink'): string => {
    const key = typeof ref === 'string' && ref ? ref : fallback
    return t.colors[key] ?? (key.startsWith('#') ? key : t.colors[fallback] ?? '#000')
  }
}

function num(v: unknown, d = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}
function str(v: unknown, d = ''): string {
  return typeof v === 'string' ? v : d
}
function withAlpha(hex: string, alpha: number) {
  const m = /^#([0-9a-f]{6})/i.exec(hex)
  if (!m) return hex
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0')
  return `#${m[1]}${a}`
}

/** §7.3 markup: `\n`, `**bold**` (500 weight, ink), NBSP/NB-hyphen pass through. */
function Markup({ text, boldColor }: { text: string; boldColor: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <span key={i} style={{ fontWeight: 500, color: boldColor }}>
            {p.slice(2, -2)}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Images (Coil equivalent): placeholder colour fills the slot while loading/on error.

function Img({
  img,
  fit = 'CROP',
  align = 'CENTER',
  style,
  radius,
}: {
  img: Json | undefined
  fit?: string
  align?: string
  style?: CSSProperties
  radius?: number
}) {
  const color = useColor()
  const ph = isObject(img) ? color(img.placeholderColor, 'mist') : color('mist')
  const url = isObject(img) && typeof img.url === 'string' && /^https?:\/\//.test(img.url) ? img.url : null
  const [failed, setFailed] = useState<string | null>(null)
  const position =
    align === 'BOTTOM_CENTER' ? 'center bottom' : align === 'TOP_CENTER' ? 'center top' : align === 'START' ? 'left center' : align === 'END' ? 'right center' : 'center'
  return (
    <div style={{ background: ph, borderRadius: radius, overflow: 'hidden', ...style }}>
      {url && failed !== url && (
        <img
          src={url}
          alt={isObject(img) ? str(img.alt) : ''}
          onError={() => setFailed(url)}
          style={{ width: '100%', height: '100%', objectFit: fit === 'FIT' ? 'contain' : 'cover', objectPosition: position, display: 'block' }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Frame layers

function Background({ bg, artH }: { bg: Json | undefined; artH: number }) {
  const color = useColor()
  if (!isObject(bg) || bg.type === 'SOLID' || !bg.type) {
    return <div style={{ position: 'absolute', inset: 0, background: color(isObject(bg) ? bg.color : 'canvas', 'canvas') }} />
  }
  if (bg.type === 'IMAGE') {
    return <Img img={bg.image} fit={str(bg.fit, 'CROP')} align={str(bg.align, 'CENTER')} style={{ position: 'absolute', inset: 0 }} />
  }
  if (bg.type === 'COLLAGE') {
    // Cells are given on the 1920 grid; y and h stretch with the artboard height (§3.2).
    const k = artH / ARTBOARD_H
    return (
      <div style={{ position: 'absolute', inset: 0, background: color(bg.gapColor, 'paper') }}>
        {Array.isArray(bg.cells) &&
          bg.cells.map((c, i) =>
            isObject(c) ? (
              <Img key={i} img={c.image} fit="CROP" style={{ position: 'absolute', left: num(c.x), top: num(c.y) * k, width: num(c.w), height: num(c.h) * k }} />
            ) : null,
          )}
      </div>
    )
  }
  return <div style={{ position: 'absolute', inset: 0, background: color('canvas') }} />
}

function ArtLayer({ art }: { art: Json | undefined }) {
  const color = useColor()
  const { extraDu } = useContext(ThemeCtx)
  if (!Array.isArray(art)) return null
  const extra = Math.max(0, extraDu)
  return (
    <>
      {art.map((a, i) => {
        if (!isObject(a)) return null
        const pin = str(a.pin, 'BOTTOM')
        const y = num(a.y) + (pin === 'TOP' ? 0 : pin === 'CENTER' ? extra / 2 : extra)
        const base: CSSProperties = {
          position: 'absolute',
          left: num(a.x),
          top: y,
          width: num(a.w),
          height: num(a.h),
          transform: a.rotation ? `rotate(${num(a.rotation)}deg)` : undefined,
        }
        if (a.type === 'DISC') return <div key={i} style={{ ...base, borderRadius: '50%', background: color(a.color, 'pale') }} />
        if (a.type === 'IMAGE') {
          return <Img key={i} img={a.image} fit={str(a.fit, 'FIT')} align={str(a.align, 'BOTTOM_CENTER')} style={{ ...base, background: 'transparent' }} />
        }
        return null
      })}
    </>
  )
}

function Header({ header, logo }: { header: JsonObject | null; logo: Json | undefined }) {
  const color = useColor()
  const style = header ? str(header.style, 'PLAIN') : 'PLAIN'
  const logoImg = header && isObject(header.logo) ? header.logo : logo
  if (style === 'HIDDEN') return <div style={{ height: 56, flexShrink: 0 }} />
  const glass = style === 'GLASS'
  const h = 50
  const w = isObject(logoImg) ? (h * num(logoImg.width, 436)) / Math.max(1, num(logoImg.height, 114)) : 190
  return (
    <div style={{ height: 56, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: glass ? '18px 32px' : 0,
          borderRadius: 999,
          background: glass ? color('glass') : 'transparent',
          border: glass ? `2px solid ${color('glassBorder')}` : undefined,
          marginLeft: glass ? -32 : 0,
        }}
      >
        <Img img={logoImg} fit="FIT" align="START" style={{ height: h, width: w, background: 'transparent' }} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Blocks

interface BlockProps {
  b: JsonObject
  onGlass: boolean
}

function alignSelf(v: unknown): CSSProperties['alignSelf'] {
  return v === 'CENTER' ? 'center' : v === 'END' ? 'flex-end' : v === 'START' ? 'flex-start' : undefined
}

/** Common block props (§6.0): marginTop, width, maxWidth, align. */
function Wrap({ b, children, style }: { b: JsonObject; children: ReactNode; style?: CSSProperties }) {
  const path = useContext(PathCtx)
  const sel = useContext(SelectCtx)
  const color = useColor()
  const w = b.width !== undefined ? num(b.width) : undefined
  const align = alignSelf(b.align) ?? (w !== undefined || b.maxWidth !== undefined ? 'flex-start' : undefined)
  const selected = sel.selected !== undefined && sel.selected === path.join('.')
  return (
    <div
      style={{
        marginTop: num(b.marginTop),
        width: w,
        maxWidth: b.maxWidth !== undefined ? num(b.maxWidth) : undefined,
        alignSelf: align,
        flexShrink: 0,
        minWidth: 0,
        cursor: sel.onSelect ? 'pointer' : undefined,
        outline: selected ? `6px solid ${color('blue')}` : undefined,
        outlineOffset: 10,
        borderRadius: selected ? 8 : undefined,
        ...style,
      }}
      onClick={
        sel.onSelect
          ? (e) => {
              e.stopPropagation()
              sel.onSelect!(path)
            }
          : undefined
      }
    >
      {children}
    </div>
  )
}

function textStyle(b: JsonObject, color: (r: unknown, f?: string) => string): CSSProperties {
  const tok = TEXT_STYLES[str(b.style)] ?? TEXT_STYLES.LEDE!
  const size = b.size !== undefined ? num(b.size) : tok.size
  const lh = b.lineHeight !== undefined ? num(b.lineHeight) : tok.lh
  return {
    fontFamily: tok.font,
    fontWeight: tok.weight,
    fontSize: size,
    lineHeight: lh,
    letterSpacing: `${tok.tracking}em`,
    color: color(b.color, tok.color),
    fontVariantNumeric: tok.tnum ? 'tabular-nums' : undefined,
    whiteSpace: 'pre-wrap',
    textAlign: b.textAlign === 'CENTER' ? 'center' : b.textAlign === 'END' ? 'right' : 'left',
  }
}

function TextBlock({ b }: BlockProps) {
  const color = useColor()
  const maxLines = b.maxLines !== undefined ? num(b.maxLines) : undefined
  const clamp: CSSProperties = maxLines
    ? { display: '-webkit-box', WebkitLineClamp: maxLines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
    : {}
  return (
    <Wrap b={b}>
      <div style={{ ...textStyle(b, color), ...clamp }}>
        <Markup text={str(b.text)} boldColor={color('ink')} />
      </div>
    </Wrap>
  )
}

function LiveDot() {
  const color = useColor()
  return <span style={{ width: 18, height: 18, borderRadius: 9, background: color('lime'), flexShrink: 0 }} />
}

function LiveBadge({ b }: BlockProps) {
  const color = useColor()
  const tok = TEXT_STYLES.LIVE!
  return (
    <Wrap b={b}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 16, fontFamily: tok.font, fontWeight: tok.weight, fontSize: tok.size, lineHeight: 1, color: color('ink') }}>
        <LiveDot />
        <span>{str(b.label, 'Live')}</span>
      </div>
    </Wrap>
  )
}

function cardPadding(p: Json | undefined, def: [number, number]): CSSProperties {
  if (p === 'FLUSH') return { padding: '0px 56px' }
  if (isObject(p)) return { paddingTop: num(p.top), paddingRight: num(p.end), paddingBottom: num(p.bottom), paddingLeft: num(p.start) }
  return { padding: `${def[0]}px ${def[1]}px` }
}

function Card({ b, children }: BlockProps & { children: ReactNode }) {
  const color = useColor()
  return (
    <Wrap b={b}>
      <div style={{ background: color('paper'), borderRadius: 48, border: `2px solid ${color('hair')}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', ...cardPadding(b.padding, [44, 56]) }}>
        {children}
      </div>
    </Wrap>
  )
}

function GlassPanel({ b, children }: BlockProps & { children: ReactNode }) {
  const color = useColor()
  return (
    <Wrap b={b}>
      <div style={{ background: color(b.fill, 'glass'), border: `2px solid ${color(b.border, 'glassBorder')}`, borderRadius: 48, padding: '48px 56px', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </Wrap>
  )
}

function Divider({ onGlass, inset = 0 }: { onGlass: boolean; inset?: number }) {
  const color = useColor()
  return <div style={{ height: 2, background: onGlass ? withAlpha(color('ink'), 0.12) : color('hair'), marginLeft: inset, marginRight: inset, flexShrink: 0 }} />
}

function KvList({ b, onGlass }: BlockProps) {
  const color = useColor()
  const rows = Array.isArray(b.rows) ? b.rows.filter(isObject) : []
  const stacked = b.variant === 'STACKED'
  return (
    <Wrap b={b}>
      {rows.map((r, i) => (
        <div key={i}>
          {i > 0 && <Divider onGlass={onGlass} />}
          {stacked ? (
            <div style={{ padding: '20px 0 22px' }}>
              <div style={{ fontFamily: DM, fontSize: 26, lineHeight: 1.3, color: color('body') }}>{str(r.label)}</div>
              <div style={{ fontFamily: DM, fontWeight: 500, fontSize: 32, lineHeight: 1.3, color: color('ink') }}>{str(r.value)}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 24, padding: '26px 0' }}>
              <span style={{ fontFamily: DM, fontSize: 30, color: color('body'), whiteSpace: 'nowrap' }}>{str(r.label)}</span>
              <span style={{ fontFamily: DM, fontWeight: 500, fontSize: 32, color: color('ink'), textAlign: 'right' }}>{str(r.value)}</span>
            </div>
          )}
        </div>
      ))}
    </Wrap>
  )
}

function StatGrid({ b, onGlass }: BlockProps) {
  const color = useColor()
  const cols = num(b.columns, 2) === 3 ? 3 : 2
  const valueSize = b.valueSize !== undefined ? num(b.valueSize) : cols === 3 ? 96 : 112
  const labelSize = cols === 3 ? 25 : 26
  const items = Array.isArray(b.items) ? b.items.filter(isObject) : []
  const rows: JsonObject[][] = []
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols))
  return (
    <Wrap b={b}>
      {rows.map((row, ri) => (
        <div key={ri}>
          {ri > 0 && <Divider onGlass={onGlass} />}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 24, padding: '36px 0 30px' }}>
            {row.map((s, i) => (
              <div key={i}>
                <div style={{ fontFamily: EXO, fontWeight: 500, fontSize: valueSize, lineHeight: 0.96, letterSpacing: '-0.022em', fontVariantNumeric: 'tabular-nums', color: s.highlight ? color('blueInk') : color('ink') }}>
                  {str(s.value)}
                </div>
                <div style={{ fontFamily: DM, fontSize: labelSize, lineHeight: 1.3, color: color('body'), marginTop: 10 }}>{str(s.label)}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Wrap>
  )
}

function Highlight({ b, onGlass }: BlockProps) {
  const color = useColor()
  return (
    <Wrap b={b}>
      <Divider onGlass={onGlass} />
      <div style={{ paddingTop: 30 }}>
        <div style={{ fontFamily: DM, fontSize: 26, color: color('mute') }}>{str(b.label)}</div>
        <div style={{ fontFamily: DM, fontWeight: 500, fontSize: 34, lineHeight: 1.3, color: color('ink'), marginTop: 8 }}>{str(b.value)}</div>
        <Img img={b.image} fit="CROP" style={{ height: num(b.imageHeight, 220), marginTop: 24 }} radius={32} />
      </div>
    </Wrap>
  )
}

function BarChart({ b, onGlass }: BlockProps) {
  const color = useColor()
  const bars = Array.isArray(b.bars) ? b.bars.filter(isObject) : []
  const max = Math.max(1, ...bars.map((x) => num(x.value)))
  const tallest = 144
  const h = num(b.height, 250)
  return (
    <Wrap b={b}>
      <Divider onGlass={onGlass} />
      <div style={{ paddingTop: 30 }}>
        {b.title ? <div style={{ fontFamily: DM, fontWeight: 500, fontSize: 28, color: color('ink') }}>{str(b.title)}</div> : null}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, bars.length)}, 1fr)`, height: h, alignItems: 'end', marginTop: 16 }}>
          {bars.map((x, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
              <span style={{ fontFamily: EXO, fontWeight: 500, fontSize: 34, color: color('ink'), marginBottom: 12 }}>{str(x.display, String(num(x.value)))}</span>
              <div style={{ width: 168, height: Math.max(6, (num(x.value) / max) * tallest), background: color(b.barColor, 'blue'), borderRadius: '18px 18px 0 0' }} />
            </div>
          ))}
        </div>
        <Divider onGlass={onGlass} />
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, bars.length)}, 1fr)`, marginTop: 14 }}>
          {bars.map((x, i) => (
            <div key={i} style={{ textAlign: 'center', fontFamily: DM, fontSize: 25, color: color('body') }}>{str(x.label)}</div>
          ))}
        </div>
      </div>
    </Wrap>
  )
}

function ChargeBarInner({ progress, showPercent, width }: { progress: number; showPercent: boolean; width?: number }) {
  const color = useColor()
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 28, width }}>
      <div style={{ flex: 1, height: 24, borderRadius: 12, background: color('mist'), border: `2px solid ${color('hair')}`, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color('lime'), borderRadius: 12 }} />
      </div>
      {showPercent && (
        <span style={{ fontFamily: EXO, fontWeight: 500, fontSize: 36, minWidth: 116, color: color('ink'), fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
      )}
    </div>
  )
}

function ChargeBar({ b }: BlockProps) {
  return (
    <Wrap b={b}>
      <ChargeBarInner progress={num(b.progress, 0)} showPercent={b.showPercent !== false} width={b.width !== undefined ? num(b.width) : undefined} />
    </Wrap>
  )
}

function DayProgress({ b }: BlockProps) {
  const color = useColor()
  const current = num(b.current, 1)
  const total = Math.max(1, num(b.total, 3))
  return (
    <Wrap b={b}>
      <div style={{ fontFamily: EXO, fontWeight: 500, fontSize: 88, lineHeight: 1, letterSpacing: '-0.018em', color: color('ink') }}>{str(b.word, 'Day')}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 32 }}>
        <span style={{ fontFamily: EXO, fontWeight: 500, fontSize: 620, lineHeight: 0.86, letterSpacing: '-0.04em', color: color('ink'), fontVariantNumeric: 'tabular-nums' }}>{current}</span>
        <span style={{ fontFamily: EXO, fontWeight: 500, fontSize: 64, color: color('body') }}>{str(b.suffix, `of ${total}`)}</span>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 28 }}>
        {Array.from({ length: total }, (_, i) => (
          <div key={i} style={{ width: 140, height: 44, borderRadius: 12, background: i < current ? color('lime') : color('mist'), border: `2px solid ${i < current ? color('lime') : color('hair')}` }} />
        ))}
      </div>
    </Wrap>
  )
}

// §13.1 countdown computed in the event timezone from "now".
function countdown(now: Date, target: string, start: string, zone: string): { days: number; pct: number } {
  let today: string
  try {
    today = new Intl.DateTimeFormat('en-CA', { timeZone: zone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  } catch {
    today = now.toISOString().slice(0, 10)
  }
  const d = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
  const DAY = 86_400_000
  const days = Math.max(0, Math.round((d(target) - d(today)) / DAY))
  const total = Math.max(1, Math.round((d(target) - d(start)) / DAY))
  const pct = days === 0 ? 100 : Math.max(0, Math.min(100, Math.round((1 - days / total) * 100)))
  return { days: Number.isFinite(days) ? days : 0, pct: Number.isFinite(pct) ? pct : 0 }
}

function Countdown({ b }: BlockProps) {
  const color = useColor()
  const { now } = useContext(ThemeCtx)
  const labels = isObject(b.labels) ? b.labels : {}
  const isStatic = b.mode === 'STATIC'
  const live = countdown(now, str(b.target), str(b.progressStart, str(b.target)), str(b.timeZone, 'Asia/Dubai'))
  const days = live.days
  const pct = isStatic ? Math.round(num(b.staticProgress, 1) * 100) : live.pct
  const value = isStatic ? str(b.staticValue, '') : days === 0 ? str(labels.todayValue, 'Today') : String(days)
  const unit = isStatic ? '' : days === 0 ? str(labels.todayUnit) : days === 1 ? str(labels.unitOne, 'day to go') : str(labels.unitOther, 'days to go')
  const status = isStatic ? '' : days === 0 ? str(labels.statusDone) : str(labels.status).replace('{pct}', String(pct))

  if (b.style === 'NUMERAL_BAR') {
    return (
      <Wrap b={b}>
        <div style={{ fontFamily: EXO, fontWeight: 500, fontSize: 540, lineHeight: 0.86, letterSpacing: '-0.04em', color: color('ink'), fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        {unit && <div style={{ ...textStyle({ style: 'H2' }, color), color: color('body') }}>{unit}</div>}
        <div style={{ marginTop: 60 }}>
          <ChargeBarInner progress={pct / 100} showPercent />
        </div>
      </Wrap>
    )
  }

  const ring = isObject(b.ring) ? b.ring : {}
  const dia = num(ring.diameter, 600)
  const ticks = Math.max(1, num(ring.ticks, 72))
  const lit = Math.round((ticks * pct) / 100)
  const c = dia / 2
  const rIn = (266 / 600) * dia
  const rOut = (296 / 600) * dia
  return (
    <Wrap b={b} style={{ alignSelf: alignSelf(b.align) ?? 'center' }}>
      <div style={{ position: 'relative', width: dia, height: dia, margin: '0 auto' }}>
        <svg width={dia} height={dia} viewBox={`0 0 ${dia} ${dia}`} style={{ position: 'absolute', inset: 0 }}>
          {Array.from({ length: ticks }, (_, i) => {
            const a = ((i * 360) / ticks - 90) * (Math.PI / 180)
            return (
              <line
                key={i}
                x1={c + rIn * Math.cos(a)}
                y1={c + rIn * Math.sin(a)}
                x2={c + rOut * Math.cos(a)}
                y2={c + rOut * Math.sin(a)}
                stroke={i < lit ? color('lime') : color('hair')}
                strokeWidth={9}
                strokeLinecap="round"
              />
            )
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ fontFamily: EXO, fontWeight: 500, fontSize: days === 0 && !isStatic ? 132 : 270, lineHeight: 0.92, letterSpacing: '-0.03em', color: color('ink'), fontVariantNumeric: 'tabular-nums' }}>{value}</div>
          {unit && <div style={{ fontFamily: DM, fontSize: 30, color: color('body'), marginTop: 12 }}>{unit}</div>}
        </div>
      </div>
      {b.title ? <div style={{ ...textStyle({ style: 'H2', textAlign: 'CENTER' }, color), marginTop: 48 }}>{str(b.title)}</div> : null}
      {status ? <div style={{ fontFamily: DM, fontSize: 30, lineHeight: 1.3, color: color('body'), textAlign: 'center', marginTop: 16 }}>{status}</div> : null}
    </Wrap>
  )
}

function List({ b, onGlass }: BlockProps) {
  const color = useColor()
  const items = Array.isArray(b.items) ? b.items.filter(isObject) : []
  const leading = str(b.leading, 'NONE')
  const density = str(b.density, 'REGULAR')
  const pad = density === 'COMPACT' ? 16 : density === 'ROOMY' ? 30 : 26
  const titleSize = density === 'COMPACT' ? 31 : 34
  const subSize = density === 'COMPACT' ? 25 : 28
  return (
    <Wrap b={b}>
      {items.map((it, i) => (
        <div key={i}>
          {i > 0 && <Divider onGlass={onGlass} />}
          <div style={{ display: 'flex', alignItems: 'center', gap: 28, padding: `${pad}px 0` }}>
            {leading === 'TIME' && (
              <span style={{ width: 132, flexShrink: 0, fontFamily: EXO, fontWeight: 500, fontSize: 42, color: color('blueInk'), fontVariantNumeric: 'tabular-nums' }}>{str(it.leadingText)}</span>
            )}
            {leading === 'NUMBER' && (
              <span style={{ width: 84, height: 84, borderRadius: 42, flexShrink: 0, background: color('navy'), color: '#fff', fontFamily: EXO, fontWeight: 500, fontSize: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {str(it.leadingText)}
              </span>
            )}
            {leading === 'LOGO' && (
              <div style={{ width: 200, height: 100, flexShrink: 0, borderRadius: 24, background: color('canvas'), border: `2px solid ${color('hair')}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Img img={it.leadingImage} fit="FIT" style={{ width: 156, height: 60, background: 'transparent' }} />
              </div>
            )}
            {leading === 'IMAGE' && <Img img={it.leadingImage} fit="CROP" style={{ width: 200, height: 100, flexShrink: 0 }} radius={24} />}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: DM, fontWeight: 500, fontSize: titleSize, lineHeight: 1.25, color: color('ink') }}>{str(it.title)}</div>
              {it.subtitle ? <div style={{ fontFamily: DM, fontSize: subSize, lineHeight: 1.3, color: color('body'), marginTop: 4 }}>{str(it.subtitle)}</div> : null}
            </div>
          </div>
        </div>
      ))}
    </Wrap>
  )
}

function TextLines({ b, onGlass }: BlockProps) {
  const color = useColor()
  const items = Array.isArray(b.items) ? b.items.map((x) => str(x)) : []
  return (
    <Wrap b={b}>
      {items.map((t, i) => (
        <div key={i}>
          {i > 0 && <Divider onGlass={onGlass} />}
          <div style={{ fontFamily: DM, fontSize: 27, lineHeight: 1.4, color: color('body'), padding: '18px 0', whiteSpace: 'pre-wrap' }}>
            <Markup text={t} boldColor={color('ink')} />
          </div>
        </div>
      ))}
    </Wrap>
  )
}

function Chips({ b }: BlockProps) {
  const color = useColor()
  return (
    <Wrap b={b}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {Array.isArray(b.items) &&
          b.items.map((c, i) => (
            <span key={i} style={{ height: 64, padding: '0 28px', borderRadius: 32, background: color('mist'), display: 'inline-flex', alignItems: 'center', fontFamily: DM, fontWeight: 500, fontSize: 27, color: color('ink') }}>
              {str(c)}
            </span>
          ))}
      </div>
    </Wrap>
  )
}

function ProductGrid({ b }: BlockProps) {
  const color = useColor()
  const cols = num(b.columns, 3)
  const iw = num(b.imageWidth, 240)
  const ih = num(b.imageHeight, 200)
  const items = Array.isArray(b.items) ? b.items.filter(isObject) : []
  return (
    <Wrap b={b}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 24 }}>
        {items.map((it, i) => (
          <div key={i} style={{ background: color('paper'), borderRadius: 32, border: `2px solid ${color('hair')}`, padding: '24px 20px 22px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Img img={it.image} fit="FIT" align="BOTTOM_CENTER" style={{ width: iw, maxWidth: '100%', height: ih, background: 'transparent' }} />
            <div style={{ fontFamily: DM, fontWeight: 500, fontSize: 28, color: color('ink'), marginTop: 18, textAlign: 'center' }}>{str(it.title)}</div>
            {it.subtitle ? <div style={{ fontFamily: DM, fontSize: 24, color: color('body'), marginTop: 4, textAlign: 'center' }}>{str(it.subtitle)}</div> : null}
          </div>
        ))}
      </div>
    </Wrap>
  )
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

function PeopleGrid({ b }: BlockProps) {
  const color = useColor()
  const cols = num(b.columns, 2)
  const size = num(b.portraitSize, 230)
  const items = Array.isArray(b.items) ? b.items.filter(isObject) : []
  return (
    <Wrap b={b}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 32, rowGap: 40 }}>
        {items.map((p, i) => {
          const hasPortrait = isObject(p.portrait) && typeof p.portrait.url === 'string' && /^https?:/.test(p.portrait.url)
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              {hasPortrait ? (
                <Img img={p.portrait} fit="CROP" style={{ width: size, height: size }} radius={size / 2} />
              ) : (
                <div style={{ width: size, height: size, borderRadius: size / 2, background: color('mist'), display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: EXO, fontWeight: 500, fontSize: size * 0.34, color: color('navy') }}>
                  {initials(str(p.name))}
                </div>
              )}
              <div style={{ fontFamily: DM, fontWeight: 500, fontSize: 32, color: color('ink'), marginTop: 20 }}>{str(p.name)}</div>
              <div style={{ fontFamily: DM, fontSize: 26, color: color('body'), marginTop: 4 }}>{str(p.role)}</div>
            </div>
          )
        })}
      </div>
    </Wrap>
  )
}

function LogoTiles({ b }: BlockProps) {
  const color = useColor()
  const cols = num(b.columns, 2)
  const th = num(b.tileHeight, 204)
  const items = Array.isArray(b.items) ? b.items.filter(isObject) : []
  return (
    <Wrap b={b}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 24 }}>
        {items.map((t, i) => (
          <div key={i} style={{ height: th, background: color('paper'), borderRadius: 32, border: `2px solid ${color('hair')}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '0 24px' }}>
            <Img img={t.logo} fit="FIT" style={{ width: 300, maxWidth: '100%', height: 104, background: 'transparent' }} />
            {t.caption ? <div style={{ fontFamily: DM, fontSize: 26, color: color('body') }}>{str(t.caption)}</div> : null}
          </div>
        ))}
      </div>
    </Wrap>
  )
}

function PartnerLockup({ b }: BlockProps) {
  const color = useColor()
  const left = isObject(b.left) ? b.left : undefined
  const lw = left ? (50 * num(left.width, 436)) / Math.max(1, num(left.height, 114)) : 190
  return (
    <Wrap b={b}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <Img img={left} fit="FIT" align="START" style={{ height: 50, width: lw, background: 'transparent' }} />
        <span style={{ fontFamily: DM, fontSize: 44, color: color('mute') }}>{str(b.separator, '×')}</span>
        <div style={{ width: 240, height: 104, borderRadius: 24, background: color('paper'), border: `2px solid ${color('hair')}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Img img={b.right} fit="FIT" style={{ width: 196, height: 66, background: 'transparent' }} />
        </div>
      </div>
    </Wrap>
  )
}

function Testimonial({ b }: BlockProps) {
  const color = useColor()
  const q = TEXT_STYLES.QUOTE!
  const hasPortrait = isObject(b.portrait) && typeof b.portrait.url === 'string'
  return (
    <Wrap b={b}>
      <div style={{ fontFamily: q.font, fontSize: q.size, lineHeight: q.lh, letterSpacing: `${q.tracking}em`, color: color('ink'), whiteSpace: 'pre-wrap' }}>“{str(b.quote)}”</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginTop: 28 }}>
        {hasPortrait && <Img img={b.portrait} fit="CROP" style={{ width: 92, height: 92, flexShrink: 0 }} radius={46} />}
        <div>
          <div style={{ fontFamily: DM, fontWeight: 500, fontSize: 30, color: color('ink') }}>{str(b.name)}</div>
          <div style={{ fontFamily: DM, fontSize: 26, color: color('body') }}>{str(b.role)}</div>
        </div>
      </div>
    </Wrap>
  )
}

function ImageBlock({ b }: BlockProps) {
  const color = useColor()
  const shape = str(b.shape, 'RECT')
  const w = b.width !== undefined ? num(b.width) : undefined
  const h = b.height !== undefined ? num(b.height) : undefined
  const radius = shape === 'CIRCLE' ? 9999 : shape === 'ROUNDED' ? num(b.cornerRadius, 32) : 0
  return (
    <Wrap b={b}>
      <Img
        img={b.image}
        fit={str(b.fit, 'CROP')}
        align={str(b.align, 'CENTER')}
        radius={radius}
        style={{
          width: w ?? '100%',
          height: h ?? (w !== undefined && isObject(b.image) ? (w * num(b.image.height, 1)) / Math.max(1, num(b.image.width, 1)) : 400),
          background: b.background ? color(b.background) : undefined,
          border: b.border ? `2px solid ${color(b.border, 'hair')}` : undefined,
          boxSizing: 'border-box',
        }}
      />
    </Wrap>
  )
}

function Collage({ b }: BlockProps) {
  const w = num(b.width, ARTBOARD_W - PAD_SIDE * 2)
  const h = num(b.height, 640)
  const r = num(b.cornerRadius, 32)
  return (
    <Wrap b={b}>
      <div style={{ position: 'relative', width: w, height: h }}>
        {Array.isArray(b.cells) &&
          b.cells.map((c, i) =>
            isObject(c) ? <Img key={i} img={c.image} fit="CROP" radius={r} style={{ position: 'absolute', left: num(c.x), top: num(c.y), width: num(c.w), height: num(c.h) }} /> : null,
          )}
      </div>
    </Wrap>
  )
}

function Carousel({ b }: BlockProps) {
  const color = useColor()
  const iw = num(b.itemWidth, 660)
  const ih = num(b.itemHeight, 640)
  const gap = num(b.gap, 24)
  const items = Array.isArray(b.items) ? b.items.filter(isObject) : []
  const bleed = b.bleedEnd !== false
  return (
    <Wrap b={b}>
      <div style={{ display: 'flex', gap, marginRight: bleed ? -PAD_SIDE : 0, overflow: 'hidden' }}>
        {items.map((it, i) => (
          <Img key={i} img={it.image} fit="CROP" radius={32} style={{ width: iw, height: ih, flexShrink: 0 }} />
        ))}
      </div>
      {b.indicator !== 'NONE' && items.length > 1 && (
        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          {items.map((_, i) => (
            <span key={i} style={{ width: i === 0 ? 36 : 12, height: 12, borderRadius: 6, background: i === 0 ? color('navy') : color('hair') }} />
          ))}
        </div>
      )}
    </Wrap>
  )
}

function DotMatrix({ b }: BlockProps) {
  const cols = num(b.columns, 15)
  const rows = num(b.rows, 9)
  const d = num(b.dotDiameter, 20)
  const pitch = num(b.pitch, 56)
  const palette = Array.isArray(b.palette) ? b.palette.map((p) => str(p, '#263D63')) : ['#263D63', '#4294FF']
  const cells: Array<[number, number]> = []
  if (typeof b.cells === 'string') {
    for (let i = 0; i + 1 < b.cells.length; i += 2) cells.push([parseInt(b.cells[i]!, 16) || 0, (parseInt(b.cells[i + 1]!, 16) || 0) / 15])
  } else if (Array.isArray(b.cells)) {
    for (const c of b.cells) if (Array.isArray(c)) cells.push([num(c[0]), num(c[1]) <= 1 ? num(c[1]) : num(c[1]) / 15])
  }
  const w = (cols - 1) * pitch + d
  const h = (rows - 1) * pitch + d
  return (
    <Wrap b={b}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', margin: '0 auto' }}>
        {Array.from({ length: rows * cols }, (_, i) => {
          const cell = cells[i] ?? [0, 0.25]
          const r = Math.floor(i / cols)
          const c = i % cols
          return <circle key={i} cx={c * pitch + d / 2} cy={r * pitch + d / 2} r={d / 2} fill={palette[cell[0]] ?? palette[0]} opacity={cell[1]} />
        })}
      </svg>
    </Wrap>
  )
}

function HallMap({ b }: BlockProps) {
  const color = useColor()
  const cols = num(b.columns, 7)
  const rows = num(b.rows, 5)
  const cw = num(b.cellWidth, 92)
  const ch = num(b.cellHeight, 72)
  const gx = num(b.gapX, 16)
  const gy = num(b.gapY, 16)
  const r = num(b.cornerRadius, 14)
  const hl = isObject(b.highlight) ? b.highlight : null
  return (
    <Wrap b={b}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, ${cw}px)`, gap: `${gy}px ${gx}px`, justifyContent: 'center' }}>
        {Array.from({ length: rows * cols }, (_, i) => {
          const rr = Math.floor(i / cols)
          const cc = i % cols
          const on = hl && num(hl.column) === cc && num(hl.row) === rr
          return (
            <div key={i} style={{ width: cw, height: ch, borderRadius: r, background: on ? color('navy') : color('mist'), color: '#fff', fontFamily: DM, fontWeight: 500, fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {on ? str(hl!.label) : ''}
            </div>
          )
        })}
      </div>
    </Wrap>
  )
}

function Poll({ b }: BlockProps) {
  const color = useColor()
  const options = Array.isArray(b.options) ? b.options.filter(isObject) : []
  return (
    <Wrap b={b}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {options.map((o, i) => (
          <div key={i} style={{ height: 112, borderRadius: 56, background: color('mist'), display: 'flex', alignItems: 'center', padding: '0 44px', fontFamily: DM, fontWeight: 500, fontSize: 32, color: color('ink') }}>
            {str(o.label)}
          </div>
        ))}
      </div>
      {b.prompt ? <div style={{ fontFamily: DM, fontSize: 26, color: color('mute'), marginTop: 24, textAlign: 'center' }}>{str(b.prompt)}</div> : null}
    </Wrap>
  )
}

function CtaGroup({ b }: BlockProps) {
  const color = useColor()
  const buttons = Array.isArray(b.buttons) ? b.buttons.filter(isObject) : []
  return (
    <Wrap b={b}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        {buttons.map((btn, i) => {
          const s = str(btn.style, 'PRIMARY')
          const base: CSSProperties = {
            height: 112,
            borderRadius: 56,
            padding: '0 60px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: DM,
            fontWeight: 500,
            fontSize: 34,
            whiteSpace: 'nowrap',
            boxSizing: 'border-box',
          }
          const look: CSSProperties =
            s === 'GHOST'
              ? { background: 'transparent', color: color('navy'), boxShadow: `inset 0 0 0 3px ${color('navy')}` }
              : s === 'WHITE'
                ? { background: color('paper'), color: color('ink') }
                : { background: color('navy'), color: '#FFFFFF' }
          return (
            <span key={i} style={{ ...base, ...look }}>
              {str(btn.label, 'Button')}
            </span>
          )
        })}
      </div>
    </Wrap>
  )
}

function FooterRail({ b, onGlass }: BlockProps) {
  const color = useColor()
  const glass = onGlass || b.onGlass === true
  return (
    <Wrap b={b}>
      <div style={{ borderTop: `2px solid ${glass ? withAlpha(color('ink'), 0.12) : color('hair')}`, paddingTop: 28, display: 'flex', justifyContent: 'space-between', gap: 24, fontFamily: DM, fontSize: 26, lineHeight: 1.2 }}>
        <span style={{ color: color('body'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{str(b.start)}</span>
        <span style={{ color: color('mute'), flexShrink: 0 }}>{str(b.end)}</span>
      </div>
    </Wrap>
  )
}

function Unknown({ b }: BlockProps) {
  const color = useColor()
  return (
    <Wrap b={b}>
      <div style={{ border: `2px dashed ${color('mute')}`, borderRadius: 24, padding: 20, fontFamily: DM, fontSize: 24, color: color('mute') }}>
        Unknown block {str(b.type, '?')} ({b.required ? 'required: frame would be dropped' : 'skipped by the app'})
      </div>
    </Wrap>
  )
}

export function Block({ block, onGlass = false, path = [] }: { block: Json; onGlass?: boolean; path?: Path }) {
  if (!isObject(block)) return null
  return (
    <PathCtx.Provider value={path}>
      <BlockInner b={block} onGlass={onGlass} path={path} />
    </PathCtx.Provider>
  )
}

function BlockInner({ b, onGlass, path }: { b: JsonObject; onGlass: boolean; path: Path }) {
  const p = { b, onGlass }
  switch (b.type) {
    case 'SPACER':
      return b.flex === false ? <div style={{ height: num(b.height), flexShrink: 0 }} /> : <div style={{ flex: '1 1 0', minHeight: 0 }} />
    case 'TEXT':
      return <TextBlock {...p} />
    case 'LIVE_BADGE':
      return <LiveBadge {...p} />
    case 'TEXT_LINES':
      return <TextLines {...p} />
    case 'CHIPS':
      return <Chips {...p} />
    case 'CARD':
      return (
        <Card {...p}>
          {Array.isArray(b.children) && b.children.map((c, i) => <Block key={i} block={c} onGlass={false} path={[...path, 'children', i]} />)}
        </Card>
      )
    case 'GLASS_PANEL':
      return (
        <GlassPanel {...p}>
          {Array.isArray(b.children) && b.children.map((c, i) => <Block key={i} block={c} onGlass path={[...path, 'children', i]} />)}
        </GlassPanel>
      )
    case 'KV_LIST':
      return <KvList {...p} />
    case 'STAT_GRID':
      return <StatGrid {...p} />
    case 'HIGHLIGHT':
      return <Highlight {...p} />
    case 'BAR_CHART':
      return <BarChart {...p} />
    case 'CHARGE_BAR':
      return <ChargeBar {...p} />
    case 'DAY_PROGRESS':
      return <DayProgress {...p} />
    case 'COUNTDOWN':
      return <Countdown {...p} />
    case 'LIST':
      return <List {...p} />
    case 'PRODUCT_GRID':
      return <ProductGrid {...p} />
    case 'PEOPLE_GRID':
      return <PeopleGrid {...p} />
    case 'LOGO_TILES':
      return <LogoTiles {...p} />
    case 'PARTNER_LOCKUP':
      return <PartnerLockup {...p} />
    case 'TESTIMONIAL':
      return <Testimonial {...p} />
    case 'IMAGE':
      return <ImageBlock {...p} />
    case 'COLLAGE':
      return <Collage {...p} />
    case 'CAROUSEL':
      return <Carousel {...p} />
    case 'DOT_MATRIX':
      return <DotMatrix {...p} />
    case 'HALL_MAP':
      return <HallMap {...p} />
    case 'POLL':
      return <Poll {...p} />
    case 'CTA_GROUP':
      return <CtaGroup {...p} />
    case 'FOOTER_RAIL':
      return <FooterRail {...p} />
    default:
      return <Unknown {...p} />
  }
}

// ---------------------------------------------------------------------------
// App-owned story chrome (§3.3): progress segments and the title row.

function Chrome({ index, count, title, cover, light }: { index: number; count: number; title: string; cover: Json | undefined; light: boolean }) {
  const color = useColor()
  const fg = light ? '#FFFFFF' : color('ink')
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', top: 64, left: 40, right: 40, display: 'flex', gap: 8 }}>
        {Array.from({ length: Math.max(1, count) }, (_, i) => (
          <div key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: withAlpha(fg, 0.28), overflow: 'hidden' }}>
            <div style={{ width: i < index ? '100%' : i === index ? '45%' : '0%', height: '100%', background: fg }} />
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', top: 92, left: 40, right: 40, display: 'flex', alignItems: 'center', gap: 20 }}>
        <Img img={cover} fit="CROP" style={{ width: 64, height: 64, flexShrink: 0 }} radius={32} />
        <span style={{ fontFamily: DM, fontWeight: 500, fontSize: 30, color: fg, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span style={{ marginLeft: 'auto', fontFamily: DM, fontSize: 26, color: withAlpha(fg, 0.7), fontVariantNumeric: 'tabular-nums' }}>
          {index + 1}/{count}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

export interface FramePreviewProps {
  frame: JsonObject
  story?: JsonObject
  /** Rendered width in CSS px; the 1080-du artboard is scaled to fit. */
  width?: number
  /** Artboard height in du. 1920 is the design; taller values show spacer/pin behaviour. */
  artboardHeight?: number
  showChrome?: boolean
  frameIndex?: number
  frameCount?: number
  now?: Date
  /** Document path of `frame.content`, used to report clicked blocks. */
  basePath?: Path
  onBlockClick?: (path: Path) => void
  /** Path key (joined with '.') of the block to highlight. */
  selectedPath?: string
}

export function FramePreview({ frame, story, width = 300, artboardHeight = ARTBOARD_H, showChrome = true, frameIndex = 0, frameCount = 1, now, basePath = [], onBlockClick, selectedPath }: FramePreviewProps) {
  const scale = width / ARTBOARD_W
  const artH = Math.max(ARTBOARD_H, artboardHeight)
  const overrides = story && isObject(story.theme) && isObject(story.theme.colors) ? story.theme.colors : {}
  const colors: Record<string, string> = { ...TOKENS }
  for (const [k, v] of Object.entries(overrides)) if (typeof v === 'string') colors[k] = colors[v] ?? v
  const theme: Theme = { colors, extraDu: artH - ARTBOARD_H, now: now ?? new Date() }

  const defaults = story && isObject(story.defaults) ? story.defaults : {}
  const defaultHeader = isObject(defaults.header) ? defaults.header : null
  const header = isObject(frame.header) ? { ...(defaultHeader ?? {}), ...frame.header } : defaultHeader
  const photo = frame.layout === 'PHOTO' || (isObject(frame.background) && frame.background.type !== 'SOLID')

  return (
    <ThemeCtx.Provider value={theme}>
    <SelectCtx.Provider value={{ onSelect: onBlockClick, selected: selectedPath }}>
      <div style={{ width, height: artH * scale, position: 'relative', overflow: 'hidden', borderRadius: 28, boxShadow: '0 1px 2px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)', background: colors.canvas }}>
        <div
          style={{
            width: ARTBOARD_W,
            height: artH,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            position: 'absolute',
            left: 0,
            top: 0,
            overflow: 'hidden',
            color: colors.ink,
            fontFamily: DM,
          }}
        >
          <Background bg={frame.background} artH={artH} />
          <ArtLayer art={frame.art} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'stretch', padding: `${PAD_TOP}px ${PAD_SIDE}px ${PAD_BOTTOM}px`, boxSizing: 'border-box' }}>
            <Header header={header} logo={defaultHeader?.logo} />
            {Array.isArray(frame.content) && frame.content.map((b, i) => <Block key={i} block={b} path={[...basePath, i]} />)}
          </div>
          {showChrome && <Chrome index={frameIndex} count={frameCount} title={story ? str(story.title) : ''} cover={story?.cover} light={photo} />}
        </div>
      </div>
    </SelectCtx.Provider>
    </ThemeCtx.Provider>
  )
}
