import { z } from 'zod'
import type { Json, JsonObject } from './jsonPath'

/** Loose but useful validation of a story document. Unknown keys are kept. */
const imageSchema = z
  .object({
    url: z.string().min(1, 'url is required'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    alt: z.string(),
  })
  .passthrough()

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/, 'expected ISO date like 2026-11-10T10:00:00+04:00')

const windowSchema = z.object({ from: isoDate.optional(), until: isoDate.optional() }).passthrough()

export const frameSchema = z
  .object({
    id: z.string().min(1, 'id is required'),
    templateId: z.string().min(1),
    templateVersion: z.number().int(),
    layout: z.enum(['CANVAS', 'PHOTO']),
    phase: z.enum(['PRE', 'DURING', 'POST']),
    title: z.string(),
    availability: windowSchema,
    background: z.object({ type: z.string() }).passthrough(),
    content: z.array(z.object({ type: z.string() }).passthrough()),
    art: z.array(z.object({ type: z.string() }).passthrough()).optional(),
    header: z.object({}).passthrough().optional(),
  })
  .passthrough()

export const storySchema = z
  .object({
    id: z.string().min(1),
    campaignId: z.string().min(1),
    surface: z.string(),
    priority: z.number().int(),
    title: z.string(),
    subtitle: z.string(),
    locale: z.string(),
    cover: imageSchema,
    live: windowSchema,
    theme: z.object({}).passthrough(),
    defaults: z.object({ durationMs: z.number().int().positive() }).passthrough(),
    frames: z.array(frameSchema),
    version: z.number().int(),
  })
  .passthrough()
  .superRefine((doc, ctx) => {
    const seen = new Map<string, number>()
    doc.frames.forEach((f, i) => {
      if (seen.has(f.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['frames', i, 'id'],
          message: `duplicate frame id "${f.id}" (also frame ${seen.get(f.id)! + 1})`,
        })
      }
      seen.set(f.id, i)
    })
  })

export type Story = z.infer<typeof storySchema>
export type Frame = z.infer<typeof frameSchema>

export interface ValidationIssue {
  path: string
  message: string
}

export function validateStory(doc: Json): ValidationIssue[] {
  const res = storySchema.safeParse(doc)
  if (res.success) return []
  return res.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
}

/** Known values for enum-like keys, offered as suggestions in the editor. */
/** Colour tokens from the design (§4.1); a colour field takes a token name or a hex value. */
export const COLOR_TOKENS = [
  'canvas', 'paper', 'mist', 'hair', 'ink', 'navy', 'body', 'mute', 'blue', 'blueInk',
  'pale', 'paleStrong', 'lime', 'limeInk', 'limeBg', 'glass', 'glassBorder',
]

export const CONTENT_TYPES = [
  // text
  'TEXT', 'LIVE_BADGE', 'TEXT_LINES', 'CHIPS',
  // layout
  'SPACER', 'CARD', 'GLASS_PANEL',
  // data display
  'KV_LIST', 'STAT_GRID', 'HIGHLIGHT', 'BAR_CHART', 'CHARGE_BAR', 'DAY_PROGRESS', 'COUNTDOWN',
  // lists and grids
  'LIST', 'PRODUCT_GRID', 'PEOPLE_GRID', 'LOGO_TILES', 'PARTNER_LOCKUP', 'TESTIMONIAL',
  // media
  'IMAGE', 'COLLAGE', 'CAROUSEL',
  // native graphics
  'DOT_MATRIX', 'HALL_MAP',
  // interaction
  'POLL', 'CTA_GROUP', 'FOOTER_RAIL',
] as const

