import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { DayUsage, Limit, Slice, Snapshot, Totals } from '../types'

// Usage panel: a side pane with every usage figure the engine gives a mod.
// Context window and rate limits come from the engine at each refresh; tokens,
// cost and tool calls are counted per turn and summed per day in the store,
// which every session on this computer shares.

const PANE = 'usage'
const TITLE = 'Usage'

// One color per thing, so a glance tells them apart.
const COLOR = {
  cyan: '#22D3EE',
  violet: '#A78BFA',
  pink: '#F472B6',
  amber: '#FBBF24',
  green: '#34D399',
  blue: '#60A5FA',
  orange: '#FB923C',
  red: '#F87171',
  teal: '#2DD4BF',
  lime: '#A3E635',
} as const
const SERIES = [COLOR.violet, COLOR.cyan, COLOR.pink, COLOR.amber, COLOR.blue, COLOR.teal, COLOR.orange, COLOR.lime]

// A connector's tools are named by an id. The option `mcp_names` gives them
// names, one "id=Name" per entry; the first 8 characters of the id are enough.
const readNames = (value: unknown): Record<string, string> => {
  const names: Record<string, string> = {}
  if (!Array.isArray(value)) return names
  for (const entry of value) {
    const match = typeof entry === 'string' ? entry.match(/^\s*([^=\s]+)\s*=\s*(.+?)\s*$/) : null
    if (match !== null) names[(match[1] ?? '').slice(0, 8)] = match[2] ?? ''
  }
  return names
}

const LIMIT_NAMES: Record<string, string> = {
  five_hour: '5-hour window',
  seven_day: 'Weekly window',
  spend_limit: 'Spend limit',
}

const snapshotAtom = atom({ plugin: 'usage-panel', key: 'snapshot' } as const, null as Snapshot | null)
const sessionAtom = atom({ plugin: 'usage-panel', key: 'session' } as const, null as DayUsage | null)
const totalsAtom = atom({ plugin: 'usage-panel', key: 'totals' } as const, null as Totals | null)

const emptyDay = (): DayUsage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  turns: 0,
  usd: 0,
  agents: 0,
  models: {},
  tools: {},
  mcp: {},
})

