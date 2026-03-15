import type { WalletData } from '@/types'

const GAMMA_API = 'https://gamma-api.polymarket.com'
const DATA_API = 'https://data-api.polymarket.com'

// ============================================================
// Types for API responses
// ============================================================

interface ProfileResponse {
  proxyWallet: string | null
  name: string | null
  pseudonym: string | null
}

interface ClosedPosition {
  proxyWallet: string
  conditionId: string
  avgPrice: number
  totalBought: number
  realizedPnl: number
  curPrice: number
  timestamp: number
  title: string
  outcome: string
}

interface OpenPosition {
  proxyWallet: string
  conditionId: string
  size: number
  avgPrice: number
  initialValue: number
  currentValue: number
  cashPnl: number
  percentPnl: number
  totalBought: number
  realizedPnl: number
  curPrice: number
  title: string
  outcome: string
}

interface Activity {
  proxyWallet: string
  timestamp: number
  conditionId: string
  type: string
  size: number
  usdcSize: number
  price: number
  side: string
}

interface ValueResponse {
  user: string
  value: number
}

// ============================================================
// API helper with retry
// ============================================================

async function fetchJSON<T>(url: string, retries = 2): Promise<T> {
  let lastError: Error | null = null

  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      return await response.json() as T
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (i < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)))
      }
    }
  }

  throw lastError
}

// ============================================================
// Data fetching functions
// ============================================================

async function getProfile(address: string): Promise<ProfileResponse | null> {
  try {
    const data = await fetchJSON<ProfileResponse>(
      `${GAMMA_API}/public-profile?address=${address}`
    )
    return data
  } catch {
    return null
  }
}

async function getAllClosedPositions(proxyWallet: string): Promise<ClosedPosition[]> {
  const allPositions: ClosedPosition[] = []
  const limit = 50
  let offset = 0
  const maxIterations = 20 // Safety limit: 50 * 20 = 1000 positions max

  for (let i = 0; i < maxIterations; i++) {
    const batch = await fetchJSON<ClosedPosition[]>(
      `${DATA_API}/closed-positions?user=${proxyWallet}&limit=${limit}&offset=${offset}&sortBy=TIMESTAMP&sortDirection=DESC`
    )
    allPositions.push(...batch)

    if (batch.length < limit) break
    offset += limit
  }

  return allPositions
}

async function getOpenPositions(proxyWallet: string): Promise<OpenPosition[]> {
  const allPositions: OpenPosition[] = []
  const limit = 500
  let offset = 0
  const maxIterations = 5

  for (let i = 0; i < maxIterations; i++) {
    const batch = await fetchJSON<OpenPosition[]>(
      `${DATA_API}/positions?user=${proxyWallet}&limit=${limit}&offset=${offset}&sizeThreshold=0.01`
    )
    allPositions.push(...batch)

    if (batch.length < limit) break
    offset += limit
  }

  return allPositions
}

async function getAllActivities(proxyWallet: string): Promise<Activity[]> {
  const allActivities: Activity[] = []
  const limit = 500
  let offset = 0
  const maxOffset = 3000 // API hard limit

  while (offset <= maxOffset) {
    try {
      const batch = await fetchJSON<Activity[]>(
        `${DATA_API}/activity?user=${proxyWallet}&limit=${limit}&offset=${offset}`
      )
      allActivities.push(...batch)

      if (batch.length < limit) break
      offset += limit
    } catch {
      break
    }
  }

  return allActivities
}

async function getPortfolioValue(proxyWallet: string): Promise<number> {
  try {
    const data = await fetchJSON<ValueResponse[]>(
      `${DATA_API}/value?user=${proxyWallet}`
    )
    if (data && data.length > 0) {
      return data[0].value || 0
    }
    return 0
  } catch {
    return 0
  }
}

// ============================================================
// Calculation logic
// ============================================================

function calculateMetrics(
  closedPositions: ClosedPosition[],
  openPositions: OpenPosition[],
  activities: Activity[],
  portfolioValue: number
): Omit<WalletData, 'address' | 'status' | 'errorMessage'> {
  // --- Trade count and volume from activities ---
  const trades = activities.filter(a => a.type === 'TRADE')
  const totalTrades = trades.length
  const totalVolume = trades.reduce((sum, t) => sum + (t.usdcSize || 0), 0)

  // --- Active days from activity timestamps ---
  const activeDaysSet = new Set<string>()
  for (const activity of activities) {
    if (activity.timestamp) {
      const date = new Date(activity.timestamp * 1000)
      activeDaysSet.add(date.toISOString().split('T')[0])
    }
  }
  const activeDays = activeDaysSet.size

  // --- Realized P&L from closed positions ---
  const realizedPnL = closedPositions.reduce((sum, p) => sum + (p.realizedPnl || 0), 0)

  // --- Unrealized P&L from open positions ---
  const unrealizedPnL = openPositions.reduce((sum, p) => sum + (p.cashPnl || 0), 0)

  // --- Total P&L ---
  const totalPnL = realizedPnL + unrealizedPnL

  // --- Win rate from closed positions ---
  const totalClosedPositions = closedPositions.length
  const winningPositions = closedPositions.filter(p => (p.realizedPnl || 0) > 0).length
  const winRate = totalClosedPositions > 0
    ? (winningPositions / totalClosedPositions) * 100
    : 0

  // --- Total invested ---
  const closedInvested = closedPositions.reduce((sum, p) => sum + (p.totalBought || 0), 0)
  const openInvested = openPositions.reduce((sum, p) => sum + (p.initialValue || 0), 0)
  const totalInvested = closedInvested + openInvested

  // --- Total return ---
  const totalReturn = totalInvested + totalPnL

  // --- ROI ---
  const roi = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0

  // --- Max single trade P&L ---
  let maxSingleTradePnL = 0
  if (closedPositions.length > 0) {
    const pnls = closedPositions.map(p => p.realizedPnl || 0)
    const maxProfit = Math.max(...pnls)
    const maxLoss = Math.min(...pnls)
    maxSingleTradePnL = Math.abs(maxProfit) >= Math.abs(maxLoss) ? maxProfit : maxLoss
  }

  return {
    totalTrades,
    totalVolume,
    totalPnL,
    roi,
    winRate,
    totalInvested,
    totalReturn,
    activeDays,
    maxSingleTradePnL,
    portfolioValue,
  }
}

// ============================================================
// Main export: fetch all data for a wallet
// ============================================================

export async function fetchWalletData(address: string): Promise<WalletData> {
  try {
    // Step 1: Get profile to resolve proxy wallet
    const profile = await getProfile(address)
    const proxyWallet = profile?.proxyWallet || address

    // Step 2: Fetch all data in parallel
    const [closedPositions, openPositions, activities, portfolioValue] = await Promise.all([
      getAllClosedPositions(proxyWallet),
      getOpenPositions(proxyWallet),
      getAllActivities(proxyWallet),
      getPortfolioValue(proxyWallet),
    ])

    // Step 3: Calculate metrics
    const metrics = calculateMetrics(closedPositions, openPositions, activities, portfolioValue)

    return {
      address,
      ...metrics,
      status: 'success',
    }
  } catch (error) {
    return {
      address,
      totalTrades: 0,
      totalVolume: 0,
      totalPnL: 0,
      roi: 0,
      winRate: 0,
      totalInvested: 0,
      totalReturn: 0,
      activeDays: 0,
      maxSingleTradePnL: 0,
      portfolioValue: 0,
      status: 'error',
      errorMessage: error instanceof Error ? error.message : 'Failed to fetch data',
    }
  }
}
