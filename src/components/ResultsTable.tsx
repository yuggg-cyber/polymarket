import { useState, useMemo } from 'react'
import {
  Copy,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Globe,
  Download,
  MessageSquareText,
  RefreshCw,
  Search,
  RotateCcw,
  ChevronDownIcon,
} from 'lucide-react'
import type { WalletData, Position, SortField, SortDirection } from '@/types'
import { exportToExcel, exportToCSV, exportToJSON } from '@/services/export'

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
// failedFields 到数据列字段的映射
// ============================================================

/** 根据 failedFields 判断某个数据字段是否失败 */
function isFieldFailed(failedFields: string[] | undefined, ...fieldNames: string[]): boolean {
  if (!failedFields || failedFields.length === 0) return false
  return fieldNames.some(name => failedFields.includes(name))
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
// 排序列定义
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

const TOTAL_COLS = 4 + SORT_COLS.length // checkbox + 展开 + 序号 + 地址 + 9 数据列 = 13

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
      <tr className="bg-blue-50/60 border-b border-blue-100">
        <td colSpan={4} className="px-4 py-2.5 text-sm font-semibold text-blue-700">
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
            <td colSpan={4} className="px-4 py-2.5">
              <a
                href={pos.eventSlug ? `https://polymarket.com/event/${pos.eventSlug}` : (pos.slug ? `https://polymarket.com/event/${pos.slug}` : '#')}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 max-w-[320px] group hover:opacity-80 transition-opacity"
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
  const ok = results.filter((r) => r.status === 'success' || r.status === 'partial')
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
  onRetryFailed?: () => Promise<void>
}

