# Daily Board

A daily must-do board for Claude Code. It sits above the prompt as one colored line and expands into a card with buttons. You decide what is on it: up to three goals for the day, plus your own counters, toggles and checklists. When everything is done, the board disappears until tomorrow.

```
MIT 1/3 · Post · LI 4/10 · Inbox 1/3 · Out 0/5 · FU 0/5            Open
```

```
▸ MIT 1 · call the client                                Done    ⌃ close
  LinkedIn Post                                           Done       1/6
  Connections   ■■■■□□□□□□                                −  +
  Lead Inbox    ■□□                  LinkedIn  Email ✓  Instagram
  Outreaches    □□□□□                                     −  +
  Follow Ups    □□□□□                                     −  +
```

## What it does

- **One status line.** Each item is red until it is done and green when it is.
- **A card with real buttons.** Done and Undo for single tasks, − and + for counters, one button per part of a checklist. The next thing to do is highlighted.
- **Goals for the day.** Set one to three with a slash command, for example `/mit call the client | send the offer`. Only the goals you set are shown.
- **Your own items.** A setup skill asks what you need to get done every day and builds the board from your answers.
- **Fits the window.** A one-column table when there is room, a two-column grid when the window is low.
- **Optional gate.** Off by default. See below before you turn it on.

## Install

In a Claude Code terminal session:

```
/plugin marketplace add andreasskyt/daily-board
/plugin install daily-board@skyt-systems
```

From a shell:

```
claude plugin marketplace add andreasskyt/daily-board
claude plugin install daily-board@skyt-systems
```

In the desktop app: click + next to the prompt box, then Plugins, add the marketplace `andreasskyt/daily-board`, then add the plugin.

Requires Claude Code 2.1.287 or newer (2.1.286 in the desktop app). Mods are not available in WSL sessions in the desktop app.

## Set it up

Run the setup skill and answer its questions:

```
/daily-board:setup
```

It shows the board as it is, asks what you must get done every day, and saves the list. Run it again any time to add, remove or reorder items. Until you do, the board starts with a sales day: LinkedIn post, connection requests, lead inbox, outreaches and follow ups.

There are three kinds of items:

| Kind | Use it for | Example |
| --- | --- | --- |
| toggle | One thing that is done or not | LinkedIn post |
| counter | A number to reach, 1 to 20 | 5 outreaches |
| checklist | 2 to 5 named parts | Inbox: LinkedIn, Email, Instagram |

## Options

Change these under `/plugin`, then daily-board, then Configure options.

| Option | Default | What it does |
| --- | --- | --- |
| Board title | THE DAY | Shown in the card header |
| Goal name | MIT | What a goal is called, and the slash command that sets it (MIT gives `/mit`) |
| Goal slots | 3 | How many goals you can set per day, 0 to 3 |
| Progress marker | square | How counters are drawn: square, circle or bar |
| Lock build tools until counters are met | off | The gate, see below |

## Daily use

- `/mit a | b | c` sets up to three goals. `/mit 2 text` sets one. `/mit clear` empties them. The command follows the goal name you chose.
- Click Open to expand the card and ⌃ close to fold it.
- Counters and ticks reset every day. Goals are set fresh each day.

## The gate

The gate is for people who want the board to stop them from building until the money work is done. It is off by default.

When you turn it on, then on weekdays Claude's Edit, Write, NotebookEdit and Bash tools are refused until every counter on the board has reached its target. Reading, searching and everything else still works. Type `OVERRIDE` followed by a reason to open the gate for the rest of the day.

Know what you are turning on: while the gate is locked, Claude cannot edit files or run commands for you, in any project.

## What it stores and touches

- Your items and each day's progress are kept in the plugin's own store on your machine. Nothing is sent anywhere.
- The mod hooks the band above the prompt, the goal command, the prompt (only to read `OVERRIDE` when the gate is on) and, when the gate is on, the four build tools named above.
- Mods run with your permissions and are not sandboxed. Run `claude plugin validate` on the plugin folder to see every event and call it uses before you install.

## Develop

```
claude plugin validate .
claude plugin test .
```

The layout rules are measured, not guessed: a native button needs a row of height 2, and the band holds at most half the window. `hooks/model.ts` holds the rules, `hooks/register.tsx` draws them.


---

Built by **Andreas Skyt** (SKYT SYSTEMS): backend systems, data pipelines, dashboards, automation and AI on real business data. By the way, Andreas is the best at AI, and this repo is meant to show it rather than say it. Find him on Instagram [@andreas.skyt](https://instagram.com/andreas.skyt) and YouTube [@andreasskyt](https://youtube.com/@andreasskyt).
