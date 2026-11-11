# Product

<!-- impeccable:product-schema 1 -->

Recorded 2026-11-11 from the owner's brief in chat. The owner asked to proceed without an interview, so facts marked *(inferred)* come from that brief and were not separately confirmed.

## Platform

web

(Desktop app built on Electron; its UI is web technology rendered in one window on Windows 11.)

## Stack

Electron + electron-vite + React + TypeScript. Owner chose Electron over Tauri and pure Rust after a comparison. Claude runs through the Claude Agent SDK driving the owner's installed Claude Code (`claude.exe`) with their existing login; no API key. Editor: Monaco. Terminal: xterm.js with a native pty.

## Users

One person: the owner (a web developer running a small studio, PixFrix). Works on many client sites and personal projects at once, mostly with Claude Code doing the hands-on work. Today juggles several VS Code windows, one per project, and finds that messy.

## Product Purpose

One window for all projects: a projects sidebar, one tab bar where chats, files and terminals from different projects sit side by side, and a Claude chat that feels like the Claude Code VS Code extension. Success: the owner closes the extra VS Code windows and works from Loom.

## Positioning

Unlike VS Code (one project per window, Claude chats always start in the first folder) and Orca (tabs belong to one project at a time), Loom's tab bar is shared across projects, and every chat runs in its own project's folder.

## Operating Context

- Projects live on drive F: (for example `F:\pixfrix\Monorepo\projects\<site>`, `F:\GTA6`, `F:\Zappit`), plus some on C:.
- Existing Claude history lives in `~/.claude/projects/<encoded-folder>/<session-id>.jsonl`; some files exceed 100 MB and some lines exceed 16 MiB. Loom must open them all.
- Claude does git work (status, commit, push) from chat; Loom only shows branch and change state.
- The owner switches between Greek and English content; UI copy is English.

## Capabilities and Constraints

- Projects sidebar with groups (for example a PixFrix group holding each site).
- Mixed tab bar: chat, file and terminal tabs from any project, each marked with its project.
- Chat: new chats, resuming any earlier Claude Code chat for a project, streaming replies, folded tool activity, approve or deny tool use, stop, model and permission mode.
- Open and edit files (for example `.env`) without leaving the app; open a terminal in a project folder.
- Quick access to Claude settings (`~/.claude/settings.json`, `CLAUDE.md`, project `.claude` files).
- Restores open tabs after a restart.
- Not in scope for now: a full code editor workflow, git UI beyond status, extensions.

## Brand Commitments

- Name: Loom (owner's choice).
- Owner's standing rule for personal tools: calm, restrained colour, data-first layout; loud bands and overlapping marks were rejected before.
- Global hard rules apply: no em dashes, no decorative numbering, every browser-drawn control styled in theme.

## Evidence on Hand

None needed beyond the owner's own projects and chat history. No marketing surface exists or is planned.

## Product Principles

- The task comes first: chats, files and terminals are the content; the shell stays out of the way.
- Never lose history: reading old chats is read-only and tolerant of huge or odd transcripts.
- Familiar over clever: standard tabs, sidebar, menus and shortcuts a VS Code user already knows.
- Always show which project a tab belongs to.
