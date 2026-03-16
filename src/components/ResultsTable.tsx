import { useState } from 'react'
import {
  Copy,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from 'lucide-react'
import type { WalletData, Position, SortField, SortDirection } from '@/types'

// ============================================================
// 格式化工具
// ============================================================

/** 格式化完整 USD 金额（带千分位，保留 2 位小数） */
function formatUSD(value: number): string {
  if (value === 0) return '$0'
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1) {
    return sign + '$' + abs.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }
  return sign + '$' + abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })
}

/** 格式化盈亏金额（带符号和颜色类） */
function formatPnL(value: number): { text: string; className: string } {
  if (value === 0) return { text: '$0', className: 'text-gray-600' }
  const formatted = formatUSD(Math.abs(value))
  if (value > 0) {
    return { text: '+' + formatted, className: 'text-emerald-600' }
  }
  return { text: '-' + formatted, className: 'text-red-500' }
}

/** 格式化精确数字 */
function formatExact(value: number): string {
  if (value === 0) return '0'
  if (Math.abs(value) < 0.000001) return value.toString()
  const str = value.toFixed(6)
  return str.replace(/\.?0+$/, '')
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

// ============================================================
// 排序图标组件
// ============================================================

function SortIcon({ field, currentField, direction }: {
  field: SortField
  currentField: SortField
  direction: SortDirection
}) {
  if (field !== currentField) {
    return <ArrowUpDown className="h-3.5 w-3.5 text-gray-300 ml-1" />
  }
  if (direction === 'asc') {
    return <ArrowUp className="h-3.5 w-3.5 text-blue-600 ml-1" />
  }
  return <ArrowDown className="h-3.5 w-3.5 text-blue-600 ml-1" />
}

// ============================================================
// 排序列配置
// ============================================================

const SORT_COLUMNS: { field: SortField; label: string; tip: string }[] = [
  { field: 'netWorth', label: '净资产', tip: '净资产 = 可用余额 + 持仓估值（USD）' },
  { field: 'profit', label: '盈亏', tip: '历史累计盈亏（USD）' },
  { field: 'availableBalance', label: '可用余额', tip: '链上 USDC 可用余额（实时查询）' },
  { field: 'portfolioValue', label: '持仓估值', tip: '当前持仓估值（USD）' },
  { field: 'totalVolume', label: '交易额', tip: '历史累计交易额（USD）' },
  { field: 'marketsTraded', label: '池子数', tip: '参与的预测市场池数量' },
  { field: 'lastActiveDay', label: '最后活跃', tip: '最近一次交易距今天数' },
  { field: 'activeDays', label: '活跃天', tip: '历史累计活跃交易天数' },
  { field: 'activeMonths', label: '活跃月', tip: '历史累计活跃月数' },
]

// ============================================================
// 仓位详情子表格
// ============================================================

function PositionRows({ positions }: { positions: Position[] }) {
  if (positions.length === 0) {
    return (
      <tr>
        <td
          colSpan={11}
          className="text-center text-gray-400 py-6 text-sm bg-gray-50/80"
        >
          暂无持仓
        </td>
      </tr>
    )
  }

  return (
    <>
      {/* 仓位子表头 */}
      <tr className="bg-blue-50/60 border-b border-blue-100">
        <td className="w-12"></td>
        <td className="px-4 py-3 text-sm font-semibold text-gray-500">市场</td>
        <td className="px-4 py-3 text-sm font-semibold text-gray-500">方向</td>
        <td className="px-4 py-3 text-sm font-semibold text-gray-500 text-right">数量</td>
        <td className="px-4 py-3 text-sm font-semibold text-gray-500 text-right">均价</td>
        <td className="px-4 py-3 text-sm font-semibold text-gray-500 text-right">现价</td>
        <td className="px-4 py-3 text-sm font-semibold text-gray-500 text-right">当前价值</td>
        <td className="px-4 py-3 text-sm font-semibold text-gray-500 text-right">浮动盈亏</td>
        <td className="px-4 py-3 text-sm font-semibold text-gray-500 text-right">买入总额</td>
        <td className="px-4 py-3 text-sm font-semibold text-gray-500 text-center">状态</td>
        <td className="px-4 py-3 text-sm font-semibold text-gray-500">截止日期</td>
      </tr>
      {positions.map((pos, idx) => {
        const pnlColor = pos.cashPnl >= 0 ? 'text-emerald-600' : 'text-red-500'
        return (
          <tr key={idx} className="bg-gray-50/40 hover:bg-gray-100/60 border-b border-gray-100">
            <td className="w-12"></td>
            <td className="px-4 py-3">
              <div className="flex items-center gap-2.5 max-w-[260px]">
                {pos.icon && (
                  <img
                    src={pos.icon}
                    alt=""
                    className="w-6 h-6 rounded flex-shrink-0"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                )}
                <span className="text-sm text-gray-800 truncate" title={pos.title}>
                  {pos.title}
                </span>
              </div>
            </td>
            <td className="px-4 py-3">
              <span
                className={`text-sm font-semibold px-2.5 py-1 rounded-full ${
                  pos.outcome === 'Yes'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-red-100 text-red-600'
                }`}
              >
                {pos.outcome}
              </span>
            </td>
            <td className="px-4 py-3 text-right text-sm font-mono text-gray-700">
              {formatExact(pos.size)}
            </td>
            <td className="px-4 py-3 text-right text-sm font-mono text-gray-700">
              ${formatExact(pos.avgPrice)}
            </td>
            <td className="px-4 py-3 text-right text-sm font-mono text-gray-700">
              ${formatExact(pos.curPrice)}
            </td>
            <td className="px-4 py-3 text-right text-sm font-mono text-gray-700">
              {formatUSD(pos.currentValue)}
            </td>
            <td className={`px-4 py-3 text-right text-sm font-mono font-semibold ${pnlColor}`}>
              {pos.cashPnl >= 0 ? '+' : ''}{formatUSD(pos.cashPnl)}
            </td>
            <td className="px-4 py-3 text-right text-sm font-mono text-gray-700">
              {formatUSD(pos.totalBought)}
            </td>
            <td className="px-4 py-3 text-center">
              <div className="flex gap-1.5 justify-center">
                {pos.redeemable && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-600 font-medium">
                    可赎回
                  </span>
                )}
                {pos.mergeable && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-purple-100 text-purple-600 font-medium">
                    可合并
                  </span>
                )}
                {!pos.redeemable && !pos.mergeable && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 font-medium">
                    持有中
                  </span>
                )}
              </div>
            </td>
            <td className="px-4 py-3 text-sm text-gray-500">
              {pos.endDate
                ? new Date(pos.endDate).toLocaleDateString('zh-CN')
                : '-'}
            </td>
          </tr>
        )
      })}
    </>
  )
}

