import type { WalletData, Position, ClosedPosition, ProxyConfig } from '@/types'

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
// 子请求结果包装：区分成功和失败
// ============================================================

interface SubResult<T> {
  ok: true
  value: T
}
interface SubError {
  ok: false
  field: string
}
type SubOutcome<T> = SubResult<T> | SubError

function success<T>(value: T): SubOutcome<T> {
  return { ok: true, value }
}
function failure<T>(field: string): SubOutcome<T> {
  return { ok: false, field }
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

const FETCH_TIMEOUT = 15000
const RETRY_BASE_MS = 500
const MAX_RETRIES = 3

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
        // 指数退避：500ms, 1000ms, 2000ms
        const delay = RETRY_BASE_MS * Math.pow(2, i)
        await new Promise((r) => setTimeout(r, delay))
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
  timeout = 8000
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
  const hex = await rpcEthCall(payload)
  if (!hex) throw new Error('All RPC endpoints failed')
  const raw = hex === '0x' ? 0n : BigInt(hex)
  const scale = 10n ** BigInt(USDC_DECIMALS)
  const valueTimes100 = (raw * 100n) / scale
  const whole = Number(valueTimes100 / 100n)
  const cent = Number(valueTimes100 % 100n)
  return whole + cent / 100
}

// ============================================================
// 账户地址 → Polymarket 地址（Safe Global API）
// ============================================================

const MAX_SAFES = 5

interface SafeApiResponse {
  safes?: string[] | Record<string, string[]>
  '137'?: string[]
}

/**
 * 通过 Safe Global API 查询某个 owner 地址关联的 Safe 多签钱包地址（Polygon 链）
 * Polymarket 用户的交易钱包就是 Safe 多签钱包
 * 始终直连 Safe API（不走代理，Safe API 仅查询地址关联关系，无风险）
 */
export async function resolveAccountToPolymarket(
  ownerAddress: string
): Promise<string[]> {
  const url = `https://safe-client.safe.global/v1/chains/137/owners/${ownerAddress}/safes`
  try {
    const res = await fetchJSON<SafeApiResponse>(url)
    let safes: string[] = []
    if (Array.isArray(res?.safes)) {
      safes = res.safes as string[]
    } else if (Array.isArray(res)) {
      safes = res
    } else if (Array.isArray((res as SafeApiResponse)?.['137'])) {
      safes = (res as SafeApiResponse)['137']!
    } else if (res?.safes && typeof res.safes === 'object' && !Array.isArray(res.safes)) {
      const safeObj = res.safes as Record<string, string[]>
      if (Array.isArray(safeObj['137'])) {
        safes = safeObj['137']
      }
    }
    return safes.slice(0, MAX_SAFES)
  } catch {
    return []
  }
}

// ============================================================
// 直连模式：Data fetching functions（抛出异常而非返回 0）
// ============================================================

async function getVolume(wallet: string): Promise<number> {
  const data = await fetchJSON<LeaderboardEntry[]>(
    `${LB_API}/volume?window=all&limit=1&address=${wallet}`
  )
  return data?.[0]?.amount ?? 0
}

async function getProfit(wallet: string): Promise<number> {
  const data = await fetchJSON<LeaderboardEntry[]>(
    `${LB_API}/profit?window=all&limit=1&address=${wallet}`
  )
  return data?.[0]?.amount ?? 0
}

async function getMarketsTraded(wallet: string): Promise<number> {
  const data = await fetchJSON<TradedResponse>(
    `${DATA_API}/traded?user=${wallet}`
  )
  return data?.traded ?? 0
}

async function getPortfolioValue(wallet: string): Promise<number> {
  const data = await fetchJSON<ValueResponse[]>(
    `${DATA_API}/value?user=${wallet}`
  )
  return data?.[0]?.value ?? 0
}

// activity 最大分页数
const MAX_ACTIVITY_PAGES = 10

