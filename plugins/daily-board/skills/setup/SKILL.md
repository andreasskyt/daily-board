---
name: setup
description: "Set up or change the daily board: interview the person about what they must get done every day, turn it into board items (toggles, counters, checklists) and save them with the daily-board tools. Use for /daily-board:setup, 'set up my daily board', 'change my board', 'add an item to my board', 'remove X from my board'."
---

# Daily board setup

The daily board is a band above the prompt. It shows up to three daily goals plus a fixed list of items the person wants to finish every day. This skill decides that list with the person and saves it.

## Tools

- `mcp__daily-board__get`: returns the board as it is now: `title`, `goal_name`, `goal_slots`, `goal_command`, `marker`, `gate` and `items`.
- `mcp__daily-board__set`: replaces the items. Input: `{ "items": [ ... ] }`. It answers with what was saved, or with one sentence saying what to fix.

If the tools are not listed, the plugin's mod is not loaded. Say so, and that the board needs Claude Code 2.1.287 or newer with mods turned on. Do not edit settings or plugin files to work around it.

## Item kinds

| kind | what the person does | fields |
| --- | --- | --- |
| `toggle` | One thing that is done or not. Drawn with a Done button. | `label` |
| `counter` | A number to reach. Drawn with progress markers and − and + buttons. | `label`, `target` (1 to 20) |
| `checklist` | Two to five named parts to tick off. Drawn with one button per part. | `label`, `parts` (2 to 5 names) |

Every item may also carry `short` (a name of at most 10 characters for the one-line status) and `marker` (`square`, `circle` or `bar`) to draw that one item differently.

Limits: 1 to 10 items, labels at most 28 characters, part names at most 14. Goals are not items: the person sets them each day with the goal command.

## Steps

1. Call `mcp__daily-board__get`. Tell the person in two or three lines what the board holds now.
2. Ask what they must get done every single day before anything else. Ask one question at a time and keep it concrete: what is the activity, is it done once or counted, and if counted, how many. Offer a starting point when they are unsure:
   - **Sales day**: LinkedIn post (toggle), connection requests (counter 10), lead inbox (checklist: LinkedIn, Email, Instagram), outreaches (counter 5), follow ups (counter 5).
   - **Maker day**: deep work blocks (counter 3), ship one thing (toggle), inbox (checklist: Email, Chat).
   - **Content day**: write (toggle), publish (toggle), comments answered (counter 10), ideas saved (counter 3).
3. Push back on a long list. The board works because it is short: five or six items is the sweet spot, and each one should be something they can finish today. A vague item ("work on marketing") becomes a counter or a toggle with a clear end.
4. Show the final list as a short table (label, kind, target or parts) and ask for a yes before saving.
5. Call `mcp__daily-board__set` with the list, in the order it should appear. If it answers "Not saved", fix what it names and call it again.
6. Tell the person what happens next, in a few lines:
   - The band above the prompt shows one colored line: red until an item is done, green when it is. Open expands it into the card with the buttons.
   - Goals are set each day with the goal command from step 1 (for example `/mit call the client | send the offer`).
   - When everything is done, the band disappears until tomorrow.

## What this skill does not change

The title, the goal name, the number of goal slots, the default marker and the gate are plugin options. The person changes them under `/plugin`, then daily-board, then Configure options (in the desktop app: the plugin's settings). Say where they are when asked; do not edit settings files.

The gate, when the person turns it on, refuses Edit, Write, NotebookEdit and Bash on weekdays until every counter has reached its target. Typing `OVERRIDE` and a reason opens it for the rest of the day. Mention this once if they ask about locking themselves out of work, and say it is off by default.
