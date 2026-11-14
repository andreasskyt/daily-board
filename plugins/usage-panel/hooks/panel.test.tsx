import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code/testing'

const PANE = {
  plugin: 'usage-panel',
  component: 'Pane',
  requestId: 'usage',
  props: {
    title: 'Usage',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const world = (on: On, usd: () => number): void => {
  mock.store(on)
  mock.clock(on, { now: new Date(2026, 10, 16, 10, 0, 0).getTime() })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: 'done' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: {
        tokens: 120_000,
        window: 1_000_000,
        percent: 12,
        breakdown: {
          categories: [
            { name: 'Messages', tokens: 90_000, color: 'text', isDeferred: false, kind: 'used' },
            { name: 'System tools', tokens: 30_000, color: 'text', isDeferred: false, kind: 'used' },
            { name: 'Free space', tokens: 880_000, color: 'text', isDeferred: false, kind: 'free' },
          ],
        },
      },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 37.5, resetsAt: new Date(2026, 10, 16, 12, 14, 0).toISOString() },
        { kind: 'seven_day', percentUsed: 91 },
      ],
      cost: { usd: usd() },
    },
  }))
}

test(
  'the panel shows context, limits, session and day totals on desktop and terminal',
  { options: { mcp_names: ['1a2b3c4d=Attio'] } },
  async ($, on) => {
  let usd = 0
  world(on, () => usd)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'mcp__1a2b3c4d-0000-4000-8000-000000000000__list-records', object: 'deals' })
  usd = 1.5
  await $.turn.complete({
    reason: 'answer',
    answer: 'hi',
    durationMs: 1000,
    isAborted: false,
    turnId: 't1',
    usage: { model: 'claude-fable-5-2', input_tokens: 1_000, output_tokens: 4_000, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 2_000 },
  })

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })
    const missing: string[] = []
    for (const pattern of [/CONTEXT WINDOW/, /120k of 1\.0M/, /Messages/, /5-hour window/, /resets in 2h 14m/, /Weekly window/, /\$1\.50/, /out 4\.0k/, /Attio/, /fable-5-2/]) {
      if ((await ui.find({ type: 'Text', text: pattern })) === undefined) missing.push(String(pattern))
    }
    expect(missing).toEqual([])
    await ui.unmount()
  }
  },
)

test('cost that grows is added to the day once, however often it refreshes', async ($, on) => {
  let usd = 2
  world(on, () => usd)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'refresh' })
  usd = 3
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'refresh' })
  expect((await ui.find({ type: 'Text', text: /Today/ })) !== undefined).toBe(true)
  const today = await ui.find({ type: 'Text', text: /Today/ })
  expect(String(today?.text)).toContain('$3.00')
  await ui.unmount()
})

test('the minimized panel shows three figures', async ($, on) => {
  world(on, () => 0.25)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const full = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await full.press({ key: 'refresh' })
  await full.unmount()
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget' }, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /ctx 12%/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /limit 91%/ })) !== undefined).toBe(true)
  await ui.unmount()
})
