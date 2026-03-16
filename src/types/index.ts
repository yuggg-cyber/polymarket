/** 单个持仓仓位 */
export interface Position {
  title: string
  slug: string
  icon: string
  outcome: string
  size: number
  avgPrice: number
  currentValue: number
  curPrice: number
  cashPnl: number
  percentPnl: number
  totalBought: number
  realizedPnl: number
  redeemable: boolean
  mergeable: boolean
  endDate: string
}

/** 钱包分析数据 */
export interface WalletData {
  address: string
  /** 交易次数 */
  totalTrades: number
  /** 结算次数 */
  totalSettlements: number
  /** 交易额（USDC） */
  totalVolume: number
  /** 活跃天数 */
  activeDays: number
  /** 活跃周数 */
  activeWeeks: number
  /** 活跃月数 */
  activeMonths: number
  /** 活跃年数 */
  activeYears: number
  /** 可用余额（USDC，链上查询） */
  availableBalance: number
  /** 投资组合价值 */
  portfolioValue: number
  /** 净资产总计 = 可用余额 + 投资组合价值 */
  netWorth: number
  /** 当前持仓列表 */
  positions: Position[]
  /** 查询状态 */
  status: 'pending' | 'loading' | 'success' | 'error'
  errorMessage?: string
}

export type SortField =
  | 'totalTrades'
  | 'totalSettlements'
  | 'totalVolume'
  | 'activeDays'
  | 'activeWeeks'
  | 'activeMonths'
  | 'activeYears'
  | 'availableBalance'
  | 'portfolioValue'
  | 'netWorth'

export type SortDirection = 'asc' | 'desc'

export interface QueryProgress {
  total: number
  completed: number
  isLoading: boolean
}