const dateKey = (time: number): string => {
  const d = new Date(time)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`
}

const addCounts = (into: Record<string, number>, from: Record<string, number>): Record<string, number> => {
  const out = { ...into }
  for (const [key, count] of Object.entries(from)) out[key] = (out[key] ?? 0) + count
  return out
}

const addDays = (a: DayUsage, b: DayUsage): DayUsage => {
  const models = { ...a.models }
  for (const [model, use] of Object.entries(b.models)) {
    const had = models[model] ?? { input: 0, output: 0 }
    models[model] = { input: had.input + use.input, output: had.output + use.output }
  }
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    turns: a.turns + b.turns,
    usd: a.usd + b.usd,
    agents: a.agents + b.agents,
    models,
    tools: addCounts(a.tools, b.tools),
    mcp: addCounts(a.mcp, b.mcp),
  }
}

// What happened since the last flush, kept in memory so a burst of tool calls
// is one store write.
let pending = emptyDay()

const mcpServer = (tool: string, names: Record<string, string>): string | null => {
  const match = tool.match(/^mcp__(.+?)__/)
  if (match === null) return null
  const id = match[1] ?? ''
  const isId = /^[0-9a-f]{8}-[0-9a-f-]{20,}$/.test(id)
  return names[id.slice(0, 8)] ?? (isId ? id.slice(0, 8) : id)
}

async function flush($: EngineInterface): Promise<void> {
  const delta = pending
  pending = emptyDay()
  const key = `day:${dateKey(await $.clock.now())}`
  const stored = ((await $.store.get(key)) as DayUsage | undefined) ?? emptyDay()
  await $.store.set(key, addDays(stored, delta))
  await update($, sessionAtom, session => addDays(session ?? emptyDay(), delta))
}

// One refresh at a time, so the cost that grew is counted once.
let isRefreshing = false

async function refresh($: EngineInterface): Promise<void> {
  if (isRefreshing) return
  isRefreshing = true
  try {
    await refreshNow($)
  } finally {
    isRefreshing = false
  }
}

async function refreshNow($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const usage = await $.session.usage({ breakdown: 'summary' })

  // The session's cost is the engine's own total; the day gets what it grew by.
  const session = (await read($, sessionAtom)) ?? emptyDay()
  const usd = usage.cost?.usd ?? session.usd
  pending.usd += Math.max(0, usd - session.usd)
  await flush($)

  const slices: Slice[] = (usage.context.breakdown?.categories ?? [])
    .filter(category => category.kind === 'used' && category.tokens > 0)
    .map(category => ({ name: category.name, tokens: category.tokens }))
    .sort((a, b) => b.tokens - a.tokens)
  const limits: Limit[] = usage.rateLimits.map(limit =>
    limit.resetsAt === undefined
      ? { kind: limit.kind, percentUsed: limit.percentUsed }
      : { kind: limit.kind, percentUsed: limit.percentUsed, resetsAt: limit.resetsAt },
  )
  const contextTokens = usage.context.tokens ?? 0
  const snapshot: Snapshot = {
    contextTokens,
    contextWindow: usage.context.window,
    contextPercent: usage.context.percent ?? Math.round((contextTokens / Math.max(1, usage.context.window)) * 100),
    slices,
    limits,
    at: now,
  }
  await update($, snapshotAtom, () => snapshot)

  let week = emptyDay()
  let month = emptyDay()
  let today = emptyDay()
  const days: { date: string; tokens: number }[] = []
  for (let back = 29; back >= 0; back--) {
    const date = dateKey(now - back * 86_400_000)
    const day = ((await $.store.get(`day:${date}`)) as DayUsage | undefined) ?? emptyDay()
    month = addDays(month, day)
    if (back < 7) {
      week = addDays(week, day)
      days.push({ date, tokens: day.input + day.output })
    }
    if (back === 0) today = day
  }
  const totals: Totals = { today, week, month, days }
  await update($, totalsAtom, () => totals)
}

// ---------- Formatting ----------

const tok = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`
  return String(Math.round(n))
}

const money = (n: number): string => `$${n.toFixed(n >= 100 ? 0 : 2)}`

const heat = (percent: number): string => (percent >= 85 ? COLOR.red : percent >= 60 ? COLOR.amber : COLOR.green)