async function getActivityStats(
  wallet: string
): Promise<{ days: number; months: number; lastGap: number | null }> {
  const PAGE = 1000
  const daysSet = new Set<number>()
  const monthsSet = new Set<number>()
  let offset = 0
  let latestTs: number | null = null
  let pageCount = 0

  while (pageCount < MAX_ACTIVITY_PAGES) {
    const batch = await fetchJSON<ActivityItem[]>(
      `${DATA_API}/activity?user=${wallet}&limit=${PAGE}&offset=${offset}`
    )
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
}

async function getPositions(wallet: string): Promise<PositionItem[]> {
  return await fetchJSON<PositionItem[]>(
    `${DATA_API}/positions?user=${wallet}&sizeThreshold=0`
  )
}

// ============================================================
// 历史已平仓位查询（按时间倒序，分页获取全部）
// ============================================================

interface ClosedPositionItem {
  proxyWallet: string
  asset: string
  conditionId: string
  avgPrice: number
  totalBought: number
  realizedPnl: number
  curPrice: number
  timestamp: number
  title: string
  slug: string
  icon: string
  eventSlug?: string
  outcome: string
  endDate: string
}

const CLOSED_POSITIONS_PAGE_SIZE = 50
const MAX_CLOSED_PAGES = 20

export async function getClosedPositions(wallet: string): Promise<ClosedPosition[]> {
  const addr = wallet.toLowerCase()
  const all: ClosedPosition[] = []
  let offset = 0
  let pageCount = 0

  while (pageCount < MAX_CLOSED_PAGES) {
    const batch = await fetchJSON<ClosedPositionItem[]>(
      `${DATA_API}/closed-positions?user=${addr}&limit=${CLOSED_POSITIONS_PAGE_SIZE}&offset=${offset}&sortBy=TIMESTAMP&sortDirection=DESC`
    )
    if (!Array.isArray(batch) || batch.length === 0) break

    for (const item of batch) {
      all.push({
        title: item.title,
        slug: item.slug,
        eventSlug: item.eventSlug || '',
        icon: item.icon,
        outcome: item.outcome,
        avgPrice: item.avgPrice,
        curPrice: item.curPrice,
        totalBought: item.totalBought,
        realizedPnl: item.realizedPnl,
        timestamp: item.timestamp,
        endDate: item.endDate,
      })
    }

    if (batch.length < CLOSED_POSITIONS_PAGE_SIZE) break
    offset += CLOSED_POSITIONS_PAGE_SIZE
    pageCount++
  }

  return all
}

// ============================================================
// 直连模式：获取钱包数据（追踪每个子请求的成功/失败）
// ============================================================

async function fetchWalletDataDirect(address: string): Promise<WalletData> {
  const wallet = address.toLowerCase()

  // 并行发起所有子请求，每个独立 catch，记录成功/失败
  const [
    volumeResult,
    profitResult,
    marketsTradedResult,
    portfolioValueResult,
    activityResult,
    balanceResult,
    positionsResult,
  ] = await Promise.all([
    getVolume(wallet).then(v => success(v)).catch((): SubOutcome<number> => failure('交易额')),
    getProfit(wallet).then(v => success(v)).catch((): SubOutcome<number> => failure('盈亏')),
    getMarketsTraded(wallet).then(v => success(v)).catch((): SubOutcome<number> => failure('池子数')),
    getPortfolioValue(wallet).then(v => success(v)).catch((): SubOutcome<number> => failure('持仓估值')),
    getActivityStats(wallet).then(v => success(v)).catch((): SubOutcome<{ days: number; months: number; lastGap: number | null }> => failure('活跃度')),
    getUSDCBalance(wallet).then(v => success(v)).catch((): SubOutcome<number> => failure('可用余额')),
    getPositions(wallet).then(v => success(v)).catch((): SubOutcome<PositionItem[]> => failure('持仓列表')),
  ])

  // 收集失败的字段
  const failedFields: string[] = []
  const allResults = [volumeResult, profitResult, marketsTradedResult, portfolioValueResult, activityResult, balanceResult, positionsResult]
  for (const r of allResults) {
    if (!r.ok) failedFields.push(r.field)
  }

  const volume = volumeResult.ok ? volumeResult.value : 0
  const profit = profitResult.ok ? profitResult.value : 0
  const marketsTraded = marketsTradedResult.ok ? marketsTradedResult.value : 0
  const portfolioValue = portfolioValueResult.ok ? portfolioValueResult.value : 0
  const activityStats = activityResult.ok ? activityResult.value : { days: 0, months: 0, lastGap: null }
  const availableBalance = balanceResult.ok ? balanceResult.value : 0
  const openPositions = positionsResult.ok ? positionsResult.value : []

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

  // 持仓盈亏：只汇总"持有中"和"真正可赎回"仓位的浮动盈亏（排除已结算灰尘残留和可合并仓位）
  const holdingPnl = positionsResult.ok
    ? positions.reduce((sum, p) => {
        // 已结算（redeemable 但属于灰尘残留）：排除
        if (p.redeemable) {
          // 真正可赎回：currentValue > 0 且（绝对值 >= $0.1 或 占买入比例 >= 1%）
          const isActuallyRedeemable = p.currentValue > 0 && (
            p.currentValue >= 0.1 ||
            (p.totalBought > 0 && p.currentValue / p.totalBought >= 0.01)
          )
          return isActuallyRedeemable ? sum + p.cashPnl : sum
        }
        // 可合并仓位：排除
        if (p.mergeable) return sum
        // 持有中：计入
        return sum + p.cashPnl
      }, 0)
    : 0

  // 判断状态：全部成功 = success，部分失败 = partial，全部失败 = error
  let status: 'success' | 'partial' | 'error' = 'success'
  if (failedFields.length === allResults.length) {
    status = 'error'
  } else if (failedFields.length > 0) {
    status = 'partial'
  }

  return {
    address,
    profit,
    availableBalance,
    portfolioValue,
    netWorth,
    holdingPnl,
    totalVolume: volume,
    marketsTraded,
    lastActiveDay: activityStats.lastGap,
    activeDays: activityStats.days,
    activeMonths: activityStats.months,
    positions,
    failedFields: failedFields.length > 0 ? failedFields : undefined,
    status,
    errorMessage: status === 'error' ? '所有数据获取失败' : (status === 'partial' ? `部分数据获取失败: ${failedFields.join('、')}` : undefined),
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
  const base = window.location.origin
  const apiUrl = `${base}/api/query`

  let lastError: Error | null = null
  let lastProxyIp: string | null = null

  for (let attempt = 0; attempt < MAX_PROXY_RETRIES; attempt++) {
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
        try {
          const errJson = JSON.parse(errBody)
          if (errJson.proxyIp) lastProxyIp = errJson.proxyIp
        } catch { /* 非 JSON 响应 */ }
        throw new Error(`API 返回 ${res.status}: ${errBody}`)
      }

      const data = await res.json()

      if (data.error) {
        if (data.proxyIp) lastProxyIp = data.proxyIp
        throw new Error(data.error)
      }

      // 检查代理模式返回的数据是否有部分失败
      // 服务端返回 failedFields 字段（如果有的话）
      const failedFields = data.failedFields as string[] | undefined
      let status: 'success' | 'partial' = 'success'
      if (failedFields && failedFields.length > 0) {
        status = 'partial'
      }

      // 计算持仓盈亏：只汇总"持有中"和"真正可赎回"仓位的浮动盈亏
      const holdingPnl = Array.isArray(data.positions)
        ? data.positions.reduce((sum: number, p: Position) => {
            if (p.redeemable) {
              const isActuallyRedeemable = p.currentValue > 0 && (
                p.currentValue >= 0.1 ||
                (p.totalBought > 0 && p.currentValue / p.totalBought >= 0.01)
              )
              return isActuallyRedeemable ? sum + (p.cashPnl || 0) : sum
            }
            if (p.mergeable) return sum
            return sum + (p.cashPnl || 0)
          }, 0)
        : 0

      return {
        ...data,
        holdingPnl,
        proxyRetries: attempt,
        status,
        failedFields,
        errorMessage: status === 'partial' ? `部分数据获取失败: ${failedFields!.join('、')}` : undefined,
      } as WalletData
    } catch (error) {
      clearTimeout(timer)
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt < MAX_PROXY_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, PROXY_RETRY_DELAY_MS * (attempt + 1)))
      }
    }
  }

  // 所有重试均失败
  return {
    address,
    profit: 0,
    availableBalance: 0,
    portfolioValue: 0,
    netWorth: 0,
    holdingPnl: 0,
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
}

// ============================================================
// Main export: 根据代理配置选择模式
// ============================================================

export async function fetchWalletData(
  address: string,
  proxyConfig?: ProxyConfig
): Promise<WalletData> {
  if (proxyConfig?.enabled && proxyConfig.host) {
    return await fetchWalletDataViaProxy(address, proxyConfig)
  }

  // 直连模式 — fetchWalletDataDirect 内部已处理所有错误，不会抛出异常
  return await fetchWalletDataDirect(address)
}
