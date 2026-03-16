import type { WalletData, Position } from '@/types'

const DATA_API = 'https://data-api.polymarket.com'
const POLYGON_RPC = 'https://polygon-rpc.com'

// Polymarket 使用的 USDC 合约地址 (Polygon)
const USDC_CONTRACTS = [
  '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC.e (PoS bridged)
  '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // USDC (native)
]

// ============================================================
// API response types
// ============================================================

interface ActivityItem {
  proxyWallet: string
  timestamp: number
  conditionId: string
  type: string // TRADE | REDEEM | MERGE | REWARD
  size: number
  usdcSize: number
  price: number
  side: string
  title: string
  outcome: string
}

interface PositionItem {
  proxyWallet: string
  asset: string
  conditionId: string
  size: number
  avgPrice: number
  initialValue: number
  currentValue: number
  cashPnl: number
  percentPnl: number
  totalBought: number
  realizedPnl: number
  percentRealizedPnl: number
  curPrice: number
  redeemable: boolean
  mergeable: boolean
  title: string
  slug: string
  icon: string
  outcome: string
  outcomeIndex: number
  endDate: string
}

interface ClosedPositionItem {
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

interface ValueResponse {
  user: string
  value: number
}

// ============================================================
// HTTP helper with retry
// ============================================================

async function fetchJSON<T>(url: string, retries = 2): Promise<T> {
  let lastError: Error | null = null

  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      return (await response.json()) as T
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (i < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)))
      }
    }
  }

  throw lastError
}

// ============================================================
// Data fetching functions
// ============================================================

/** 分页获取全部活动记录 */
async function getAllActivities(wallet: string): Promise<ActivityItem[]> {
  const all: ActivityItem[] = []
  const limit = 500
  let offset = 0
  const maxOffset = 5000

  while (offset <= maxOffset) {
    try {
      const batch = await fetchJSON<ActivityItem[]>(
        `${DATA_API}/activity?user=${wallet}&limit=${limit}&offset=${offset}`
      )
      all.push(...batch)
      if (batch.length < limit) break
      offset += limit
    } catch {
      break
    }
  }

  return all
}

/** 获取当前持仓（sizeThreshold=0 获取全部） */
async function getPositions(wallet: string): Promise<PositionItem[]> {
  try {
    return await fetchJSON<PositionItem[]>(
      `${DATA_API}/positions?user=${wallet}&sizeThreshold=0`
    )
  } catch {
    return []
  }
}

/** 获取已结算仓位 */
async function getClosedPositions(wallet: string): Promise<ClosedPositionItem[]> {
  const all: ClosedPositionItem[] = []
  const limit = 100
  let offset = 0
  const maxIterations = 20

  for (let i = 0; i < maxIterations; i++) {
    try {
      const batch = await fetchJSON<ClosedPositionItem[]>(
        `${DATA_API}/closed-positions?user=${wallet}&limit=${limit}&offset=${offset}`
      )
      all.push(...batch)
      if (batch.length < limit) break
      offset += limit
    } catch {
      break
    }
  }

  return all
}

/** 获取投资组合价值 */
async function getPortfolioValue(wallet: string): Promise<number> {
  try {
    const data = await fetchJSON<ValueResponse[]>(
      `${DATA_API}/value?user=${wallet}`
    )
    if (data && data.length > 0) {
      return data[0].value || 0
    }
    return 0
  } catch {
    return 0
  }
}

/** 通过 Polygon RPC 查询 USDC 余额 */
async function getUSDCBalance(wallet: string): Promise<number> {
  const addrPadded = wallet.replace('0x', '').toLowerCase().padStart(64, '0')
  const callData = '0x70a08231' + addrPadded
  let totalBalance = 0

  for (const contract of USDC_CONTRACTS) {
    try {
      const payload = {
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: contract, data: callData }, 'latest'],
        id: 1,
      }
      const response = await fetch(POLYGON_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json()
      if (result.result) {
        totalBalance += parseInt(result.result, 16) / 1e6
      }
    } catch {
      // 忽略单个合约查询失败
    }
  }

  return totalBalance
}

