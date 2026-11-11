# Product

<!-- impeccable:product-schema 1 -->

Recorded 2026-11-11 from the owner's brief in chat. The owner asked to proceed without an interview, so facts marked *(inferred)* come from that brief and were not separately confirmed.

## Platform

web

(Desktop app built on Electron; its UI is web technology rendered in one window on Windows 11.)

## Stack

Electron + electron-vite + React + TypeScript. Owner chose Electron over Tauri and pure Rust after a comparison. Claude runs through the Claude Agent SDK, driving Claude Code (the copy bundled with the SDK, or an installed `claude.exe`) with the person's existing sign-in; no API key of Loom's own. Editor: Monaco. Terminal: xterm.js with a native pty.

## Users

First of all its owner, a web developer running a small studio, who works on many client sites and personal projects at once with Claude Code doing most of the hands-on work, and found juggling one VS Code window per project messy. The code is shared publicly for anyone working the same way.

## Product Purpose

One window for all projects: a projects sidebar, one tab bar where chats, files and terminals from different projects sit side by side, and a Claude chat that feels like the Claude Code VS Code extension. Success: the owner closes the extra VS Code windows and works from Loom.

## Positioning

Unlike VS Code (one project per window, Claude chats always start in the first folder) and Orca (tabs belong to one project at a time), Loom's tab bar is shared across projects, and every chat runs in its own project's folder.

## Operating Context

- Projects live on more than one drive, some as folders inside a monorepo of client sites, some as folders holding a few apps.
- Existing Claude history lives in `~/.claude/projects/<encoded-folder>/<session-id>.jsonl`; some files exceed 100 MB and some lines exceed 16 MiB. Loom must open them all.
- Loom's Git panel covers everyday commits, push and pull; anything that needs a merge stays a job for a chat.
- The owner switches between Greek and English content; UI copy is English.

## Capabilities and Constraints

- Projects sidebar with groups (for example a group holding each client site).
- Mixed tab bar: chat, file and terminal tabs from any project, each marked with its project.
- Chat: new chats, resuming any earlier Claude Code chat for a project, streaming replies, folded tool activity, approve or deny tool use, stop, model and permission mode.
- Open and edit files (for example `.env`) without leaving the app; open a terminal in a project folder.
- Quick access to Claude settings (`~/.claude/settings.json`, `CLAUDE.md`, project `.claude` files).
- Restores open tabs after a restart.
- Not in scope for now: a full code editor workflow, extensions.

## Brand Commitments

- Name: Loom (owner's choice).
- Owner's standing rule for personal tools: calm, restrained colour, data-first layout; loud bands and overlapping marks were rejected before.
- Global hard rules apply: no em dashes, no decorative numbering, every browser-drawn control styled in theme.

## Evidence on Hand

None needed beyond the owner's own projects and chat history. The only public page is the GitHub README, illustrated with screenshots of a made-up demo workspace.

## Product Principles

- The task comes first: chats, files and terminals are the content; the shell stays out of the way.
- Never lose history: reading old chats is read-only and tolerant of huge or odd transcripts.
- Familiar over clever: standard tabs, sidebar, menus and shortcuts a VS Code user already knows.
- Always show which project a tab belongs to.
