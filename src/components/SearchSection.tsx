import { useState, useCallback } from 'react'
import { Search, AlertCircle, Loader2 } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { QueryProgress, ProxyConfig } from '@/types'

const MAX_BATCH_ADDRESSES = 200
const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/

interface SearchSectionProps {
  onQuery: (addresses: string[]) => Promise<void>
  progress: QueryProgress
  proxyConfig: ProxyConfig
}

export function SearchSection({ onQuery, progress, proxyConfig }: SearchSectionProps) {
  const [mode, setMode] = useState<'single' | 'batch'>('single')
  const [singleAddress, setSingleAddress] = useState('')
  const [batchAddresses, setBatchAddresses] = useState('')
  const [singleError, setSingleError] = useState('')
  const [batchError, setBatchError] = useState('')
  const [parsedCount, setParsedCount] = useState(0)

  const validateAddress = (addr: string): boolean => {
    return ETH_ADDRESS_REGEX.test(addr.trim())
  }

  const parseBatchAddresses = useCallback((text: string): string[] => {
    const raw = text
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    return [...new Set(raw)]
  }, [])

  const handleBatchChange = (value: string) => {
    setBatchAddresses(value)
    const addresses = parseBatchAddresses(value)
    setParsedCount(addresses.length)

    if (addresses.length > MAX_BATCH_ADDRESSES) {
      setBatchError(
        `最多允许 ${MAX_BATCH_ADDRESSES} 个地址，当前：${addresses.length} 个`
      )
    } else {
      const invalid = addresses.filter((a) => !validateAddress(a))
      if (invalid.length > 0 && addresses.length > 0) {
        setBatchError(`检测到 ${invalid.length} 个无效地址`)
      } else {
        setBatchError('')
      }
    }
  }

  const handleSingleChange = (value: string) => {
    setSingleAddress(value)
    if (value.trim() && !validateAddress(value)) {
      setSingleError('请输入合法的以太坊/Polygon 钱包地址（0x...）')
    } else {
      setSingleError('')
    }
  }

  const handleQuery = async () => {
    let addresses: string[] = []

    if (mode === 'single') {
      const addr = singleAddress.trim()
      if (!validateAddress(addr)) {
        setSingleError('请输入合法的以太坊/Polygon 钱包地址（0x...）')
        return
      }
      addresses = [addr]
    } else {
      const parsed = parseBatchAddresses(batchAddresses)
      const invalid = parsed.filter((a) => !validateAddress(a))
      if (invalid.length > 0) {
        setBatchError(`发现 ${invalid.length} 个无效地址，请修正后重试`)
        return
      }
      if (parsed.length === 0) {
        setBatchError('请输入至少一个钱包地址')
        return
      }
      if (parsed.length > MAX_BATCH_ADDRESSES) {
        setBatchError(`最多允许 ${MAX_BATCH_ADDRESSES} 个地址`)
        return
      }
      addresses = parsed
    }

    await onQuery(addresses)
  }

  const isBatchOverLimit = parsedCount > MAX_BATCH_ADDRESSES
  const isQueryDisabled =
    progress.isLoading ||
    (mode === 'single' && (!singleAddress.trim() || !!singleError)) ||
    (mode === 'batch' && (isBatchOverLimit || !!batchError || parsedCount === 0))

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Tabs
        value={mode}
        onValueChange={(v) => setMode(v as 'single' | 'batch')}
        className="w-full"
      >
        <div className="mb-5 flex justify-center">
          <TabsList className="bg-gray-100 p-1 rounded-lg">
            <TabsTrigger
              value="single"
              className="px-8 py-2.5 text-sm font-medium rounded-md data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm"
            >
              单个查询
            </TabsTrigger>
            <TabsTrigger
              value="batch"
              className="px-8 py-2.5 text-sm font-medium rounded-md data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm"
            >
              批量查询
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="single">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="输入 Polymarket 钱包地址（0x...）"
                value={singleAddress}
                onChange={(e) => handleSingleChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isQueryDisabled) handleQuery()
                }}
                className="h-14 pl-12 text-base bg-white border-gray-200 rounded-xl shadow-sm focus:border-blue-400 focus:ring-blue-400"
              />
            </div>
            <Button
              onClick={handleQuery}
              disabled={isQueryDisabled}
              className="h-14 px-10 text-base font-medium rounded-xl bg-blue-600 hover:bg-blue-700 shadow-sm"
              size="lg"
            >
              {progress.isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                '查询'
              )}
            </Button>
          </div>
          {singleError && (
            <div className="mt-3 flex items-center gap-2 text-sm text-red-500">
              <AlertCircle className="h-4 w-4" />
              {singleError}
            </div>
          )}
        </TabsContent>

        <TabsContent value="batch">
          <div className="space-y-4">
            <Textarea
              placeholder={`输入钱包地址，每行一个或用逗号分隔（最多 ${MAX_BATCH_ADDRESSES} 个）`}
              value={batchAddresses}
              onChange={(e) => handleBatchChange(e.target.value)}
              className="min-h-[160px] bg-white border-gray-200 text-base resize-y rounded-xl shadow-sm focus:border-blue-400 focus:ring-blue-400"
              rows={6}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {batchError ? (
                  <div className="flex items-center gap-2 text-sm text-red-500">
                    <AlertCircle className="h-4 w-4" />
                    {batchError}
                  </div>
                ) : (
                  <span className="text-sm text-gray-500">
                    {parsedCount > 0
                      ? `已检测到 ${parsedCount} 个地址`
                      : '输入地址开始查询'}
                  </span>
                )}
              </div>
              <Button
                onClick={handleQuery}
                disabled={isQueryDisabled}
                className="h-11 px-8 text-sm font-medium rounded-xl bg-blue-600 hover:bg-blue-700 shadow-sm"
              >
                {progress.isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  `查询${parsedCount > 0 ? `（${parsedCount}）` : ''}`
                )}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* 进度条 */}
      {progress.isLoading && progress.total > 0 && (
        <div className="mt-8 space-y-3 bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600 font-medium">
              正在查询钱包数据...
              {proxyConfig.enabled && <span className="text-green-500 ml-2">(代理模式)</span>}
            </span>
            <span className="text-blue-600 font-semibold">
              {progress.completed} / {progress.total}
            </span>
          </div>
          <Progress
            value={(progress.completed / progress.total) * 100}
            className="h-2.5"
          />
        </div>
      )}

      {/* 空状态 */}
      {!progress.isLoading && progress.total === 0 && (
        <div className="mt-16 flex flex-col items-center text-center">
          <Search className="mb-4 h-14 w-14 text-gray-300" />
          <p className="text-lg font-medium text-gray-600">输入钱包地址开始分析</p>
          <p className="mt-2 text-sm text-gray-400">
            支持查询盈亏、交易额、可用余额、持仓估值、活跃度等数据
          </p>
        </div>
      )}
    </div>
  )
}
