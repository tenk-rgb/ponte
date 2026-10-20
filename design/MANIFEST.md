# Asset Manifest

| Asset | Backend | Model | Date | License | Commercial use | Prompt or source |
|---|---|---|---|---|---|---|
| `design/icons/*.svg` (13 icons: brand, pc, server, chip, agent, screen, terminal, files, board, home, link, led-on, led-off) | none | hand-authored duotone SVG | 2026-10-20 | project (MIT) | yes | Authored directly in `design/icons/build-icons.js`, no model. Inspected on a contact sheet at 16/24/32/48 px, light and dark, one color. |
| `src/Ponte/wwwroot/icons-ponte.js` | none | generated from the SVGs above | 2026-10-20 | project (MIT) | yes | `node design/icons/build-icons.js` |
| `src/Ponte/wwwroot/icons.js` | none | Lucide 0.544.0 static SVGs | 2026-10-20 | ISC (`wwwroot/vendor/LUCIDE-LICENSE.txt`) | yes | Generic actions only; generated from `lucide-static` |
| `src/Ponte/ponte.ico`, `wwwroot/icon.png`, `wwwroot/index.html` mark | none (vector recreation) | hand-authored SVG after a raster reference the user supplied (generated with Dreamina AI) | 2026-10-20 | project (MIT) for the SVG; the reference raster was not shipped | verify: the reference came from an AI image generator, so clear its terms before trademarking | `design/logo/ponte-logo.svg` (tile) and `design/logo/ponte-mark.svg` (title bar); .ico rendered at 256 px by headless Edge and downsampled
| `src/Ponte/wwwroot/fonts/Bricolage.ttf` | none | Bricolage Grotesque (Mathieu Triay) | 2026-10-19 | SIL OFL 1.1 (`fonts/Bricolage-OFL.txt`) | yes | Google Fonts repository |
