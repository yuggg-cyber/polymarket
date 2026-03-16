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
  eventSlug?: string
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
// 令牌桶限速器（用于 lb-api 的 3 请求/秒限速）
// ============================================================

class TokenBucket {
  private tokens: number
  private lastRefill: number
  private readonly maxTokens: number
  private readonly refillRate: number // tokens per ms
  constructor(maxTokens: number, refillPerSecond: number) {
    this.maxTokens = maxTokens
    this.tokens = maxTokens
    this.refillRate = refillPerSecond / 1000
    this.lastRefill = Date.now()
  }

  private refill() {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate)
    this.lastRefill = now
  }

  async acquire(): Promise<void> {
    this.refill()
    if (this.tokens >= 1) {
      this.tokens -= 1
      return
    }
    // 计算需要等待多久才能获得一个令牌
    const waitMs = Math.ceil((1 - this.tokens) / this.refillRate)
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        this.refill()
        this.tokens = Math.max(0, this.tokens - 1)
        resolve()
      }, waitMs)
    })
  }
}

// lb-api 限速: 3 请求/秒，令牌桶容量设为 2（留一点余量避免边界触发）
const lbApiLimiter = new TokenBucket(2, 2.5)

// ============================================================
// HTTP helpers（直连模式）
// ============================================================

const FETCH_TIMEOUT = 15000    // 从 5s 提升到 15s
const RETRY_BASE_MS = 500      // 从 800ms 降低到 500ms
const MAX_RETRIES = 3           // 从 2 提升到 3

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

async function fetchJSON<T>(url: string, retries = MAX_RETRIES): Promise<T> {
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

/** 带 lb-api 限速的 fetchJSON */
async function fetchJSONWithLbLimit<T>(url: string, retries = MAX_RETRIES): Promise<T> {
  await lbApiLimiter.acquire()
  return fetchJSON<T>(url, retries)
}

// ============================================================
// Polygon RPC: USDC.e 余额查询（直连模式）
// ============================================================

async function rpcEthCall(
  payload: object,
  timeout = 8000   // 从 3500ms 提升到 8000ms
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
// 直连模式：Data fetching functions（带独立重试）
// ============================================================

async function getVolume(wallet: string): Promise<number> {
  try {
    const data = await fetchJSONWithLbLimit<LeaderboardEntry[]>(
      `${LB_API}/volume?window=all&limit=1&address=${wallet}`
    )
    return data?.[0]?.amount ?? 0
  } catch {
    return 0
  }
}

async function getProfit(wallet: string): Promise<number> {
  try {
    const data = await fetchJSONWithLbLimit<LeaderboardEntry[]>(
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

// activity 最大分页数，避免超级活跃地址无限分页拖慢查询
const MAX_ACTIVITY_PAGES = 10

async function getActivityStats(
  wallet: string
): Promise<{ days: number; months: number; lastGap: number | null }> {
  try {
    const PAGE = 1000
    const daysSet = new Set<number>()
    const monthsSet = new Set<number>()
    let offset = 0
    let latestTs: number | null = null
    let pageCount = 0

    while (pageCount < MAX_ACTIVITY_PAGES) {
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
      pageCount++
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
    eventSlug: p.eventSlug || '',
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

const MAX_PROXY_RETRIES = 5
const PROXY_RETRY_DELAY_MS = 1000

async function fetchWalletDataViaProxy(
  address: string,
  proxy: ProxyConfig
): Promise<WalletData> {
  // 自动补全协议前缀，防止用户输入时遗漏 https://
  let base = proxy.apiBase.replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) {
    base = `https://${base}`
  }
  const apiUrl = `${base}/api/query`

  let lastError: Error | null = null
  let lastProxyIp: string | null = null

  for (let attempt = 0; attempt < MAX_PROXY_RETRIES; attempt++) {
    // 每次尝试生成新的 session ID，从而获取新的代理 IP
    const sessionId = randomSessionId()
    const proxyUser = `${proxy.userPrefix}_session-${sessionId}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60000)

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
        // 尝试从错误响应中提取 proxyIp
        try {
          const errJson = JSON.parse(errBody)
          if (errJson.proxyIp) lastProxyIp = errJson.proxyIp
        } catch { /* 非 JSON 响应，忽略 */ }
        throw new Error(`API 返回 ${res.status}: ${errBody}`)
      }

      const data = await res.json()

      if (data.error) {
        if (data.proxyIp) lastProxyIp = data.proxyIp
        throw new Error(data.error)
      }

      // 成功，返回结果并附带重试次数
      return {
        ...data,
        proxyRetries: attempt,
        status: 'success',
      } as WalletData
    } catch (error) {
      clearTimeout(timer)
      lastError = error instanceof Error ? error : new Error(String(error))

      // 如果还有重试机会，等待一下再换新 IP 重试
      if (attempt < MAX_PROXY_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, PROXY_RETRY_DELAY_MS * (attempt + 1)))
      }
    }
  }

  // 所有重试均失败
  const result: WalletData = {
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
    proxyIp: lastProxyIp,
    proxyRetries: MAX_PROXY_RETRIES,
    status: 'error',
    errorMessage: `代理查询失败（已重试 ${MAX_PROXY_RETRIES} 次）: ${lastError?.message ?? '未知错误'}`,
  }
  return result
}

// ============================================================
// Main export: 根据代理配置选择模式
// ============================================================

export async function fetchWalletData(
  address: string,
  proxyConfig?: ProxyConfig
): Promise<WalletData> {
  // 代理模式：fetchWalletDataViaProxy 内部已包含重试和错误处理，不会抛出异常
  if (proxyConfig?.enabled && proxyConfig.host && proxyConfig.apiBase) {
    return await fetchWalletDataViaProxy(address, proxyConfig)
  }

  // 直连模式
  try {
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
