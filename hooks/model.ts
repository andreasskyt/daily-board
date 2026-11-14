import type { Board, Item, Marker, Part } from '../types'

// The board's rules, free of the engine: config, validation, progress and the
// layout packing. register.tsx draws from these.

export type Config = {
  title: string
  goalName: string
  goalSlots: number
  marker: Marker
  isGateOn: boolean
}

// The starter board, used until the setup skill stores the person's own.
export const STARTER_ITEMS: Item[] = [
  { id: 'post', kind: 'toggle', label: 'LinkedIn Post', short: 'Post' },
  { id: 'connections', kind: 'counter', label: 'Connections', short: 'LI', target: 10 },
  {
    id: 'inbox',
    kind: 'checklist',
    label: 'Lead Inbox',
    short: 'Inbox',
    parts: [
      { id: 'linkedin', label: 'LinkedIn' },
      { id: 'email', label: 'Email' },
      { id: 'instagram', label: 'Instagram' },
    ],
  },
  { id: 'outreaches', kind: 'counter', label: 'Outreaches', short: 'Out', target: 5 },
  { id: 'follow-ups', kind: 'counter', label: 'Follow Ups', short: 'FU', target: 5 },
]

export const MAX_ITEMS = 10
const MAX_LABEL = 28
const MAX_TARGET = 20
const MAX_PARTS = 5

const MARKERS: Marker[] = ['square', 'circle', 'bar']

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export const toMarker = (value: unknown): Marker | undefined =>
  MARKERS.find(marker => marker === text(value).toLowerCase())

export const readConfig = (options: Record<string, unknown>): Config => {
  const slots = typeof options.goal_slots === 'number' ? Math.round(options.goal_slots) : 3
  return {
    title: text(options.title) || 'THE DAY',
    goalName: text(options.goal_name) || 'MIT',
    goalSlots: Math.min(3, Math.max(0, slots)),
    marker: toMarker(options.marker) ?? 'square',
    isGateOn: options.gate === true,
  }
}

export const slug = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// Checks what the setup skill sends and turns it into items, or says in one
// sentence what to fix.
export const validateItems = (input: unknown): { items: Item[] } | { error: string } => {
  if (!Array.isArray(input)) return { error: 'items must be a list.' }
  if (input.length === 0) return { error: 'Give at least one item.' }
  if (input.length > MAX_ITEMS) return { error: `At most ${MAX_ITEMS} items.` }
  const items: Item[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) return { error: 'Each item must be an object.' }
    const row = raw as Record<string, unknown>
    const label = text(row.label)
    if (label === '') return { error: 'Every item needs a label.' }
    if (label.length > MAX_LABEL) return { error: `"${label}" is too long: labels are at most ${MAX_LABEL} characters.` }
    let id = slug(label) || `item-${items.length + 1}`
    while (seen.has(id) || /^goal\d$/.test(id)) id = `${id}-${items.length + 1}`
    seen.add(id)
    const short = text(row.short)
    const base = short === '' ? { id, label } : { id, label, short: short.slice(0, 10) }
    const marker = toMarker(row.marker)
    const kind = text(row.kind)
    if (kind === 'toggle') {
      items.push({ ...base, kind: 'toggle' })
    } else if (kind === 'counter') {
      const target = typeof row.target === 'number' ? Math.round(row.target) : 0
      if (target < 1 || target > MAX_TARGET) return { error: `"${label}" needs a target from 1 to ${MAX_TARGET}.` }
      items.push(marker === undefined ? { ...base, kind: 'counter', target } : { ...base, kind: 'counter', target, marker })
    } else if (kind === 'checklist') {
      const labels = Array.isArray(row.parts) ? row.parts.map(text).filter(part => part !== '') : []
      if (labels.length < 2 || labels.length > MAX_PARTS) return { error: `"${label}" needs 2 to ${MAX_PARTS} parts.` }
      const parts: Part[] = labels.map((partLabel, i) => ({ id: slug(partLabel) || `part-${i + 1}`, label: partLabel.slice(0, 14) }))
      if (new Set(parts.map(part => part.id)).size !== parts.length) return { error: `"${label}" has two parts with the same name.` }
      items.push(marker === undefined ? { ...base, kind: 'checklist', parts } : { ...base, kind: 'checklist', parts, marker })
    } else {
      return { error: `"${label}" has kind "${kind}": use toggle, counter or checklist.` }
    }
  }
  return { items }
}

export const describeItems = (items: Item[]): string =>
  items
    .map(item => {
      if (item.kind === 'counter') return `${item.label} (counter to ${item.target})`
      if (item.kind === 'checklist') return `${item.label} (checklist: ${item.parts.map(part => part.label).join(', ')})`
      return `${item.label} (${item.kind})`
    })
    .join(' · ')

// ---------- Goals ----------

export const goalId = (slot: number): string => `goal${slot}`