export function ResultsTable({
  results,
  addressNotes = {},
  isLoading = false,
  onRefreshSingle,
  onRefreshAll,
  onRetryFailed,
}: ResultsTableProps) {
  const [sortField, setSortField]       = useState<SortField>('index')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [copiedAddr, setCopiedAddr]     = useState<string | null>(null)
  const [refreshingAddr, setRefreshingAddr] = useState<string | null>(null)
  const [searchQuery, setSearchQuery]   = useState('')
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [exportMenuOpen, setExportMenuOpen] = useState(false)

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

  // 行选择
  const toggleSelectRow = (addr: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev)
      next.has(addr) ? next.delete(addr) : next.add(addr)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedRows.size === results.length) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(results.map((r) => r.address)))
    }
  }

  // 构建原始地址到序号的映射（按输入顺序）
  const addressIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    results.forEach((r, i) => {
      map.set(r.address, i + 1)
    })
    return map
  }, [results])

  // 搜索过滤
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return results
    const q = searchQuery.trim().toLowerCase()
    return results.filter((r) => {
      if (r.address.toLowerCase().includes(q)) return true
      const note = addressNotes[r.address] || addressNotes[r.address.toLowerCase()] || ''
      if (note.toLowerCase().includes(q)) return true
      const idx = addressIndexMap.get(r.address) ?? 0
      if (String(idx) === q) return true
      return false
    })
  }, [results, searchQuery, addressNotes, addressIndexMap])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      // error 排最后，success 和 partial 正常排序
      const aIsData = a.status === 'success' || a.status === 'partial'
      const bIsData = b.status === 'success' || b.status === 'partial'
      if (!aIsData && bIsData) return 1
      if (aIsData && !bIsData) return -1
      if (sortField === 'index') {
        const ai = addressIndexMap.get(a.address) ?? 0
        const bi = addressIndexMap.get(b.address) ?? 0
        return sortDirection === 'asc' ? ai - bi : bi - ai
      }
      const av = (a[sortField] as number) ?? -1
      const bv = (b[sortField] as number) ?? -1
      return sortDirection === 'asc' ? av - bv : bv - av
    })
  }, [filtered, sortField, sortDirection, addressIndexMap])

  const okCount = results.filter((r) => r.status === 'success').length
  const partialCount = results.filter((r) => r.status === 'partial').length
  const errorCount = results.filter((r) => r.status === 'error').length
  const retryableCount = errorCount + partialCount

  // 导出相关
  const getExportData = () => {
    if (selectedRows.size > 0) {
      return results.filter((r) => selectedRows.has(r.address))
    }
    return results
  }

  const handleExport = (format: 'excel' | 'csv' | 'json') => {
    const data = getExportData()
    if (format === 'excel') exportToExcel(data, addressNotes, addressIndexMap)
    else if (format === 'csv') exportToCSV(data, addressNotes, addressIndexMap)
    else exportToJSON(data, addressNotes, addressIndexMap)
    setExportMenuOpen(false)
  }

  // 渲染单个数据单元格，失败的字段显示 "-"
  const renderCell = (
    wallet: WalletData,
    value: number | null,
    failedFieldNames: string[],
    formatter: (v: number) => string,
    extraClass = ''
  ) => {
    const failed = isFieldFailed(wallet.failedFields, ...failedFieldNames)
    if (failed) {
      return (
        <td className="px-3 py-3 text-center text-sm text-orange-400 font-mono" title={`获取失败: ${failedFieldNames.join('、')}`}>
          -
        </td>
      )
    }
    return (
      <td className={`px-3 py-3 text-center font-mono text-sm ${extraClass}`}>
        {value !== null ? formatter(value) : '-'}
      </td>
    )
  }

  const rows: React.ReactNode[] = []
  for (const wallet of sorted) {
    const isExpanded = expandedRows.has(wallet.address)
    const hasPos     = wallet.positions && wallet.positions.length > 0
    const pnl        = formatPnL(wallet.profit)
    const isRefreshing = refreshingAddr === wallet.address
    const rowIndex = addressIndexMap.get(wallet.address) ?? 0
    const isSelected = selectedRows.has(wallet.address)
    const isPartialStatus = wallet.status === 'partial'
    const isDataReady = wallet.status === 'success' || wallet.status === 'partial'

    rows.push(
      <tr
        key={wallet.address}
        className={`border-b border-gray-100 hover:bg-gray-50/80 transition-colors ${isExpanded ? 'bg-blue-50/30' : ''} ${isSelected ? 'bg-blue-50/50' : ''} ${isPartialStatus ? 'bg-orange-50/30' : ''}`}
      >
        {/* Checkbox */}
        <td className="w-10 px-2 py-3 text-center">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSelectRow(wallet.address)}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
          />
        </td>

        {/* 展开按钮 */}
        <td className="w-10 px-2 py-3 text-center">
          {isDataReady && (
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

        {/* 序号 */}
        <td className="w-12 px-2 py-3 text-center text-sm text-gray-400 font-mono">
          {rowIndex}
        </td>

        {/* 地址 + 操作按钮 + 代理 IP */}
        <td className="px-3 py-3 min-w-[200px]">
          <div className="flex items-center gap-1.5">
            {wallet.status === 'loading' && (
              <Loader2 className="w-4 h-4 animate-spin text-blue-500 flex-shrink-0" />
            )}
            {wallet.status === 'error' && (
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            )}
            {wallet.status === 'partial' && (
              <span title={wallet.errorMessage || '部分数据获取失败'}><AlertTriangle className="w-4 h-4 text-orange-500 flex-shrink-0" /></span>
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
            {onRefreshSingle && isDataReady && (
              <button
                onClick={() => handleRefreshSingle(wallet.address)}
                disabled={isRefreshing || isLoading}
                className="p-0.5 rounded hover:bg-blue-100 transition-colors disabled:opacity-40"
                title="刷新此地址数据"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            )}
            {/* error 状态也显示刷新按钮 */}
            {onRefreshSingle && wallet.status === 'error' && (
              <button
                onClick={() => handleRefreshSingle(wallet.address)}
                disabled={isRefreshing || isLoading}
                className="p-0.5 rounded hover:bg-blue-100 transition-colors disabled:opacity-40"
                title="重新查询此地址"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            )}
            {/* 备注图标 */}
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
          {/* 代理出口 IP */}
          {wallet.proxyIp && isDataReady && (
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
          {wallet.proxyIp && wallet.status === 'error' && (
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
          {/* partial 状态下显示失败提示 */}
          {isPartialStatus && wallet.errorMessage && (
            <div className="text-xs text-orange-500 mt-1" title={wallet.errorMessage}>
              {wallet.errorMessage}
            </div>
          )}
        </td>

        {/* 数据列 */}
        {wallet.status === 'loading' ? (
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
            {/* 净资产：依赖可用余额和持仓估值 */}
            {renderCell(wallet, wallet.netWorth, ['可用余额', '持仓估值'], formatUSD, 'text-gray-800 font-semibold')}
            {/* 盈亏 */}
            {isFieldFailed(wallet.failedFields, '盈亏') ? (
              <td className="px-3 py-3 text-center text-sm text-orange-400 font-mono" title="获取失败: 盈亏">-</td>
            ) : (
              <td className={`px-3 py-3 text-center font-mono text-sm ${pnl.className}`}>{pnl.text}</td>
            )}
            {/* 可用余额 */}
            {renderCell(wallet, wallet.availableBalance, ['可用余额'], formatUSD, 'text-gray-700')}
            {/* 持仓估值 */}
            {renderCell(wallet, wallet.portfolioValue, ['持仓估值'], formatUSD, 'text-gray-700')}
            {/* 交易额 */}
            {renderCell(wallet, wallet.totalVolume, ['交易额'], formatUSD, 'text-gray-700')}
            {/* 池子数 */}
            {renderCell(wallet, wallet.marketsTraded, ['池子数'], (v) => String(v), 'text-gray-700')}
            {/* 最后活跃 */}
            {isFieldFailed(wallet.failedFields, '活跃度') ? (
              <td className="px-3 py-3 text-center text-sm text-orange-400 font-mono" title="获取失败: 活跃度">-</td>
            ) : (
              <td className="px-3 py-3 text-center text-sm text-gray-600">
                {wallet.lastActiveDay !== null ? `${wallet.lastActiveDay}天前` : '-'}
              </td>
            )}
            {/* 活跃天 */}
            {renderCell(wallet, wallet.activeDays, ['活跃度'], (v) => String(v), 'text-gray-700')}
            {/* 活跃月 */}
            {renderCell(wallet, wallet.activeMonths, ['活跃度'], (v) => String(v), 'text-gray-700')}
          </>
        )}
      </tr>
    )

    // 展开的仓位行
    if (isExpanded && isDataReady) {
      rows.push(
        <PositionDetailRows key={wallet.address + '-pos'} positions={wallet.positions} />
      )
    }
  }

  const isAllSelected = results.length > 0 && selectedRows.size === results.length
  const isPartialSelected = selectedRows.size > 0 && selectedRows.size < results.length

  return (
    <div className="space-y-5">
      <SummaryCards results={results} />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-bold text-gray-900">查询结果</h2>
          <span className="text-sm text-gray-500">
            已查询 {results.length} 个地址，成功 {okCount} 个
            {partialCount > 0 && (
              <span className="text-orange-500 ml-1">，部分成功 {partialCount} 个</span>
            )}
            {errorCount > 0 && (
              <span className="text-red-500 ml-1">，失败 {errorCount} 个</span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* 搜索框 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索地址 / 备注 / 序号"
              className="pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-56 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100"
              >
                <span className="text-gray-400 text-xs">&#x2715;</span>
              </button>
            )}
          </div>

          {/* 重试失败/部分成功按钮 */}
          {onRetryFailed && retryableCount > 0 && !isLoading && (
            <button
              onClick={onRetryFailed}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-orange-500 rounded-lg hover:bg-orange-600 transition-colors shadow-sm"
              title={`重新查询 ${retryableCount} 个失败/部分成功的地址`}
            >
              <RotateCcw className="w-4 h-4" />
              重试失败 ({retryableCount})
            </button>
          )}

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

          {/* 导出下拉菜单 */}
          {(okCount + partialCount) > 0 && (
            <div className="relative">
              <button
                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                onBlur={() => setTimeout(() => setExportMenuOpen(false), 200)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-colors shadow-sm"
                title="导出数据"
              >
                <Download className="w-4 h-4" />
                导出{selectedRows.size > 0 ? ` (${selectedRows.size})` : ''}
                <ChevronDownIcon className="w-3.5 h-3.5 text-gray-400" />
              </button>
              {exportMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleExport('excel')}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-between"
                  >
                    <span>Excel (.xlsx)</span>
                    <span className="text-xs text-gray-400">推荐</span>
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleExport('csv')}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    CSV (.csv)
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleExport('json')}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    JSON (.json)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 选中提示 */}
      {selectedRows.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg text-sm">
          <span className="text-blue-700">
            已选择 <strong>{selectedRows.size}</strong> 个地址
          </span>
          <button
            onClick={() => setSelectedRows(new Set())}
            className="text-blue-600 hover:text-blue-800 underline transition-colors"
          >
            取消选择
          </button>
          <span className="text-blue-400">|</span>
          <span className="text-blue-500">导出时将只导出选中的地址</span>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b-2 border-gray-200">
                {/* 全选 checkbox */}
                <th className="w-10 px-2 py-3">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(el) => { if (el) el.indeterminate = isPartialSelected }}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </th>
                <th className="w-10 px-2 py-3"></th>
                <th className="w-12 px-2 py-3 text-center whitespace-nowrap">
                  <button
                    onClick={() => handleSort('index')}
                    className="inline-flex items-center justify-center hover:text-gray-900 transition-colors text-sm font-semibold text-gray-600"
                    title="按导入顺序排序"
                  >
                    #
                    <SortIcon active={sortField === 'index'} direction={sortDirection} />
                  </button>
                </th>
                <th className="px-3 py-3 text-left text-sm font-semibold text-gray-600 whitespace-nowrap">
                  地址
                </th>
                {SORT_COLS.map(({ field, label, tip }) => (
                  <th key={field} className="px-3 py-3 text-center whitespace-nowrap">
                    <button
                      onClick={() => handleSort(field)}
                      className="inline-flex items-center justify-center hover:text-gray-900 transition-colors text-sm font-semibold text-gray-600"
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
