import { useState } from 'react'
import {
  Copy,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { WalletData, Position, SortField, SortDirection } from '@/types'

/** 精确格式化数字，不四舍五入，保留原始小数位（最多 6 位） */
function formatNumber(value: number): string {
  if (value === 0) return '0'
  if (Math.abs(value) < 0.000001) return value.toString()
  const str = value.toFixed(6)
  return str.replace(/\.?0+$/, '')
}

/** 格式化 USD 金额（大数缩写） */
function formatUSD(value: number): string {
  if (value === 0) return '$0'
  if (Math.abs(value) >= 1_000_000) {
    return '$' + formatNumber(value / 1_000_000) + 'M'
  }
  if (Math.abs(value) >= 1_000) {
    return '$' + formatNumber(value / 1_000) + 'K'
  }
  return '$' + formatNumber(value)
}

/** 格式化精确 USD（不缩写，完整显示） */
function formatUSDExact(value: number): string {
  if (value === 0) return '$0'
  if (Math.abs(value) < 0.01 && value !== 0) {
    return '$' + value.toString()
  }
  return (
    '$' +
    value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    })
  )
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

// 可排序列配置
const SORT_COLUMNS: { field: SortField; label: string }[] = [
  { field: 'totalTrades', label: '交易次数' },
  { field: 'totalSettlements', label: '结算次数' },
  { field: 'totalVolume', label: '交易额' },
  { field: 'activeDays', label: '活跃天数' },
  { field: 'activeWeeks', label: '活跃周数' },
  { field: 'activeMonths', label: '活跃月数' },
  { field: 'activeYears', label: '活跃年数' },
  { field: 'availableBalance', label: '可用余额' },
  { field: 'portfolioValue', label: '投资组合' },
  { field: 'netWorth', label: '净资产' },
]

