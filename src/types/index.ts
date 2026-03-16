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
  /** 盈亏（历史累计，来自 lb-api） */
  profit: number
  /** 可用余额（链上 USDC.e 查询） */
  availableBalance: number
  /** 持仓估值（来自 data-api/value） */
  portfolioValue: number
  /** 净资产 = 可用余额 + 持仓估值 */
  netWorth: number
  /** 交易额（历史累计，来自 lb-api） */
  totalVolume: number
  /** 池子数（参与的市场数量） */
  marketsTraded: number
  /** 最后活跃（距今天数） */
  lastActiveDay: number | null
  /** 活跃天数 */
  activeDays: number
  /** 活跃月数 */
  activeMonths: number
  /** 当前持仓列表 */
  positions: Position[]
  /** 查询状态 */
  status: 'pending' | 'loading' | 'success' | 'error'
  errorMessage?: string
}

export type SortField =
  | 'netWorth'
  | 'profit'
  | 'availableBalance'
  | 'portfolioValue'
  | 'totalVolume'
  | 'marketsTraded'
  | 'lastActiveDay'
  | 'activeDays'
  | 'activeMonths'

export type SortDirection = 'asc' | 'desc'

export interface QueryProgress {
  total: number
  completed: number
  isLoading: boolean
}
