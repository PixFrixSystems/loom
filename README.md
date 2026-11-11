# Loom

One window for all your projects. Chats, files and terminals from any project share one tab bar, and every Claude chat runs in its own project's folder.

## Open it

Use the **Loom** shortcut on the desktop or in the Start menu. Loom keeps the Start menu shortcut up to date by itself.

## After changing the code

```
npm run build
```

Then close and reopen Loom. `npm run dev` runs it with live reload while you work on it.

## Check that it works

```
npm run smoke        # opens the app against a scratch folder and checks history, files, terminal, quick open
npm run smoke:live   # also sends two tiny messages to Claude (Haiku) and tests approvals
```

`smoke:live` leaves two short test chats in Claude's history for this folder (`~/.claude/projects/C--Users-panos-loom`). Delete that folder afterwards if you don't want them.

## Where things live

- Loom's projects, groups, open tabs and settings: `%APPDATA%\Loom\loom-state.json`
- Chat history stays where Claude Code keeps it: `~/.claude/projects`. Loom reads it and never rewrites it.
- Chats run through the Claude Code program that ships with the Agent SDK (`node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe`) using your normal Claude sign-in, settings, skills and hooks. Settings can switch to your installed `claude.exe` instead.

## Good to know

- A resumed chat shows its messages from the last compaction onward, like Claude Code does. Earlier turns are summarized in the first message.
- Don't continue the same chat in VS Code and Loom at the same time: both write to the same history file.
- New chats start in "Ask before edits". Change the default in Settings, or per chat from the message box.
- Effort and Ultracode sit in the message box and can change mid-chat. "Default" effort follows `effortLevel` in your Claude settings.
- To move a chat to another project, right-click its tab or its row in the sidebar, then Move to project. Its history moves to that project's folder (the original is kept in `~/.claude/chat-backups`) and Claude works there from the next message.
- Plan limits in the status bar come from the same source as Claude Code's `/usage`, checked every five minutes and after each reply. Loom also writes them to `~/.claude/usage-cache.json`, so the 80% usage guard works for Loom chats. The SDK marks this call experimental; if it breaks, the meters just stop updating.
- Split layouts: the grid button in the top bar has ready-made layouts (side by side, top and bottom, three columns, four squares, one large with two stacked) and splits for the pane you're in. Drag a tab onto a pane to show it there, or onto a pane's edge to split it. Drag the lines between panes to resize; double-click one to even them out. Clicking a tab shows it in the selected pane (the one with the green line). The layout is saved.
- Git (right panel, or click the branch in the status bar): what changed in the project folder, staged and not. Click a file to select it (Ctrl+click or Shift+click for more) and Commit then commits only those; double-click it for a side-by-side diff. Stage, unstage or throw away (a copy goes to `%APPDATA%\Loom\discarded`, new files to the Recycle Bin). Commit with your own message or "Write with Claude", which follows your CLAUDE.md commit rules. Push, pull (fast-forward only; anything needing a merge is a job for a chat), switch or start branches, and browse recent commits. Works for projects inside a bigger repository, like each PixFrix site.
- Chats read as a timeline: your message, then a thread of Claude's steps with a dot each (green done, red failed, open ring running). Commands and edits show a box with what went in and what came out; reads and searches open on a click.
- Typing / lists every command and skill Claude has in that folder, yours marked, even before the chat's first message.
- The meter next to the send button shows how full the chat is; its tick is where Claude starts summarizing earlier messages.
- Browser tabs show a site inside Loom: the globe next to a running server opens it beside the chat. Back, forward, reload, phone and tablet widths, developer tools (F12). Sites run sandboxed, with no access to Loom.
- When tabs don't fit, arrows appear at the ends of the row and the ⌄ button lists them all.
- A tab can have a window of its own, for another screen: right-click it and choose "Move to a new window", or drag it out of Loom and let go. Chats keep running, terminals keep their shell and output, files keep unsaved edits. Closing that window (or Ctrl+W in it) moves the tab back. In the main window the tab stays listed; clicking it brings its window forward. Moved-out tabs come back to the main window when Loom restarts.
- Images you send show as thumbnails in the chat, saved chats included; click one for full size, arrow keys for the next.
- Thinking and tool steps show how long they took, and every reply ends with how long Claude worked on it.
- Dev servers: Loom reads each project's `package.json` (or a web, site or single app folder inside it) for `dev`, `start`, `serve`, `preview` and similar scripts, using the project's npm, pnpm, yarn or bun. Run starts the one you last picked. Servers run in the background; their address shows in the chat header, the sidebar and the status bar, which also lists every server with restart and stop. Quitting Loom stops them all, including anything they started.
- Project icons are found automatically (`app/icon.svg`, `public/favicon.*`, and the same inside `web/` or a single app folder). Right-click a project, then Icon, to pick an image or turn it off. Groups have no icon until you give them one: right-click the group, then Icon, to borrow one of its projects' icons or pick an image.

## Shortcuts

| | |
|---|---|
| New chat in this project | Ctrl+T |
| Close tab | Ctrl+W |
| Next and previous tab | Ctrl+Tab, Ctrl+Shift+Tab |
| Open a file | Ctrl+P |
| New terminal | Ctrl+` |
| Split to the right, split down | Ctrl+\, Ctrl+Shift+\ |
| Move between panes | Ctrl+Alt+arrows |
| Sidebar | Ctrl+B |
| Files and Claude panel | Ctrl+Alt+B |
| Settings | Ctrl+, |
| Stop Claude | Esc in the message box |
| Save a file | Ctrl+S |
