import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Search,
  TrendingDown,
} from 'lucide-react'
import type { AddressType, ClosedPosition, Position, ProxyConfig, WalletData } from '@/types'
import {
  getClosedPositionsWithMeta,
  getRedeemablePositionsWithMeta,
  resolveAccountToPolymarket,
} from '@/services/polymarket'
import { createQueue } from '@/services/queue'

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/
const MAX_MANUAL_ADDRESSES = 200
const LOSS_QUERY_CONCURRENCY = 3
const LOSS_QUERY_MAX_CLOSED_PAGES = 100
const LOSS_QUERY_MAX_REDEEMABLE_PAGES = 20

type SourceMode = 'current' | 'manual' | 'combined'
type AddressSource = 'current' | 'manual'
type AddressStatusType = 'resolving' | 'loading' | 'success' | 'no-loss' | 'partial' | 'capped' | 'error'
type LossRecordType = 'closed' | 'settled-current'

interface LossQueryDrawerProps {
  currentResults: WalletData[]
  addressType: AddressType
  proxyConfig: ProxyConfig
}

interface MonthRange {
  startTs: number
  endTs: number
  label: string
}

interface LossAddress {
  key: string
  walletAddress: string
  originalAddress?: string
  inputAddress: string
  source: AddressSource
}

interface AddressStatus {
  key: string
  walletAddress: string
  originalAddress?: string
  inputAddress: string
  source: AddressSource
  status: AddressStatusType
  message?: string
  lossCount?: number
  closedCount?: number
  currentCount?: number
}

interface LossRow {
  id: string
  walletAddress: string
  originalAddress?: string
  source: AddressSource
  recordType: LossRecordType
  marketKey: string
  title: string
  slug: string
  eventSlug: string
  icon: string
  outcome: string
  lossAmount: number
  boughtAmount: number
  avgPrice: number
  curPrice: number
  recordTimestamp?: number
  monthTimestamp: number
  endDate: string
}

interface CachedClosedPositions {
  positions: ClosedPosition[]
  reachedLimit: boolean
}

function getCurrentMonthValue() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${now.getFullYear()}-${month}`
}

function parseMonth(monthValue: string): MonthRange | null {
  const match = /^(\d{4})-(\d{2})$/.exec(monthValue)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  if (!year || month < 1 || month > 12) return null

  const start = new Date(year, month - 1, 1, 0, 0, 0, 0)
  const end = new Date(year, month, 1, 0, 0, 0, 0)
  return {
    startTs: Math.floor(start.getTime() / 1000),
    endTs: Math.floor(end.getTime() / 1000),
    label: `${year}年${month}月`,
  }
}

function parseAddressTokens(text: string) {
  return text
    .split(/[\s,;，；]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatUSD(value: number) {
  const abs = Math.abs(value)
  if (abs === 0) return '$0'
  return '$' + abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: abs >= 1 ? 2 : 6,
  })
}

function formatPrice(value: number) {
  if (value === 0) return '0'
  const fixed = value.toFixed(6)
  return fixed.replace(/\.?0+$/, '')
}

function formatDate(timestamp?: number) {
  if (!timestamp) return '-'
  return new Date(timestamp * 1000).toLocaleDateString('zh-CN')
}

function formatEndDate(endDate: string) {
  if (!endDate) return '-'
  return new Date(endDate).toLocaleDateString('zh-CN')
}

function getMarketUrl(row: LossRow) {
  const slug = row.eventSlug || row.slug
  return slug ? `https://polymarket.com/event/${slug}` : undefined
}

function getCurrentLossAddresses(results: WalletData[]): LossAddress[] {
  const map = new Map<string, LossAddress>()

  for (const result of results) {
    if (result.status !== 'success' && result.status !== 'partial') continue
    if (!ADDRESS_RE.test(result.address)) continue

    const key = result.address.toLowerCase()
    if (map.has(key)) continue

    map.set(key, {
      key,
      walletAddress: result.address,
      originalAddress: result.originalAddress,
      inputAddress: result.originalAddress || result.address,
      source: 'current',
    })
  }

  return [...map.values()]
}

