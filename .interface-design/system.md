# Ponte design system

## Direction
Mata Atlântica meets circuit board. The canvas is forest green, and maracujá yellow marks anything alive (online, running, the action you can take). The tech motif replaces leaves: cut corners (chamfers) on things you act on, diamond LEDs for status, and lit traces with a node for the active tab. The person is a power user jumping into work and home machines and watching AI agents. The direction was chosen by the user (option C) on 2026-10-19 after rejecting two dark-navy versions.

## Signature
The network map on Início. "Este PC" is the hub, and every saved connection is a diamond node reached by a PCB-style trace that leaves diagonally and ends straight. Nodes whose port answered are lit maracujá, with a pulse running along the trace; clicking a node connects. It shows real reachability data.

## Layout
Início has two columns: main 1.45fr, side min 300px; they stack under 1000px. The main column holds "Conectar" (44px/800, the focal point), the connect field, recents (3 at most) and the dense row list. The side column, sticky, holds the Rede panel and the Agentes cards, each with a live tail of the last 3 terminal lines (refreshed every 1.5s while Início is visible).

## Tokens (app.css)
- Surfaces: `--mata` canvas → `--copa` (+1) → `--copa-alta` (floating). `--mata-fundo` is the inset for inputs. `--terminal` is darker than the cards in both themes.
- Text, 4 steps: `--folha`, `--folha-2`, `--folha-3`, `--folha-4`.
- Lines: `--linha` / `--linha-forte`, low-opacity rgba, drawn as inset box-shadows.
- One accent: `--maracuja` (#f2c230 dark; #a27a00 light so text stays readable). `--sinal` means a port answered (same hue). `--urucum` is destructive.
- `--chanfro: 10px` is the cut corner, applied through `clip-path`. Never put an outer ring on a chamfered element; use a surface step or an inset focus.

## Type
Bricolage Grotesque, variable (opsz, wdth, wght), bundled in `wwwroot/fonts`. Scale 1.25 from 14: 12 · 14 · 16 · 18 · 22 · 28 · 44. Tiers come from weight (800/700/650/600/500) plus the text steps. Display headings use `opsz 96` and -0.035em tracking. Terminals use Cascadia Mono.

## Space, radius, depth
- Spacing: 4px grid.
- Shape: chamfers on interactive surfaces (connect 14px, panel 16px, cards 10px). Plain 8px radius on rows and buttons; segmented control 10 outer and 8 inner.
- Depth: surface steps plus low-opacity lines. Shadows (`--flutua`) only on modal, palette and toast.

## Components
- Button: 36px tall (32 small), radius 8, weight 600, `scale(.97)` on press. Primary is a maracujá fill with `--maracuja-tinta` text.
- Row: grid `16px 1fr 88px 140px`, at least 52px tall. The name sits over user@host. The action column is fixed.
- Status LED: a 10px diamond. Lit maracujá with a soft halo = answered; outline = no answer; faint = not checked yet. The probe is a TCP connect every 30s on Início.
- Active tab: a 2px maracujá trace with a 7px diamond node at the bottom edge.
- Agent card: chamfered `--copa` card with a name, a status word (rodando/parado), "where: command", and a `pre` tail on `--terminal`.
- Motion: ease-out `cubic-bezier(.23,1,.32,1)`, 120–200ms. The only ambient motion is the trace pulse, which is off under reduced motion.
