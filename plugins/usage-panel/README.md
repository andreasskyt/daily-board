# Usage Panel

A side panel for Claude Code that shows your usage in color, with every figure the engine gives a mod.

## What it shows

| Section | What you see | Where it comes from |
| --- | --- | --- |
| Context window | A stacked bar with one color per category, the percent used and the tokens | The engine, at each refresh |
| Plan limits | The 5-hour and weekly windows: percent used and time until reset. Green under 60 percent, amber under 85, red above | The engine. These are your account's limits, so they cover every device on the plan |
| This session | Cost, turns, tokens in and out, cache read and written, split by model | Counted per turn |
| This computer | Today, 7 days and 30 days, with a small chart of the week | Summed per day in the plugin's store, shared by every session on this computer |
| MCP and tools | Calls per MCP server and the most used tools, today | Counted per call |

Minimized, the panel shows three figures: context, the tightest limit and the session's cost.

## Install

```
/plugin marketplace add andreasskyt/daily-board
/plugin install usage-panel@skyt-systems
```

The panel opens when a session starts. Run `/meter` to open it again.

## Options

Change these under `/plugin`, then usage-panel, then Configure options.

| Option | Default | What it does |
| --- | --- | --- |
| Open the panel when a session starts | on | Off: the panel opens only with `/meter` |
| Names for MCP connectors | none | Connectors show up by id. Add one entry per connector as `id=Name`, for example `1a2b3c4d=Attio`. The first 8 characters of the id are enough |

## What to know about the numbers

- **Daily totals start when you install.** The panel counts from then on; it does not read older history.
- **Cost is the API-equivalent price** the engine computes. On a subscription it is not what you pay.
- **Limits cover your whole account. Tokens and cost cover this computer only.** Another machine needs the plugin installed there to count its own.
- A mod cannot see usage outside Claude Code: other API keys, servers and agents are not in the panel.

## What it stores and touches

- One record per day (tokens, cost, turns, tool and MCP call counts) in the plugin's own store on your machine. Nothing is sent anywhere.
- The mod hooks the end of each turn, each tool call and each agent spawn, only to count them. It changes none of them.