// ============================================================
// Calculation logic
// ============================================================

function calculateMetrics(
  activities: ActivityItem[],
  closedPositions: ClosedPositionItem[],
  openPositions: PositionItem[],
  portfolioValue: number,
  availableBalance: number
): Omit<WalletData, 'address' | 'status' | 'errorMessage'> {
  // --- 交易次数：activity 中 type=TRADE 的数量 ---
  const trades = activities.filter((a) => a.type === 'TRADE')
  const totalTrades = trades.length

  // --- 结算次数：closed-positions 的数量 ---
  const totalSettlements = closedPositions.length

  // --- 交易额：所有 TRADE 的 usdcSize 总和（精确） ---
  const totalVolume = trades.reduce((sum, t) => sum + (t.usdcSize || 0), 0)

  // --- 活跃度：从 activity 的 timestamp 计算 ---
  const daysSet = new Set<string>()
  const weeksSet = new Set<string>()
  const monthsSet = new Set<string>()
  const yearsSet = new Set<string>()

  for (const activity of activities) {
    if (activity.timestamp) {
      const date = new Date(activity.timestamp * 1000)
      const y = date.getFullYear()
      const m = String(date.getMonth() + 1).padStart(2, '0')
      const d = String(date.getDate()).padStart(2, '0')

      daysSet.add(`${y}-${m}-${d}`)
      monthsSet.add(`${y}-${m}`)
      yearsSet.add(`${y}`)

      // ISO week number
      const jan1 = new Date(y, 0, 1)
      const dayOfYear = Math.floor(
        (date.getTime() - jan1.getTime()) / 86400000
      )
      const weekNum = Math.ceil((dayOfYear + jan1.getDay() + 1) / 7)
      weeksSet.add(`${y}-W${String(weekNum).padStart(2, '0')}`)
    }
  }

  // --- 净资产 ---
  const netWorth = availableBalance + portfolioValue

  // --- 持仓列表 ---
  const positions: Position[] = openPositions.map((p) => ({
    title: p.title,
    slug: p.slug,
    icon: p.icon,
    outcome: p.outcome,
    size: p.size,
    avgPrice: p.avgPrice,
    currentValue: p.currentValue,
    curPrice: p.curPrice,
    cashPnl: p.cashPnl,
    percentPnl: p.percentPnl,
    totalBought: p.totalBought,
    realizedPnl: p.realizedPnl,
    redeemable: p.redeemable,
    mergeable: p.mergeable,
    endDate: p.endDate,
  }))

  return {
    totalTrades,
    totalSettlements,
    totalVolume,
    activeDays: daysSet.size,
    activeWeeks: weeksSet.size,
    activeMonths: monthsSet.size,
    activeYears: yearsSet.size,
    availableBalance,
    portfolioValue,
    netWorth,
    positions,
  }
}

// ============================================================
// Main export: fetch all data for a wallet
// ============================================================

export async function fetchWalletData(address: string): Promise<WalletData> {
  try {
    // 直接使用地址查询（Polymarket data-api 支持 proxy wallet）
    const wallet = address.toLowerCase()

    // 并行获取所有数据
    const [activities, closedPositions, openPositions, portfolioValue, availableBalance] =
      await Promise.all([
        getAllActivities(wallet),
        getClosedPositions(wallet),
        getPositions(wallet),
        getPortfolioValue(wallet),
        getUSDCBalance(wallet),
      ])

    // 计算指标
    const metrics = calculateMetrics(
      activities,
      closedPositions,
      openPositions,
      portfolioValue,
      availableBalance
    )

    return {
      address,
      ...metrics,
      status: 'success',
    }
  } catch (error) {
    return {
      address,
      totalTrades: 0,
      totalSettlements: 0,
      totalVolume: 0,
      activeDays: 0,
      activeWeeks: 0,
      activeMonths: 0,
      activeYears: 0,
      availableBalance: 0,
      portfolioValue: 0,
      netWorth: 0,
      positions: [],
      status: 'error',
      errorMessage: error instanceof Error ? error.message : '获取数据失败',
    }
  }
}
