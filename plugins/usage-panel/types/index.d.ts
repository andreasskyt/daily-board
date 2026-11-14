export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

// One day's usage on this computer, summed over every session that ran the mod.
export type DayUsage = Tokens & {
  turns: number
  usd: number
  agents: number
  models: Record<string, { input: number; output: number }>
  tools: Record<string, number>
  mcp: Record<string, number>
}

export type Slice = { name: string; tokens: number }

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// What the engine reported at the last refresh.
export type Snapshot = {
  contextTokens: number
  contextWindow: number
  contextPercent: number
  slices: Slice[]
  limits: Limit[]
  at: number
}

export type Totals = {
  today: DayUsage
  week: DayUsage
  month: DayUsage
  days: { date: string; tokens: number }[]
}

declare module 'claude-code' {
  interface PluginState {
    'usage-panel': {
      snapshot: Snapshot | null
      session: DayUsage | null
      totals: Totals | null
    }
  }
}
