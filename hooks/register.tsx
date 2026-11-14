import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Board, Item, Override } from '../types'
import {
  STARTER_ITEMS,
  applyGoalCommand,
  describeItems,
  glyphs,
  itemsOf,
  markerCount,
  pack,
  progress,
  readConfig,
  slug,
  validateItems,
} from './model'
import type { Config } from './model'

// Daily board: a status line above the prompt that expands into a card.
// Options come from the plugin's settings; the items come from the setup
// skill through the two tools below and are kept in the plugin's store.

const TOOL_GET = 'mcp__daily-board__get'
const TOOL_SET = 'mcp__daily-board__set'
const GATED_MESSAGE = 'daily-board gate failed closed'

const boardAtom = atom({ plugin: 'daily-board', key: 'board' } as const, null as Board | null)
const itemsAtom = atom({ plugin: 'daily-board', key: 'items' } as const, null as Item[] | null)
const overrideAtom = atom({ plugin: 'daily-board', key: 'override' } as const, null as Override | null)
const isExpandedAtom = atom({ plugin: 'daily-board', key: 'isExpanded' } as const, false)

const todayKey = (): string => {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${String(now.getDate()).padStart(2, '0')}`
}

const isWeekday = (time: number): boolean => {
  const day = new Date(time).getDay()
  return day >= 1 && day <= 5
}

const freshBoard = (): Board => ({ date: todayKey(), counts: {}, checks: {}, texts: {} })

async function loadBoard($: EngineInterface): Promise<Board> {
  const date = todayKey()
  const current = await read($, boardAtom)
  if (current !== null && current.date === date) return current
  const stored = (await $.store.get(`board:${date}`)) as Board | undefined
  const board = stored ?? freshBoard()
  await update($, boardAtom, () => board)
  return board
}

async function changeBoard($: EngineInterface, fn: (b: Board) => Board): Promise<void> {
  const before = await loadBoard($)
  const board = fn(before)
  await update($, boardAtom, () => board)
  await $.store.set(`board:${board.date}`, board)
}

async function loadTasks($: EngineInterface): Promise<Item[]> {
  const current = await read($, itemsAtom)
  if (current !== null) return current
  const stored = (await $.store.get('items')) as Item[] | undefined
  const tasks = stored ?? STARTER_ITEMS
  await update($, itemsAtom, () => tasks)
  return tasks
}

// The gate: on weekdays every counter must reach its target, unless the
// person typed OVERRIDE today.
async function gateState($: EngineInterface, config: Config): Promise<{ isLocked: boolean; progress: string }> {
  if (!config.isGateOn) return { isLocked: false, progress: '' }
  const board = (await read($, boardAtom)) ?? freshBoard()
  const tasks = (await read($, itemsAtom)) ?? STARTER_ITEMS
  const override = await read($, overrideAtom)
  const counters = tasks.filter(item => item.kind === 'counter')
  const isMet = counters.every(item => {
    const { count, target } = progress(item, board)
    return count >= target
  })
  const text = counters
    .map(item => {
      const { count, target } = progress(item, board)
      return `${item.label} ${count}/${target}`
    })
    .join(' · ')
  const isOverridden = override !== null && override.date === todayKey()
  return { isLocked: isWeekday(await $.clock.now()) && !isMet && !isOverridden, progress: text }
}

async function gateDeny($: EngineInterface, config: Config): Promise<string | null> {
  const state = await gateState($, config)
  if (!state.isLocked) return null
  return `Daily board gate is locked: ${state.progress}. The counters come first (use + in the band). The person can type OVERRIDE <reason> to open it for today.`
}

export const register: Register = (on, options) => {
  const config = readConfig(options as Record<string, unknown>)
  const baseCommand = slug(config.goalName) || 'goal'
  // The command the goals are set with; empty when no name could be taken.
  let goalCommand = baseCommand

  on('session.start', async ($, e, next) => {
    if (config.goalSlots > 0) {
      // Another plugin may own the short name: fall back to a prefixed one
      // instead of failing the whole start.
      goalCommand = ''
      for (const name of [baseCommand, `board-${baseCommand}`]) {
        try {
          await $.command.register({
            name,
            description:
              config.goalSlots === 1
                ? `Sets today's ${config.goalName}: "/${name} <goal>", "/${name} clear" empties it`
                : `Sets today's ${config.goalName}s: "/${name} a | b" sets up to ${config.goalSlots}, "/${name} 2 <goal>" sets one, "/${name} clear" empties them`,
          })
          goalCommand = name
          break
        } catch {
          // taken: try the next name
        }
      }
    }
    await $.tool.register({
      name: 'get',
      description:
        'Daily board: returns the board as it is set up now (title, goal name and slots, the items) so the setup skill can show it before changing it.',
      isDeferred: false,
    })
    await $.tool.register({
      name: 'set',
      description:
        'Daily board: replaces the items on the board. Each item is a toggle (done or not), a counter (with a target, changed with − and +) or a checklist (2 to 5 named parts). Used by the daily-board setup skill after the person has agreed to the list.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        required: ['items'],
        properties: {
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 10,
            items: {
              type: 'object',
              required: ['label', 'kind'],
              properties: {
                label: { type: 'string', description: 'Shown on the card, at most 28 characters.' },
                short: { type: 'string', description: 'Optional short name for the one-line status, at most 10 characters.' },
                kind: { type: 'string', enum: ['toggle', 'counter', 'checklist'] },
                target: { type: 'integer', minimum: 1, maximum: 20, description: 'Counter only: how many to reach.' },
                parts: { type: 'array', items: { type: 'string' }, description: 'Checklist only: 2 to 5 part names.' },
                marker: { type: 'string', enum: ['square', 'circle', 'bar'], description: 'Optional: how progress is drawn.' },
              },
            },
          },
        },
      },
    })
    const storedOverride = (await $.store.get('override')) as Override | undefined
    if (storedOverride !== undefined && storedOverride.date === todayKey()) {
      await update($, overrideAtom, () => storedOverride)
    }
    await loadTasks($)
    await loadBoard($)
    $.clock.every(60_000, () => loadBoard($))
    return next(e)
  })

  on('command.run', async ($, e, next) => {
    if (config.goalSlots === 0 || goalCommand === '' || e.command !== goalCommand) return next(e)
    const before = await loadBoard($)
    const result = applyGoalCommand(before, (e.args ?? '').trim(), config, goalCommand)
    if (result.board !== before) await changeBoard($, () => result.board)
    return { text: result.text }
  })

  on('tool.call', { tool: /^mcp__daily-board__(get|set)$/ }, async ($, e) => {
    const tasks = await loadTasks($)
    if (e.tool === TOOL_GET) {
      return {
        result: JSON.stringify({
          title: config.title,
          goal_name: config.goalName,
          goal_slots: config.goalSlots,
          goal_command: config.goalSlots > 0 && goalCommand !== '' ? `/${goalCommand}` : null,
          marker: config.marker,
          gate: config.isGateOn,
          items: tasks,
        }),
      }
    }
    if (e.tool !== TOOL_SET) return { result: 'Unknown daily-board tool.' }
    const checked = validateItems((e as unknown as { items?: unknown }).items)
    if ('error' in checked) return { result: `Not saved: ${checked.error}` }
    await update($, itemsAtom, () => checked.items)
    await $.store.set('items', checked.items)
    return { result: `Saved ${checked.items.length} items: ${describeItems(checked.items)}. The board shows them now; today's progress on items that kept their name is kept.` }
  })

  // OVERRIDE <reason> opens the gate for the rest of the day.
  on('prompt.submit', async ($, e, next) => {
    if (!config.isGateOn) return next(e)
    const match = e.text.match(/^\s*OVERRIDE\b[:\s]*([\s\S]*)$/)
    if (match === null) return next(e)
    const reason = (match[1] ?? '').trim() || 'no reason given'
    const override: Override = { date: todayKey(), reason }
    await update($, overrideAtom, () => override)
    await $.store.set('override', override)
    $.ui.toast(`Gate open for the rest of the day: ${reason}`)
    return next(e)
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const deny = await gateDeny($, config)
    return deny === null ? next(e) : { deny }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: GATED_MESSAGE }))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const deny = await gateDeny($, config)
    return deny === null ? next(e) : { deny }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: GATED_MESSAGE }))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const deny = await gateDeny($, config)
    return deny === null ? next(e) : { deny }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: GATED_MESSAGE }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const deny = await gateDeny($, config)
    return deny === null ? next(e) : { deny }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: GATED_MESSAGE }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const board = (await read($, boardAtom)) ?? freshBoard()
    const tasks = (await read($, itemsAtom)) ?? STARTER_ITEMS
    const isExpanded = await read($, isExpandedAtom)
    const override = await read($, overrideAtom)
    const isLocked = (await gateState($, config)).isLocked
    const isOverridden = config.isGateOn && override !== null && override.date === todayKey()

    const items = itemsOf(board, tasks, config)
    const done = items.map(item => {
      const { count, target } = progress(item, board)
      return count >= target
    })
    const doneCount = done.filter(Boolean).length
    const nextIndex = done.indexOf(false)
    const total = items.length

    // Nothing to do, or everything done: no band until the next day.
    if (total === 0 || doneCount === total) return next(e)

    const bump = (id: string, delta: number) => () =>
      changeBoard($, b => ({ ...b, counts: { ...b.counts, [id]: Math.max(0, (b.counts[id] ?? 0) + delta) } }))
    const flipCheck = (key: string) => () =>
      changeBoard($, b => ({ ...b, checks: { ...b.checks, [key]: b.checks[key] !== true } }))
    const open = () => update($, isExpandedAtom, () => true)
    const close = () => update($, isExpandedAtom, () => false)

    const cardW = Math.min(e.props.bodyColumns, 84)
    const spacer = <Box flexGrow={1} />

    if (!isExpanded) {
      // One text line: an item is green when done, red until then. Several
      // goals fold into one "MIT 1/3" so the line stays one line.
      const goals = items.filter(item => item.kind === 'goal')
      const goalsDone = goals.filter(item => board.checks[item.id] === true).length
      const firstGoal = goals[0]
      const segments: { text: string; color: string }[] = []
      if (firstGoal !== undefined) {
        const text = board.texts[firstGoal.id] ?? ''
        const short = text.length > 24 ? `${text.slice(0, 24)}…` : text
        const color = goalsDone === goals.length && text !== '' ? 'green' : 'red'
        if (text === '') segments.push({ text: `${config.goalName}?`, color })
        else if (goals.length === 1) segments.push({ text: `${config.goalName}: ${short}`, color })
        else segments.push({ text: `${config.goalName} ${goalsDone}/${goals.length}`, color })
      }
      items.forEach((item, i) => {
        if (item.kind === 'goal') return
        const { count, target } = progress(item, board)
        const color = done[i] === true ? 'green' : 'red'
        const name = item.short ?? item.label
        segments.push({ text: item.kind === 'toggle' ? name : `${name} ${count}/${target}`, color })
      })
      return (
        <Box width={cardW} height={2} alignItems="center" columnGap={1}>
          <Box flexShrink={1}>
            <Text>
              {isLocked && <Text color="red">LOCKED · </Text>}
              {segments.map((segment, i) => (
                <Text>
                  <Text color={segment.color}>{segment.text}</Text>
                  {i < segments.length - 1 && <Text dimColor> · </Text>}
                </Text>
              ))}
              {isOverridden && <Text dimColor> · OVERRIDE</Text>}
            </Text>
          </Box>
          {spacer}
          <Button key="expand" label="Open" onPress={open} />
        </Box>
      )
    }

    // ---------- Expanded ----------

    const labelOf = (item: Item): string => {
      if (item.kind !== 'goal') return item.label
      const text = board.texts[item.id] ?? ''
      if (text !== '') return `${item.label} · ${text}`
      return goalCommand === '' ? `${config.goalName} · not set` : `${config.goalName} · set it with /${goalCommand}`
    }

    const mark = (index: number) => (
      <Box width={2} flexShrink={0}>
        {done[index] === true ? <Text color="green">✓</Text> : index === nextIndex ? <Text color="cyan">▸</Text> : <Text> </Text>}
      </Box>
    )

    const labelText = (item: Item, index: number) => (
      <Text color={done[index] === true ? 'green' : index === nextIndex ? 'cyan' : undefined} dimColor={done[index] === true}>
        {labelOf(item)}
      </Text>
    )

    const markers = (item: Item): RenderChildren => {
      if (item.kind !== 'counter' && item.kind !== 'checklist') return null
      const { count, target } = progress(item, board)
      const g = glyphs(item.marker ?? config.marker)
      return (
        <Text>
          <Text color="green">{g.on.repeat(Math.min(target, count))}</Text>
          <Text dimColor>{g.off.repeat(Math.max(0, target - count))}</Text>
        </Text>
      )
    }

    // Controls keep their place: a counter always shows both − and +.
    const controls = (item: Item, index: number): RenderChildren => {
      const isDone = done[index] === true
      const variant = index === nextIndex ? 'primary' : undefined
      if (item.kind === 'goal' || item.kind === 'toggle') {
        if (item.kind === 'goal' && (board.texts[item.id] ?? '') === '') return null
        return isDone ? (
          <Button key={item.id} dimColor label="Undo" onPress={flipCheck(item.id)} />
        ) : (
          <Button key={item.id} label="Done" variant={variant} onPress={flipCheck(item.id)} />
        )
      }
      if (item.kind === 'counter') {
        const count = board.counts[item.id] ?? 0
        return (
          <Box columnGap={1}>
            <Button key={`${item.id}-minus`} dimColor={count === 0} label="−" onPress={bump(item.id, -1)} />
            <Button key={`${item.id}-plus`} dimColor={isDone} label="+" variant={isDone ? undefined : variant} onPress={bump(item.id, 1)} />
          </Box>
        )
      }
      return (
        <Box columnGap={1}>
          {item.parts.map(part => {
            const key = `${item.id}.${part.id}`
            const isOn = board.checks[key] === true
            return <Button key={key} dimColor={isOn} label={isOn ? `${part.label} ✓` : part.label} onPress={flipCheck(key)} />
          })}
        </Box>
      )
    }

    const score = (
      <Text color={doneCount * 2 >= total ? 'green' : 'yellow'}>
        {doneCount}/{total}
      </Text>
    )
    const closeButton = <Button key="collapse" plain dimColor label="⌃ close" onPress={close} />
    const header = (
      <Box alignItems="center" columnGap={2}>
        <Text color={isLocked ? 'red' : 'cyan'}>{isLocked ? 'LOCKED' : config.title}</Text>
        <Text>
          <Text color="green">{'▰'.repeat(doneCount)}</Text>
          <Text dimColor>{'▱'.repeat(total - doneCount)}</Text>
        </Text>
        {score}
        {isOverridden && <Text dimColor>OVERRIDE</Text>}
        {spacer}
        {closeButton}
      </Box>
    )

    // The first layout that fits the band wins: the table with a header, the
    // table with the header in a gutter, the grid with a header, the grid
    // with a gutter. Past that the band scrolls.
    const maxRows = e.props.maxRows
    const gap = 3
    const gutterW = 9
    const half = Math.floor((cardW - gap) / 2)
    const halfWithGutter = Math.floor((cardW - gutterW - 1 - gap) / 2)
    const isTable = total * 2 <= maxRows
    const hasHeader = isTable ? total * 2 + 1 <= maxRows : pack(items, half).length * 2 + 1 <= maxRows

    const gutter = (rowIndex: number) =>
      hasHeader ? null : (
        <Box width={gutterW} flexShrink={0} justifyContent="flex-end">
          {rowIndex === 0 ? closeButton : rowIndex === 1 ? score : null}
        </Box>
      )

    if (isTable) {
      // One-column table: fixed label and marker slots, controls right-aligned.
      const labelW = Math.max(0, ...items.filter(i => i.kind !== 'goal').map(i => i.label.length)) + 1
      const markW = Math.ceil(Math.max(0, ...items.map(markerCount)) * 1.5) + 1
      return (
        <Box flexDirection="column" width={cardW}>
          {hasHeader && header}
          {items.map((item, index) => (
            <Box width={cardW} height={2} alignItems="center" columnGap={1}>
              {mark(index)}
              {item.kind === 'goal' ? (
                <Box flexShrink={1}>{labelText(item, index)}</Box>
              ) : (
                <>
                  <Box width={labelW} flexShrink={0}>
                    {labelText(item, index)}
                  </Box>
                  <Box width={markW} flexShrink={0}>
                    {markers(item)}
                  </Box>
                </>
              )}
              {spacer}
              <Box flexShrink={0}>{controls(item, index)}</Box>
              {gutter(index)}
            </Box>
          ))}
        </Box>
      )
    }

    // Two-column grid: buttons end at the two column edges, nowhere else.
    const cellW = hasHeader ? half : halfWithGutter
    const fullW = hasHeader ? cardW : cardW - gutterW - 1
    const cell = (width: number, item: Item) => {
      const index = items.indexOf(item)
      return (
        <Box width={width} height={2} alignItems="center" columnGap={1}>
          {mark(index)}
          <Box flexShrink={1}>{labelText(item, index)}</Box>
          <Box flexShrink={0}>{markers(item)}</Box>
          {spacer}
          <Box flexShrink={0}>{controls(item, index)}</Box>
        </Box>
      )
    }
    return (
      <Box flexDirection="column" width={cardW}>
        {hasHeader && header}
        {pack(items, cellW).map((row, rowIndex) => {
          const first = row[0]
          const second = row[1]
          if (first === undefined) return null
          return (
            <Box alignItems="center" columnGap={1}>
              {second === undefined ? (
                cell(fullW, first)
              ) : (
                <Box columnGap={gap}>
                  {cell(cellW, first)}
                  {cell(cellW, second)}
                </Box>
              )}
              {gutter(rowIndex)}
            </Box>
          )
        })}
      </Box>
    )
  })
}