const until = (iso: string | undefined, now: number): string => {
  if (iso === undefined) return ''
  const ms = new Date(iso).getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `resets in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `resets in ${hours}h ${minutes % 60}m`
  return `resets in ${Math.round(hours / 24)}d`
}

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

export const register: Register = (on, options) => {
  const config = options as Record<string, unknown>
  const names = readNames(config.mcp_names)
  const isAutoOpen = config.auto_open !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'meter', description: 'Opens the usage panel: context, limits, cost, tokens and tool calls' })
    $.clock.after(1_500, () => refresh($))
    $.clock.every(60_000, () => refresh($))
    if (isAutoOpen) await $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'meter' }, async $ => {
    void refresh($)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Usage panel opened.' }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const usage = e.usage
    if (usage !== undefined) {
      const had = pending.models[usage.model] ?? { input: 0, output: 0 }
      pending = {
        ...pending,
        input: pending.input + usage.input_tokens,
        output: pending.output + usage.output_tokens,
        cacheRead: pending.cacheRead + usage.cache_read_input_tokens,
        cacheWrite: pending.cacheWrite + usage.cache_creation_input_tokens,
        turns: pending.turns + 1,
        models: { ...pending.models, [usage.model]: { input: had.input + usage.input_tokens, output: had.output + usage.output_tokens } },
      }
    }
    void refresh($)
    return result
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const name = String(e.tool)
    const server = mcpServer(name, names)
    if (server === null) pending.tools[name] = (pending.tools[name] ?? 0) + 1
    else pending.mcp[server] = (pending.mcp[server] ?? 0) + 1
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    pending.agents += 1
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const snapshot = await read($, snapshotAtom)
    const session = (await read($, sessionAtom)) ?? emptyDay()
    const totals = await read($, totalsAtom)
    const cols = e.props.bodyColumns

    if (snapshot === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Reading usage…</Text>
          <Box height={2} alignItems="center">
            <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
          </Box>
        </Box>
      )
    }

    // The minimized pane: three figures that read at a glance.
    if (e.props.placement === 'widget') {
      const worst = snapshot.limits.reduce((max, limit) => Math.max(max, limit.percentUsed), 0)
      return (
        <Text>
          <Text color={heat(snapshot.contextPercent)}>ctx {snapshot.contextPercent}%</Text>
          <Text dimColor> · </Text>
          <Text color={heat(worst)}>limit {Math.round(worst)}%</Text>
          <Text dimColor> · </Text>
          <Text color={COLOR.green}>{money(session.usd)}</Text>
        </Text>
      )
    }

    // Bars are drawn in glyphs, about 1.5 cells each on desktop.
    const barW = Math.max(12, Math.min(40, Math.floor(cols / 1.6)))

    const title = (text: string, color: string): RenderChildren => <Text color={color}>{text}</Text>
    const gapRow = <Text> </Text>

    const meter = (percent: number, color: string): RenderChildren => {
      const filled = Math.max(percent > 0 ? 1 : 0, Math.min(barW, Math.round((percent / 100) * barW)))
      return (
        <Text>
          <Text color={color}>{'█'.repeat(filled)}</Text>
          <Text dimColor>{'░'.repeat(barW - filled)}</Text>
        </Text>
      )
    }

    // Context: one stacked bar, a color per category.
    const shown = snapshot.slices.slice(0, SERIES.length)
    let used = 0
    const segments = shown.map((slice, i) => {
      const width = Math.min(barW - used, Math.max(1, Math.round((slice.tokens / Math.max(1, snapshot.contextWindow)) * barW)))
      used += width
      return { slice, width, color: SERIES[i] ?? COLOR.cyan }
    })
    const flatFill = Math.max(snapshot.contextPercent > 0 ? 1 : 0, Math.round((snapshot.contextPercent / 100) * barW))

    const sortedCounts = (counts: Record<string, number>): [string, number][] =>
      Object.entries(counts).sort((a, b) => b[1] - a[1])
    const today = totals?.today ?? emptyDay()
    const mcpRows = sortedCounts(today.mcp).slice(0, 6)
    const mcpMax = Math.max(1, ...mcpRows.map(row => row[1]))
    const toolRows = sortedCounts(today.tools).slice(0, 5)
    const modelRows = Object.entries(session.models).sort((a, b) => b[1].output - a[1].output).slice(0, 3)

    const dayMax = Math.max(1, ...(totals?.days ?? []).map(day => day.tokens))
    const spark = (totals?.days ?? [])
      .map(day => SPARK[Math.min(SPARK.length - 1, Math.floor((day.tokens / dayMax) * (SPARK.length - 1)))] ?? '▁')
      .join('')

    const period = (label: string, day: DayUsage, color: string): RenderChildren => (
      <Text>
        <Text color={color}>{label.padEnd(8)}</Text>
        <Text>{tok(day.input + day.output)} tokens</Text>
        <Text dimColor> · </Text>
        <Text color={COLOR.green}>{money(day.usd)}</Text>
        <Text dimColor> · {day.turns} turns</Text>
      </Text>
    )

    return (
      <Box flexDirection="column">
        {title('CONTEXT WINDOW', COLOR.cyan)}
        {segments.length > 0 ? (
          <Text>
            {segments.map(segment => (
              <Text color={segment.color}>{'█'.repeat(segment.width)}</Text>
            ))}
            <Text dimColor>{'░'.repeat(Math.max(0, barW - used))}</Text>
          </Text>
        ) : (
          <Text>
            <Text color={heat(snapshot.contextPercent)}>{'█'.repeat(Math.min(barW, flatFill))}</Text>
            <Text dimColor>{'░'.repeat(Math.max(0, barW - flatFill))}</Text>
          </Text>
        )}
        <Text>
          <Text color={heat(snapshot.contextPercent)}>{snapshot.contextPercent}%</Text>
          <Text dimColor>
            {' '}
            · {tok(snapshot.contextTokens)} of {tok(snapshot.contextWindow)}
          </Text>
        </Text>
        {segments.map(segment => (
          <Text>
            <Text color={segment.color}>■ </Text>
            <Text>{segment.slice.name}</Text>
            <Text dimColor> {tok(segment.slice.tokens)}</Text>
          </Text>
        ))}
        {gapRow}

        {title('PLAN LIMITS · all your devices', COLOR.violet)}
        {snapshot.limits.length === 0 ? (
          <Text dimColor>No reading yet. It appears after the next response.</Text>
        ) : (
          snapshot.limits.map(limit => (
            <Box flexDirection="column">
              <Text>
                <Text>{LIMIT_NAMES[limit.kind] ?? limit.kind} </Text>
                <Text color={heat(limit.percentUsed)}>{limit.percentUsed}%</Text>
                <Text dimColor> {until(limit.resetsAt, snapshot.at)}</Text>
              </Text>
              {meter(Math.min(100, limit.percentUsed), heat(limit.percentUsed))}
            </Box>
          ))
        )}
        {gapRow}

        {title('THIS SESSION', COLOR.pink)}
        <Text>
          <Text color={COLOR.green}>{money(session.usd)}</Text>
          <Text dimColor> · {session.turns} turns · {session.agents} agents</Text>
        </Text>
        <Text>
          <Text color={COLOR.blue}>in {tok(session.input)}</Text>
          <Text dimColor> · </Text>
          <Text color={COLOR.pink}>out {tok(session.output)}</Text>
        </Text>
        <Text>
          <Text color={COLOR.teal}>cache read {tok(session.cacheRead)}</Text>
          <Text dimColor> · </Text>
          <Text color={COLOR.orange}>write {tok(session.cacheWrite)}</Text>
        </Text>
        {modelRows.map(([model, use], i) => (
          <Text>
            <Text color={SERIES[i] ?? COLOR.cyan}>■ </Text>
            <Text>{model.replace(/^claude-/, '')}</Text>
            <Text dimColor>
              {' '}
              in {tok(use.input)} · out {tok(use.output)}
            </Text>
          </Text>
        ))}
        {gapRow}

        {title('THIS COMPUTER', COLOR.amber)}
        {period('Today', today, COLOR.amber)}
        {period('7 days', totals?.week ?? emptyDay(), COLOR.orange)}
        {period('30 days', totals?.month ?? emptyDay(), COLOR.red)}
        {spark !== '' && (
          <Text>
            <Text color={COLOR.amber}>{spark}</Text>
            <Text dimColor> last 7 days</Text>
          </Text>
        )}
        {gapRow}

        {title('MCP AND TOOLS · today', COLOR.teal)}
        {mcpRows.length === 0 && toolRows.length === 0 && <Text dimColor>No tool calls counted yet today.</Text>}
        {mcpRows.map(([server, count], i) => (
          <Text>
            <Text color={SERIES[i] ?? COLOR.teal}>{'█'.repeat(Math.max(1, Math.round((count / mcpMax) * Math.floor(barW / 2))))}</Text>
            <Text> {server}</Text>
            <Text dimColor> {count}</Text>
          </Text>
        ))}
        {toolRows.length > 0 && (
          <Text>
            {toolRows.map(([tool, count], i) => (
              <Text>
                <Text color={COLOR.blue}>{tool}</Text>
                <Text dimColor>
                  {' '}
                  {count}
                  {i < toolRows.length - 1 ? ' · ' : ''}
                </Text>
              </Text>
            ))}
          </Text>
        )}
        {gapRow}

        <Box height={2} alignItems="center" columnGap={1}>
          <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
          <Text dimColor>cost is the API-equivalent price</Text>
        </Box>
      </Box>
    )
  })
}
