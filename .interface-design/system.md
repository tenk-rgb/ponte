# Ponte design system

## Direction
Brasília modernism. Athos Bulcão azulejo blue, exposed concrete, ipê yellow for live things, and the three Ponte JK arches. Calm and precise, like a control desk at night. The person is a power user connecting to home and work machines and watching AI agents, often in a hurry between other things.

## Focal pattern
Each view has one focal element. On Início it is the "Conectar" field (56px, 18px text). It searches, filters the list, and connects on Enter. An unknown address opens the new-connection form already filled in. Recents (at most 3) are the second tier. Everything else is a dense row list.

## Tokens (app.css)
- Surfaces: `--concreto` canvas → `--papel` (+1 step) → `--papel-alto` (floating). Inputs use `--concreto-fundo` (inset, darker).
- Text, 4 steps: `--tinta`, `--tinta-2`, `--tinta-3`, `--tinta-4`.
- Lines: `--linha` / `--linha-forte`, low-opacity rgba, drawn as inset box-shadows.
- One accent: `--azulejo` (action, focus, selection). `--ipe` means running now, `--mata` means online, `--urucum` means destructive. Nothing else gets color.

## Type
Gabarito (Naipe Foundry, Rio), variable 400–900. Never enable `ss01`: it turns digits into circled numbers. Scale 1.25 from 14: 12 · 14 · 16 · 18 · 22 · 28. Tiers come from weight (750/700/650/600/500) plus the text steps, not size alone. Negative tracking on headings ≥ 16px. Terminals use Cascadia Mono.

## Space, radius, depth
- Spacing: 4px grid (4, 8, 12, 16, 24, 32, 40, 48, 64).
- Radius: 4 tiles · 6–8 controls · 10 rows/segmented · 12 cards and tiles · 14 connect field · 16 modals. Nested radii are concentric (segmented 10 = 8 + 2 padding).
- Depth: lines plus one-step surface shifts. Shadows (`--flutua`) only on things that float: modal, palette, toast.

## Components
- Button: 36px tall (32 small), 16px horizontal padding (12 small), radius 8, weight 600, `scale(.97)` on press. Primary is azulejo fill; default is an inset `--linha-forte` ring; ghost turns azulejo-suave on hover.
- Row: grid `20px 1fr 104px 96px 140px`, at least 52px tall, 1px `--linha` between rows, `--papel` on hover. The action column is fixed so columns align. Actions are ghost icon buttons (32px).
- Status mark: a 14px color tile (leaf corner) with an 8px dot. Green = port answered, hollow = no answer, hidden = not checked yet. The check is a TCP connect every 30s while Início is visible.
- Active tab: an arch (28×8, 2px azulejo) under the label. Window controls are 46px wide; close turns urucum on hover.
- Motion: ease-out `cubic-bezier(.23,1,.32,1)`, 120–200ms, transform and opacity only. No animation on the palette or other keyboard-repeated actions.
