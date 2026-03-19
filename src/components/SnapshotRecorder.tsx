import { useState, useCallback, useMemo } from 'react'
import {
  Plus,
  Trash2,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import type { WalletData, Position } from '@/types'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

// ============================================================
// 类型定义
// ============================================================

/** 快照记录数据 */
export interface SnapshotRecord {
  id: string
  timestamp: number
  /** 记录时间的可读字符串 */
  timeStr: string
  /** 查询的地址数量 */
  addressCount: number
  /** 6个卡片数据 */
  netWorth: number
  availableBalance: number
  portfolioValue: number
  holdingPnl: number
  totalProfit: number
  redeemableTotal: number
  redeemableCount: number
}

// ============================================================
// localStorage 持久化
// ============================================================

const SNAPSHOT_STORAGE_KEY = 'polymarket_snapshot_records'

function loadSnapshots(): SnapshotRecord[] {
  try {
    const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

function saveSnapshots(records: SnapshotRecord[]) {
  try {
    localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(records))
  } catch { /* ignore */ }
}

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

function formatDiff(current: number, previous: number): { text: string; color: string; icon: 'up' | 'down' | 'same' } {
  const diff = current - previous
  if (Math.abs(diff) < 0.005) {
    return { text: '无变化', color: 'text-gray-400', icon: 'same' }
  }
  const formatted = formatUSD(Math.abs(diff))
  if (diff > 0) {
    return { text: '+' + formatted, color: 'text-emerald-600', icon: 'up' }
  }
  return { text: '-' + formatted, color: 'text-red-500', icon: 'down' }
}

function isActuallyRedeemable(p: Position): boolean {
  if (!p.redeemable) return false
  return p.currentValue > 0 && (
    p.currentValue >= 0.1 ||
    (p.totalBought > 0 && p.currentValue / p.totalBought >= 0.01)
  )
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 30) return `${days}天前`
  return `${Math.floor(days / 30)}个月前`
}

// ============================================================
// 主组件
// ============================================================

interface SnapshotRecorderProps {
  results: WalletData[]
  isLoading: boolean
}

export function SnapshotRecorder({ results, isLoading }: SnapshotRecorderProps) {
  const [records, setRecords] = useState<SnapshotRecord[]>(loadSnapshots)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [expandedRecords, setExpandedRecords] = useState<Set<string>>(new Set())

  // 从当前结果计算卡片数据
  const currentCardData = useMemo(() => {
    const ok = results.filter((r) => r.status === 'success' || r.status === 'partial')
    if (ok.length === 0) return null

    const netWorth = ok.reduce((s, r) => s + r.netWorth, 0)
    const availableBalance = ok.reduce((s, r) => s + r.availableBalance, 0)
    const portfolioValue = ok.reduce((s, r) => s + r.portfolioValue, 0)
    const holdingPnl = ok.reduce((s, r) => s + r.holdingPnl, 0)
    const totalProfit = ok.reduce((s, r) => s + r.profit, 0)

    let redeemableTotal = 0
    let redeemableCount = 0
    for (const w of ok) {
      for (const p of w.positions) {
        if (isActuallyRedeemable(p)) {
          redeemableTotal += p.currentValue
          redeemableCount++
        }
      }
    }

    return {
      addressCount: ok.length,
      netWorth,
      availableBalance,
      portfolioValue,
      holdingPnl,
      totalProfit,
      redeemableTotal,
      redeemableCount,
    }
  }, [results])

  // 确认记录
  const handleRecord = useCallback(() => {
    if (!currentCardData) return

    const now = new Date()
    const record: SnapshotRecord = {
      id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: now.getTime(),
      timeStr: now.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      ...currentCardData,
    }

    setRecords(prev => {
      const updated = [record, ...prev]
      saveSnapshots(updated)
      return updated
    })
  }, [currentCardData])

  // 删除单条记录
  const handleDelete = useCallback((id: string) => {
    setDeleteTargetId(id)
    setShowDeleteConfirm(true)
  }, [])

  const confirmDelete = useCallback(() => {
    if (!deleteTargetId) return
    setRecords(prev => {
      const updated = prev.filter(r => r.id !== deleteTargetId)
      saveSnapshots(updated)
      return updated
    })
    setShowDeleteConfirm(false)
    setDeleteTargetId(null)
  }, [deleteTargetId])

  // 清空所有记录
  const confirmClearAll = useCallback(() => {
    setRecords([])
    saveSnapshots([])
    setShowClearConfirm(false)
  }, [])

  // 展开/收起记录详情
  const toggleExpand = useCallback((id: string) => {
    setExpandedRecords(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const DiffIcon = ({ icon, size = 'md' }: { icon: 'up' | 'down' | 'same'; size?: 'sm' | 'md' }) => {
    const cls = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'
    if (icon === 'up') return <TrendingUp className={cls} />
    if (icon === 'down') return <TrendingDown className={cls} />
    return <Minus className={cls} />
  }

  // 渲染对比行
  const renderCompareRow = (label: string, current: number, previous: number) => {
    const diff = formatDiff(current, previous)
    return (
      <div key={label} className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0">
        <span className="text-sm text-gray-500">{label}</span>
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold text-gray-800">{formatUSD(current)}</span>
          <span className={`inline-flex items-center gap-1 text-xs font-semibold ${diff.color}`}>
            <DiffIcon icon={diff.icon} size="sm" />
            {diff.text}
          </span>
        </div>
      </div>
    )
  }

  const hasData = currentCardData !== null && !isLoading

  return (
    <div className="space-y-6">
      {/* 当前数据预览 */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
        <div className="text-sm font-semibold text-gray-700 mb-3">当前卡片数据预览</div>
        {!hasData ? (
          <div className="text-sm text-gray-400 py-6 text-center">
            {isLoading ? '数据加载中...' : '暂无查询数据，请先查询钱包地址'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-lg px-3.5 py-3 border border-gray-100 shadow-sm">
              <div className="text-xs text-gray-400 mb-1">净资产总计</div>
              <div className="text-lg font-bold text-gray-900">{formatUSD(currentCardData.netWorth)}</div>
            </div>
            <div className="bg-white rounded-lg px-3.5 py-3 border border-gray-100 shadow-sm">
              <div className="text-xs text-gray-400 mb-1">可用余额</div>
              <div className="text-lg font-bold text-gray-900">{formatUSD(currentCardData.availableBalance)}</div>
            </div>
            <div className="bg-white rounded-lg px-3.5 py-3 border border-gray-100 shadow-sm">
              <div className="text-xs text-gray-400 mb-1">持仓估值</div>
              <div className="text-lg font-bold text-gray-900">{formatUSD(currentCardData.portfolioValue)}</div>
            </div>
            <div className="bg-white rounded-lg px-3.5 py-3 border border-gray-100 shadow-sm">
              <div className="text-xs text-gray-400 mb-1">持仓盈亏</div>
              <div className={`text-lg font-bold ${currentCardData.holdingPnl >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {currentCardData.holdingPnl >= 0 ? '+' : ''}{formatUSD(currentCardData.holdingPnl)}
              </div>
            </div>
            <div className="bg-white rounded-lg px-3.5 py-3 border border-gray-100 shadow-sm">
              <div className="text-xs text-gray-400 mb-1">总盈亏</div>
              <div className={`text-lg font-bold ${currentCardData.totalProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {currentCardData.totalProfit >= 0 ? '+' : ''}{formatUSD(currentCardData.totalProfit)}
              </div>
            </div>
            <div className="bg-white rounded-lg px-3.5 py-3 border border-gray-100 shadow-sm">
              <div className="text-xs text-gray-400 mb-1">可赎回总额</div>
              <div className="text-lg font-bold text-amber-600">
                {currentCardData.redeemableCount > 0
                  ? formatUSD(currentCardData.redeemableTotal)
                  : '-'}
              </div>
            </div>
          </div>
        )}

        {/* 确认记录按钮 */}
        <button
          onClick={handleRecord}
          disabled={!hasData}
          className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 text-base font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          <Plus className="w-5 h-5" />
          确认记录
        </button>
        <div className="text-xs text-gray-400 text-center mt-2">
          点击后将记录当前6个卡片的数据快照（含 {currentCardData?.addressCount || 0} 个地址）
        </div>
      </div>

      {/* 历史记录列表 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-gray-700">
            历史记录 ({records.length})
          </div>
          {records.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="text-xs text-red-400 hover:text-red-600 transition-colors font-medium"
            >
              清空全部
            </button>
          )}
        </div>

        {records.length === 0 ? (
          <div className="text-sm text-gray-400 py-8 text-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
            暂无记录，点击「确认记录」保存当前数据快照
          </div>
        ) : (
          <div className="space-y-3">
            {records.map((record, idx) => {
              const prevRecord = idx < records.length - 1 ? records[idx + 1] : null
              const isExpanded = expandedRecords.has(record.id)

              return (
                <div
                  key={record.id}
                  className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm"
                >
                  {/* 记录头部 */}
                  <div
                    className="flex items-center justify-between px-4 py-3.5 cursor-pointer hover:bg-gray-50/50 transition-colors"
                    onClick={() => toggleExpand(record.id)}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <button className="p-0.5 flex-shrink-0">
                        {isExpanded
                          ? <ChevronDown className="w-5 h-5 text-gray-400" />
                          : <ChevronRight className="w-5 h-5 text-gray-400" />}
                      </button>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-400">#{records.length - idx}</span>
                          <span className="text-base font-bold text-gray-900">{formatUSD(record.netWorth)}</span>
                          {prevRecord && (
                            (() => {
                              const diff = formatDiff(record.netWorth, prevRecord.netWorth)
                              return (
                                <span className={`inline-flex items-center gap-1 text-xs font-semibold ${diff.color}`}>
                                  <DiffIcon icon={diff.icon} size="sm" />
                                  {diff.text}
                                </span>
                              )
                            })()
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <Clock className="w-3.5 h-3.5 text-gray-300" />
                          <span className="text-xs text-gray-400">{record.timeStr}</span>
                          <span className="text-xs text-gray-300">({formatRelativeTime(record.timestamp)})</span>
                          <span className="text-xs text-gray-300">| {record.addressCount}个地址</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(record.id) }}
                      className="p-1.5 rounded-lg hover:bg-red-50 transition-colors flex-shrink-0"
                      title="删除此记录"
                    >
                      <Trash2 className="w-4 h-4 text-gray-300 hover:text-red-500" />
                    </button>
                  </div>

                  {/* 展开的详情 */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-100">
                      <div className="pt-3 space-y-0.5">
                        {/* 6个卡片数据对比 */}
                        {renderCompareRow('净资产总计', record.netWorth, prevRecord?.netWorth ?? record.netWorth)}
                        {renderCompareRow('可用余额', record.availableBalance, prevRecord?.availableBalance ?? record.availableBalance)}
                        {renderCompareRow('持仓估值', record.portfolioValue, prevRecord?.portfolioValue ?? record.portfolioValue)}
                        {renderCompareRow('持仓盈亏', record.holdingPnl, prevRecord?.holdingPnl ?? record.holdingPnl)}
                        {renderCompareRow('总盈亏', record.totalProfit, prevRecord?.totalProfit ?? record.totalProfit)}
                        {record.redeemableCount > 0 || (prevRecord && prevRecord.redeemableCount > 0) ? (
                          renderCompareRow('可赎回总额', record.redeemableTotal, prevRecord?.redeemableTotal ?? record.redeemableTotal)
                        ) : (
                          <div className="flex items-center justify-between py-2.5">
                            <span className="text-sm text-gray-500">可赎回总额</span>
                            <span className="text-sm text-gray-400">-</span>
                          </div>
                        )}
                      </div>
                      {!prevRecord && (
                        <div className="mt-3 text-xs text-gray-400 text-center">
                          首次记录，无对比数据
                        </div>
                      )}
                      {prevRecord && (
                        <div className="mt-3 text-xs text-gray-400 text-center">
                          对比上次记录: {prevRecord.timeStr}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="删除记录"
        message="确定要删除这条记录吗？该操作不可恢复。"
        confirmText="确认删除"
        cancelText="取消"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => { setShowDeleteConfirm(false); setDeleteTargetId(null) }}
      />

      {/* 清空确认弹窗 */}
      <ConfirmDialog
        open={showClearConfirm}
        title="清空所有记录"
        message="确定要清空所有历史记录吗？该操作不可恢复。"
        confirmText="确认清空"
        cancelText="取消"
        variant="danger"
        onConfirm={confirmClearAll}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  )
}
