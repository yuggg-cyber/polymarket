export interface WalletData {
  address: string
  totalTrades: number
  totalVolume: number
  totalPnL: number
  roi: number
  winRate: number
  totalInvested: number
  totalReturn: number
  activeDays: number
  maxSingleTradePnL: number
  portfolioValue: number
  status: 'pending' | 'loading' | 'success' | 'error'
  errorMessage?: string
}

export type SortField = 
  | 'totalPnL'
  | 'roi'
  | 'winRate'
  | 'totalVolume'
  | 'totalTrades'
  | 'totalInvested'
  | 'totalReturn'
  | 'activeDays'
  | 'portfolioValue'

export type SortDirection = 'asc' | 'desc'

export interface QueryProgress {
  total: number
  completed: number
  isLoading: boolean
}
