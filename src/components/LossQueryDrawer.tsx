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
import type { AddressType, ClosedPosition, WalletData } from '@/types'
import { getClosedPositionsWithMeta, resolveAccountToPolymarket } from '@/services/polymarket'
import { createQueue } from '@/services/queue'

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/
const MAX_MANUAL_ADDRESSES = 200
const LOSS_QUERY_CONCURRENCY = 3
const LOSS_QUERY_MAX_CLOSED_PAGES = 100

type SourceMode = 'current' | 'manual' | 'combined'
type AddressSource = 'current' | 'manual'
type AddressStatusType = 'resolving' | 'loading' | 'success' | 'no-loss' | 'capped' | 'error'

interface LossQueryDrawerProps {
  currentResults: WalletData[]
  addressType: AddressType
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
}

interface LossRow {
  id: string
  walletAddress: string
  originalAddress?: string
  source: AddressSource
  position: ClosedPosition
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

function formatDate(timestamp: number) {
  if (!timestamp) return '-'
  return new Date(timestamp * 1000).toLocaleDateString('zh-CN')
}

function formatEndDate(endDate: string) {
  if (!endDate) return '-'
  return new Date(endDate).toLocaleDateString('zh-CN')
}

function getMarketUrl(position: ClosedPosition) {
  const slug = position.eventSlug || position.slug
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

function buildLossRows(address: LossAddress, positions: ClosedPosition[], range: MonthRange): LossRow[] {
  return positions
    .filter((position) => (
      position.timestamp >= range.startTs &&
      position.timestamp < range.endTs &&
      position.realizedPnl < 0
    ))
    .map((position, index) => ({
      id: `${address.key}:${position.slug}:${position.outcome}:${position.timestamp}:${index}`,
      walletAddress: address.walletAddress,
      originalAddress: address.originalAddress,
      source: address.source,
      position,
    }))
}

function getStatusText(status: AddressStatus) {
  if (status.status === 'resolving') return '解析账户地址中'
  if (status.status === 'loading') return '查询历史战绩中'
  if (status.status === 'success') return `${status.lossCount || 0} 个亏损市场`
  if (status.status === 'no-loss') return '本月无亏损'
  if (status.status === 'capped') return `已到分页上限，已找到 ${status.lossCount || 0} 个亏损市场`
  return status.message || '查询失败'
}

export function LossQueryDrawer({ currentResults, addressType }: LossQueryDrawerProps) {
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
      const lossDiff = Math.abs(b.position.realizedPnl) - Math.abs(a.position.realizedPnl)
      if (lossDiff !== 0) return lossDiff
      return b.position.timestamp - a.position.timestamp
    })
  }, [rows])

  const summary = useMemo(() => {
    const totalLoss = sortedRows.reduce((sum, row) => sum + Math.abs(row.position.realizedPnl), 0)
    const lossAddresses = new Set(sortedRows.map((row) => row.walletAddress.toLowerCase())).size
    const failedCount = statuses.filter((status) => status.status === 'error').length
    const cappedCount = statuses.filter((status) => status.status === 'capped').length

    return {
      totalLoss,
      lossCount: sortedRows.length,
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
    await Promise.allSettled(addresses.map((address) =>
      queue.add(async () => {
        const cacheKey = `${address.key}:${monthValue}`
        let cached = cacheRef.current.get(cacheKey)

        try {
          updateStatus(address.key, { status: 'loading', message: '查询历史战绩中' })

          if (!cached) {
            cached = await getClosedPositionsWithMeta(address.walletAddress, {
              maxPages: LOSS_QUERY_MAX_CLOSED_PAGES,
              stopBeforeTimestamp: range.startTs,
            })
            cacheRef.current.set(cacheKey, cached)
          }

          const lossRows = buildLossRows(address, cached.positions, range)
          if (lossRows.length > 0) {
            setRows((prev) => [...prev, ...lossRows])
          }

          updateStatus(address.key, {
            status: cached.reachedLimit ? 'capped' : (lossRows.length > 0 ? 'success' : 'no-loss'),
            lossCount: lossRows.length,
            closedCount: cached.positions.length,
            message: cached.reachedLimit
              ? `已达到 ${LOSS_QUERY_MAX_CLOSED_PAGES * 50} 条历史战绩上限，较早记录可能未完全覆盖`
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
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[180px_1fr]">
          <label className="block">
            <span className="text-xs font-medium text-gray-500 mb-1.5 block">自然月</span>
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
                    : status.status === 'capped'
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
          <table className="w-full min-w-[980px] border-collapse">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">地址</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">市场</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">方向</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500">亏损金额</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500">买入额</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500">均价</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500">结算价</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500">平仓时间</th>
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
                const url = getMarketUrl(row.position)
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
                          {row.position.icon && (
                            <img
                              src={row.position.icon}
                              alt=""
                              className="mt-0.5 h-6 w-6 flex-shrink-0 rounded"
                              onError={(event) => { (event.target as HTMLImageElement).style.display = 'none' }}
                            />
                          )}
                          <span className="line-clamp-2 group-hover:underline">{row.position.title}</span>
                          <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-300 group-hover:text-blue-500" />
                        </a>
                      ) : (
                        <span className="text-sm text-gray-800">{row.position.title}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        row.position.outcome === 'Yes'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-red-100 text-red-600'
                      }`}>
                        {row.position.outcome}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right align-top font-mono text-sm font-semibold text-red-500">
                      -{formatUSD(row.position.realizedPnl)}
                    </td>
                    <td className="px-3 py-2.5 text-right align-top font-mono text-sm text-gray-700">
                      {formatUSD(row.position.totalBought)}
                    </td>
                    <td className="px-3 py-2.5 text-right align-top font-mono text-sm text-gray-700">
                      ${formatPrice(row.position.avgPrice)}
                    </td>
                    <td className="px-3 py-2.5 text-right align-top font-mono text-sm text-gray-700">
                      ${formatPrice(row.position.curPrice)}
                    </td>
                    <td className="px-3 py-2.5 text-right align-top text-sm text-gray-500">
                      {formatDate(row.position.timestamp)}
                    </td>
                    <td className="px-3 py-2.5 text-right align-top text-sm text-gray-500">
                      {formatEndDate(row.position.endDate)}
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