export const goalText = (board: Board, slot: number): string => board.texts[goalId(slot)] ?? ''

// The goal slots set today, in order; slot 1 alone while none is set, so the
// board can say how to set one. None when the board has no goal slots.
export const activeGoalSlots = (board: Board, config: Config): number[] => {
  if (config.goalSlots === 0) return []
  const slots: number[] = []
  for (let slot = 1; slot <= config.goalSlots; slot++) if (goalText(board, slot) !== '') slots.push(slot)
  return slots.length > 0 ? slots : [1]
}

export const itemsOf = (board: Board, tasks: Item[], config: Config): Item[] => {
  const goals: Item[] = activeGoalSlots(board, config).map(slot => ({
    id: goalId(slot),
    kind: 'goal',
    label: config.goalSlots === 1 ? config.goalName : `${config.goalName} ${slot}`,
  }))
  return [...goals, ...tasks]
}

// "a | b | c" sets the goals in order, "2 text" sets one slot, "clear" empties
// them. Returns the new board and what to say.
export const applyGoalCommand = (board: Board, args: string, config: Config, command: string): { board: Board; text: string } => {
  const max = config.goalSlots
  const setSlots = (texts: string[]): Board => {
    const next = { ...board, texts: { ...board.texts }, checks: { ...board.checks } }
    for (let slot = 1; slot <= max; slot++) {
      const value = (texts[slot - 1] ?? '').trim()
      if (value !== (next.texts[goalId(slot)] ?? '')) next.checks[goalId(slot)] = false
      next.texts[goalId(slot)] = value
    }
    return next
  }
  const summary = (b: Board): string =>
    activeGoalSlots(b, config)
      .filter(slot => goalText(b, slot) !== '')
      .map(slot => `${config.goalName} ${slot}: ${goalText(b, slot)}`)
      .join(' · ') || `No ${config.goalName} set.`

  const usage =
    max === 1
      ? `Usage: /${command} <goal>   or   /${command} clear`
      : `Usage: /${command} <goal> | <goal 2>${max === 3 ? ' | <goal 3>' : ''}   or   /${command} 2 <goal>   or   /${command} clear`
  if (args === '') return { board, text: `${summary(board)}\n${usage}` }
  if (args.toLowerCase() === 'clear') return { board: setSlots([]), text: `${config.goalName} cleared.` }
  const one = args.match(/^([1-3])\s+(.+)$/s)
  if (one !== null && !args.includes('|') && max > 1) {
    const slot = Number(one[1])
    if (slot > max) return { board, text: `Only ${max} ${config.goalName} slots. ${usage}` }
    const next = setSlots([1, 2, 3].map(s => (s === slot ? one[2] ?? '' : goalText(board, s))))
    return { board: next, text: summary(next) }
  }
  const parts = args.split('|').map(part => part.trim()).filter(part => part !== '')
  if (parts.length > max) return { board, text: `Only ${max} ${config.goalName} slot${max === 1 ? '' : 's'}. ${usage}` }
  const next = setSlots(parts)
  return { board: next, text: summary(next) }
}

// ---------- Progress ----------

export const progress = (item: Item, board: Board): { count: number; target: number } => {
  if (item.kind === 'counter') return { count: board.counts[item.id] ?? 0, target: item.target }
  if (item.kind === 'checklist') {
    const count = item.parts.filter(part => board.checks[`${item.id}.${part.id}`] === true).length
    return { count, target: item.parts.length }
  }
  return { count: board.checks[item.id] === true ? 1 : 0, target: 1 }
}

export const glyphs = (marker: Marker): { on: string; off: string } => {
  if (marker === 'circle') return { on: '●', off: '○' }
  if (marker === 'bar') return { on: '▰', off: '▱' }
  return { on: '■', off: '□' }
}

export const markerCount = (item: Item): number =>
  item.kind === 'counter' ? item.target : item.kind === 'checklist' ? item.parts.length : 0

// ---------- Layout ----------
// Measured on desktop: a native Button needs a row of height 2 and a marker
// glyph is about 1.5 cells wide.

// Estimated cell width of an item, in band cells, for the grid.
const estimate = (item: Item): number => {
  const base = 2 + item.label.length + 2
  if (item.kind === 'counter') return base + Math.ceil(item.target * 1.5) + 9
  if (item.kind === 'toggle') return base + 8
  return Number.POSITIVE_INFINITY
}

// Grid: a row holds one full-width item or two that both fit half the card.
export const pack = (items: Item[], half: number): Item[][] => {
  const rows: Item[][] = []
  let isOpen = false
  for (const item of items) {
    const fitsHalf = estimate(item) <= half - 1
    const last = rows[rows.length - 1]
    if (fitsHalf && isOpen && last !== undefined && last.length === 1) {
      last.push(item)
      isOpen = false
    } else {
      rows.push([item])
      isOpen = fitsHalf
    }
  }
  return rows
}