function addLossAddress(map: Map<string, LossAddress>, address: LossAddress) {
  if (!map.has(address.key)) {
    map.set(address.key, address)
  }
}

function getEndTimestamp(endDate: string): number | null {
  const timestamp = new Date(endDate).getTime()
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null
}

function isInMonth(timestamp: number, range: MonthRange) {
  return timestamp >= range.startTs && timestamp < range.endTs
}

function isActuallyRedeemable(position: Position) {
  if (!position.redeemable || position.currentValue <= 0) return false
  if (position.currentValue >= 0.1) return true
  if (position.totalBought > 0 && position.currentValue / position.totalBought < 0.01) return false
  return true
}

function buildClosedLossRows(
  address: LossAddress,
  positions: ClosedPosition[],
  range: MonthRange
): LossRow[] {
  return positions
    .flatMap((position, index) => {
      const monthTimestamp = getEndTimestamp(position.endDate) ?? position.timestamp
      if (!isInMonth(monthTimestamp, range) || position.realizedPnl >= 0) return []

      const marketKey = position.conditionId || position.eventSlug || position.slug || position.title
      return [{
        id: `${address.key}:closed:${position.asset || marketKey}:${position.timestamp}:${index}`,
        walletAddress: address.walletAddress,
        originalAddress: address.originalAddress,
        source: address.source,
        recordType: 'closed' as const,
        marketKey,
        title: position.title,
        slug: position.slug,
        eventSlug: position.eventSlug,
        icon: position.icon,
        outcome: position.outcome,
        lossAmount: position.realizedPnl,
        boughtAmount: position.totalBought,
        avgPrice: position.avgPrice,
        curPrice: position.curPrice,
        recordTimestamp: position.timestamp,
        monthTimestamp,
        endDate: position.endDate,
      }]
    })
}

function buildSettledCurrentLossRows(
  address: LossAddress,
  positions: Position[],
  range: MonthRange
): LossRow[] {
  return positions.flatMap((position, index) => {
    const monthTimestamp = getEndTimestamp(position.endDate)
    const isSettledLoss = (
      position.redeemable &&
      !isActuallyRedeemable(position) &&
      position.cashPnl < 0
    )
    if (!monthTimestamp || !isInMonth(monthTimestamp, range) || !isSettledLoss) return []

    const marketKey = position.conditionId || position.eventSlug || position.slug || position.title
    const boughtAmount = position.initialValue > 0
      ? position.initialValue
      : position.size * position.avgPrice

    return [{
      id: `${address.key}:settled:${position.asset || marketKey}:${index}`,
      walletAddress: address.walletAddress,
      originalAddress: address.originalAddress,
      source: address.source,
      recordType: 'settled-current' as const,
      marketKey,
      title: position.title,
      slug: position.slug,
      eventSlug: position.eventSlug,
      icon: position.icon,
      outcome: position.outcome,
      lossAmount: position.cashPnl,
      boughtAmount,
      avgPrice: position.avgPrice,
      curPrice: position.curPrice,
      monthTimestamp,
      endDate: position.endDate,
    }]
  })
}

function getStatusText(status: AddressStatus) {
  if (status.status === 'resolving') return '解析账户地址中'
  if (status.status === 'loading') return '查询仓位数据中'
  if (status.status === 'success') return `${status.lossCount || 0} 个亏损市场`
  if (status.status === 'no-loss') return '本月无亏损'
  if (status.status === 'partial') return status.message || '部分仓位查询失败'
  if (status.status === 'capped') return `已到分页上限，已找到 ${status.lossCount || 0} 个亏损市场`
  return status.message || '查询失败'
}

