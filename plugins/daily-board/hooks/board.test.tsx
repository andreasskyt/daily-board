import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code/testing'

const BAND = {
  plugin: 'daily-board',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 85,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

// What stands beneath the plugin in every test: a store and a clock in
// memory, and the engine's answers to the registrations the mod makes.
const world = (on: On, now = 0): void => {
  mock.store(on)
  mock.clock(on, { now })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__daily-board__${e.name}` } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

const start = { cwd: '/', surface: 'desktop', isInteractive: true } as const

test('the starter board draws on terminal and desktop, with three goals', async ($, on) => {
  world(on)
  await $.session.start(start)
  const answer = await $.command.run({ command: 'mit', args: 'call COAD | send offers | write post' })
  expect(answer.text).toBe('MIT 1: call COAD · MIT 2: send offers · MIT 3: write post')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /MIT 0\/3/ })) !== undefined).toBe(true)
    await ui.press({ key: 'expand' })
    expect((await ui.find({ type: 'Text', text: /MIT 2 · send offers/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Button', key: 'connections-plus' })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Button', key: 'connections-minus' })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Button', key: 'inbox.email' })) !== undefined).toBe(true)
    await ui.press({ key: 'collapse' })
    await ui.unmount()
  }
})

test('buttons change the board: done, plus, minus and a checklist part', async ($, on) => {
  world(on)
  await $.session.start(start)
  await $.command.run({ command: 'mit', args: 'one goal' })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'expand' })
  await ui.press({ key: 'goal1' })
  expect((await ui.find({ type: 'Button', key: 'goal1' }))?.text).toBe('Undo')

  await ui.press({ key: 'connections-plus' })
  await ui.press({ key: 'connections-plus' })
  await ui.press({ key: 'connections-minus' })
  await ui.press({ key: 'inbox.email' })
  expect((await ui.find({ type: 'Button', key: 'inbox.email' }))?.text).toBe('Email ✓')

  await ui.press({ key: 'collapse' })
  expect((await ui.find({ type: 'Text', text: /LI 1\/10/ })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /Inbox 1\/3/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test('the set tool replaces the items and refuses a bad list', async ($, on) => {
  world(on)
  await $.session.start(start)

  const bad = await $.tool.call({ tool: 'mcp__daily-board__set', items: [{ label: 'Reps', kind: 'counter' }] })
  expect(String(bad.result)).toContain('Not saved')

  const saved = await $.tool.call({
    tool: 'mcp__daily-board__set',
    items: [
      { label: 'Deep work', kind: 'counter', target: 3, marker: 'circle' },
      { label: 'Ship one thing', kind: 'toggle' },
      { label: 'Inbox', kind: 'checklist', parts: ['Email', 'Chat'] },
    ],
  })
  expect(String(saved.result)).toContain('Saved 3 items')

  const current = await $.tool.call({ tool: 'mcp__daily-board__get' })
  expect(String(current.result)).toContain('"label":"Deep work"')

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'expand' })
  expect((await ui.find({ type: 'Button', key: 'deep-work-plus' })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Button', key: 'ship-one-thing' }))?.text).toBe('Done')
  expect((await ui.find({ type: 'Button', key: 'inbox.chat' })) !== undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /○○○/ })) !== undefined).toBe(true)
  await ui.unmount()
})

test(
  'options rename the goal, its command and the title',
  { options: { title: 'TODAY', goal_name: 'Focus', goal_slots: 1, marker: 'bar', gate: false } },
  async ($, on) => {
    world(on)
    await $.session.start(start)
    const answer = await $.command.run({ command: 'focus', args: 'finish the deck' })
    expect(answer.text).toBe('Focus 1: finish the deck')

    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 20 }, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /Focus: finish the deck/ })) !== undefined).toBe(true)
    await ui.press({ key: 'expand' })
    expect((await ui.find({ type: 'Text', text: /TODAY/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /Focus · finish the deck/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /▱▱▱▱▱/ })) !== undefined).toBe(true)
    await ui.unmount()
  },
)

test('no goal slots: no goal command row, only the items', { options: { goal_slots: 0 } }, async ($, on) => {
  world(on)
  await $.session.start(start)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /MIT/ })) === undefined).toBe(true)
  expect((await ui.find({ type: 'Text', text: /Post/ })) !== undefined).toBe(true)
  await ui.unmount()
})

// The gate reads the engine's clock, so a test picks the day.
const MONDAY = new Date(2026, 10, 16, 10, 0, 0).getTime()
const SATURDAY = new Date(2026, 10, 14, 10, 0, 0).getTime()

test('the gate refuses Bash on a weekday until OVERRIDE', { options: { gate: true } }, async ($, on) => {
  world(on, MONDAY)
  on('tool.call', () => ({ result: 'ran' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.toast', () => ({ value: {} }))
  await $.session.start(start)

  const locked = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(JSON.stringify(locked)).toContain('"deny":"Daily board gate is locked: Connections 0/10')

  await $.prompt.submit({ text: 'OVERRIDE shipping a client fix' })
  const opened = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(JSON.stringify(opened)).not.toContain('deny')
})

test('the gate is open on a weekend, and off by default on a weekday', { options: { gate: true } }, async ($, on) => {
  world(on, SATURDAY)
  on('tool.call', () => ({ result: 'ran' }))
  await $.session.start(start)
  const weekend = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(JSON.stringify(weekend)).not.toContain('deny')
})

test('with the gate option off nothing is refused', async ($, on) => {
  world(on, MONDAY)
  on('tool.call', () => ({ result: 'ran' }))
  await $.session.start(start)
  const free = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(JSON.stringify(free)).not.toContain('deny')
})

test('a goal command another plugin owns falls back to a prefixed name', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('command.register', (_, e) => {
    if (e.name === 'mit') throw new Error('"/mit" refused: another plugin registered it already')
    return { value: { command: e.name } }
  })
  on('tool.register', (_, e) => ({ value: { tool: `mcp__daily-board__${e.name}` } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start(start)

  const answer = await $.command.run({ command: 'board-mit', args: 'call the client' })
  expect(answer.text).toBe('MIT 1: call the client')
  const current = await $.tool.call({ tool: 'mcp__daily-board__get' })
  expect(String(current.result)).toContain('"goal_command":"/board-mit"')
})
