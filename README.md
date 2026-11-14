# Claude Code mods by SKYT SYSTEMS

Two mods for Claude Code, and a guide to building your own.

| Plugin | What it is |
| --- | --- |
| [daily-board](plugins/daily-board) | A daily must-do board above the prompt: up to three goals plus your own counters, toggles and checklists. One colored status line that expands into a card. Optional gate that locks build tools until the counters are met. |
| [usage-panel](plugins/usage-panel) | A side panel that shows usage in color: the context window by category, the plan's rate-limit windows, session cost and tokens, daily totals, and MCP and tool calls. |

New to mods? Read the [guide](GUIDE.md): what a mod can do, how to build one without guessing at the layout, and the mistakes that cost us the most time.

## Install

In a Claude Code terminal session, add the marketplace once and install what you want:

```
/plugin marketplace add andreasskyt/daily-board
/plugin install daily-board@skyt-systems
/plugin install usage-panel@skyt-systems
```

From a shell:

```
claude plugin marketplace add andreasskyt/daily-board
claude plugin install daily-board@skyt-systems
claude plugin install usage-panel@skyt-systems
```

In the desktop app: click + next to the prompt box, then Plugins, add the marketplace `andreasskyt/daily-board`, then add the plugins.

Requires Claude Code 2.1.287 or newer (2.1.286 in the desktop app). Mods are not available in WSL sessions in the desktop app.

## After installing

- **daily-board:** run `/daily-board:setup` and answer its questions. It builds the board from what you need to get done every day.
- **usage-panel:** it opens by itself. Run `/meter` to open it again.

## Before you install any mod

Mods run with your permissions and are not sandboxed. Read what a mod does first: `claude plugin validate <plugin folder>` lists every event it hooks and every call it makes. Each plugin's README here says what it stores and touches.

## Develop

```
claude plugin validate plugins/daily-board
claude plugin test plugins/daily-board
claude plugin test plugins/usage-panel
```
