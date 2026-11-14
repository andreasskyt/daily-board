# A practical guide to Claude Code mods

What we learned building the two mods in this repository. It is written for someone who wants to build their own and would rather not repeat our mistakes. The official reference is at https://code.claude.com/docs/en/plugins/overview; this guide is the part you only learn by doing.

## What a mod is

A mod is a plugin with a hooks module: a TypeScript file that changes Claude Code's own interface or behavior. It can draw a band above the prompt or a panel beside the chat, add slash commands, register tools the model can call, read usage, and allow, rewrite or refuse tool calls.

A mod is four small files:

```
my-mod/
  .claude-plugin/plugin.json   name, version, description, options
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           the code
  types/index.d.ts             the values the mod keeps in state
```

The module exports one function. Every hook has the same shape:

```ts
export const register: Register = (on, options) => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    // $ is the engine, e is the event, next(e) lets it continue
    return next(e)
  })
}
```

Return without calling `next` and your hook answers instead of the engine. Call `next` with a changed `e` and you rewrite what happens. Call `next(e)` and then act, and you observe.

## Where a mod can draw

| Place | Use it for | Limit to know |
| --- | --- | --- |
| Band above the prompt | A status you want in view all the time | At most half the window's rows. Taller content scrolls. A mod cannot raise this |
| Pane beside the chat | Lists, dashboards, anything tall | Narrow: design for about 40 columns |
| Status line | One short line | Text only |
| Toast | A one-time notice | Disappears by itself |

Pick the place before you design. Our first board was a tall card in the band, and no amount of layout work could make it fit: the band was the wrong place for that much height.

## The layout rules nobody tells you

Layout is measured in terminal cells, but the desktop app draws with a proportional font and native buttons. What looks aligned in your head overlaps on screen. These are the numbers we measured on desktop:

- **A native button is about 1.45 rows tall.** A row that holds one needs `height={2}`. At height 1 the buttons overlap the rows above and below.
- **A plain button and a line of text are 1 row.**
- **A marker glyph (■ ● ▰) is about 1.5 cells wide.** Ten of them do not fit in ten cells.
- **The band holds `e.props.maxRows` rows,** half the window. In a normal window that is about 12.

And the rules that follow from them:

1. **Never size content with fixed character widths or padded strings.** Give content its natural width, put a `columnGap` between cells, and use a `flexGrow` spacer to push buttons to one right-aligned column.
2. **Fixed widths are fine for slots, not for content.** A label column of fixed width makes the markers line up. A fixed width around ten markers makes them overflow.
3. **Controls should never move.** A button that appears and disappears makes its neighbors jump. Draw it dimmed instead.
4. **Choose the layout from the room you have.** Read `maxRows` and `bodyColumns` and pick: a one-column table when it fits, a two-column grid when it does not.
5. **Highlight one thing.** The next action gets the accent color and the primary button. Finished items go dim.

## Build it without guessing

This is the workflow that finally worked. Before it, every layout change was a guess followed by a screenshot.

1. **Develop in the session's mods folder.** It reloads at the end of every turn. A folder loaded through `CLAUDE_CODE_PLUGIN_DIRS` reloads in the desktop app only when `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` is also set.
2. **Measure first.** Ship a ruler: a throwaway mod that prints `maxRows` and `bodyColumns` and draws candidate rows (a button at height 1, at height 2, a plain button, a row of markers). One screenshot of that tells you more than ten layout attempts.
3. **Give the mod a probe tool.** A mod reloads in the middle of a turn when a tool it registered is about to run, so the model can change the code, call the tool and read the real sizes back in the same turn.
4. **Write tests.** `claude plugin test <folder>` mounts your band or pane on the terminal and desktop surfaces, presses buttons by key and reads the text back. It catches a tree the engine refuses, a hook that throws, and logic errors. It does not show you how it looks.
5. **Look at it.** Tests do not replace a screenshot. Nothing does.
6. **Move it to its permanent home last,** once it is right.

## Making a mod configurable

Plugin options (`userConfig` in `plugin.json`) reach the module as `options`. They can only be flat values: a string, a number, a boolean, or a list of strings. A list of structured objects is not possible.

So split the configuration:

- **Simple choices go in `userConfig`:** a title, a number, an on/off switch. The person gets a settings screen for free.
- **Structured configuration goes through a tool.** The mod registers a tool with a JSON schema, validates what it receives and keeps it in its store. A setup skill in the same plugin interviews the person and calls the tool. `daily-board` works this way.

Ship a sensible starter configuration so the mod works before anyone runs the setup.

## Mistakes that cost us time

- **A slash command name can be taken.** `/usage` belongs to Claude Code, and another plugin may own the name you want. A refused `$.command.register` throws, and a throw in `session.start` skips the whole hook, so nothing of your mod starts. Catch it and fall back to another name. `claude plugin validate` warns about names Claude Code ships.
- **A matcher needs a literal.** `on('tool.call', { tool })` with a variable from a loop does not type-check. Write one `on` per tool, or use a regular expression.
- **`$` goes only to top-level functions.** Passing it to a closure defined inside `register` is refused by the validator.
- **Guards must fail closed.** A hook that refuses tool calls needs `.catch(($, e, next) => next.called ? next(e) : { deny: 'why' })`, or a bug in your guard lets everything through.
- **A background call is not a user request.** In auto mode a mod's own MCP call from a timer can be refused by the permission classifier. A `tool.check` hook that allows exactly your own calls (check `next.origin.plugin`) fixes it without opening the tool to anyone else.
- **Do not use the wall clock for rules.** Read `$.clock.now()`. Then a test can pick the day, and a gate that only locks on weekdays can be tested on a Saturday.
- **State outlives your code.** `$.state` survives a reload and `$.store` survives the session, so new code meets values the old code wrote. Change a key's name when you change its shape.
- **One row per plugin.** Each mod draws its own band row and returns `next(e)` for none. Wrapping the result of `next(e)` into your own tree is the old way and no longer needed.

## Sharing a mod

A repository becomes a marketplace with one file, `.claude-plugin/marketplace.json`, listing each plugin and its folder. Then anyone installs with:

```
/plugin marketplace add <owner>/<repo>
/plugin install <plugin>@<marketplace>
```

Before you publish:

- Scan for secrets and read every file for names, internal URLs and data that are not yours to share.
- Write down what the mod stores and what it hooks. Mods run with the installer's permissions and are not sandboxed, so people should be able to see what they are trusting.
- Anything that blocks the person's tools should be off by default.
- Third-party marketplaces do not update automatically. Bump `version` in `plugin.json` and tell people to run `claude plugin update`.

## A checklist

- [ ] The place is right: band for a line, pane for anything tall
- [ ] Measured `maxRows` and `bodyColumns` before designing
- [ ] Rows with native buttons are height 2
- [ ] No fixed widths on content, buttons right-aligned with a spacer
- [ ] Layout chosen from the room available
- [ ] Command registration cannot break the start
- [ ] Guards fail closed
- [ ] Tests mount it on terminal and desktop and press the buttons
- [ ] Seen on screen, not only in tests
- [ ] README says what it stores and what it hooks