export const ENUMS: Record<string, string[]> = {
  type: [
    ...CONTENT_TYPES,
    // background / art / action types
    'SOLID', 'DISC', 'ADD_TO_CALENDAR', 'DEEP_LINK', 'URL', 'OPEN_STORY', 'REMIND', 'SHARE', 'CLOSE', 'NONE',
  ],
  style: [
    // TEXT styles (§4.2)
    'XL', 'H1_LG', 'H1', 'H1_SM', 'H2', 'H3', 'LEDE', 'LEDE_INK', 'KICK', 'NOTE', 'QUOTE', 'LIVE',
    // CTA button styles, header styles, countdown styles
    'PRIMARY', 'GHOST', 'WHITE', 'PLAIN', 'GLASS', 'HIDDEN', 'RING', 'NUMERAL_BAR',
  ],
  phase: ['PRE', 'DURING', 'POST'],
  layout: ['CANVAS', 'PHOTO'],
  templateId: [
    'HERO_SPEC', 'HERO_MEDIA', 'COUNTDOWN_RING', 'COUNTDOWN_NUMERAL', 'HERO_ART', 'INFOGRAPHIC_CARD',
    'PRODUCT_GRID', 'PEOPLE_GRID', 'DAY_OPENER', 'LIST_CARD', 'POLL', 'STATS', 'LOGO_WALL', 'COLLAGE',
    'CAROUSEL', 'PHOTO_CAPTION', 'PHOTO_ANNOUNCEMENT', 'PHOTO_TESTIMONIAL',
  ],
  fit: ['CROP', 'FIT'],
  align: ['START', 'CENTER', 'END', 'BOTTOM_CENTER', 'TOP_CENTER'],
  textAlign: ['START', 'CENTER', 'END'],
  pin: ['TOP', 'BOTTOM', 'CENTER'],
  shape: ['RECT', 'ROUNDED', 'CIRCLE'],
  variant: ['STACKED', 'SPLIT'],
  padding: ['DEFAULT', 'FLUSH'],
  leading: ['TIME', 'NUMBER', 'LOGO', 'IMAGE', 'NONE'],
  density: ['COMPACT', 'REGULAR', 'ROOMY'],
  surface: ['HOME'],
  color: COLOR_TOKENS,
  barColor: COLOR_TOKENS,
  fill: COLOR_TOKENS,
  gapColor: COLOR_TOKENS,
  placeholderColor: COLOR_TOKENS,
  background: COLOR_TOKENS,
  border: COLOR_TOKENS,
  mode: ['LIVE', 'STATIC'],
  animation: ['NONE', 'LOOP_FILL'],
  indicator: ['DOTS', 'NONE'],
  snap: ['START', 'CENTER'],
  openIn: ['IN_APP', 'EXTERNAL'],
  timeZone: ['Asia/Dubai', 'UTC'],
  mime: ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'],
}

const placeholderImage: JsonObject = {
  url: 'https://',
  width: 1200,
  height: 800,
  alt: '',
}

