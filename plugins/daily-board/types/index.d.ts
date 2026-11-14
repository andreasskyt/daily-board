export type Marker = 'square' | 'circle' | 'bar'

export type Part = { id: string; label: string }

export type Item = { id: string; label: string; short?: string } & (
  | { kind: 'goal' }
  | { kind: 'toggle' }
  | { kind: 'counter'; target: number; marker?: Marker }
  | { kind: 'checklist'; parts: Part[]; marker?: Marker }
)

export type Board = {
  date: string
  counts: Record<string, number>
  checks: Record<string, boolean>
  texts: Record<string, string>
}

export type Override = { date: string; reason: string }

declare module 'claude-code' {
  interface PluginState {
    'daily-board': {
      board: Board | null
      items: Item[] | null
      override: Override | null
      isExpanded: boolean
    }
  }
}
