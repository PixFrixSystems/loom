# Loom design

Operate surface: a working tool used for hours next to code, styled to match Loom's website. The full brand guide lives outside the repo (the Loom brand kit's `BRAND.md`); the website's playable demo (`components/demo` in the site project) is the reference implementation. This file records what the app uses.

## The idea

A graphite room lit from above. Surfaces are dark glass: each a little lighter than what is behind it, catching a thin highlight on its top edge, casting a soft deep shadow. One colour carries meaning, the violet of the logo's loop: live, active, connected. A softer lavender is the edge light: focus, selection, checked. Everything else is greys with a faint blue cast. Calm and precise, never neon. Light comes from light sources (glows, rims, LEDs), never from decorative gradients. Dark only.

## Palette (tokens in `styles/base.css`)

| Token | Value | Use |
|---|---|---|
| `--window` | `#0c0e15` | The window body |
| `--bg` | `#10131c` | Panes: chats, files, terminals, settings |
| `--bg-shell` / `--bg-top` | `#10121a` / `#12141b` | Sidebar, tab rows and side panel; title bar and status bar (the window with a white wash) |
| `--bg-raised` / `--float` | `#161926` / `rgba(22,25,38,0.97)` | Cards; menus and popovers (with a 16px blur) |
| `--bg-sunken` | `#080a10` | Terminal, tool output and diff wells |
| `--line` / `--line-strong` | white at 7% / 12% | Dividers; stronger dividers, input outlines, the chat timeline |
| `--edge` / `--edge-2` / `--hi` | white at 8% / 14% / 10% | Glass outline (inset shadow), on hover, the lit top edge |
| `--text` / `--text-2` / `--text-3` | `#eceef4` / `#a9afbf` / `#858b9c` | Primary, secondary, meta (never dimmer than `--text-3`) |
| `--brand` | `#8c8af6` | The one meaningful colour: active tab underline, thinking dot, running chat |
| `--light` | `#c8c6fa` | Focus rings, checked controls, caret, links, meter fills |
| `--brand-deep` | `#4b47b8` | Text selection, with white text |
| `--ok` / `--warn` / `--danger` | `#4fd18b` / `#f0c38a` / `#ff8595` | Running and added; modified and needs approval; deleted, deny, stop (never violet for errors) |

Projects keep a colour, but only as the deep tint of their initial tile (`--t-*` gradients) when they have no icon. No second accent colour.

## Type

- Interface: Schibsted Grotesk (variable, bundled through `@fontsource-variable/schibsted-grotesk`), falling back to Segoe UI, which also covers Greek. Base 13px, labels 12 to 12.5px at 560 to 650, meta 11 to 11.5px with tabular numbers, panel headings 14 to 18px at 650 to 700 and -0.015em, big headings 28 to 40px at 700 and -0.03em.
- Code, terminals, paths and file names: Cascadia Code or Mono. Never for labels.

## Shape and depth

- 4px spacing base. Radii: pills (999px) for buttons and chips, 8px icon buttons and menu items, 9 to 14px fields and the composer, 12px menus and cards, 5px tiles and checkboxes. Nested corners are concentric.
- Glass: a white wash over `#0f121b`, an inset 1px top highlight, an inset 1px outline, a deep soft shadow. Borders are inset shadows so they never change layout.
- The primary action is a lit white button whose violet spill grows on hover; everything else is a glass pill.
- Bars: title bar 42px, open files row 30px, pane headers 32px, status bar 28px.

## Signature details

- The active tab is lit, with a 2px violet underline glowing under its label; its project name turns lavender.
- Dividers light up lavender while held; dragged tabs show lavender drop zones. A split pane draws no edge of its own: the active tab's underline says which one you are in.
- File icons (Files panel, Ctrl+P) are the one place with many hues: each kind of file keeps the colour it is known by, muted to about the same lightness, drawn in one hand in `FileIcon.tsx`. Tool folders (`node_modules`, `dist`, `.git`) are dimmed; `.claude` and `CLAUDE.md` take the lavender.
- Running servers are green LEDs. The thinking dot is violet and pulses while Claude thinks: the only animation that loops.

## Motion

Ease-out `cubic-bezier(0.16, 1, 0.3, 1)` for almost everything (hovers 200 to 250ms, menus 180ms from their corner at 98% scale, new chat steps 350ms rising 4px); ease-in-out for things moving between two places; press feedback at 96%. Everything collapses under reduced motion.

## Controls

All drawn in theme: dropdowns with a drawn chevron and a glass list, checkboxes and radios that light lavender, the small Ultracode switch, fields with a lavender focus, keycaps with a lit top and dark base, light thin scrollbars, violet selection. Context menus are drawn by the app, never by the OS.

## Rules kept

No em dashes, no decorative numbering, no uppercase eyebrow labels, no gradient text or glow blobs without a source, no cards as the page structure, monospace only for code and data, no light-on-light glass.
