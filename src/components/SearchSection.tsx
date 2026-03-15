import { useState, useCallback } from 'react'
import { Search, AlertCircle, Loader2 } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { WalletData, QueryProgress } from '@/types'
import { fetchWalletData } from '@/services/polymarket'
import { processQueue } from '@/services/queue'

const MAX_BATCH_ADDRESSES = 100
const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/

interface SearchSectionProps {
  setResults: React.Dispatch<React.SetStateAction<WalletData[]>>
  progress: QueryProgress
  setProgress: React.Dispatch<React.SetStateAction<QueryProgress>>
}

export default function SearchSection({ setResults, progress, setProgress }: SearchSectionProps) {
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
      .map(s => s.trim())
      .filter(s => s.length > 0)
    // Deduplicate
    return [...new Set(raw)]
  }, [])

  const handleBatchChange = (value: string) => {
    setBatchAddresses(value)
    const addresses = parseBatchAddresses(value)
    setParsedCount(addresses.length)

    if (addresses.length > MAX_BATCH_ADDRESSES) {
      setBatchError(`Maximum ${MAX_BATCH_ADDRESSES} addresses allowed. Currently: ${addresses.length}`)
    } else {
      const invalid = addresses.filter(a => !validateAddress(a))
      if (invalid.length > 0 && addresses.length > 0) {
        setBatchError(`${invalid.length} invalid address(es) detected`)
      } else {
        setBatchError('')
      }
    }
  }

  const handleSingleChange = (value: string) => {
    setSingleAddress(value)
    if (value.trim() && !validateAddress(value)) {
      setSingleError('Please enter a valid Ethereum/Polygon wallet address (0x...)')
    } else {
      setSingleError('')
    }
  }

  const handleQuery = async () => {
    let addresses: string[] = []

    if (mode === 'single') {
      const addr = singleAddress.trim()
      if (!validateAddress(addr)) {
        setSingleError('Please enter a valid Ethereum/Polygon wallet address (0x...)')
        return
      }
      addresses = [addr]
    } else {
      const parsed = parseBatchAddresses(batchAddresses)
      const invalid = parsed.filter(a => !validateAddress(a))
      if (invalid.length > 0) {
        setBatchError(`${invalid.length} invalid address(es) found. Please fix them before querying.`)
        return
      }
      if (parsed.length === 0) {
        setBatchError('Please enter at least one wallet address')
        return
      }
      if (parsed.length > MAX_BATCH_ADDRESSES) {
        setBatchError(`Maximum ${MAX_BATCH_ADDRESSES} addresses allowed`)
        return
      }
      addresses = parsed
    }

    // Start query
    setProgress({ total: addresses.length, completed: 0, isLoading: true })
    setResults([])

    // Initialize results with pending status
    const initialResults: WalletData[] = addresses.map(addr => ({
      address: addr,
      totalTrades: 0,
      totalVolume: 0,
      totalPnL: 0,
      roi: 0,
      winRate: 0,
      totalInvested: 0,
      totalReturn: 0,
      activeDays: 0,
      maxSingleTradePnL: 0,
      portfolioValue: 0,
      status: 'pending' as const,
    }))
    setResults(initialResults)

    // Process with concurrency control
    await processQueue(
      addresses,
      async (address: string) => {
        return await fetchWalletData(address)
      },
      (result: WalletData, index: number) => {
        setResults(prev => {
          const updated = [...prev]
          updated[index] = result
          return updated
        })
        setProgress(prev => ({
          ...prev,
          completed: prev.completed + 1,
        }))
      },
      5 // max concurrency
    )

    setProgress(prev => ({ ...prev, isLoading: false }))
  }

  const isBatchOverLimit = parsedCount > MAX_BATCH_ADDRESSES
  const isQueryDisabled =
    progress.isLoading ||
    (mode === 'single' && (!singleAddress.trim() || !!singleError)) ||
    (mode === 'batch' && (isBatchOverLimit || !!batchError || parsedCount === 0))

  return (
    <div className="mx-auto mb-10 w-full max-w-3xl">
      <Tabs
        value={mode}
        onValueChange={(v) => setMode(v as 'single' | 'batch')}
        className="w-full"
      >
        <div className="mb-4 flex justify-center">
          <TabsList className="bg-secondary">
            <TabsTrigger value="single" className="px-6">
              Single Query
            </TabsTrigger>
            <TabsTrigger value="batch" className="px-6">
              Batch Query
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="single">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Enter wallet address (0x...)"
                value={singleAddress}
                onChange={(e) => handleSingleChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isQueryDisabled) handleQuery()
                }}
                className="h-12 pl-10 text-base bg-card border-border focus-visible:ring-primary"
              />
            </div>
            <Button
              onClick={handleQuery}
              disabled={isQueryDisabled}
              className="h-12 px-8 bg-primary text-primary-foreground hover:bg-primary/90"
              size="lg"
            >
              {progress.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Query'
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
              placeholder="Enter wallet addresses, one per line or comma-separated (max 100)"
              value={batchAddresses}
              onChange={(e) => handleBatchChange(e.target.value)}
              className="min-h-[160px] bg-card border-border text-base focus-visible:ring-primary resize-y"
              rows={6}
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
                      ? `${parsedCount} address(es) detected`
                      : 'Enter addresses to begin'}
                  </span>
                )}
              </div>
              <Button
                onClick={handleQuery}
                disabled={isQueryDisabled}
                className="h-10 px-8 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {progress.isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  `Query${parsedCount > 0 ? ` (${parsedCount})` : ''}`
                )}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Progress Bar */}
      {progress.isLoading && progress.total > 0 && (
        <div className="mt-6 space-y-2">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Querying wallets...</span>
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

      {/* Empty state */}
      {!progress.isLoading && progress.total === 0 && (
        <div className="mt-16 flex flex-col items-center text-center text-muted-foreground">
          <Search className="mb-4 h-16 w-16 opacity-30" />
          <p className="text-lg font-medium">Enter a wallet address to start</p>
          <p className="mt-1 text-sm">
            Supports querying trade count, P&L, ROI, and 11 core metrics
          </p>
        </div>
      )}
    </div>
  )
}
