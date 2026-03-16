import * as XLSX from 'xlsx'
import type { WalletData } from '@/types'

/**
 * 导出钱包数据为 Excel 文件
 * - 主表：钱包汇总数据
 * - 持仓表：所有持仓明细
 * - 列宽自适应内容长度
 */
export function exportToExcel(
  results: WalletData[],
  addressNotes: Record<string, string>,
) {
  const wb = XLSX.utils.book_new()

  // ============================================================
  // Sheet 1: 钱包汇总
  // ============================================================
  const summaryHeaders = [
    '地址',
    '备注',
    '净资产',
    '盈亏',
    '可用余额',
    '持仓估值',
    '交易额',
    '池子数',
    '最后活跃(天)',
    '活跃天数',
    '活跃月数',
    '持仓数量',
    '状态',
    '代理IP',
  ]

  const summaryData = results.map((w) => [
    w.address,
    addressNotes[w.address] || '',
    w.status === 'success' ? w.netWorth : '',
    w.status === 'success' ? w.profit : '',
    w.status === 'success' ? w.availableBalance : '',
    w.status === 'success' ? w.portfolioValue : '',
    w.status === 'success' ? w.totalVolume : '',
    w.status === 'success' ? w.marketsTraded : '',
    w.status === 'success' ? (w.lastActiveDay !== null ? w.lastActiveDay : '') : '',
    w.status === 'success' ? w.activeDays : '',
    w.status === 'success' ? w.activeMonths : '',
    w.status === 'success' ? w.positions.length : '',
    w.status === 'success' ? '成功' : w.status === 'error' ? '失败' : '加载中',
    w.proxyIp || '',
  ])

  const ws1 = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryData])

  // 设置数字格式（保留2位小数）
  const numberCols = [2, 3, 4, 5, 6] // 净资产、盈亏、可用余额、持仓估值、交易额
  for (let r = 1; r <= summaryData.length; r++) {
    for (const c of numberCols) {
      const cell = ws1[XLSX.utils.encode_cell({ r, c })]
      if (cell && typeof cell.v === 'number') {
        cell.t = 'n'
        cell.z = '#,##0.00'
      }
    }
  }

  // 列宽自适应
  ws1['!cols'] = autoFitColumns([summaryHeaders, ...summaryData])

  XLSX.utils.book_append_sheet(wb, ws1, '钱包汇总')

  // ============================================================
  // Sheet 2: 持仓明细
  // ============================================================
  const posHeaders = [
    '钱包地址',
    '备注',
    '市场名称',
    '市场链接',
    '方向',
    '数量',
    '均价',
    '现价',
    '当前价值',
    '浮动盈亏',
    '买入总额',
    '已实现盈亏',
    '状态',
    '截止日期',
  ]

  const posData: (string | number)[][] = []
  for (const w of results) {
    if (w.status !== 'success') continue
    for (const p of w.positions) {
      posData.push([
        w.address,
        addressNotes[w.address] || '',
        p.title,
        p.slug ? `https://polymarket.com/event/${p.slug}` : '',
        p.outcome,
        p.size,
        p.avgPrice,
        p.curPrice,
        p.currentValue,
        p.cashPnl,
        p.totalBought,
        p.realizedPnl,
        p.redeemable ? '可赎回' : p.mergeable ? '可合并' : '持有中',
        p.endDate ? new Date(p.endDate).toLocaleDateString('zh-CN') : '',
      ])
    }
  }

  const ws2 = XLSX.utils.aoa_to_sheet([posHeaders, ...posData])

  // 数字格式
  const posNumberCols = [5, 6, 7, 8, 9, 10, 11]
  for (let r = 1; r <= posData.length; r++) {
    for (const c of posNumberCols) {
      const cell = ws2[XLSX.utils.encode_cell({ r, c })]
      if (cell && typeof cell.v === 'number') {
        cell.t = 'n'
        cell.z = '#,##0.000000'
      }
    }
  }

  ws2['!cols'] = autoFitColumns([posHeaders, ...posData])

  XLSX.utils.book_append_sheet(wb, ws2, '持仓明细')

  // ============================================================
  // 导出文件
  // ============================================================
  const now = new Date()
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  XLSX.writeFile(wb, `Polymarket_钱包分析_${dateStr}.xlsx`)
}

/**
 * 根据内容自动计算列宽
 */
function autoFitColumns(data: (string | number)[][]): XLSX.ColInfo[] {
  const colWidths: number[] = []

  for (const row of data) {
    for (let i = 0; i < row.length; i++) {
      const val = row[i]
      let len = 0
      if (val === null || val === undefined || val === '') {
        len = 0
      } else if (typeof val === 'number') {
        len = String(val).length + 2
      } else {
        // 中文字符算 2 个宽度单位
        len = 0
        for (const ch of String(val)) {
          len += ch.charCodeAt(0) > 127 ? 2 : 1
        }
      }
      colWidths[i] = Math.max(colWidths[i] || 0, len)
    }
  }

  // 最小宽度 8，最大宽度 50
  return colWidths.map((w) => ({ wch: Math.min(Math.max(w + 2, 8), 50) }))
}
