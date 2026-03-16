import type { WalletData, Position, ProxyConfig } from '@/types'

const DATA_API = 'https://data-api.polymarket.com'
const LB_API = 'https://lb-api.polymarket.com'

// Polymarket 使用的 USDC.e 合约地址 (Polygon PoS bridged)
const USDC_CONTRACT = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
const USDC_DECIMALS = 6

// Polygon RPC 端点列表（带 fallback）
const POLYGON_RPCS = [
  'https://polygon.drpc.org',
  'https://polygon.publicnode.com',
  'https://polygon-bor-rpc.publicnode.com',
  'https://1rpc.io/matic',
  'https://rpc.ankr.com/polygon',
]
let preferredRpc = POLYGON_RPCS[0]

// ============================================================
// API response types
// ============================================================

interface LeaderboardEntry {
  proxyWallet: string
  amount: number
  pseudonym: string
  name: string
}

interface TradedResponse {
  user: string
  traded: number
}

interface ValueResponse {
  user: string
  value: number
}

interface ActivityItem {
  timestamp: number
  type: string
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
  curPrice: number
  redeemable: boolean
  mergeable: boolean
  title: string
  slug: string
  icon: string
  outcome: string
  endDate: string
}

// ============================================================
// 生成随机 session ID（用于动态代理）
// ============================================================

function randomSessionId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// ============================================================
// HTTP helpers（直连模式）
// ============================================================

const FETCH_TIMEOUT = 5000
const RETRY_BASE_MS = 800

async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeout = FETCH_TIMEOUT
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    return res
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJSON<T>(url: string, retries = 2): Promise<T> {
  let lastError: Error | null = null
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchWithTimeout(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as T
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (i < retries) {
        await new Promise((r) => setTimeout(r, RETRY_BASE_MS * (i + 1)))
      }
    }
  }
  throw lastError
}

// ============================================================
// Polygon RPC: USDC.e 余额查询（直连模式）
// ============================================================

async function rpcEthCall(
  payload: object,
  timeout = 3500
): Promise<string | null> {
  const urls = [preferredRpc, ...POLYGON_RPCS.filter((u) => u !== preferredRpc)]
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        timeout
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const j = await res.json()
      const result = Array.isArray(j) ? j[0]?.result : j?.result
      if (typeof result === 'string' && result.startsWith('0x')) {
        preferredRpc = url
        return result
      }
    } catch {
      // try next RPC
    }
  }
  return null
}

async function getUSDCBalance(wallet: string): Promise<number> {
  const addrHex = wallet.slice(2).toLowerCase()
  const data = '0x70a08231' + addrHex.padStart(64, '0')
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_call',
    params: [{ to: USDC_CONTRACT, data }, 'latest'],
  }
  try {
    const hex = await rpcEthCall(payload)
    if (!hex) return 0
    const raw = hex === '0x' ? 0n : BigInt(hex)
    const scale = 10n ** BigInt(USDC_DECIMALS)
    const valueTimes100 = (raw * 100n) / scale
    const whole = Number(valueTimes100 / 100n)
    const cent = Number(valueTimes100 % 100n)
    return whole + cent / 100
  } catch {
    return 0
  }
}

// ============================================================
// 直连模式：Data fetching functions
// ============================================================

async function getVolume(wallet: string): Promise<number> {
  try {
    const data = await fetchJSON<LeaderboardEntry[]>(
      `${LB_API}/volume?window=all&limit=1&address=${wallet}`
    )
    return data?.[0]?.amount ?? 0
  } catch {
    return 0
  }
}

async function getProfit(wallet: string): Promise<number> {
  try {
    const data = await fetchJSON<LeaderboardEntry[]>(
      `${LB_API}/profit?window=all&limit=1&address=${wallet}`
    )
    return data?.[0]?.amount ?? 0
  } catch {
    return 0
  }
}

async function getMarketsTraded(wallet: string): Promise<number> {
  try {
    const data = await fetchJSON<TradedResponse>(
      `${DATA_API}/traded?user=${wallet}`
    )
    return data?.traded ?? 0
  } catch {
    return 0
  }
}

async function getPortfolioValue(wallet: string): Promise<number> {
  try {
    const data = await fetchJSON<ValueResponse[]>(
      `${DATA_API}/value?user=${wallet}`
    )
    return data?.[0]?.value ?? 0
  } catch {
    return 0
  }
}