export function LossQueryDrawer({ currentResults, addressType, proxyConfig }: LossQueryDrawerProps) {
  const [sourceMode, setSourceMode] = useState<SourceMode>('combined')
  const [manualAddressType, setManualAddressType] = useState<AddressType>(addressType)
  const [manualText, setManualText] = useState('')
  const [monthValue, setMonthValue] = useState(getCurrentMonthValue)
  const [rows, setRows] = useState<LossRow[]>([])
  const [statuses, setStatuses] = useState<AddressStatus[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [inputError, setInputError] = useState<string | null>(null)
  const [progress, setProgress] = useState({ total: 0, completed: 0 })
  const cacheRef = useRef(new Map<string, CachedClosedPositions>())

  useEffect(() => {
    setManualAddressType(addressType)
  }, [addressType])

  const currentAddresses = useMemo(() => getCurrentLossAddresses(currentResults), [currentResults])
  const proxyActive = Boolean(proxyConfig.enabled && proxyConfig.host)
  const manualTokens = useMemo(() => parseAddressTokens(manualText), [manualText])
  const uniqueManualTokens = useMemo(() => {
    const seen = new Map<string, string>()
    for (const token of manualTokens) {
      const key = token.toLowerCase()
      if (!seen.has(key)) seen.set(key, token)
    }
    return [...seen.values()]
  }, [manualTokens])

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const lossDiff = Math.abs(b.lossAmount) - Math.abs(a.lossAmount)
      if (lossDiff !== 0) return lossDiff
      return b.monthTimestamp - a.monthTimestamp
    })
  }, [rows])

  const summary = useMemo(() => {
    const totalLoss = sortedRows.reduce((sum, row) => sum + Math.abs(row.lossAmount), 0)
    const lossMarkets = new Set(sortedRows.map((row) => (
      `${row.walletAddress.toLowerCase()}:${row.marketKey}:${row.outcome}`
    ))).size
    const lossAddresses = new Set(sortedRows.map((row) => row.walletAddress.toLowerCase())).size
    const failedCount = statuses.filter((status) => (
      status.status === 'error' || status.status === 'partial'
    )).length
    const cappedCount = statuses.filter((status) => status.status === 'capped').length

    return {
      totalLoss,
      lossCount: lossMarkets,
      checkedCount: statuses.filter((status) => status.status !== 'resolving').length,
      lossAddresses,
      failedCount,
      cappedCount,
    }
  }, [sortedRows, statuses])

  const canQuery = (
    (sourceMode !== 'manual' && currentAddresses.length > 0) ||
    (sourceMode !== 'current' && uniqueManualTokens.length > 0)
  )

  const updateStatus = (key: string, patch: Partial<AddressStatus>) => {
    setStatuses((prev) => prev.map((status) => (
      status.key === key ? { ...status, ...patch } : status
    )))
  }

  const copyAddress = (address: string) => {
    void navigator.clipboard?.writeText(address)
  }

  const handleQuery = async () => {
    if (isRunning) return

    const range = parseMonth(monthValue)
    if (!range) {
      setInputError('请选择有效月份')
      return
    }

    if (!canQuery) {
      setInputError('先在主页面导入/查询地址，或在这里手动输入地址')
      return
    }

    if (sourceMode !== 'current') {
      if (manualTokens.length > MAX_MANUAL_ADDRESSES) {
        setInputError(`手动输入最多支持 ${MAX_MANUAL_ADDRESSES} 个地址`)
        return
      }
      const invalidAddress = manualTokens.find((token) => !ADDRESS_RE.test(token))
      if (invalidAddress) {
        setInputError(`地址格式不正确: ${invalidAddress}`)
        return
      }
    }

    setInputError(null)
    setRows([])
    setProgress({ total: 0, completed: 0 })
    setIsRunning(true)

    const addressMap = new Map<string, LossAddress>()
    const resolveFailures: AddressStatus[] = []

    if (sourceMode !== 'manual') {
      for (const address of currentAddresses) {
        addLossAddress(addressMap, address)
      }
    }

    if (sourceMode !== 'current' && uniqueManualTokens.length > 0) {
      if (manualAddressType === 'polymarket') {
        for (const token of uniqueManualTokens) {
          const key = token.toLowerCase()
          addLossAddress(addressMap, {
            key,
            walletAddress: token,
            inputAddress: token,
            source: 'manual',
          })
        }
      } else {
        const resolvingStatuses: AddressStatus[] = [
          ...[...addressMap.values()].map((address) => ({
            ...address,
            status: 'loading' as AddressStatusType,
            message: '等待查询',
          })),
          ...uniqueManualTokens.map((token) => ({
            key: `account:${token.toLowerCase()}`,
            walletAddress: token,
            inputAddress: token,
            source: 'manual' as AddressSource,
            status: 'resolving' as AddressStatusType,
          })),
        ]
        setStatuses(resolvingStatuses)

        const resolveQueue = createQueue(LOSS_QUERY_CONCURRENCY)
        await Promise.allSettled(uniqueManualTokens.map((token) =>
          resolveQueue.add(async () => {
            const safes = await resolveAccountToPolymarket(token)
            if (safes.length === 0) {
              resolveFailures.push({
                key: `account:${token.toLowerCase()}`,
                walletAddress: token,
                inputAddress: token,
                source: 'manual',
                status: 'error',
                message: '未找到关联的 Polymarket 地址',
              })
              return
            }

            for (const safe of safes) {
              const key = safe.toLowerCase()
              addLossAddress(addressMap, {
                key,
                walletAddress: safe,
                originalAddress: token,
                inputAddress: token,
                source: 'manual',
              })
            }
          }).catch(() => {
            resolveFailures.push({
              key: `account:${token.toLowerCase()}`,
              walletAddress: token,
              inputAddress: token,
              source: 'manual',
              status: 'error',
              message: '账户地址解析失败',
            })
          })
        ))
      }
    }

    const addresses = [...addressMap.values()]
    setStatuses([
      ...resolveFailures,
      ...addresses.map((address) => ({
        ...address,
        status: 'loading' as AddressStatusType,
        message: '等待查询',
      })),
    ])
    setProgress({ total: addresses.length, completed: 0 })

    if (addresses.length === 0) {
      setIsRunning(false)
      return
    }

    const queue = createQueue(LOSS_QUERY_CONCURRENCY)
    const transportCacheKey = proxyActive
      ? ['proxy', proxyConfig.host, proxyConfig.port, proxyConfig.userPrefix, proxyConfig.password].join(':')
      : 'direct'
    await Promise.allSettled(addresses.map((address) =>
      queue.add(async () => {
        const cacheKey = `${address.key}:${transportCacheKey}`
        let cached = cacheRef.current.get(cacheKey)

        try {
          updateStatus(address.key, { status: 'loading', message: '查询已平仓与已结算持仓中' })

          const closedQuery = cached
            ? Promise.resolve(cached)
            : getClosedPositionsWithMeta(address.walletAddress, {
                maxPages: LOSS_QUERY_MAX_CLOSED_PAGES,
              }, proxyConfig)
          const currentQuery = getRedeemablePositionsWithMeta(address.walletAddress, {
            maxPages: LOSS_QUERY_MAX_REDEEMABLE_PAGES,
          }, proxyConfig)
          const [closedResult, currentResult] = await Promise.allSettled([
            closedQuery,
            currentQuery,
          ])

          if (closedResult.status === 'fulfilled' && !cached) {
            cached = closedResult.value
            cacheRef.current.set(cacheKey, cached)
          }

          if (closedResult.status === 'rejected' && currentResult.status === 'rejected') {
            throw new Error('历史战绩和当前持仓查询均失败')
          }

          const closedPositions = closedResult.status === 'fulfilled'
            ? closedResult.value.positions
            : []
          const currentPositions = currentResult.status === 'fulfilled'
            ? currentResult.value.positions
            : []
          const lossRows = [
            ...buildClosedLossRows(address, closedPositions, range),
            ...buildSettledCurrentLossRows(address, currentPositions, range),
          ]
          if (lossRows.length > 0) {
            setRows((prev) => [...prev, ...lossRows])
          }

          const failedSources = [
            ...(closedResult.status === 'rejected' ? ['历史战绩'] : []),
            ...(currentResult.status === 'rejected' ? ['当前持仓'] : []),
          ]
          const cappedSources = [
            ...(closedResult.status === 'fulfilled' && closedResult.value.reachedLimit ? ['历史战绩'] : []),
            ...(currentResult.status === 'fulfilled' && currentResult.value.reachedLimit ? ['当前持仓'] : []),
          ]
          const status: AddressStatusType = cappedSources.length > 0
            ? 'capped'
            : failedSources.length > 0
              ? 'partial'
              : lossRows.length > 0
                ? 'success'
                : 'no-loss'

          updateStatus(address.key, {
            status,
            lossCount: lossRows.length,
            closedCount: closedPositions.length,
            currentCount: currentPositions.length,
            message: cappedSources.length > 0
              ? `${cappedSources.join('、')}达到分页上限，记录可能未完全覆盖`
              : failedSources.length > 0
                ? `${failedSources.join('、')}查询失败，已显示其余可用结果`
                : undefined,
          })
        } catch (error) {
          updateStatus(address.key, {
            status: 'error',
            message: error instanceof Error ? error.message : '查询失败',
          })
        } finally {
          setProgress((prev) => ({ ...prev, completed: prev.completed + 1 }))
        }
      })
    ))

    setIsRunning(false)
  }

  const notableStatuses = statuses.filter((status) => (
    status.status === 'error' ||
    status.status === 'partial' ||
    status.status === 'capped' ||
    status.status === 'no-loss'
  ))

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div>
          <div className="text-xs font-medium text-gray-500 mb-1.5">地址来源</div>
          <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
            {[
              { value: 'combined', label: '当前结果 + 手输' },
              { value: 'current', label: '当前结果' },
              { value: 'manual', label: '手动输入' },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setSourceMode(option.value as SourceMode)}
                disabled={isRunning}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  sourceMode === option.value
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="mt-1.5 text-xs text-gray-400">
            当前可用地址 {currentAddresses.length} 个，手动输入 {uniqueManualTokens.length} 个
            <span className={`ml-2 ${proxyActive ? 'text-green-600' : ''}`}>
              {proxyActive ? '代理模式' : '直连模式'}
            </span>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[180px_1fr]">
          <label className="block">
            <span className="text-xs font-medium text-gray-500 mb-1.5 block">自然月（按截止日期）</span>
            <input
              type="month"
              value={monthValue}
              onChange={(event) => setMonthValue(event.target.value)}
              disabled={isRunning}
              className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
            />
          </label>

          {sourceMode !== 'current' && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1.5">手动地址类型</div>
              <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
                {[
                  { value: 'polymarket', label: 'Polymarket 地址' },
                  { value: 'account', label: '账户地址' },
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setManualAddressType(option.value as AddressType)}
                    disabled={isRunning}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      manualAddressType === option.value
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {sourceMode !== 'current' && (
          <textarea
            value={manualText}
            onChange={(event) => setManualText(event.target.value)}
            disabled={isRunning}
            placeholder="可粘贴多个 0x 地址，支持换行、空格、逗号分隔"
            className="min-h-24 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
          />
        )}

        {inputError && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {inputError}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <button
            onClick={handleQuery}
            disabled={isRunning || !canQuery}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            查询亏损
          </button>
          {isRunning && (
            <span className="text-xs text-gray-500">
              {progress.completed}/{progress.total} 个地址
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2">
          <div className="text-xs text-red-500">总亏损</div>
          <div className="text-lg font-bold text-red-600">-{formatUSD(summary.totalLoss)}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
          <div className="text-xs text-gray-500">亏损市场</div>
          <div className="text-lg font-bold text-gray-900">{summary.lossCount}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
          <div className="text-xs text-gray-500">已查地址</div>
          <div className="text-lg font-bold text-gray-900">{summary.checkedCount}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
          <div className="text-xs text-gray-500">亏损地址</div>
          <div className="text-lg font-bold text-gray-900">{summary.lossAddresses}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
          <div className="text-xs text-gray-500">失败/上限</div>
          <div className="text-lg font-bold text-gray-900">{summary.failedCount}/{summary.cappedCount}</div>
        </div>
      </div>

      {notableStatuses.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="mb-1.5 text-xs font-medium text-gray-500">地址状态</div>
          <div className="max-h-28 space-y-1 overflow-y-auto">
            {notableStatuses.map((status) => (
              <div key={status.key} className="flex items-center justify-between gap-3 text-xs">
                <span className="font-mono text-gray-600" title={status.walletAddress}>
                  {shortenAddress(status.walletAddress)}
                  {status.originalAddress && (
                    <span className="ml-1 text-purple-500">({shortenAddress(status.originalAddress)})</span>
                  )}
                </span>
                <span className={
                  status.status === 'error'
                    ? 'text-red-500'
                    : status.status === 'capped' || status.status === 'partial'
                      ? 'text-amber-600'
                      : 'text-gray-400'
                }>
                  {getStatusText(status)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">地址</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">市场</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">方向</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500">亏损金额</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500">买入额</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500">均价</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500">结算价</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500">记录时间</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500">截止日期</th>
              </tr>
            </thead>
            <tbody>
              {isRunning && sortedRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-sm text-gray-400">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      正在查询亏损市场...
                    </span>
                  </td>
                </tr>
              )}

              {!isRunning && sortedRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-sm text-gray-400">
                    <TrendingDown className="mx-auto mb-2 h-5 w-5 text-gray-300" />
                    {statuses.length > 0 ? '所选月份没有亏损市场' : '选择月份和地址后开始查询'}
                  </td>
                </tr>
              )}

              {sortedRows.map((row) => {
                const url = getMarketUrl(row)
                return (
                  <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-gray-700" title={row.walletAddress}>
                          {shortenAddress(row.walletAddress)}
                        </span>
                        <button
                          onClick={() => copyAddress(row.walletAddress)}
                          className="rounded p-0.5 text-gray-300 hover:bg-gray-100 hover:text-gray-600"
                          title="复制地址"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {row.originalAddress && row.originalAddress.toLowerCase() !== row.walletAddress.toLowerCase() && (
                        <div className="mt-0.5 text-xs text-purple-500" title={row.originalAddress}>
                          账户 {shortenAddress(row.originalAddress)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group flex max-w-[360px] items-start gap-2 text-sm text-gray-800 hover:text-blue-600"
                        >
                          {row.icon && (
                            <img
                              src={row.icon}
                              alt=""
                              className="mt-0.5 h-6 w-6 flex-shrink-0 rounded"
                              onError={(event) => { (event.target as HTMLImageElement).style.display = 'none' }}
                            />
                          )}
                          <span className="line-clamp-2 group-hover:underline">{row.title}</span>
                          <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-300 group-hover:text-blue-500" />
                        </a>
                      ) : (
                        <span className="text-sm text-gray-800">{row.title}</span>
                      )}
                      <div className={`mt-1 text-xs ${
                        row.recordType === 'settled-current' ? 'text-red-400' : 'text-gray-400'
                      }`}>
                        {row.recordType === 'settled-current' ? '当前持仓 · 已结算' : '历史战绩'}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        row.outcome === 'Yes'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-red-100 text-red-600'
                      }`}>
                        {row.outcome}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right align-top font-mono text-sm font-semibold text-red-500">
                      -{formatUSD(row.lossAmount)}
                    </td>
                    <td className="px-3 py-2.5 text-right align-top font-mono text-sm text-gray-700">
                      {formatUSD(row.boughtAmount)}
                    </td>
                    <td className="px-3 py-2.5 text-right align-top font-mono text-sm text-gray-700">
                      ${formatPrice(row.avgPrice)}
                    </td>
                    <td className="px-3 py-2.5 text-right align-top font-mono text-sm text-gray-700">
                      ${formatPrice(row.curPrice)}
                    </td>
                    <td className="px-3 py-2.5 text-right align-top text-sm text-gray-500">
                      {row.recordTimestamp ? formatDate(row.recordTimestamp) : '未转历史'}
                    </td>
                    <td className="px-3 py-2.5 text-right align-top text-sm text-gray-500">
                      {formatEndDate(row.endDate)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {statuses.length > 0 && !isRunning && summary.failedCount === 0 && summary.cappedCount === 0 && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          查询完成
        </div>
      )}
    </div>
  )
}