// ============================================================
// 汇总卡片
// ============================================================

function SummaryCards({ results }: { results: WalletData[] }) {
  const successResults = results.filter((r) => r.status === 'success')
  if (successResults.length === 0) return null

  const totalProfit = successResults.reduce((s, r) => s + r.profit, 0)
  const totalAvailable = successResults.reduce((s, r) => s + r.availableBalance, 0)
  const totalHoldings = successResults.reduce((s, r) => s + r.portfolioValue, 0)
  const totalNetWorth = successResults.reduce((s, r) => s + r.netWorth, 0)

  const profitPnl = formatPnL(totalProfit)

  const cards = [
    { label: '总盈亏', value: profitPnl.text, sub: '历史累计', className: profitPnl.className },
    { label: '可用余额', value: formatUSD(totalAvailable), sub: 'USDC', className: 'text-gray-900' },
    { label: '持仓估值', value: formatUSD(totalHoldings), sub: 'USD', className: 'text-gray-900' },
    { label: '净资产总计', value: formatUSD(totalNetWorth), sub: '可用 + 持仓', className: 'text-gray-900' },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-white rounded-xl border border-gray-200 px-5 py-4"
        >
          <div className="text-sm text-gray-500 mb-1.5">{card.label}</div>
          <div className={`text-2xl font-bold tracking-tight ${card.className}`}>
            {card.value}
          </div>
          <div className="text-xs text-gray-400 mt-1">{card.sub}</div>
        </div>
      ))}
    </div>
  )
}

// ============================================================
// 主表格组件
// ============================================================

interface ResultsTableProps {
  results: WalletData[]
}

