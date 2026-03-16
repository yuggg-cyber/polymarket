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
  Globe,
  Download,
  MessageSquareText,
  RefreshCw,
} from 'lucide-react'
import type { WalletData, Position, SortField, SortDirection } from '@/types'
import { exportToExcel } from '@/services/export'

// ============================================================
// 格式化工具
// ============================================================

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

function formatPnL(value: number): { text: string; className: string } {
  if (value === 0) return { text: '$0', className: 'text-gray-600' }
  const formatted = formatUSD(Math.abs(value))
  if (value > 0) return { text: '+' + formatted, className: 'text-emerald-600 font-semibold' }
  return { text: '-' + formatted, className: 'text-red-500 font-semibold' }
}

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
// 排序图标
// ============================================================

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) return <ArrowUpDown className="w-3.5 h-3.5 text-gray-300 ml-1 flex-shrink-0" />
  if (direction === 'asc') return <ArrowUp className="w-3.5 h-3.5 text-blue-600 ml-1 flex-shrink-0" />
  return <ArrowDown className="w-3.5 h-3.5 text-blue-600 ml-1 flex-shrink-0" />
}

// ============================================================
// 排序列定义 — 主表格共 11 列（展开 + 地址 + 9 数据列）
// ============================================================

const SORT_COLS: { field: SortField; label: string; tip: string }[] = [
  { field: 'netWorth',         label: '净资产',   tip: '净资产 = 可用余额 + 持仓估值' },
  { field: 'profit',           label: '盈亏',     tip: '历史累计盈亏（USD）' },
  { field: 'availableBalance', label: '可用余额', tip: '链上 USDC.e 可用余额' },
  { field: 'portfolioValue',   label: '持仓估值', tip: '当前持仓估值（USD）' },
  { field: 'totalVolume',      label: '交易额',   tip: '历史累计交易额（USD）' },
  { field: 'marketsTraded',    label: '池子数',   tip: '参与的预测市场数量' },
  { field: 'lastActiveDay',    label: '最后活跃', tip: '最近一次交易距今天数' },
  { field: 'activeDays',       label: '活跃天',   tip: '历史累计活跃交易天数' },
  { field: 'activeMonths',     label: '活跃月',   tip: '历史累计活跃月数' },
]

const TOTAL_COLS = 2 + SORT_COLS.length // 展开按钮 + 地址 + 9 数据列 = 11

// ============================================================
// 仓位详情行
// ============================================================

