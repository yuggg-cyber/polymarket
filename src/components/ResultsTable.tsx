import { useState, useMemo, useRef, useEffect } from 'react'
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
  RefreshCw,
  Search,
  RotateCcw,
  ChevronDownIcon,
  Trash2,
  X,
  Pencil,
  History,
  TrendingUp,
  Gift,
  Settings2,
} from 'lucide-react'
import type { WalletData, Position, ClosedPosition, SortField, SortDirection } from '@/types'
import { exportToExcel, exportToCSV, exportToJSON } from '@/services/export'
import { getClosedPositions } from '@/services/polymarket'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

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
  if (value === 0) return { text: '$0', className: 'text-gray-500' }
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
// 排序列定义（按用户要求的顺序：净资产-可用余额-持仓估值-持仓盈亏-总盈亏-池子数-交易额-活跃天-活跃月-最后活跃）
// ============================================================

const SORT_COLS: { field: SortField; label: string; tip: string }[] = [
  { field: 'netWorth',         label: '净资产',   tip: '净资产 = 可用余额 + 持仓估值' },
  { field: 'availableBalance', label: '可用余额', tip: '链上 USDC.e 可用余额' },
  { field: 'portfolioValue',   label: '持仓估值', tip: '当前持仓估值（USD）' },
  { field: 'holdingPnl',       label: '持仓盈亏', tip: '当前持仓的浮动盈亏汇总（USD）' },
  { field: 'profit',           label: '总盈亏',   tip: '历史累计总盈亏（USD）' },
  { field: 'marketsTraded',    label: '池子数',   tip: '参与的预测市场数量' },
  { field: 'totalVolume',      label: '交易额',   tip: '历史累计交易额（USD）' },
  { field: 'activeDays',       label: '活跃天',   tip: '历史累计活跃交易天数' },
  { field: 'activeMonths',     label: '活跃月',   tip: '历史累计活跃月数' },
  { field: 'lastActiveDay',    label: '最后活跃', tip: '最近一次交易距今天数' },
]

// 列可见性存储
const COL_VISIBILITY_KEY = 'polymarket_col_visibility'
const ALL_COL_FIELDS = SORT_COLS.map(c => c.field)
const DEFAULT_VISIBLE = new Set<SortField>(ALL_COL_FIELDS)

function loadColVisibility(): Set<SortField> {
  try {
    const raw = localStorage.getItem(COL_VISIBILITY_KEY)
    if (raw) {
      const arr = JSON.parse(raw) as string[]
      const saved = new Set(arr.filter(f => ALL_COL_FIELDS.includes(f as SortField)) as SortField[])
      // 自动补充新增的列字段（旧配置中不存在的列默认显示）
      for (const field of ALL_COL_FIELDS) {
        if (!arr.includes(field)) {
          saved.add(field)
        }
      }
      return saved
    }
  } catch { /* ignore */ }
  return new Set(DEFAULT_VISIBLE)
}

function saveColVisibility(visible: Set<SortField>) {
  localStorage.setItem(COL_VISIBILITY_KEY, JSON.stringify([...visible]))
}

// ============================================================
// 可编辑备注单元格
// ============================================================

function EditableNoteCell({
  address,
  note,
  onNoteChange,
}: {
  address: string
  note: string
  onNoteChange?: (address: string, note: string) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(note)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEditValue(note)
  }, [note])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isEditing])

  const handleSave = () => {
    setIsEditing(false)
    if (onNoteChange && editValue !== note) {
      onNoteChange(address, editValue)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave()
    } else if (e.key === 'Escape') {
      setEditValue(note)
      setIsEditing(false)
    }
  }

  if (isEditing) {
    return (
      <td className="px-3 py-2 min-w-[120px]">
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          className="w-full px-2 py-1 text-sm border border-blue-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder="输入备注..."
        />
      </td>
    )
  }

  return (
    <td className="px-3 py-3 min-w-[120px]">
      <div
        className="flex items-center gap-1 cursor-pointer group"
        onClick={() => setIsEditing(true)}
        title={note || '点击添加备注'}
      >
        {note ? (
          <span className="text-sm text-amber-600 truncate max-w-[150px]">{note}</span>
        ) : (
          <span className="text-sm text-gray-300 group-hover:text-gray-400">-</span>
        )}
        <Pencil className="w-3 h-3 text-gray-300 group-hover:text-blue-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </td>
  )
}