export function ResultsTable({ results }: ResultsTableProps) {
  const [sortField, setSortField] = useState<SortField>('totalVolume')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null)

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  const toggleExpand = (address: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(address)) {
        next.delete(address)
      } else {
        next.add(address)
      }
      return next
    })
  }

  const copyAddress = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address)
      setCopiedAddr(address)
      setTimeout(() => setCopiedAddr(null), 1500)
    } catch {
      // fallback
    }
  }

  // 排序逻辑
  const sortedResults = [...results].sort((a, b) => {
    if (a.status !== 'success' && b.status === 'success') return 1
    if (a.status === 'success' && b.status !== 'success') return -1
    const aVal = (a[sortField] as number) ?? -1
    const bVal = (b[sortField] as number) ?? -1
    return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
  })

  const successCount = results.filter((r) => r.status === 'success').length

  return (
    <div className="space-y-5">
      {/* 汇总卡片 */}
      <SummaryCards results={results} />

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">
          查询结果
          <span className="ml-2 text-sm font-normal text-gray-500">
            已查询 {results.length} 个地址，成功 {successCount} 个
          </span>
        </h2>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-12 px-3 py-3.5"></th>
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-gray-600 min-w-[180px]">
                  地址
                </th>
                {SORT_COLUMNS.map(({ field, label, tip }) => (
                  <th key={field} className="px-4 py-3.5 text-right">
                    <button
                      onClick={() => handleSort(field)}
                      className="inline-flex items-center justify-end gap-0 hover:text-gray-900 transition-colors text-sm font-semibold text-gray-600 whitespace-nowrap"
                      title={tip}
                    >
                      {label}
                      <SortIcon field={field} currentField={sortField} direction={sortDirection} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedResults.map((wallet) => {
                const isExpanded = expandedRows.has(wallet.address)
                const hasPositions =
                  wallet.positions && wallet.positions.length > 0
                const profitPnl = formatPnL(wallet.profit)

                return (
                  <tbody key={wallet.address}>
                    <tr
                      className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                        isExpanded ? 'bg-blue-50/30' : ''
                      }`}
                    >
                      {/* 展开按钮 */}
                      <td className="w-12 px-3 py-3.5">
                        {wallet.status === 'success' && (
                          <button
                            onClick={() => toggleExpand(wallet.address)}
                            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                            title={
                              hasPositions
                                ? '展开/收起持仓详情'
                                : '无持仓'
                            }
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-gray-500" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-gray-400" />
                            )}
                          </button>
                        )}
                      </td>

                      {/* 钱包地址 */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          {(wallet.status === 'loading' ||
                            wallet.status === 'pending') && (
                            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                          )}
                          {wallet.status === 'error' && (
                            <AlertCircle className="h-4 w-4 text-red-500" />
                          )}
                          <span
                            className="font-mono text-sm text-gray-800"
                            title={wallet.address}
                          >
                            {shortenAddress(wallet.address)}
                          </span>
                          <button
                            onClick={() => copyAddress(wallet.address)}
                            className="p-1 rounded-md hover:bg-gray-100 transition-colors"
                            title={copiedAddr === wallet.address ? '已复制' : '复制地址'}
                          >
                            <Copy
                              className={`h-3.5 w-3.5 ${
                                copiedAddr === wallet.address
                                  ? 'text-emerald-500'
                                  : 'text-gray-400'
                              }`}
                            />
                          </button>
                          <a
                            href={`https://polygonscan.com/address/${wallet.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 rounded-md hover:bg-gray-100 transition-colors"
                            title="在 PolygonScan 查看"
                          >
                            <ExternalLink className="h-3.5 w-3.5 text-gray-400" />
                          </a>
                        </div>
                      </td>

                      {/* 数据列 */}
                      {wallet.status === 'loading' ||
                      wallet.status === 'pending' ? (
                        <td colSpan={9} className="px-4 py-3.5 text-center">
                          <div className="flex items-center justify-center gap-2 text-gray-400">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span className="text-sm">加载中...</span>
                          </div>
                        </td>
                      ) : wallet.status === 'error' ? (
                        <td colSpan={9} className="px-4 py-3.5 text-center">
                          <div className="flex items-center justify-center gap-2 text-red-500">
                            <AlertCircle className="h-4 w-4" />
                            <span className="text-sm">
                              {wallet.errorMessage || '查询失败'}
                            </span>
                          </div>
                        </td>
                      ) : (
                        <>
                          <td className="px-4 py-3.5 text-right font-mono text-sm text-gray-800 font-semibold">
                            {formatUSD(wallet.netWorth)}
                          </td>
                          <td className={`px-4 py-3.5 text-right font-mono text-sm font-semibold ${profitPnl.className}`}>
                            {profitPnl.text}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-sm text-gray-700">
                            {formatUSD(wallet.availableBalance)}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-sm text-gray-700">
                            {formatUSD(wallet.portfolioValue)}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-sm text-gray-700">
                            {formatUSD(wallet.totalVolume)}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-sm text-gray-700">
                            {wallet.marketsTraded}
                          </td>
                          <td className="px-4 py-3.5 text-right text-sm text-gray-600">
                            {wallet.lastActiveDay !== null
                              ? `${wallet.lastActiveDay}天前`
                              : '-'}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-sm text-gray-700">
                            {wallet.activeDays}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-sm text-gray-700">
                            {wallet.activeMonths}
                          </td>
                        </>
                      )}
                    </tr>

                    {/* 展开的仓位详情 */}
                    {isExpanded && wallet.status === 'success' && (
                      <PositionRows positions={wallet.positions} />
                    )}
                  </tbody>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