async function getActivityStats(
  wallet: string
): Promise<{ days: number; months: number; lastGap: number | null }> {
  try {
    const PAGE = 1000
    const daysSet = new Set<number>()
    const monthsSet = new Set<number>()
    let offset = 0
    let latestTs: number | null = null

    while (true) {
      let batch: ActivityItem[]
      try {
        batch = await fetchJSON<ActivityItem[]>(
          `${DATA_API}/activity?user=${wallet}&limit=${PAGE}&offset=${offset}`
        )
      } catch {
        break
      }
      if (!Array.isArray(batch) || batch.length === 0) break

      for (const item of batch) {
        const date = new Date(item.timestamp * 1000)
        const y = date.getFullYear()
        const mo = date.getMonth() + 1
        const day = date.getDate()
        daysSet.add(y * 10000 + mo * 100 + day)
        monthsSet.add(y * 100 + mo)
        if (latestTs === null || item.timestamp > latestTs) {
          latestTs = item.timestamp
        }
      }

      if (batch.length < PAGE) break
      offset += PAGE
    }

    if (latestTs === null) {
      return { days: 0, months: 0, lastGap: null }
    }

    const gap = Math.floor(
      (Date.now() - latestTs * 1000) / (24 * 60 * 60 * 1000)
    )
    return { days: daysSet.size, months: monthsSet.size, lastGap: gap }
  } catch {
    return { days: 0, months: 0, lastGap: null }
  }
}

async function getPositions(wallet: string): Promise<PositionItem[]> {
  try {
    return await fetchJSON<PositionItem[]>(
      `${DATA_API}/positions?user=${wallet}&sizeThreshold=0`
    )
  } catch {
    return []
  }
}

// ============================================================
// 直连模式：获取钱包数据
// ============================================================

async function fetchWalletDataDirect(address: string): Promise<WalletData> {
  const wallet = address.toLowerCase()

  const [volume, profit, marketsTraded, portfolioValue, activityStats, availableBalance, openPositions] =
    await Promise.all([
      getVolume(wallet),
      getProfit(wallet),
      getMarketsTraded(wallet),
      getPortfolioValue(wallet),
      getActivityStats(wallet),
      getUSDCBalance(wallet),
      getPositions(wallet),
    ])

  const netWorth = availableBalance + portfolioValue

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
    address,
    profit,
    availableBalance,
    portfolioValue,
    netWorth,
    totalVolume: volume,
    marketsTraded,
    lastActiveDay: activityStats.lastGap,
    activeDays: activityStats.days,
    activeMonths: activityStats.months,
    positions,
    status: 'success',
  }
}

// ============================================================
// 代理模式：通过 Vercel Serverless Function 查询
// ============================================================

async function fetchWalletDataViaProxy(
  address: string,
  proxy: ProxyConfig
): Promise<WalletData> {
  const sessionId = randomSessionId()
  const proxyUser = `${proxy.userPrefix}_session-${sessionId}`

  // 自动补全协议前缀，防止用户输入时遗漏 https://
  let base = proxy.apiBase.replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) {
    base = `https://${base}`
  }
  const apiUrl = `${base}/api/query`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60000) // 60s 超时

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        address: address.toLowerCase(),
        proxyHost: proxy.host,
        proxyPort: proxy.port,
        proxyUser,
        proxyPass: proxy.password,
      }),
    })

    clearTimeout(timer)

    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`API 返回 ${res.status}: ${errBody}`)
    }

    const data = await res.json()

    if (data.error) {
      throw new Error(data.error)
    }

    return {
      ...data,
      status: 'success',
    } as WalletData
  } catch (error) {
    clearTimeout(timer)
    throw error
  }
}

// ============================================================
// Main export: 根据代理配置选择模式
// ============================================================

export async function fetchWalletData(
  address: string,
  proxyConfig?: ProxyConfig
): Promise<WalletData> {
  try {
    if (proxyConfig?.enabled && proxyConfig.host && proxyConfig.apiBase) {
      return await fetchWalletDataViaProxy(address, proxyConfig)
    }
    return await fetchWalletDataDirect(address)
  } catch (error) {
    return {
      address,
      profit: 0,
      availableBalance: 0,
      portfolioValue: 0,
      netWorth: 0,
      totalVolume: 0,
      marketsTraded: 0,
      lastActiveDay: null,
      activeDays: 0,
      activeMonths: 0,
      positions: [],
      status: 'error',
      errorMessage: error instanceof Error ? error.message : '获取数据失败',
    }
  }
}
