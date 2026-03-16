import { useState, useCallback } from 'react'
import type { WalletData, QueryProgress, ProxyConfig } from '@/types'
import { fetchWalletData } from '@/services/polymarket'
import { createQueue } from '@/services/queue'
import { SearchSection } from '@/components/SearchSection'
import { ResultsTable } from '@/components/ResultsTable'
import { AddressManager, type SavedAddress } from '@/components/AddressManager'
import { ProxySettings } from '@/components/ProxySettings'
import { Drawer } from '@/components/ui/drawer'

const STORAGE_KEY_PROXY = 'polymarket_proxy'
const STORAGE_KEY_ADDRESSES = 'polymarket_saved_addresses'

/** 每个请求之间的延迟（毫秒），避免触发 API 限流 */
const REQUEST_DELAY_MS = 300

const DEFAULT_PROXY: ProxyConfig = {
  enabled: false,
  host: '',
  port: '',
  userPrefix: '',
  password: '',
  apiBase: '',
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key)
    if (saved) return JSON.parse(saved)
  } catch { /* ignore */ }
  return fallback
}

function saveToStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* ignore */ }
}

/** 延迟工具函数 */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function App() {
  const [results, setResults] = useState<WalletData[]>([])
  const [progress, setProgress] = useState<QueryProgress>({
    total: 0,
    completed: 0,
    isLoading: false,
  })
  const [proxyConfig, setProxyConfig] = useState<ProxyConfig>(
    () => loadFromStorage(STORAGE_KEY_PROXY, DEFAULT_PROXY)
  )
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>(
    () => loadFromStorage(STORAGE_KEY_ADDRESSES, [])
  )

  // 抽屉状态
  const [proxyDrawerOpen, setProxyDrawerOpen] = useState(false)
  const [addressDrawerOpen, setAddressDrawerOpen] = useState(false)

  // 根据地址获取备注映射表（不区分大小写）
  const getNotes = useCallback(() => {
    const map: Record<string, string> = {}
    for (const a of savedAddresses) {
      if (a.note) {
        map[a.address] = a.note
        map[a.address.toLowerCase()] = a.note
      }
    }
    return map
  }, [savedAddresses])

  const handleProxyChange = useCallback((config: ProxyConfig) => {
    setProxyConfig(config)
    saveToStorage(STORAGE_KEY_PROXY, config)
  }, [])

  const handleSaveAddresses = useCallback((addresses: SavedAddress[]) => {
    setSavedAddresses(addresses)
    saveToStorage(STORAGE_KEY_ADDRESSES, addresses)
  }, [])

  /** 批量查询多个地址（带延迟防限流） */
  const handleQuery = useCallback(async (addresses: string[]) => {
    setResults([])
    setProgress({ total: addresses.length, completed: 0, isLoading: true })

    // 初始化所有钱包为 loading 状态
    const initialResults: WalletData[] = addresses.map((addr) => ({
      address: addr,
      profit: 0,
      availableBalance: 0,
      portfolioValue: 0,
      netWorth: 0,
      totalVolume: 0,
      marketsTraded: 0,
      lastActiveDay: null,
      activeDays: 0,
      activeMonths: 0,
      positions: [],
      status: 'loading' as const,
    }))
    setResults(initialResults)

    // 使用并发队列（代理模式并发 8，直连模式并发 5）
    const concurrency = proxyConfig.enabled ? 8 : 5
    const queue = createQueue(concurrency)
    let completed = 0

    const tasks = addresses.map((addr, idx) =>
      queue.add(async () => {
        if (idx > 0) {
          await sleep(REQUEST_DELAY_MS)
        }
        const data = await fetchWalletData(
          addr,
          proxyConfig.enabled ? proxyConfig : undefined
        )
        completed++
        setProgress((prev) => ({ ...prev, completed }))
        setResults((prev) =>
          prev.map((r) => (r.address === addr ? data : r))
        )
        return data
      })
    )

    await Promise.allSettled(tasks)
    setProgress((prev) => ({ ...prev, isLoading: false }))
  }, [proxyConfig])

  /** 刷新单个地址的数据 — 保留旧数据显示，不设为 loading 隐藏 */
  const handleRefreshSingle = useCallback(async (address: string) => {
    const data = await fetchWalletData(
      address,
      proxyConfig.enabled ? proxyConfig : undefined
    )

    setResults((prev) =>
      prev.map((r) => (r.address === address ? data : r))
    )
  }, [proxyConfig])

  /** 刷新查询所有当前结果中的地址 */
  const handleRefreshAll = useCallback(async () => {
    if (results.length === 0) return
    const addresses = results.map((r) => r.address)
    await handleQuery(addresses)
  }, [results, handleQuery])

  /** 重试所有失败和部分成功的地址 */
  const handleRetryFailed = useCallback(async () => {
    const failedAddresses = results.filter((r) => r.status === 'error' || r.status === 'partial')
    if (failedAddresses.length === 0) return

    setProgress((prev) => ({
      ...prev,
      total: failedAddresses.length,
      completed: 0,
      isLoading: true,
    }))

    // 将失败/部分成功的地址状态设为 loading（保留其他地址数据不变）
    // 对于 partial 状态，保留旧数据显示，不设为 loading 隐藏
    setResults((prev) =>
      prev.map((r) =>
        r.status === 'error'
          ? { ...r, status: 'loading' as const, errorMessage: undefined, failedFields: undefined }
          : r
      )
    )

    const concurrency = proxyConfig.enabled ? 8 : 5
    const queue = createQueue(concurrency)
    let completed = 0

    const tasks = failedAddresses.map((wallet, idx) =>
      queue.add(async () => {
        if (idx > 0) {
          await sleep(REQUEST_DELAY_MS)
        }
        const data = await fetchWalletData(
          wallet.address,
          proxyConfig.enabled ? proxyConfig : undefined
        )
        completed++
        setProgress((prev) => ({ ...prev, completed }))
        setResults((prev) =>
          prev.map((r) => (r.address === wallet.address ? data : r))
        )
        return data
      })
    )

    await Promise.allSettled(tasks)
    setProgress((prev) => ({ ...prev, isLoading: false }))
  }, [results, proxyConfig])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      {/* 顶部标题栏 */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-[1400px] mx-auto px-6 py-5 flex items-center gap-4">
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900">
              Polymarket 钱包分析工具
            </h1>
            <p className="text-sm text-gray-500">
              批量查询和分析 Polymarket 钱包地址的交易数据
            </p>
          </div>

          {/* 右侧功能按钮 */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setProxyDrawerOpen(true)}
              className="relative px-4 py-2 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-gray-800 transition-colors"
            >
              代理设置
              {proxyConfig.enabled && (
                <span className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
              )}
            </button>
            <button
              onClick={() => setAddressDrawerOpen(true)}
              className="relative px-4 py-2 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-gray-800 transition-colors"
            >
              地址管理
              {savedAddresses.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 flex items-center justify-center text-xs font-bold text-white bg-amber-500 rounded-full border-2 border-white">
                  {savedAddresses.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* 代理设置抽屉 */}
      <Drawer
        open={proxyDrawerOpen}
        onClose={() => setProxyDrawerOpen(false)}
        title="代理设置"
      >
        <ProxySettings
          proxyConfig={proxyConfig}
          onProxyChange={handleProxyChange}
        />
      </Drawer>

      {/* 地址管理抽屉 */}
      <Drawer
        open={addressDrawerOpen}
        onClose={() => setAddressDrawerOpen(false)}
        title="地址管理"
      >
        <AddressManager
          savedAddresses={savedAddresses}
          onSave={handleSaveAddresses}
          onQuery={(addresses) => {
            setAddressDrawerOpen(false)
            return handleQuery(addresses)
          }}
          isLoading={progress.isLoading}
        />
      </Drawer>

      {/* 主内容区 */}
      <main className="max-w-[1400px] mx-auto px-6 py-8">
        <SearchSection
          onQuery={handleQuery}
          progress={progress}
          proxyConfig={proxyConfig}
        />

        {results.length > 0 && (
          <div className="mt-8">
            <ResultsTable
              results={results}
              addressNotes={getNotes()}
              isLoading={progress.isLoading}
              onRefreshSingle={handleRefreshSingle}
              onRefreshAll={handleRefreshAll}
              onRetryFailed={handleRetryFailed}
            />
          </div>
        )}
      </main>
    </div>
  )
}

export default App
