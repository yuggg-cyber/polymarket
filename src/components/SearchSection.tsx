import { useState, useCallback } from 'react'
import { Search, AlertCircle, Loader2 } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { QueryProgress } from '@/types'

const MAX_BATCH_ADDRESSES = 100
const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/

interface SearchSectionProps {
  onQuery: (addresses: string[]) => Promise<void>
  progress: QueryProgress
}

export function SearchSection({ onQuery, progress }: SearchSectionProps) {
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
    <div className="mx-auto w-full max-w-3xl">
      <Tabs
        value={mode}
        onValueChange={(v) => setMode(v as 'single' | 'batch')}
        className="w-full"
      >
        <div className="mb-4 flex justify-center">
          <TabsList className="bg-secondary">
            <TabsTrigger value="single" className="px-6">
              单个查询
            </TabsTrigger>
            <TabsTrigger value="batch" className="px-6">
              批量查询
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="single">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="输入钱包地址（0x...）"
                value={singleAddress}
                onChange={(e) => handleSingleChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isQueryDisabled) handleQuery()
                }}
                className="h-12 pl-10 text-base bg-card border-border"
              />
            </div>
            <Button
              onClick={handleQuery}
              disabled={isQueryDisabled}
              className="h-12 px-8"
              size="lg"
            >
              {progress.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                '查询'
              )}
            </Button>
          </div>
          {singleError && (
            <div className="mt-2 flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {singleError}
            </div>
          )}
        </TabsContent>

        <TabsContent value="batch">
          <div className="space-y-3">
            <Textarea
              placeholder="输入钱包地址，每行一个或用逗号分隔（最多 100 个）"
              value={batchAddresses}
              onChange={(e) => handleBatchChange(e.target.value)}
              className="min-h-[140px] bg-card border-border text-base resize-y"
              rows={5}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {batchError ? (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    {batchError}
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {parsedCount > 0
                      ? `已检测到 ${parsedCount} 个地址`
                      : '输入地址开始查询'}
                  </span>
                )}
              </div>
              <Button onClick={handleQuery} disabled={isQueryDisabled}>
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
        <div className="mt-6 space-y-2">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>正在查询钱包数据...</span>
            <span>
              {progress.completed} / {progress.total}
            </span>
          </div>
          <Progress
            value={(progress.completed / progress.total) * 100}
            className="h-2"
          />
        </div>
      )}

      {/* 空状态 */}
      {!progress.isLoading && progress.total === 0 && (
        <div className="mt-12 flex flex-col items-center text-center text-muted-foreground">
          <Search className="mb-3 h-12 w-12 opacity-20" />
          <p className="text-base font-medium">输入钱包地址开始分析</p>
          <p className="mt-1 text-sm">
            支持查询交易次数、结算次数、活跃度、资产余额、持仓等数据
          </p>
        </div>
      )}
    </div>
  )
}
