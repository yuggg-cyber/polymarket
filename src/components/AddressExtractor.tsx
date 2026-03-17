import { useState, useCallback } from 'react'
import { Loader2, Copy, Download, AlertCircle, Check, ChevronDownIcon } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { resolveAccountToPolymarket } from '@/services/polymarket'
import { createQueue } from '@/services/queue'

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/
const MAX_ADDRESSES = 200

interface ResolvedItem {
  input: string
  polymarketAddresses: string[]
  status: 'pending' | 'loading' | 'success' | 'error'
  errorMessage?: string
}

export function AddressExtractor() {
  const [inputText, setInputText] = useState('')
  const [inputError, setInputError] = useState('')
  const [results, setResults] = useState<ResolvedItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [copiedAll, setCopiedAll] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)

  const parsedAddresses = useCallback(() => {
    const raw = inputText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    return [...new Set(raw)]
  }, [inputText])

  const parsedCount = parsedAddresses().length

  const handleInputChange = (value: string) => {
    setInputText(value)
    const addresses = value
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    const unique = [...new Set(addresses)]

    if (unique.length > MAX_ADDRESSES) {
      setInputError(`最多允许 ${MAX_ADDRESSES} 个地址，当前：${unique.length} 个`)
    } else {
      const invalid = unique.filter((a) => !ETH_ADDRESS_REGEX.test(a))
      if (invalid.length > 0 && unique.length > 0) {
        setInputError(`检测到 ${invalid.length} 个无效地址`)
      } else {
        setInputError('')
      }
    }
  }

  const handleExtract = async () => {
    const addresses = parsedAddresses()
    const invalid = addresses.filter((a) => !ETH_ADDRESS_REGEX.test(a))
    if (invalid.length > 0) {
      setInputError(`发现 ${invalid.length} 个无效地址，请修正后重试`)
      return
    }
    if (addresses.length === 0) {
      setInputError('请输入至少一个账户地址')
      return
    }
    if (addresses.length > MAX_ADDRESSES) {
      setInputError(`最多允许 ${MAX_ADDRESSES} 个地址`)
      return
    }

    setIsLoading(true)
    setResults(
      addresses.map((addr) => ({
        input: addr,
        polymarketAddresses: [],
        status: 'loading' as const,
      }))
    )

    const queue = createQueue(3)
    const tasks = addresses.map((addr, idx) =>
      queue.add(async () => {
        try {
          const safes = await resolveAccountToPolymarket(addr)
          setResults((prev) =>
            prev.map((r, i) =>
              i === idx
                ? {
                    ...r,
                    polymarketAddresses: safes,
                    status: safes.length > 0 ? ('success' as const) : ('error' as const),
                    errorMessage: safes.length === 0 ? '未找到关联的 Polymarket 账户' : undefined,
                  }
                : r
            )
          )
        } catch {
          setResults((prev) =>
            prev.map((r, i) =>
              i === idx
                ? {
                    ...r,
                    status: 'error' as const,
                    errorMessage: '解析失败',
                  }
                : r
            )
          )
        }
      })
    )

    await Promise.allSettled(tasks)
    setIsLoading(false)
  }

  // 获取所有成功提取的 Polymarket 地址（按输入顺序）
  const allPolymarketAddresses = results
    .filter((r) => r.status === 'success')
    .flatMap((r) => r.polymarketAddresses)

  // 复制单个地址
  const copySingle = async (addr: string, index: number) => {
    try {
      await navigator.clipboard.writeText(addr)
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 1500)
    } catch { /* noop */ }
  }

  // 复制所有 Polymarket 地址
  const copyAll = async () => {
    if (allPolymarketAddresses.length === 0) return
    try {
      await navigator.clipboard.writeText(allPolymarketAddresses.join('\n'))
      setCopiedAll(true)
      setTimeout(() => setCopiedAll(false), 1500)
    } catch { /* noop */ }
  }

  // 导出功能
  const handleExport = (format: 'txt' | 'csv' | 'json') => {
    setExportMenuOpen(false)
    if (results.length === 0) return

    let content: string
    let filename: string
    let mimeType: string
    const now = new Date()
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`

    if (format === 'txt') {
      content = allPolymarketAddresses.join('\n')
      filename = `Polymarket_地址提取_${dateStr}.txt`
      mimeType = 'text/plain;charset=utf-8'
    } else if (format === 'csv') {
      const bom = '\uFEFF'
      const lines = ['账户地址,Polymarket 地址,状态']
      for (const r of results) {
        if (r.status === 'success') {
          for (const poly of r.polymarketAddresses) {
            lines.push(`${r.input},${poly},成功`)
          }
        } else if (r.status === 'error') {
          lines.push(`${r.input},,${r.errorMessage || '失败'}`)
        }
      }
      content = bom + lines.join('\n')
      filename = `Polymarket_地址提取_${dateStr}.csv`
      mimeType = 'text/csv;charset=utf-8'
    } else {
      const data = results.map((r) => ({
        accountAddress: r.input,
        polymarketAddresses: r.polymarketAddresses,
        status: r.status,
        error: r.errorMessage || null,
      }))
      content = JSON.stringify(data, null, 2)
      filename = `Polymarket_地址提取_${dateStr}.json`
      mimeType = 'application/json;charset=utf-8'
    }

    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const successCount = results.filter((r) => r.status === 'success').length
  const errorCount = results.filter((r) => r.status === 'error').length

  return (
    <div className="space-y-5">
      {/* 说明 */}
      <div className="text-sm text-gray-500 bg-gray-50 px-4 py-3 rounded-lg border border-gray-100">
        输入账户地址（MetaMask 等钱包地址），批量提取关联的 Polymarket 钱包地址。
      </div>

      {/* 输入区域 */}
      <div>
        <label className="block text-sm font-medium text-gray-600 mb-2">
          账户地址（每行一个或用逗号分隔，最多 {MAX_ADDRESSES} 个）
        </label>
        <Textarea
          placeholder="输入账户地址，每行一个或用逗号分隔"
          value={inputText}
          onChange={(e) => handleInputChange(e.target.value)}
          className="min-h-[120px] text-sm bg-gray-50 border-gray-200 resize-y"
          rows={5}
        />
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {inputError ? (
              <div className="flex items-center gap-2 text-sm text-red-500">
                <AlertCircle className="h-4 w-4" />
                {inputError}
              </div>
            ) : (
              <span className="text-sm text-gray-500">
                {parsedCount > 0 ? `已检测到 ${parsedCount} 个地址` : '输入地址开始提取'}
              </span>
            )}
          </div>
          <Button
            onClick={handleExtract}
            disabled={isLoading || parsedCount === 0 || !!inputError}
            className="h-9 px-5 bg-purple-600 hover:bg-purple-700 text-white text-sm"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : null}
            {isLoading ? '提取中...' : `提取${parsedCount > 0 ? `（${parsedCount}）` : ''}`}
          </Button>
        </div>
      </div>

      {/* 结果区域 */}
      {results.length > 0 && (
        <div className="space-y-4">
          {/* 统计信息 + 操作按钮 */}
          <div className="flex items-center justify-between flex-wrap gap-3 pt-3 border-t border-gray-100">
            <div className="text-sm text-gray-600">
              共 {results.length} 个账户，成功 {successCount} 个
              {errorCount > 0 && <span className="text-red-500 ml-1">，失败 {errorCount} 个</span>}
              {allPolymarketAddresses.length > 0 && (
                <span className="text-purple-600 ml-1">
                  ，提取到 {allPolymarketAddresses.length} 个 Polymarket 地址
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* 复制全部 */}
              {allPolymarketAddresses.length > 0 && (
                <button
                  onClick={copyAll}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                  title="复制所有 Polymarket 地址"
                >
                  {copiedAll ? (
                    <Check className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                  {copiedAll ? '已复制' : `复制全部 (${allPolymarketAddresses.length})`}
                </button>
              )}

              {/* 导出下拉菜单 */}
              {allPolymarketAddresses.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setExportMenuOpen(!exportMenuOpen)}
                    onBlur={() => setTimeout(() => setExportMenuOpen(false), 200)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                    title="导出数据"
                  >
                    <Download className="w-4 h-4" />
                    导出
                    <ChevronDownIcon className="w-3.5 h-3.5 text-gray-400" />
                  </button>
                  {exportMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleExport('txt')}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-between"
                      >
                        <span>TXT（仅地址）</span>
                        <span className="text-xs text-gray-400">推荐</span>
                      </button>
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleExport('csv')}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        CSV（含对应关系）
                      </button>
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleExport('json')}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        JSON（完整数据）
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 结果列表 */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-3 py-2.5 text-left text-sm font-semibold text-gray-600 w-[40px]">#</th>
                  <th className="px-3 py-2.5 text-left text-sm font-semibold text-gray-600">账户地址</th>
                  <th className="px-3 py-2.5 text-left text-sm font-semibold text-gray-600">Polymarket 地址</th>
                  <th className="px-3 py-2.5 text-center text-sm font-semibold text-gray-600 w-[60px]">状态</th>
                </tr>
              </thead>
              <tbody>
                {results.map((item, idx) => (
                  <tr key={item.input + idx} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-3 py-2.5 text-sm text-gray-400 font-mono">{idx + 1}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-sm text-gray-700" title={item.input}>
                        {item.input.slice(0, 8)}...{item.input.slice(-4)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {item.status === 'loading' ? (
                        <span className="inline-flex items-center gap-1.5 text-sm text-gray-400">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> 解析中...
                        </span>
                      ) : item.status === 'error' ? (
                        <span className="text-sm text-red-500">{item.errorMessage}</span>
                      ) : (
                        <div className="space-y-1">
                          {item.polymarketAddresses.map((addr, addrIdx) => (
                            <div key={addr} className="flex items-center gap-1.5">
                              <span className="font-mono text-sm text-purple-700" title={addr}>
                                {addr.slice(0, 8)}...{addr.slice(-4)}
                              </span>
                              <button
                                onClick={() => copySingle(addr, idx * 100 + addrIdx)}
                                className="p-0.5 rounded hover:bg-gray-200 transition-colors"
                                title="复制地址"
                              >
                                {copiedIndex === idx * 100 + addrIdx ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5 text-gray-400" />
                                )}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {item.status === 'loading' && (
                        <Loader2 className="w-4 h-4 animate-spin text-blue-500 mx-auto" />
                      )}
                      {item.status === 'success' && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                          成功
                        </span>
                      )}
                      {item.status === 'error' && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">
                          失败
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