// ============================================================
// 仓位详情行
// ============================================================

/**
 * 灰尘残留判断阈值：
 * - 绝对值阈值：currentValue < $0.1 视为灰尘
 * - 比例阈值：currentValue / totalBought < 1% 视为灰尘
 * 两个条件同时满足时才视为灰尘残留（已实质结算）
 */
const REDEEMABLE_DUST_VALUE = 0.1
const REDEEMABLE_DUST_RATIO = 0.01

/** 判断仓位是否真正可赎回（排除灰尘残留） */
function isActuallyRedeemable(pos: Position): boolean {
  if (!pos.redeemable || pos.currentValue <= 0) return false
  // 绝对值较大（>= $0.1）时直接视为可赎回
  if (pos.currentValue >= REDEEMABLE_DUST_VALUE) return true
  // 绝对值较小时，进一步检查占买入总额的比例
  if (pos.totalBought > 0 && pos.currentValue / pos.totalBought < REDEEMABLE_DUST_RATIO) return false
  return true
}

/** 获取持仓状态的排序权重：持有中=0，可合并=1，可赎回(盈利)=2，已结算(亏损)=3 */
function getPositionStatusWeight(pos: Position): number {
  if (pos.redeemable) {
    return isActuallyRedeemable(pos) ? 2 : 3
  }
  if (pos.mergeable) return 1
  return 0
}

/** 历史战绩行 */
function ClosedPositionRows({ closedPositions, isLoading, totalCols }: { closedPositions: ClosedPosition[]; isLoading: boolean; totalCols: number }) {
  if (isLoading) {
    return (
      <tr>
        <td colSpan={totalCols} className="text-center text-gray-400 py-6 bg-gray-50/80">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> 加载历史战绩中...
          </span>
        </td>
      </tr>
    )
  }

  if (closedPositions.length === 0) {
    return (
      <tr>
        <td colSpan={totalCols} className="text-center text-gray-400 py-6 bg-gray-50/80">
          暂无历史战绩
        </td>
      </tr>
    )
  }

  return (
    <>
      <tr className="bg-amber-50/60 border-b border-amber-100">
        <td colSpan={4} className="px-4 py-2.5 text-sm font-semibold text-amber-700">
          历史战绩
          <span className="ml-2 text-xs font-normal text-amber-500">({closedPositions.length} 条记录)</span>
        </td>
        <td className="px-3 py-2.5 text-sm font-semibold text-gray-500">方向</td>
        <td className="px-3 py-2.5 text-sm font-semibold text-gray-500 text-right">平仓时间</td>
        <td className="px-3 py-2.5 text-sm font-semibold text-gray-500 text-right">均价</td>
        <td className="px-3 py-2.5 text-sm font-semibold text-gray-500 text-right">结算价</td>
        <td className="px-3 py-2.5 text-sm font-semibold text-gray-500 text-right">买入总额</td>
        <td className="px-3 py-2.5 text-sm font-semibold text-gray-500 text-right">实现盈亏</td>
        <td className="px-3 py-2.5 text-sm font-semibold text-gray-500 text-right">收益率</td>
        <td className="px-3 py-2.5 text-sm font-semibold text-gray-500 text-center">结果</td>
        <td colSpan={2} className="px-3 py-2.5 text-sm font-semibold text-gray-500">截止日期</td>
      </tr>
      {closedPositions.map((pos, idx) => {
        const pnlColor = pos.realizedPnl >= 0 ? 'text-emerald-600' : 'text-red-500'
        const isWin = pos.realizedPnl >= 0
        const returnRate = pos.totalBought > 0 ? (pos.realizedPnl / pos.totalBought * 100) : 0
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
            <td className="px-3 py-2.5 text-right text-sm text-gray-500">
              {pos.timestamp ? new Date(pos.timestamp * 1000).toLocaleDateString('zh-CN') : '-'}
            </td>
            <td className="px-3 py-2.5 text-right text-sm font-mono text-gray-700">${formatExact(pos.avgPrice)}</td>
            <td className="px-3 py-2.5 text-right text-sm font-mono text-gray-700">${formatExact(pos.curPrice)}</td>
            <td className="px-3 py-2.5 text-right text-sm font-mono text-gray-700">{formatUSD(pos.totalBought)}</td>
            <td className={`px-3 py-2.5 text-right text-sm font-mono font-semibold ${pnlColor}`}>
              {pos.realizedPnl >= 0 ? '+' : ''}{formatUSD(pos.realizedPnl)}
            </td>
            <td className={`px-3 py-2.5 text-right text-sm font-mono font-semibold ${pnlColor}`}>
              {returnRate >= 0 ? '+' : ''}{returnRate.toFixed(1)}%
            </td>
            <td className="px-3 py-2.5 text-center">
              {isWin ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600 font-medium">盈利</span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-400 font-medium">亏损</span>
              )}
            </td>
            <td colSpan={2} className="px-3 py-2.5 text-sm text-gray-500">
              {pos.endDate ? new Date(pos.endDate).toLocaleDateString('zh-CN') : '-'}
            </td>
          </tr>
        )
      })}
    </>
  )
}