/** Starter JSON for each block type, used by "Add block". */
export function blockTemplate(type: string): JsonObject {
  switch (type) {
    case 'TEXT': return { type, style: 'LEDE', text: 'New text' }
    case 'IMAGE': return { type, width: 936, height: 490, shape: 'ROUNDED', cornerRadius: 32, fit: 'FIT', image: { ...placeholderImage } }
    case 'SPACER': return { type }
    case 'CTA_GROUP': return { type, marginTop: 36, buttons: [{ label: 'Button', style: 'PRIMARY', action: { type: 'DEEP_LINK', uri: 'zynetic://open/' } }] }
    case 'FOOTER_RAIL': return { type, marginTop: 36, start: '', end: '' }
    case 'CARD': return { type, marginTop: 48, children: [] }
    case 'KV_LIST': return { type, variant: 'SPLIT', rows: [{ label: 'Label', value: 'Value' }] }
    case 'LIVE_BADGE': return { type, label: 'Live' }
    case 'DAY_PROGRESS': return { type, word: 'Day', current: 1, total: 3, suffix: 'of 3', marginTop: 40 }
    case 'GLASS_PANEL': return { type, children: [] }
    case 'CHIPS': return { type, marginTop: 24, items: ['Chip'] }
    case 'LIST': return { type, leading: 'NUMBER', density: 'REGULAR', items: [{ leadingText: '1', title: 'Item', subtitle: '' }] }
    case 'PARTNER_LOCKUP': return { type, marginTop: 8, separator: '×', left: { ...placeholderImage }, right: { ...placeholderImage } }
    case 'STAT_GRID': return { type, columns: 2, valueSize: 112, items: [{ value: '0', label: 'label' }] }
    case 'HIGHLIGHT': return { type, marginTop: 32, imageHeight: 220, label: 'Highlight', value: '', image: { ...placeholderImage } }
    case 'BAR_CHART': return { type, marginTop: 32, title: 'Chart', height: 250, barColor: 'blue', bars: [{ label: 'A', value: 1, display: '1' }] }
    case 'LOGO_TILES': return { type, marginTop: 48, columns: 2, tileHeight: 204, items: [{ logo: { ...placeholderImage }, caption: '' }] }
    case 'TESTIMONIAL': return { type, marginTop: 24, quote: '', name: '', role: '' }
    case 'COLLAGE': return { type, marginTop: 48, width: 936, height: 640, cornerRadius: 32, cells: [{ x: 0, y: 0, w: 936, h: 640, image: { ...placeholderImage } }] }
    case 'TEXT_LINES': return { type, marginTop: 24, items: ['**Bold lead.** First line.', '**Bold lead.** Second line.'] }
    case 'CHARGE_BAR': return { type, marginTop: 36, progress: 0.36, showPercent: false, animation: 'LOOP_FILL', width: 520 }
    case 'COUNTDOWN':
      return {
        type, style: 'RING', mode: 'LIVE', align: 'CENTER', marginTop: 48,
        target: '2026-11-10', progressStart: '2026-10-14', timeZone: 'Asia/Dubai',
        ring: { diameter: 600, ticks: 72 },
        labels: { unitOne: 'day to go', unitOther: 'days to go', todayValue: 'Today', todayUnit: 'doors open at 10:00', status: '{pct}% charged, doors open 10 November', statusDone: 'Fully charged. See you at Booth C‑09.' },
      }
    case 'PRODUCT_GRID': return { type, marginTop: 48, columns: 3, imageWidth: 240, imageHeight: 200, items: [{ image: { ...placeholderImage }, title: 'Product', subtitle: 'One line' }] }
    case 'PEOPLE_GRID': return { type, columns: 2, portraitSize: 230, items: [{ portrait: { ...placeholderImage }, name: 'Name Surname', role: 'Role' }] }
    case 'CAROUSEL': return { type, marginTop: 48, itemWidth: 660, itemHeight: 640, gap: 24, bleedEnd: true, snap: 'START', indicator: 'DOTS', items: [{ image: { ...placeholderImage } }, { image: { ...placeholderImage } }] }
    case 'DOT_MATRIX': return { type, columns: 15, rows: 9, dotDiameter: 20, pitch: 56, palette: ['#263D63', '#4294FF'], cells: '0f'.repeat(135) }
    case 'HALL_MAP': return { type, columns: 7, rows: 5, cellWidth: 92, cellHeight: 72, gapX: 16, gapY: 16, cornerRadius: 14, highlight: { column: 4, row: 1, label: 'C-09' } }
    case 'POLL':
      return {
        type, pollId: 'poll_id', required: true,
        options: [{ id: 'a', label: 'Option A' }, { id: 'b', label: 'Option B' }],
        prompt: 'Tap to vote', resultsNote: '{total} votes so far', closedNote: 'Poll closed, {total} votes',
      }
    default: return { type }
  }
}

export function frameTemplate(id: string): JsonObject {
  return {
    id,
    templateId: 'HERO_MEDIA',
    templateVersion: 1,
    layout: 'CANVAS',
    phase: 'PRE',
    title: 'New frame',
    availability: { from: '2026-10-01T00:00:00+04:00', until: '2026-12-31T23:59:59+04:00' },
    background: { type: 'SOLID', color: 'canvas' },
    content: [
      { type: 'TEXT', style: 'KICK', text: 'Kicker', marginTop: 64 },
      { type: 'TEXT', style: 'H1', text: 'Headline.' },
      { type: 'SPACER' },
      { type: 'FOOTER_RAIL', marginTop: 36, start: '', end: '' },
    ],
  }
}
