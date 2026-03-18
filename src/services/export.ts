import * as XLSX from 'xlsx'
import type { WalletData } from '@/types'

// ============================================================
// 通用数据构建
// ============================================================

const SUMMARY_HEADERS = [
  '序号',
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

function buildSummaryRow(
  w: WalletData,
  index: number,
  addressNotes: Record<string, string>,
): (string | number)[] {
  return [
    index,
    w.address,
    addressNotes[w.address] || addressNotes[w.address.toLowerCase()] || '',
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
  ]
}

function buildSummaryData(
  results: WalletData[],
  addressNotes: Record<string, string>,
  indexMap: Map<string, number>,
): (string | number)[][] {
  return results.map((w) => {
    const idx = indexMap.get(w.address) ?? 0
    return buildSummaryRow(w, idx, addressNotes)
  })
}

// ============================================================
// 时间戳字符串
// ============================================================

function dateStr(): string {
  const now = new Date()
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
}

// ============================================================
// 触发下载
// ============================================================

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ============================================================
// Excel 导出
// ============================================================

/**
 * 导出钱包数据为 Excel 文件
 */
export function exportToExcel(
  results: WalletData[],
  addressNotes: Record<string, string>,
  indexMap: Map<string, number>,
) {
  const wb = XLSX.utils.book_new()

  // Sheet 1: 钱包汇总
  const summaryData = buildSummaryData(results, addressNotes, indexMap)
  const ws1 = XLSX.utils.aoa_to_sheet([SUMMARY_HEADERS, ...summaryData])

  // 设置数字格式（保留2位小数）
  const numberCols = [3, 4, 5, 6, 7] // 净资产、盈亏、可用余额、持仓估值、交易额
  for (let r = 1; r <= summaryData.length; r++) {
    for (const c of numberCols) {
      const cell = ws1[XLSX.utils.encode_cell({ r, c })]
      if (cell && typeof cell.v === 'number') {
        cell.t = 'n'
        cell.z = '#,##0.00'
      }
    }
  }

  ws1['!cols'] = autoFitColumns([SUMMARY_HEADERS, ...summaryData])
  XLSX.utils.book_append_sheet(wb, ws1, '钱包汇总')

  // Sheet 2: 持仓明细
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
        p.redeemable ? ((p.currentValue >= 0.1 || (p.totalBought > 0 && p.currentValue / p.totalBought >= 0.01)) && p.currentValue > 0 ? '可赎回' : '已结算') : p.mergeable ? '可合并' : '持有中',
        p.endDate ? new Date(p.endDate).toLocaleDateString('zh-CN') : '',
      ])
    }
  }

  const ws2 = XLSX.utils.aoa_to_sheet([posHeaders, ...posData])

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

  XLSX.writeFile(wb, `Polymarket_钱包分析_${dateStr()}.xlsx`)
}

// ============================================================
// CSV 导出
// ============================================================

function escapeCsvField(value: string | number): string {
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

export function exportToCSV(
  results: WalletData[],
  addressNotes: Record<string, string>,
  indexMap: Map<string, number>,
) {
  const summaryData = buildSummaryData(results, addressNotes, indexMap)
  const lines = [
    SUMMARY_HEADERS.map(escapeCsvField).join(','),
    ...summaryData.map((row) => row.map(escapeCsvField).join(',')),
  ]
  // BOM 头确保 Excel 打开中文不乱码
  const bom = '\uFEFF'
  const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  downloadBlob(blob, `Polymarket_钱包分析_${dateStr()}.csv`)
}

// ============================================================
// JSON 导出
// ============================================================

export function exportToJSON(
  results: WalletData[],
  addressNotes: Record<string, string>,
  indexMap: Map<string, number>,
) {
  const data = results.map((w) => {
    const idx = indexMap.get(w.address) ?? 0
    const note = addressNotes[w.address] || addressNotes[w.address.toLowerCase()] || ''
    return {
      index: idx,
      address: w.address,
      note,
      status: w.status,
      netWorth: w.netWorth,
      profit: w.profit,
      availableBalance: w.availableBalance,
      portfolioValue: w.portfolioValue,
      totalVolume: w.totalVolume,
      marketsTraded: w.marketsTraded,
      lastActiveDay: w.lastActiveDay,
      activeDays: w.activeDays,
      activeMonths: w.activeMonths,
      positionsCount: w.positions.length,
      proxyIp: w.proxyIp || null,
    }
  })

  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  downloadBlob(blob, `Polymarket_钱包分析_${dateStr()}.json`)
}

// ============================================================
// 列宽自适应
// ============================================================

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
        len = 0
        for (const ch of String(val)) {
          len += ch.charCodeAt(0) > 127 ? 2 : 1
        }
      }
      colWidths[i] = Math.max(colWidths[i] || 0, len)
    }
  }

  return colWidths.map((w) => ({ wch: Math.min(Math.max(w + 2, 8), 50) }))
}