function PositionDetailRows({ positions }: { positions: Position[] }) {
  if (positions.length === 0) {
    return (
      <tr>
        <td colSpan={TOTAL_COLS} className="text-center text-gray-400 py-6 bg-gray-50/80">
          暂无持仓
        </td>
      </tr>
    )
  }

  return (
    <>
      {/* 子表头 */}
      <tr className="bg-blue-50/60 border-b border-blue-100">
        <td colSpan={2} className="px-4 py-2.5 text-sm font-semibold text-blue-700">
          持仓明细
        </td>
        <td className="px-3 py-2.5 text-sm font-semibold text-gray-500">方向</td>
        <td className="px-3 py-2.5 text-sm font-semibold text-gray-500 text-right">数量</td>
        <td className="px-3 py-2.5 text-sm font-semibold text-gray-500 text-right">均价</td>
        <td className="px-3 py-2.5 text-sm font-semibold text-gray-500 text-right">现价</td>
        <td className="px-3 py-2.5 text-sm font-semibold text-gray-500 text-right">当前价值</td>
        <td className="px-3 py-2.5 text-sm font-semibold text-gray-500 text-right">浮动盈亏</td>
        <td className="px-3 py-2.5 text-sm font-semibold text-gray-500 text-right">买入总额</td>
        <td className="px-3 py-2.5 text-sm font-semibold text-gray-500 text-center">状态</td>
        <td className="px-3 py-2.5 text-sm font-semibold text-gray-500">截止日期</td>
      </tr>
      {positions.map((pos, idx) => {
        const pnlColor = pos.cashPnl >= 0 ? 'text-emerald-600' : 'text-red-500'
        return (
          <tr key={idx} className="bg-gray-50/40 hover:bg-gray-100/60 border-b border-gray-100">
            {/* 市场名称占前两列 — 可点击跳转到 Polymarket 预测页面 */}
            <td colSpan={2} className="px-4 py-2.5">
              <a
                href={pos.eventSlug ? `https://polymarket.com/event/${pos.eventSlug}` : (pos.slug ? `https://polymarket.com/event/${pos.slug}` : '#')}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 max-w-[280px] group hover:opacity-80 transition-opacity"
                title={(pos.eventSlug || pos.slug) ? `查看预测市场：${pos.title}` : pos.title}
              >
                {pos.icon && (
                  <img
                    src={pos.icon}
                    alt=""
                    className="w-6 h-6 rounded flex-shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                <span className="text-sm text-gray-800 truncate group-hover:text-blue-600 group-hover:underline">
                  {pos.title}
                </span>
                {(pos.eventSlug || pos.slug) && (
                  <ExternalLink className="w-3 h-3 text-gray-300 group-hover:text-blue-500 flex-shrink-0" />
                )}
              </a>
            </td>
            <td className="px-3 py-2.5">
              <span className={`text-sm font-semibold px-2 py-0.5 rounded-full ${
                pos.outcome === 'Yes' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
              }`}>
                {pos.outcome}
              </span>
            </td>
            <td className="px-3 py-2.5 text-right text-sm font-mono text-gray-700">{formatExact(pos.size)}</td>
            <td className="px-3 py-2.5 text-right text-sm font-mono text-gray-700">${formatExact(pos.avgPrice)}</td>
            <td className="px-3 py-2.5 text-right text-sm font-mono text-gray-700">${formatExact(pos.curPrice)}</td>
            <td className="px-3 py-2.5 text-right text-sm font-mono text-gray-700">{formatUSD(pos.currentValue)}</td>
            <td className={`px-3 py-2.5 text-right text-sm font-mono font-semibold ${pnlColor}`}>
              {pos.cashPnl >= 0 ? '+' : ''}{formatUSD(pos.cashPnl)}
            </td>
            <td className="px-3 py-2.5 text-right text-sm font-mono text-gray-700">{formatUSD(pos.totalBought)}</td>
            <td className="px-3 py-2.5 text-center">
              {pos.redeemable ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-600 font-medium">可赎回</span>
              ) : pos.mergeable ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-600 font-medium">可合并</span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">持有中</span>
              )}
            </td>
            <td className="px-3 py-2.5 text-sm text-gray-500">
              {pos.endDate ? new Date(pos.endDate).toLocaleDateString('zh-CN') : '-'}
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
  const ok = results.filter((r) => r.status === 'success')
  if (ok.length === 0) return null

  const totalProfit    = ok.reduce((s, r) => s + r.profit, 0)
  const totalAvailable = ok.reduce((s, r) => s + r.availableBalance, 0)
  const totalHoldings  = ok.reduce((s, r) => s + r.portfolioValue, 0)
  const totalNetWorth  = ok.reduce((s, r) => s + r.netWorth, 0)

  const pnl = formatPnL(totalProfit)

  const cards = [
    { label: '总盈亏',     value: pnl.text,                  sub: '历史累计',   cls: pnl.className },
    { label: '可用余额',   value: formatUSD(totalAvailable),  sub: 'USDC',       cls: 'text-gray-900' },
    { label: '持仓估值',   value: formatUSD(totalHoldings),   sub: 'USD',        cls: 'text-gray-900' },
    { label: '净资产总计', value: formatUSD(totalNetWorth),    sub: '可用 + 持仓', cls: 'text-gray-900' },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {cards.map((c) => (
        <div key={c.label} className="bg-white rounded-xl border border-gray-200 px-5 py-4">
          <div className="text-sm text-gray-500 mb-1">{c.label}</div>
          <div className={`text-2xl font-bold tracking-tight ${c.cls}`}>{c.value}</div>
          <div className="text-xs text-gray-400 mt-1">{c.sub}</div>
        </div>
      ))}
    </div>
  )
}

// ============================================================
// 主组件
// ============================================================

interface ResultsTableProps {
  results: WalletData[]
  addressNotes?: Record<string, string>
  isLoading?: boolean
  onRefreshSingle?: (address: string) => Promise<void>
  onRefreshAll?: () => Promise<void>
}

export function ResultsTable({
  results,
  addressNotes = {},
  isLoading = false,
  onRefreshSingle,
  onRefreshAll,
}: ResultsTableProps) {
  const [sortField, setSortField]       = useState<SortField>('totalVolume')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [copiedAddr, setCopiedAddr]     = useState<string | null>(null)
  const [refreshingAddr, setRefreshingAddr] = useState<string | null>(null)

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  const toggleExpand = (addr: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      next.has(addr) ? next.delete(addr) : next.add(addr)
      return next
    })
  }

  const copyAddress = async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr)
      setCopiedAddr(addr)
      setTimeout(() => setCopiedAddr(null), 1500)
    } catch { /* noop */ }
  }

  const handleRefreshSingle = async (addr: string) => {
    if (!onRefreshSingle || refreshingAddr) return
    setRefreshingAddr(addr)
    try {
      await onRefreshSingle(addr)
    } finally {
      setRefreshingAddr(null)
    }
  }

  const sorted = [...results].sort((a, b) => {
    if (a.status !== 'success' && b.status === 'success') return 1
    if (a.status === 'success' && b.status !== 'success') return -1
    const av = (a[sortField] as number) ?? -1
    const bv = (b[sortField] as number) ?? -1
    return sortDirection === 'asc' ? av - bv : bv - av
  })

  const okCount = results.filter((r) => r.status === 'success').length

  const rows: React.ReactNode[] = []
  for (const wallet of sorted) {
    const isExpanded = expandedRows.has(wallet.address)
    const hasPos     = wallet.positions && wallet.positions.length > 0
    const pnl        = formatPnL(wallet.profit)
    const isRefreshing = refreshingAddr === wallet.address || wallet.status === 'loading'

    rows.push(
      <tr
        key={wallet.address}
        className={`border-b border-gray-100 hover:bg-gray-50/80 transition-colors ${isExpanded ? 'bg-blue-50/30' : ''}`}
      >
        {/* 展开按钮 */}
        <td className="w-10 px-2 py-3 text-center">
          {wallet.status === 'success' && (
            <button
              onClick={() => toggleExpand(wallet.address)}
              className="p-1 rounded hover:bg-gray-200 transition-colors"
              title={hasPos ? '展开/收起持仓详情' : '无持仓'}
            >
              {isExpanded
                ? <ChevronDown className="w-4 h-4 text-gray-500" />
                : <ChevronRight className="w-4 h-4 text-gray-400" />}
            </button>
          )}
        </td>

        {/* 地址 + 操作按钮 + 代理 IP */}
        <td className="px-3 py-3 min-w-[200px]">
          <div className="flex items-center gap-1.5">
            {(wallet.status === 'loading' || wallet.status === 'pending') && (
              <Loader2 className="w-4 h-4 animate-spin text-blue-500 flex-shrink-0" />
            )}
            {wallet.status === 'error' && (
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            )}
            <span className="font-mono text-sm text-gray-800" title={wallet.address}>
              {shortenAddress(wallet.address)}
            </span>
            <button
              onClick={() => copyAddress(wallet.address)}
              className="p-0.5 rounded hover:bg-gray-200 transition-colors"
              title={copiedAddr === wallet.address ? '已复制' : '复制地址'}
            >
              <Copy className={`w-3.5 h-3.5 ${copiedAddr === wallet.address ? 'text-emerald-500' : 'text-gray-400'}`} />
            </button>
            <a
              href={`https://polygonscan.com/address/${wallet.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-0.5 rounded hover:bg-gray-200 transition-colors"
              title="在 PolygonScan 查看"
            >
              <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
            </a>
            {/* 单地址刷新按钮 */}
            {onRefreshSingle && (wallet.status === 'success' || wallet.status === 'error') && (
              <button
                onClick={() => handleRefreshSingle(wallet.address)}
                disabled={isRefreshing || isLoading}
                className="p-0.5 rounded hover:bg-blue-100 transition-colors disabled:opacity-40"
                title="刷新此地址数据"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            )}
            {/* 备注图标 + tooltip */}
            {(addressNotes[wallet.address] || addressNotes[wallet.address.toLowerCase()]) && (
              <span
                className="relative group p-0.5 rounded hover:bg-amber-100 transition-colors cursor-default"
                title={addressNotes[wallet.address] || addressNotes[wallet.address.toLowerCase()]}
              >
                <MessageSquareText className="w-3.5 h-3.5 text-amber-500" />
                <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 px-2.5 py-1.5 text-xs text-white bg-gray-800 rounded-lg shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                  {addressNotes[wallet.address] || addressNotes[wallet.address.toLowerCase()]}
                </span>
              </span>
            )}
          </div>
          {/* 代理出口 IP 显示在地址下方（成功和失败状态都显示） */}
          {wallet.proxyIp && (wallet.status === 'success' || wallet.status === 'error') && (
            <div className="flex items-center gap-1 mt-1">
              <Globe className="w-3 h-3 text-blue-400 flex-shrink-0" />
              <span className="text-xs text-blue-500 font-mono">{wallet.proxyIp}</span>
              {typeof wallet.proxyRetries === 'number' && wallet.proxyRetries > 0 && (
                <span className="text-xs text-amber-500 ml-1">
                  (重试{wallet.proxyRetries}次)
                </span>
              )}
            </div>
          )}
        </td>

        {/* 数据列 */}
        {wallet.status === 'loading' || wallet.status === 'pending' ? (
          <td colSpan={9} className="px-3 py-3 text-center text-gray-400">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
            </span>
          </td>
        ) : wallet.status === 'error' ? (
          <td colSpan={9} className="px-3 py-3 text-center text-red-500">
            <span className="inline-flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {wallet.errorMessage || '查询失败'}
            </span>
          </td>
        ) : (
          <>
            <td className="px-3 py-3 text-right font-mono text-sm text-gray-800 font-semibold">{formatUSD(wallet.netWorth)}</td>
            <td className={`px-3 py-3 text-right font-mono text-sm ${pnl.className}`}>{pnl.text}</td>
            <td className="px-3 py-3 text-right font-mono text-sm text-gray-700">{formatUSD(wallet.availableBalance)}</td>
            <td className="px-3 py-3 text-right font-mono text-sm text-gray-700">{formatUSD(wallet.portfolioValue)}</td>
            <td className="px-3 py-3 text-right font-mono text-sm text-gray-700">{formatUSD(wallet.totalVolume)}</td>
            <td className="px-3 py-3 text-right font-mono text-sm text-gray-700">{wallet.marketsTraded}</td>
            <td className="px-3 py-3 text-right text-sm text-gray-600">{wallet.lastActiveDay !== null ? `${wallet.lastActiveDay}天前` : '-'}</td>
            <td className="px-3 py-3 text-right font-mono text-sm text-gray-700">{wallet.activeDays}</td>
            <td className="px-3 py-3 text-right font-mono text-sm text-gray-700">{wallet.activeMonths}</td>
          </>
        )}
      </tr>
    )

    // 展开的仓位行
    if (isExpanded && wallet.status === 'success') {
      rows.push(
        <PositionDetailRows key={wallet.address + '-pos'} positions={wallet.positions} />
      )
    }
  }

  return (
    <div className="space-y-5">
      <SummaryCards results={results} />

      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-bold text-gray-900">查询结果</h2>
          <span className="text-sm text-gray-500">
            已查询 {results.length} 个地址，成功 {okCount} 个
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* 刷新全部按钮 */}
          {onRefreshAll && results.length > 0 && (
            <button
              onClick={onRefreshAll}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50"
              title="重新查询所有地址"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              刷新全部
            </button>
          )}
          {/* 导出数据按钮 */}
          {okCount > 0 && (
            <button
              onClick={() => exportToExcel(results, addressNotes)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-colors shadow-sm"
              title="导出为 Excel 文件"
            >
              <Download className="w-4 h-4" />
              导出数据
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b-2 border-gray-200">
                <th className="w-10 px-2 py-3"></th>
                <th className="px-3 py-3 text-left text-sm font-semibold text-gray-600 whitespace-nowrap">
                  地址
                </th>
                {SORT_COLS.map(({ field, label, tip }) => (
                  <th key={field} className="px-3 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => handleSort(field)}
                      className="inline-flex items-center justify-end hover:text-gray-900 transition-colors text-sm font-semibold text-gray-600"
                      title={tip}
                    >
                      {label}
                      <SortIcon active={sortField === field} direction={sortDirection} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
