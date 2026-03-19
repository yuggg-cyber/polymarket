import { useState, useCallback, useEffect } from 'react'
import { Search, AlertCircle, Loader2 } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { QueryProgress, ProxyConfig, AddressType } from '@/types'

const MAX_BATCH_ADDRESSES = 200
const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/

// ============================================================
// 进度面板组件（带实时计时）
// ============================================================

function ProgressPanel({ progress, addressType, proxyEnabled }: {
  progress: QueryProgress
  addressType: AddressType
  proxyEnabled: boolean
}) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const pct = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0
  const elapsed = progress.startTime ? Math.floor((Date.now() - progress.startTime) / 1000) : 0
  const speed = elapsed > 0 && progress.completed > 0 ? progress.completed / elapsed : 0
  const remaining = speed > 0 ? Math.ceil((progress.total - progress.completed) / speed) : 0
  const formatTime = (s: number) => s >= 60 ? `${Math.floor(s / 60)}分${s % 60}秒` : `${s}秒`

  // suppress unused warning
  void tick

  return (
    <div className="mt-4 space-y-2.5 bg-white rounded-xl p-3 border border-gray-200 shadow-sm md:mt-8 md:space-y-3 md:p-5">
      <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="text-gray-600 font-medium">
          {addressType === 'account' ? '正在识别并查询钱包数据...' : '正在查询钱包数据...'}
          {proxyEnabled && <span className="text-green-500 ml-2">(代理模式)</span>}
        </span>
        <span className="text-blue-600 font-semibold">
          {progress.completed} / {progress.total}
          <span className="text-gray-400 font-normal ml-2">({pct.toFixed(0)}%)</span>
        </span>
      </div>
      <Progress
        value={pct}
        className="h-2.5"
      />
      <div className="flex flex-col gap-1 text-xs text-gray-400 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 flex-wrap sm:gap-3">
          {progress.currentAddress && (
            <span>当前: <span className="font-mono text-gray-500">{progress.currentAddress.slice(0, 6)}...{progress.currentAddress.slice(-4)}</span></span>
          )}
          {(progress.failedCount ?? 0) > 0 && (
            <span className="text-amber-500">失败: {progress.failedCount}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:gap-3">
          {elapsed > 0 && <span>已耗时: {formatTime(elapsed)}</span>}
          {remaining > 0 && progress.completed < progress.total && (
            <span>预计剩余: {formatTime(remaining)}</span>
          )}
          {speed > 0 && <span>{speed.toFixed(1)} 个/秒</span>}
        </div>
      </div>
    </div>
  )
}

type TabMode = 'single' | 'batch' | 'memo'

interface SearchSectionProps {
  activeTab: TabMode
  onTabChange: (tab: TabMode) => void
  onQuery: (addresses: string[]) => Promise<void>
  onMemoQuery: (addresses: string[]) => Promise<void>
  progress: QueryProgress
  proxyConfig: ProxyConfig
  hasResults: boolean
  addressType: AddressType
  onAddressTypeChange: (type: AddressType) => void
}

export function SearchSection({
  activeTab,
  onTabChange,
  onQuery,
  onMemoQuery,
  progress,
  proxyConfig,
  hasResults,
  addressType,
  onAddressTypeChange,
}: SearchSectionProps) {
  const [singleAddress, setSingleAddress] = useState('')
  const [batchAddresses, setBatchAddresses] = useState('')
  const [memoAddresses, setMemoAddresses] = useState('')
  const [singleError, setSingleError] = useState('')
  const [batchError, setBatchError] = useState('')
  const [memoError, setMemoError] = useState('')
  const [parsedCount, setParsedCount] = useState(0)
  const [memoParsedCount, setMemoParsedCount] = useState(0)

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

  const handleMemoChange = (value: string) => {
    setMemoAddresses(value)
    const addresses = parseBatchAddresses(value)
    setMemoParsedCount(addresses.length)

    if (addresses.length > MAX_BATCH_ADDRESSES) {
      setMemoError(
        `最多允许 ${MAX_BATCH_ADDRESSES} 个地址，当前：${addresses.length} 个`
      )
    } else {
      const invalid = addresses.filter((a) => !validateAddress(a))
      if (invalid.length > 0 && addresses.length > 0) {
        setMemoError(`检测到 ${invalid.length} 个无效地址`)
      } else {
        setMemoError('')
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
    if (activeTab === 'single') {
      const addr = singleAddress.trim()
      if (!validateAddress(addr)) {
        setSingleError('请输入合法的以太坊/Polygon 钱包地址（0x...）')
        return
      }
      await onQuery([addr])
    } else if (activeTab === 'batch') {
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
      await onQuery(parsed)
    } else {
      // memo
      const parsed = parseBatchAddresses(memoAddresses)
      const invalid = parsed.filter((a) => !validateAddress(a))
      if (invalid.length > 0) {
        setMemoError(`发现 ${invalid.length} 个无效地址，请修正后重试`)
        return
      }
      if (parsed.length === 0) {
        setMemoError('请输入至少一个钱包地址')
        return
      }
      if (parsed.length > MAX_BATCH_ADDRESSES) {
        setMemoError(`最多允许 ${MAX_BATCH_ADDRESSES} 个地址`)
        return
      }
      await onMemoQuery(parsed)
    }
  }

  const isBatchOverLimit = parsedCount > MAX_BATCH_ADDRESSES
  const isMemoOverLimit = memoParsedCount > MAX_BATCH_ADDRESSES
  const isQueryDisabled =
    progress.isLoading ||
    (activeTab === 'single' && (!singleAddress.trim() || !!singleError)) ||
    (activeTab === 'batch' && (isBatchOverLimit || !!batchError || parsedCount === 0)) ||
    (activeTab === 'memo' && (isMemoOverLimit || !!memoError || memoParsedCount === 0))

  const addressTypeLabel = addressType === 'account' ? '账户地址' : 'Polymarket 地址'
  const placeholderSuffix = addressType === 'account' ? '（支持 MetaMask 等账户地址）' : '（0x...）'

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Tabs
        value={activeTab}
        onValueChange={(v) => onTabChange(v as TabMode)}
        className="w-full"
      >
        <div className="mb-3 flex justify-center md:mb-5">
          <TabsList className="bg-gray-100 p-1 rounded-lg">
            <TabsTrigger
              value="single"
              className="px-4 py-2 text-xs font-medium rounded-md data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm md:px-8 md:py-2.5 md:text-sm"
            >
              单个查询
            </TabsTrigger>
            <TabsTrigger
              value="batch"
              className="px-4 py-2 text-xs font-medium rounded-md data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm md:px-8 md:py-2.5 md:text-sm"
            >
              批量查询
            </TabsTrigger>
            <TabsTrigger
              value="memo"
              className="px-4 py-2 text-xs font-medium rounded-md data-[state=active]:bg-white data-[state=active]:text-amber-600 data-[state=active]:shadow-sm md:px-8 md:py-2.5 md:text-sm"
            >
              记忆查询
            </TabsTrigger>
          </TabsList>
        </div>

        {/* 地址类型切换 */}
        <div className="mb-3 flex flex-col items-center gap-1.5 md:mb-4 md:flex-row md:justify-center md:gap-0">
          <div className="inline-flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg p-1">
            <button
              onClick={() => onAddressTypeChange('polymarket')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors md:px-4 md:text-sm ${
                addressType === 'polymarket'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Polymarket 地址
            </button>
            <button
              onClick={() => onAddressTypeChange('account')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors md:px-4 md:text-sm ${
                addressType === 'account'
                  ? 'bg-white text-purple-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              账户地址
            </button>
          </div>
          {addressType === 'account' && (
            <span className="text-xs text-purple-500 md:ml-3 md:self-center">
              将自动识别关联的 Polymarket 钱包地址
            </span>
          )}
        </div>

        <TabsContent value="single">
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 md:left-4 md:h-5 md:w-5" />
              <Input
                placeholder={`输入${addressTypeLabel}${placeholderSuffix}`}
                value={singleAddress}
                onChange={(e) => handleSingleChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isQueryDisabled) handleQuery()
                }}
                className="h-11 pl-9 text-sm bg-white border-gray-200 rounded-xl shadow-sm focus:border-blue-400 focus:ring-blue-400 md:h-14 md:pl-12 md:text-base"
              />
            </div>
            <Button
              onClick={handleQuery}
              disabled={isQueryDisabled}
              className="h-11 px-6 text-sm font-medium rounded-xl bg-blue-600 hover:bg-blue-700 shadow-sm sm:px-10 md:h-14 md:text-base"
              size="lg"
            >
              {progress.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin md:h-5 md:w-5" />
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
          <div className="space-y-3 md:space-y-4">
            <Textarea
              placeholder={`输入${addressTypeLabel}，每行一个或用逗号分隔（最多 ${MAX_BATCH_ADDRESSES} 个）`}
              value={batchAddresses}
              onChange={(e) => handleBatchChange(e.target.value)}
              className="min-h-[120px] bg-white border-gray-200 text-sm resize-y rounded-xl shadow-sm focus:border-blue-400 focus:ring-blue-400 md:min-h-[160px] md:text-base"
              rows={5}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
                className="h-10 px-6 text-sm font-medium rounded-xl bg-blue-600 hover:bg-blue-700 shadow-sm sm:h-11 sm:px-8"
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

        <TabsContent value="memo">
          <div className="space-y-3 md:space-y-4">
            <Textarea
              placeholder={`输入${addressTypeLabel}，每行一个或用逗号分隔（最多 ${MAX_BATCH_ADDRESSES} 个）`}
              value={memoAddresses}
              onChange={(e) => handleMemoChange(e.target.value)}
              className="min-h-[120px] bg-white border-gray-200 text-sm resize-y rounded-xl shadow-sm focus:border-amber-400 focus:ring-amber-400 md:min-h-[160px] md:text-base"
              rows={5}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                {memoError ? (
                  <div className="flex items-center gap-2 text-sm text-red-500">
                    <AlertCircle className="h-4 w-4" />
                    {memoError}
                  </div>
                ) : (
                  <span className="text-sm text-gray-500">
                    {memoParsedCount > 0
                      ? `已检测到 ${memoParsedCount} 个地址`
                      : '输入地址开始记忆查询'}
                  </span>
                )}
              </div>
              {/* 只保留查询按钮，刷新和清除移到 ResultsTable */}
              <Button
                onClick={handleQuery}
                disabled={isQueryDisabled}
                className="h-10 px-6 text-sm font-medium rounded-xl bg-amber-500 hover:bg-amber-600 shadow-sm text-white sm:h-11 sm:px-8"
              >
                {progress.isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  `查询${memoParsedCount > 0 ? `（${memoParsedCount}）` : ''}`
                )}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* 进度条 */}
      {progress.isLoading && progress.total > 0 && (
        <ProgressPanel progress={progress} addressType={addressType} proxyEnabled={proxyConfig.enabled} />
      )}

      {/* 空状态 */}
      {!progress.isLoading && !hasResults && (
        <div className="mt-10 flex flex-col items-center text-center md:mt-16">
          <Search className="mb-3 h-10 w-10 text-gray-300 md:mb-4 md:h-14 md:w-14" />
          <p className="text-base font-medium text-gray-600 md:text-lg">输入钱包地址开始分析</p>
          <p className="mt-1.5 text-xs text-gray-400 md:mt-2 md:text-sm">
            支持 Polymarket 地址和账户地址（自动识别关联钱包）
          </p>
        </div>
      )}
    </div>
  )
}