/** 带 Tab 切换的仓位详情行 */
function PositionDetailRows({ positions, walletAddress, totalCols }: { positions: Position[]; walletAddress: string; totalCols: number }) {
  const [activeTab, setActiveTab] = useState<'current' | 'history'>('current')
  const [closedPositions, setClosedPositions] = useState<ClosedPosition[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)

  const handleTabChange = async (tab: 'current' | 'history') => {
    setActiveTab(tab)
    if (tab === 'history' && !historyLoaded) {
      setHistoryLoading(true)
      try {
        const data = await getClosedPositions(walletAddress)
        setClosedPositions(data)
        setHistoryLoaded(true)
      } catch {
        setClosedPositions([])
        setHistoryLoaded(true)
      } finally {
        setHistoryLoading(false)
      }
    }
  }

  // 排序：持有中 → 可合并 → 可赎回，同状态内按买入总额降序
  const sortedPositions = useMemo(() => {
    return [...positions].sort((a, b) => {
      const weightA = getPositionStatusWeight(a)
      const weightB = getPositionStatusWeight(b)
      if (weightA !== weightB) return weightA - weightB
      return b.totalBought - a.totalBought
    })
  }, [positions])

  // 计算历史战绩统计
  const historyStats = useMemo(() => {
    if (closedPositions.length === 0) return null
    const wins = closedPositions.filter(p => p.realizedPnl >= 0).length
    const totalPnl = closedPositions.reduce((s, p) => s + p.realizedPnl, 0)
    const winRate = (wins / closedPositions.length * 100).toFixed(1)
    return { wins, total: closedPositions.length, winRate, totalPnl }
  }, [closedPositions])

  return (
    <>
      {/* Tab 切换行 */}
      <tr className="bg-gray-50 border-b border-gray-200">
        <td colSpan={totalCols} className="px-4 py-2">
          <div className="flex items-center gap-4">
            <button
              onClick={() => handleTabChange('current')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'current'
                  ? 'bg-blue-100 text-blue-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              当前持仓
              <span className="text-xs ml-0.5 opacity-70">({positions.length})</span>
            </button>
            <button
              onClick={() => handleTabChange('history')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'history'
                  ? 'bg-amber-100 text-amber-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              历史战绩
              {historyLoaded && <span className="text-xs ml-0.5 opacity-70">({closedPositions.length})</span>}
              {historyLoading && <Loader2 className="w-3 h-3 animate-spin ml-1" />}
            </button>

            {/* 历史战绩统计摘要 */}
            {activeTab === 'history' && historyStats && (
              <div className="flex items-center gap-3 ml-auto text-xs">
                <span className="text-gray-500">
                  胜率: <strong className="text-gray-700">{historyStats.winRate}%</strong>
                  <span className="text-gray-400 ml-1">({historyStats.wins}/{historyStats.total})</span>
                </span>
                <span className="text-gray-500">
                  总实现盈亏: <strong className={historyStats.totalPnl >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                    {historyStats.totalPnl >= 0 ? '+' : ''}{formatUSD(historyStats.totalPnl)}
                  </strong>
                </span>
              </div>
            )}
          </div>
        </td>
      </tr>

      {/* 当前持仓内容 */}
      {activeTab === 'current' && (
        <>
          {positions.length === 0 ? (
            <tr>
              <td colSpan={totalCols} className="text-center text-gray-400 py-6 bg-gray-50/80">
                暂无持仓
              </td>
            </tr>
          ) : (
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
                <td colSpan={2} className="px-3 py-2.5 text-sm font-semibold text-gray-500">截止日期</td>
              </tr>
              {sortedPositions.map((pos, idx) => {
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
                        isActuallyRedeemable(pos) ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600 font-medium">可赎回</span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-400 font-medium">已结算</span>
                        )
                      ) : pos.mergeable ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-600 font-medium">可合并</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">持有中</span>
                      )}
                    </td>
                    <td colSpan={2} className="px-3 py-2.5 text-sm text-gray-500">
                      {pos.endDate ? new Date(pos.endDate).toLocaleDateString('zh-CN') : '-'}
                    </td>
                  </tr>
                )
              })}
            </>
          )}
        </>
      )}

      {/* 历史战绩内容 */}
      {activeTab === 'history' && (
        <ClosedPositionRows closedPositions={closedPositions} isLoading={historyLoading} totalCols={totalCols} />
      )}
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
  const totalHoldingPnl = ok.reduce((s, r) => s + r.holdingPnl, 0)

  // 计算可赎回总额
  let totalRedeemable = 0
  let redeemableCount = 0
  for (const w of ok) {
    for (const p of w.positions) {
      if (isActuallyRedeemable(p)) {
        totalRedeemable += p.currentValue
        redeemableCount++
      }
    }
  }

  const pnl = formatPnL(totalProfit)
  const holdingPnlFmt = formatPnL(totalHoldingPnl)

  const cards: { label: string; value: string; sub: string; cls: string; highlight?: boolean }[] = [
    { label: '净资产总计', value: formatUSD(totalNetWorth),    sub: '可用 + 持仓', cls: 'text-gray-900' },
    { label: '可用余额',   value: formatUSD(totalAvailable),  sub: 'USDC',       cls: 'text-gray-900' },
    { label: '持仓估值',   value: formatUSD(totalHoldings),   sub: 'USD',        cls: 'text-gray-900' },
    { label: '持仓盈亏',   value: holdingPnlFmt.text,        sub: '当前持仓浮动', cls: holdingPnlFmt.className },
    { label: '总盈亏',     value: pnl.text,                  sub: '历史累计',   cls: pnl.className },
  ]

  // 有可赎回仓位时才显示第6张卡片
  if (redeemableCount > 0) {
    cards.push({
      label: '可赎回总额',
      value: formatUSD(totalRedeemable),
      sub: `${redeemableCount} 个仓位可赎回`,
      cls: 'text-amber-600',
      highlight: true,
    })
  }

  return (
    <div className={`grid grid-cols-2 gap-2 mb-4 md:gap-4 md:mb-6 ${cards.length > 5 ? 'lg:grid-cols-6' : cards.length > 4 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
      {cards.map((c) => (
        <div
          key={c.label}
          className={`bg-white rounded-xl border px-3 py-2.5 md:px-5 md:py-4 ${
            c.highlight
              ? 'border-amber-300 bg-amber-50/50'
              : 'border-gray-200'
          }`}
        >
          <div className={`text-xs mb-0.5 md:text-sm md:mb-1 ${c.highlight ? 'text-amber-600 font-medium' : 'text-gray-500'}`}>{c.label}</div>
          <div className={`text-lg font-bold tracking-tight md:text-2xl ${c.cls}`}>{c.value}</div>
          <div className={`text-[10px] mt-0.5 md:text-xs md:mt-1 ${c.highlight ? 'text-amber-500' : 'text-gray-400'}`}>{c.sub}</div>
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
  onNoteChange?: (address: string, note: string) => void
  isLoading?: boolean
  onRefreshSingle?: (address: string) => Promise<void>
  onRefreshAll?: () => Promise<void>
  onRetryFailed?: () => Promise<void>
  onMemoClear?: () => void
  onDeleteAddress?: (address: string) => void
  isMemoTab?: boolean
  memoSavedTime?: string
}

export function ResultsTable({
  results,
  addressNotes = {},
  onNoteChange,
  isLoading = false,
  onRefreshSingle,
  onRefreshAll,
  onRetryFailed,
  onMemoClear,
  onDeleteAddress,
  isMemoTab = false,
  memoSavedTime = '',
}: ResultsTableProps) {
  const [sortField, setSortField]       = useState<SortField>('index')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [copiedAddr, setCopiedAddr]     = useState<string | null>(null)
  const [refreshingAddr, setRefreshingAddr] = useState<string | null>(null)
  const [searchQuery, setSearchQuery]   = useState('')
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [visibleCols, setVisibleCols] = useState<Set<SortField>>(loadColVisibility)
  const [colMenuOpen, setColMenuOpen] = useState(false)

  const toggleColVisibility = (field: SortField) => {
    setVisibleCols(prev => {
      const next = new Set(prev)
      if (next.has(field)) {
        if (next.size <= 1) return prev // 至少保留 1 列
        next.delete(field)
      } else {
        next.add(field)
      }
      saveColVisibility(next)
      return next
    })
  }

  const resetColVisibility = () => {
    setVisibleCols(new Set(DEFAULT_VISIBLE))
    saveColVisibility(new Set(DEFAULT_VISIBLE))
  }

  const filteredSortCols = SORT_COLS.filter(c => visibleCols.has(c.field))
  const TOTAL_COLS = 4 + filteredSortCols.length + 1

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

  // 构建原始地址到序号的映射
  const addressIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    results.forEach((r, i) => {
      map.set(r.address, i + 1)
    })
    return map
  }, [results])

  // 获取地址的备注（不区分大小写）
  const getNote = (address: string): string => {
    return addressNotes[address.toLowerCase()] || ''
  }

  // 搜索过滤
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return results
    const q = searchQuery.trim().toLowerCase()
    return results.filter((r) => {
      if (r.address.toLowerCase().includes(q)) return true
      const note = getNote(r.address)
      if (note.toLowerCase().includes(q)) return true
      const idx = addressIndexMap.get(r.address) ?? 0
      if (String(idx) === q) return true
      return false
    })
  }, [results, searchQuery, addressNotes, addressIndexMap]) // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      // 按序号排序时，严格按照添加顺序，不区分状态
      if (sortField === 'index') {
        const ai = addressIndexMap.get(a.address) ?? 0
        const bi = addressIndexMap.get(b.address) ?? 0
        return sortDirection === 'asc' ? ai - bi : bi - ai
      }
      // 按数据列排序时，将非数据行（loading/error/pending）放到末尾
      const aIsData = a.status === 'success' || a.status === 'partial'
      const bIsData = b.status === 'success' || b.status === 'partial'
      if (!aIsData && bIsData) return 1
      if (aIsData && !bIsData) return -1
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

  // 渲染单个数据单元格
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
        <td className="px-4 py-3.5 text-right text-base text-orange-400" title={`获取失败: ${failedFieldNames.join('、')}`}>
          -
        </td>
      )
    }
    return (
      <td className={`px-4 py-3.5 text-right text-base tabular-nums ${extraClass}`}>
        {value !== null ? formatter(value) : '-'}
      </td>
    )
  }

  // 渲染盈亏类单元格（带颜色）
  const renderPnlCell = (
    wallet: WalletData,
    value: number,
    failedFieldNames: string[],
  ) => {
    const failed = isFieldFailed(wallet.failedFields, ...failedFieldNames)
    if (failed) {
      return (
        <td className="px-4 py-3.5 text-right text-base text-orange-400" title={`获取失败: ${failedFieldNames.join('、')}`}>
          -
        </td>
      )
    }
    const pnlFmt = formatPnL(value)
    return (
      <td className={`px-4 py-3.5 text-right text-base tabular-nums ${pnlFmt.className}`}>{pnlFmt.text}</td>
    )
  }

  const rows: React.ReactNode[] = []
  for (const wallet of sorted) {
    const isExpanded = expandedRows.has(wallet.address)
    const hasPos     = wallet.positions && wallet.positions.length > 0
    const isRefreshing = refreshingAddr === wallet.address
    const rowIndex = addressIndexMap.get(wallet.address) ?? 0
    const isSelected = selectedRows.has(wallet.address)
    const isPartialStatus = wallet.status === 'partial'
    const isDataReady = wallet.status === 'success' || wallet.status === 'partial'
    const walletNote = getNote(wallet.address)

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
        <td className="w-12 px-2 py-3.5 text-center text-base text-gray-400 tabular-nums">
          <div className="flex flex-col items-center justify-center">
            {wallet.positions.some(p => isActuallyRedeemable(p)) && (
              <span
                title="有可赎回的盈利仓位"
                className="inline-flex items-center justify-center w-5 h-5 rounded border border-amber-400 mb-0.5"
                style={{ boxShadow: '0 0 6px 1px rgba(251, 191, 36, 0.5)' }}
              >
                <Gift className="w-3 h-3 text-amber-500" />
              </span>
            )}
            {rowIndex}
          </div>
        </td>

        {/* 地址 + 操作按钮 */}
        <td className="px-3 py-3.5 min-w-[200px]">
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
            <span className="font-mono text-base text-gray-800 font-medium" title={wallet.address}>
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
              href={`https://polymarket.com/profile/${wallet.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-0.5 rounded hover:bg-gray-200 transition-colors"
              title="在 Polymarket 查看个人主页"
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
            {/* 删除此地址按钮 */}
            {onDeleteAddress && !isLoading && (
              <button
                onClick={() => onDeleteAddress(wallet.address)}
                className="p-0.5 rounded hover:bg-red-100 transition-colors"
                title="删除此地址"
              >
                <X className="w-3.5 h-3.5 text-red-400 hover:text-red-600" />
              </button>
            )}
          </div>
          {/* 原始账户地址（账户地址模式下显示） */}
          {wallet.originalAddress && wallet.originalAddress !== wallet.address && (
            <div className="flex items-center gap-1 mt-1">
              <span className="text-xs text-purple-500 font-mono" title={`账户地址: ${wallet.originalAddress}`}>
                账户: {shortenAddress(wallet.originalAddress)}
              </span>
            </div>
          )}
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
          <>
            <td colSpan={filteredSortCols.length} className="px-2 py-3 text-center text-gray-400">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
              </span>
            </td>
            <td className="px-2 py-3"></td>
          </>
        ) : wallet.status === 'error' ? (
          <>
            <td colSpan={filteredSortCols.length} className="px-2 py-3 text-center text-red-500">
              <span className="inline-flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> {wallet.errorMessage || '查询失败'}
              </span>
            </td>
            <td className="px-2 py-3"></td>
          </>
        ) : (
          <>
            {/* 动态数据列 - 按新顺序：净资产-可用余额-持仓估值-持仓盈亏-总盈亏-池子数-交易额-活跃天-活跃月-最后活跃 */}
            {visibleCols.has('netWorth') && renderCell(wallet, wallet.netWorth, ['可用余额', '持仓估值'], formatUSD, 'text-gray-900 font-semibold')}
            {visibleCols.has('availableBalance') && renderCell(wallet, wallet.availableBalance, ['可用余额'], formatUSD, 'text-gray-700 font-medium')}
            {visibleCols.has('portfolioValue') && renderCell(wallet, wallet.portfolioValue, ['持仓估值'], formatUSD, 'text-gray-700 font-medium')}
            {visibleCols.has('holdingPnl') && renderPnlCell(wallet, wallet.holdingPnl, ['持仓列表'])}
            {visibleCols.has('profit') && renderPnlCell(wallet, wallet.profit, ['盈亏'])}
            {visibleCols.has('marketsTraded') && renderCell(wallet, wallet.marketsTraded, ['池子数'], (v) => String(v), 'text-gray-700 font-medium')}
            {visibleCols.has('totalVolume') && renderCell(wallet, wallet.totalVolume, ['交易额'], formatUSD, 'text-gray-700 font-medium')}
            {visibleCols.has('activeDays') && renderCell(wallet, wallet.activeDays, ['活跃度'], (v) => String(v), 'text-gray-700 font-medium')}
            {visibleCols.has('activeMonths') && renderCell(wallet, wallet.activeMonths, ['活跃度'], (v) => String(v), 'text-gray-700 font-medium')}
            {visibleCols.has('lastActiveDay') && (
              isFieldFailed(wallet.failedFields, '活跃度') ? (
                <td className="px-4 py-3.5 text-right text-base text-orange-400" title="获取失败: 活跃度">-</td>
              ) : (
                <td className="px-4 py-3.5 text-right text-base text-gray-700 font-medium tabular-nums">
                  {wallet.lastActiveDay !== null ? `${wallet.lastActiveDay}天前` : '-'}
                </td>
              )
            )}
            {/* 备注 */}
            <EditableNoteCell
              address={wallet.address}
              note={walletNote}
              onNoteChange={onNoteChange}
            />
          </>
        )}
      </tr>
    )

    // 展开的仓位行
    if (isExpanded && isDataReady) {
      rows.push(
        <PositionDetailRows key={wallet.address + '-pos'} positions={wallet.positions} walletAddress={wallet.address} totalCols={TOTAL_COLS} />
      )
    }
  }

  const isAllSelected = results.length > 0 && selectedRows.size === results.length
  const isPartialSelected = selectedRows.size > 0 && selectedRows.size < results.length

  return (
    <div className="space-y-3 md:space-y-5">
      <SummaryCards results={results} />

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:flex-wrap md:gap-3">
        <div className="flex flex-col gap-0.5 md:flex-row md:items-baseline md:gap-3">
          <h2 className="text-base font-bold text-gray-900 md:text-lg">查询结果</h2>
          <span className="text-xs text-gray-500 md:text-sm">
            已查询 {results.length} 个地址，成功 {okCount} 个
            {partialCount > 0 && (
              <span className="text-orange-500 ml-1">，部分成功 {partialCount} 个</span>
            )}
            {errorCount > 0 && (
              <span className="text-red-500 ml-1">，失败 {errorCount} 个</span>
            )}
          </span>
          {/* 记忆查询保存时间提示 */}
          {isMemoTab && memoSavedTime && !isLoading && (
            <span className="text-xs text-gray-400 md:text-sm">
              （保存于 {memoSavedTime}）
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap md:gap-2">
          {/* 搜索框 */}
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索地址 / 备注 / 序号"
              className="pl-9 pr-3 py-1.5 text-xs border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full transition-colors sm:w-56 md:py-2 md:text-sm"
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

          {/* 重试失败按钮 */}
          {onRetryFailed && retryableCount > 0 && !isLoading && (
            <button
              onClick={onRetryFailed}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-white bg-orange-500 rounded-lg hover:bg-orange-600 transition-colors shadow-sm md:gap-2 md:px-4 md:py-2 md:text-sm"
              title={`重新查询 ${retryableCount} 个失败/部分成功的地址`}
            >
              <RotateCcw className="w-3.5 h-3.5 md:w-4 md:h-4" />
              重试 ({retryableCount})
            </button>
          )}

          {/* 刷新全部按钮 */}
          {onRefreshAll && results.length > 0 && (
            <button
              onClick={onRefreshAll}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50 md:gap-2 md:px-4 md:py-2 md:text-sm"
              title="重新查询所有地址"
            >
              <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 ${isLoading ? 'animate-spin' : ''}`} />
              刷新全部
            </button>
          )}

          {/* 清除按钮（仅记忆查询标签页显示） */}
          {isMemoTab && onMemoClear && results.length > 0 && !isLoading && (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-red-500 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors shadow-sm md:gap-2 md:px-4 md:py-2 md:text-sm"
              title="清除已保存的记忆查询数据"
            >
              <Trash2 className="w-3.5 h-3.5 md:w-4 md:h-4" />
              清除
            </button>
          )}

          {/* 导出下拉菜单 */}
          {(okCount + partialCount) > 0 && (
            <div className="relative">
              <button
                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                onBlur={() => setTimeout(() => setExportMenuOpen(false), 200)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-colors shadow-sm md:gap-2 md:px-4 md:py-2 md:text-sm"
                title="导出数据"
              >
                <Download className="w-3.5 h-3.5 md:w-4 md:h-4" />
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

          {/* 列设置按钮 */}
          <div className="relative">
            <button
              onClick={() => setColMenuOpen(!colMenuOpen)}
              onBlur={() => setTimeout(() => setColMenuOpen(false), 200)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors shadow-sm md:gap-2 md:px-3 md:py-2 md:text-sm ${
                visibleCols.size < ALL_COL_FIELDS.length
                  ? 'text-blue-600 bg-blue-50 border-blue-300 hover:bg-blue-100'
                  : 'text-gray-700 bg-white border-gray-300 hover:bg-gray-50 hover:border-gray-400'
              }`}
              title="设置显示列"
            >
              <Settings2 className="w-3.5 h-3.5 md:w-4 md:h-4" />
              列
            </button>
            {colMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
                {SORT_COLS.map(({ field, label }) => (
                  <label
                    key={field}
                    className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer transition-colors"
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <input
                      type="checkbox"
                      checked={visibleCols.has(field)}
                      onChange={() => toggleColVisibility(field)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    {label}
                  </label>
                ))}
                <div className="border-t border-gray-100 mt-1 pt-1">
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={resetColVisibility}
                    className="w-full text-left px-4 py-2 text-xs text-gray-500 hover:text-blue-600 hover:bg-gray-50 transition-colors"
                  >
                    重置为默认
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 选中提示 */}
      {selectedRows.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs md:gap-3 md:px-4 md:py-2.5 md:text-sm">
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
          <table className="w-full border-collapse" style={{ minWidth: '1200px' }}>
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
                {filteredSortCols.map(({ field, label, tip }) => (
                  <th key={field} className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => handleSort(field)}
                      className="inline-flex items-center justify-end w-full hover:text-gray-900 transition-colors text-sm font-semibold text-gray-600"
                      title={tip}
                    >
                      {label}
                      <SortIcon active={sortField === field} direction={sortDirection} />
                    </button>
                  </th>
                ))}
                {/* 备注列表头 */}
                <th className="px-3 py-3 text-left text-sm font-semibold text-gray-600 whitespace-nowrap min-w-[120px]">
                  备注
                </th>
              </tr>
            </thead>
            <tbody>
              {rows}
            </tbody>
          </table>
        </div>
      </div>

      {/* 清除记忆查询确认弹窗 */}
      <ConfirmDialog
        open={showClearConfirm}
        title="清除记忆查询"
        message="确定要清除已保存的记忆查询结果吗？该操作将同时清除对应地址的备注信息，且不可恢复。"
        confirmText="确认清除"
        cancelText="取消"
        variant="danger"
        onConfirm={() => {
          setShowClearConfirm(false)
          onMemoClear?.()
        }}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  )
}