/** 仓位详情子表格 */
function PositionRows({ positions }: { positions: Position[] }) {
  if (positions.length === 0) {
    return (
      <TableRow>
        <TableCell
          colSpan={12}
          className="text-center text-muted-foreground py-3 text-sm bg-muted/30"
        >
          暂无持仓
        </TableCell>
      </TableRow>
    )
  }

  return (
    <>
      {/* 仓位表头 */}
      <TableRow className="bg-muted/50">
        <TableCell className="pl-12 font-medium text-xs text-muted-foreground">
          市场
        </TableCell>
        <TableCell className="font-medium text-xs text-muted-foreground">
          方向
        </TableCell>
        <TableCell className="font-medium text-xs text-muted-foreground text-right">
          数量
        </TableCell>
        <TableCell className="font-medium text-xs text-muted-foreground text-right">
          均价
        </TableCell>
        <TableCell className="font-medium text-xs text-muted-foreground text-right">
          现价
        </TableCell>
        <TableCell className="font-medium text-xs text-muted-foreground text-right">
          当前价值
        </TableCell>
        <TableCell className="font-medium text-xs text-muted-foreground text-right">
          浮动盈亏
        </TableCell>
        <TableCell className="font-medium text-xs text-muted-foreground text-right">
          盈亏比例
        </TableCell>
        <TableCell className="font-medium text-xs text-muted-foreground text-right">
          买入总额
        </TableCell>
        <TableCell className="font-medium text-xs text-muted-foreground text-right">
          已实现盈亏
        </TableCell>
        <TableCell className="font-medium text-xs text-muted-foreground text-center">
          状态
        </TableCell>
        <TableCell className="font-medium text-xs text-muted-foreground">
          截止日期
        </TableCell>
      </TableRow>
      {positions.map((pos, idx) => (
        <TableRow key={idx} className="bg-muted/20 hover:bg-muted/40">
          <TableCell className="pl-12">
            <div className="flex items-center gap-2 max-w-[200px]">
              {pos.icon && (
                <img
                  src={pos.icon}
                  alt=""
                  className="w-5 h-5 rounded-sm flex-shrink-0"
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              )}
              <span className="text-xs truncate" title={pos.title}>
                {pos.title}
              </span>
            </div>
          </TableCell>
          <TableCell>
            <span
              className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                pos.outcome === 'Yes'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              {pos.outcome}
            </span>
          </TableCell>
          <TableCell className="text-right text-xs font-mono">
            {formatNumber(pos.size)}
          </TableCell>
          <TableCell className="text-right text-xs font-mono">
            {formatUSDExact(pos.avgPrice)}
          </TableCell>
          <TableCell className="text-right text-xs font-mono">
            {formatUSDExact(pos.curPrice)}
          </TableCell>
          <TableCell className="text-right text-xs font-mono">
            {formatUSDExact(pos.currentValue)}
          </TableCell>
          <TableCell
            className={`text-right text-xs font-mono ${
              pos.cashPnl >= 0
                ? 'text-[var(--color-profit)]'
                : 'text-[var(--color-loss)]'
            }`}
          >
            {pos.cashPnl >= 0 ? '+' : ''}
            {formatUSDExact(pos.cashPnl)}
          </TableCell>
          <TableCell
            className={`text-right text-xs font-mono ${
              pos.percentPnl >= 0
                ? 'text-[var(--color-profit)]'
                : 'text-[var(--color-loss)]'
            }`}
          >
            {pos.percentPnl >= 0 ? '+' : ''}
            {formatNumber(pos.percentPnl)}%
          </TableCell>
          <TableCell className="text-right text-xs font-mono">
            {formatUSDExact(pos.totalBought)}
          </TableCell>
          <TableCell
            className={`text-right text-xs font-mono ${
              pos.realizedPnl >= 0
                ? 'text-[var(--color-profit)]'
                : 'text-[var(--color-loss)]'
            }`}
          >
            {pos.realizedPnl >= 0 ? '+' : ''}
            {formatUSDExact(pos.realizedPnl)}
          </TableCell>
          <TableCell className="text-center">
            <div className="flex gap-1 justify-center">
              {pos.redeemable && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                  可赎回
                </span>
              )}
              {pos.mergeable && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                  可合并
                </span>
              )}
              {!pos.redeemable && !pos.mergeable && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                  持有中
                </span>
              )}
            </div>
          </TableCell>
          <TableCell className="text-xs text-muted-foreground">
            {pos.endDate
              ? new Date(pos.endDate).toLocaleDateString('zh-CN')
              : '-'}
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}

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
    const aVal = (a[sortField] as number) ?? 0
    const bVal = (b[sortField] as number) ?? 0
    return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
  })

  const successCount = results.filter((r) => r.status === 'success').length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">
          查询结果
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            ({successCount}/{results.length})
          </span>
        </h2>
      </div>

      <div className="border rounded-lg overflow-x-auto bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-10"></TableHead>
              <TableHead className="min-w-[160px]">钱包地址</TableHead>
              {SORT_COLUMNS.map(({ field, label }) => (
                <TableHead key={field} className="text-right">
                  <button
                    onClick={() => handleSort(field)}
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors text-xs font-medium"
                  >
                    {label}
                    {sortField === field && (
                      <span className="text-primary">
                        {sortDirection === 'asc' ? ' \u2191' : ' \u2193'}
                      </span>
                    )}
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedResults.map((wallet) => {
              const isExpanded = expandedRows.has(wallet.address)
              const hasPositions =
                wallet.positions && wallet.positions.length > 0

              return (
                <>
                  <TableRow
                    key={wallet.address}
                    className={`hover:bg-muted/30 ${
                      isExpanded ? 'bg-muted/20' : ''
                    }`}
                  >
                    {/* 展开按钮 */}
                    <TableCell className="w-10 px-2">
                      {wallet.status === 'success' && (
                        <button
                          onClick={() => toggleExpand(wallet.address)}
                          className="p-1 rounded hover:bg-muted transition-colors"
                          title={
                            hasPositions
                              ? '展开/收起持仓详情'
                              : '无持仓'
                          }
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      )}
                    </TableCell>

                    {/* 钱包地址 */}
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {(wallet.status === 'loading' ||
                          wallet.status === 'pending') && (
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        )}
                        {wallet.status === 'error' && (
                          <AlertCircle className="h-3 w-3 text-destructive" />
                        )}
                        <span
                          className="font-mono text-sm"
                          title={wallet.address}
                        >
                          {shortenAddress(wallet.address)}
                        </span>
                        <button
                          onClick={() => copyAddress(wallet.address)}
                          className="p-0.5 rounded hover:bg-muted transition-colors"
                          title="复制地址"
                        >
                          <Copy
                            className={`h-3 w-3 ${
                              copiedAddr === wallet.address
                                ? 'text-[var(--color-profit)]'
                                : 'text-muted-foreground'
                            }`}
                          />
                        </button>
                        <a
                          href={`https://polygonscan.com/address/${wallet.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-0.5 rounded hover:bg-muted transition-colors"
                          title="在 PolygonScan 查看"
                        >
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </a>
                      </div>
                    </TableCell>

                    {/* 数据列 */}
                    {wallet.status === 'loading' ||
                    wallet.status === 'pending' ? (
                      <TableCell colSpan={10} className="text-center">
                        <div className="flex items-center justify-center gap-2 text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-sm">加载中...</span>
                        </div>
                      </TableCell>
                    ) : wallet.status === 'error' ? (
                      <TableCell colSpan={10} className="text-center">
                        <div className="flex items-center justify-center gap-2 text-destructive">
                          <AlertCircle className="h-4 w-4" />
                          <span className="text-sm">
                            {wallet.errorMessage || '查询失败'}
                          </span>
                        </div>
                      </TableCell>
                    ) : (
                      <>
                        <TableCell className="text-right font-mono text-sm">
                          {wallet.totalTrades.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {wallet.totalSettlements.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatUSD(wallet.totalVolume)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {wallet.activeDays}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {wallet.activeWeeks}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {wallet.activeMonths}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {wallet.activeYears}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatUSDExact(wallet.availableBalance)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatUSDExact(wallet.portfolioValue)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-semibold">
                          {formatUSDExact(wallet.netWorth)}
                        </TableCell>
                      </>
                    )}
                  </TableRow>

                  {/* 展开的仓位详情 */}
                  {isExpanded && wallet.status === 'success' && (
                    <PositionRows positions={wallet.positions} />
                  )}
                </>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
