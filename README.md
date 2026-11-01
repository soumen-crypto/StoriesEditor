# Story editor

A local web app for editing the story/campaign JSON files (e.g. `evw26-event.json`,
`evw26-preview.json`). Built with **TanStack Start** (TanStack Router + Vite + React 19),
Tailwind CSS and Zod. Server functions read and write the files on disk, so saving in the
browser updates the file directly — no copy/paste.

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The files in `data/` are listed on the home page.

To point it at a different folder of JSON files:

```bash
DATA_DIR=/path/to/your/json npm run dev
```

## What you can do

- **Campaign** panel: id, title, subtitle, priority, locale, live window, cover, defaults, theme.
- **Frames** sidebar: filter, select, add, duplicate, delete, reorder (↑/↓). Frames with
  validation problems show a red count.
- **Frame** editor: identity fields with suggestions for `templateId` / `layout` / `phase`,
  date-time pickers for availability (keeps the `+04:00` offset), background, optional header
  override and art layers, and the **content blocks**:
  - each block is a collapsible row with its type, style and a text summary;
  - reorder, duplicate, remove;
  - **+ Add block** offers a starter template for every known block type
    (`TEXT`, `IMAGE`, `CTA_GROUP`, `KV_LIST`, `STAT_GRID`, `GLASS_PANEL`, …);
  - inside a block every field is editable; add/remove/rename fields, change a field's type,
    reorder array items. `CARD.children` / `GLASS_PANEL.children` use the same block editor.
- **Preview** (right column, wide screens): renders the selected frame the way the app's Compose
  renderer does (see `ev-world-stories-sdui-api-design`, §3, §4, §6, §12):
  - 1080-du artboard scaled to fit; z-order background → pinned art → content column
    (padding 240 / 72 / 300) → app chrome (progress segments, title row);
  - header row 56 du with the 50 du logo (plain, or in a glass pill), then blocks top to bottom;
    `SPACER` takes the extra height on tall screens, art is pinned `TOP` / `BOTTOM` / `CENTER`;
  - colour tokens (`canvas`, `ink`, `navy`, `blueInk`, `lime`, `glass`, …) with `theme.colors`
    overrides, and the Exo 2 / DM Sans type ramp (`XL` … `LIVE`) with per-block `size` /
    `lineHeight` / `color` / `textAlign` / `maxLines`;
  - every block in the catalogue, including `COUNTDOWN` (ring and numeral), `CHARGE_BAR`,
    `POLL`, `CAROUSEL`, `PRODUCT_GRID`, `PEOPLE_GRID`, `TEXT_LINES`, `DOT_MATRIX`, `HALL_MAP`;
    unknown block types show a dashed placeholder noting whether the app would skip the block or
    drop the frame (`required`);
  - glass panels are a plain 92 % white fill, no blur, as in the app; images fall back to their
    `placeholderColor` (`mist`) while loading or on error.
  - Switch between the 9:16 design artboard and taller phones (19.5:9, 20:9) to check spacer and
    pin behaviour; toggle the app chrome; enlarge the pane with `+`.
  - Not simulated: the countdown uses the browser clock (the app uses server time), and
    animations (live dot, charge bar loop, ring ticks, poll bars) are shown at rest.
  - Below the preview: the frame's availability window next to the campaign's live window.
- **Raw JSON**: edit the whole document as text and apply.
- **Validation**: Zod schema checks required fields, ISO date format, enums and duplicate frame ids.
  Click the issue count in the top bar to list them; clicking an issue jumps to the frame.
- **Save** (`Ctrl/⌘+S`) writes pretty-printed JSON back to `data/<file>.json`. "bump version"
  increments the document `version` on each save (toggle in the top bar). **Download** gives you
  the current JSON as a file without saving. **Undo/Redo**: `Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z`.
- **Duplicate** a file from the home page (e.g. make `evw26-preview.json` from the event file).

## Layout

```
data/                      the JSON files you edit
src/routes/index.tsx       file list
src/routes/edit.$file.tsx  editor route (loads the file via a server function)
src/lib/files.ts           server functions: list / read / write / duplicate
src/lib/schema.ts          Zod schema, enum suggestions, block & frame templates
src/lib/jsonPath.ts        immutable JSON path helpers
src/components/Editor.tsx  editor UI (campaign, frames, blocks, raw)
src/components/JsonNode.tsx generic recursive JSON editor
src/components/FramePreview.tsx approximate frame preview
```

To add a new block type to the "Add block" palette, extend `CONTENT_TYPES` and `blockTemplate()`
in `src/lib/schema.ts`; to add enum suggestions for a key, extend `ENUMS` there.

## Production build

```bash
npm run build
npm run start
```
