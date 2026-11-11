# Loom design

Operate surface: a working tool used for hours next to code. Calm, dark, content first, standard controls. The world lends only type, palette, density and one signature move.

## Palette

Warm graphite ground, like undyed wool under low light. One action colour. Project colours are natural dyes.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#1a1c20` | Content: chats, editor, settings |
| `--bg-shell` | `#15171a` | Sidebar, tab bar, status bar, right panel |
| `--bg-raised` | `#212328` | Composer, cards, menus, user bubbles |
| `--bg-input` / `--bg-sunken` | `#1e2025` / `#17191c` | Fields; code and tool output |
| `--line` / `--line-soft` / `--line-strong` | `#2a2d33` / `#23262b` / `#3b3f47` | Dividers and borders |
| `--text` / `--text-2` / `--text-3` | `#e8e4dc` / `#b4afa5` / `#8f8a81` | Body, secondary, meta (all at least 4.5:1 on `--bg`) |
| `--accent` | `#6fb5a1` verdigris | Primary actions, focus, selection, live state |
| `--warn` / `--danger` / `--ok` | `#dcb05a` / `#e27d6b` / `#93c078` | Needs approval, errors, success |

Thread colours (one per project): woad `#6f97c8`, madder `#d27563`, verdigris `#5fb09a`, weld `#d6b257`, indigo `#918cda`, cochineal `#cb769e`, lichen `#a1b968`, walnut `#b68f6b`, slate `#919eaf`.

## Type

- Interface: Segoe UI Variable Text at 13px, the Windows system face. One family, fixed sizes, ratio about 1.15.
- Chat reading text: 14px, line height 1.6.
- Code, paths, commands and terminals only: Cascadia Code or Cascadia Mono at 12 to 13px. Never for labels.

## Signature move: project threads

Every project has a thread colour. It appears as a 3px vertical thread beside the project in the sidebar, as a 2px line across the top of each of its tabs, as the project name inside the tab, beside the chat and file headers, and in the status bar. A tab bar that mixes projects stays readable at a glance. The app mark is the same idea: three threads with a woven weft.

## Motion

- 140 to 200ms ease-out on state changes only (hover, open, focus).
- Menus and approval cards pop in from 98.5% scale.
- One authored moment: while Claude works, a short shuttle crosses a thread line beside the elapsed time.
- Everything respects reduced motion.

## Controls

Standard and themed: custom dropdowns (`Dropdown` in `components/Menu.tsx`), checkboxes and radios, segmented controls, fields with a verdigris focus ring, thin warm scrollbars, verdigris text selection. Context menus are drawn by the app, never by the OS.

## Rules kept

No em dashes, no decorative numbering, no uppercase eyebrow labels, no gradients as decoration, no cards as the page structure, monospace only for code and data.
