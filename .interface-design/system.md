# Ponte design system

## Direction
Black and gray, the way X and ChatGPT are: pure black canvas in the dark theme, white in the light theme, surfaces rising in small gray steps, and the primary button inverted (white on black, black on white). The only color is the green of "respondendo" and "rodando". The circuit motif from the earlier Mata Atlântica pass stays as the signature: chamfered corners on things you act on, diamond LEDs for status, a lit trace with a node under the active tab. Chosen by the user on 2026-10-20 after the green version.

## Icons
Two sources, one grammar: 24-grid, 2px round strokes, `currentColor`.
- Ponte's own set (13 icons) lives in `design/icons/build-icons.js`, which writes the SVG files there and `wwwroot/icons-ponte.js`. It carries the identity: a chamfered top-right corner on containers (pc, server, chip, agent, terminal, files, board) and a filled diamond on status and connection points (led-on/off, link, screen, server, agent, home). `brand` is two arches on a deck. Inspected on a contact sheet at 16/24/32/48 px in both themes; `chip` is the only one that softens at 16 px, so never use it below 18.
- Lucide (ISC, `wwwroot/icons.js` from `lucide-static`) fills generic actions: search, settings, mic, plus, x, pencil, refresh, trash, upload, download, play, maximize, power.
- `icon(name)` looks the Ponte set up first; old Lucide names (monitor, cpu, bot, term, folder, grid, laptop) are aliased onto it. Machines: `pc` for Windows or any desktop, `server` for shell-only Linux, `chip` for Raspberry-like names, `agent` for agents, `screen` for the "Tela" action. Never hand-draw paths inside app.js; add them to the generator.
- Provenance for every asset is in `design/MANIFEST.md`.

## Layout
Início fills the window: grid `minmax(0,1fr) minmax(320px,440px)`, 32px side padding, no max-width; stacks under 1000px. Main column: "Conectar" (44px/800, the focal point), the connect field, recents (3 at most), dense rows. Side column (sticky): the Rede panel and the Agentes cards with a live tail (last 3 terminal lines, refreshed every 1.5s).

Quadro is mission control. Head: title, one-line status, a Terminal button and the zoom control. A launcher strip ("Abrir também") lists chips for every connection and agent not yet open; a chip opens it and returns to the board. With nothing open, the launcher grows into cards with a play affordance, so the board is never a dead end. Open sessions are tiles: a terminal tile shows the live xterm, an activity sparkline (output chunks per 2s over the last minute, the newest bars green) and "há X s"; a desktop tile explains that the remote screen lives in its own tab and offers "Assumir". Tiles enter with a 50ms stagger; the tile head flashes one step lighter on output.

## Rede panel
A list, not a map. Each row: machine icon, name, a latency bar (full at 0 ms, empty at 1000 ms) and the connect time in ms, green when the port answered, "sem resposta" otherwise. Sorted: answering first, then by latency. The probe is a TCP connect per connection every 30s while Início is visible; the host returns ms or -1.

## Tokens (app.css)
- Surfaces: `--fundo` canvas → `--placa` (+1) → `--placa-alta` (floating). `--fundo-inset` is the inset for inputs and the terminal tail. `--terminal` is darker than the cards in both themes.
- Text, 4 steps: `--tinta`, `--tinta-2`, `--tinta-3`, `--tinta-4`.
- Lines: `--linha` / `--linha-forte`, low-opacity rgba, drawn as inset box-shadows.
- `--acento` is the inverted action color (not a hue). `--sinal` is green for alive. `--erro` is red for destructive.
- `--chanfro: 10px`, applied through `clip-path`. Elements with a chamfer keep 24px of right padding so nothing sits under the cut.

## Type
Bricolage Grotesque, variable, bundled in `wwwroot/fonts`. Scale 1.25 from 14: 12 · 14 · 16 · 18 · 22 · 28 · 44. Tiers come from weight (800/700/650/600/500) plus the text steps. Display headings use `opsz 96` and -0.035em tracking. Terminals use Cascadia Mono.

## Space, radius, depth
- Spacing: 4px grid.
- Shape: chamfers on interactive surfaces (connect 14px, panel 16px, cards 10px, chips 8px). Plain 8px radius on rows and buttons; segmented control 10 outer and 8 inner.
- Depth: surface steps plus low-opacity lines. Shadows (`--flutua`) only on modal, palette and toast.

## Components
- Button: 36px tall (32 small), radius 8, weight 600, `scale(.97)` on press.
- Row: grid `16px 1fr 88px 140px`, at least 52px tall.
- Status LED: a 10px diamond. Green with a soft halo = answered; outline = no answer; faint = not checked yet.
- Active tab: a 2px trace with a 7px diamond node at the bottom edge, both `--acento`.
- Motion: ease-out `cubic-bezier(.23,1,.32,1)`, 120–320ms, transform and opacity only. Ambient motion is limited to the desktop tile's breathing LED and the sparkline refresh; all off under reduced motion.
