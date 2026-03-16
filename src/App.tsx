import { useState, useCallback } from 'react'
import type { WalletData, QueryProgress, ProxyConfig } from '@/types'
import { fetchWalletData } from '@/services/polymarket'
import { createQueue } from '@/services/queue'
import { SearchSection } from '@/components/SearchSection'
import { ResultsTable } from '@/components/ResultsTable'
import { AddressManager, type SavedAddress } from '@/components/AddressManager'

const STORAGE_KEY_PROXY = 'polymarket_proxy'
const STORAGE_KEY_ADDRESSES = 'polymarket_saved_addresses'

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

  const handleQuery = useCallback(async (addresses: string[]) => {
    // 自动将查询的地址保存到地址管理器中
    setSavedAddresses((prev) => {
      const existingSet = new Set(prev.map((a) => a.address.toLowerCase()))
      const newAddresses: SavedAddress[] = []
      for (const addr of addresses) {
        if (!existingSet.has(addr.toLowerCase())) {
          existingSet.add(addr.toLowerCase())
          newAddresses.push({
            address: addr,
            note: '',
            addedAt: Date.now(),
          })
        }
      }
      if (newAddresses.length === 0) return prev
      const updated = [...prev, ...newAddresses]
      saveToStorage(STORAGE_KEY_ADDRESSES, updated)
      return updated
    })

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

    // 使用并发队列（代理模式并发 5，直连模式并发 3）
    const concurrency = proxyConfig.enabled ? 5 : 3
    const queue = createQueue(concurrency)
    let completed = 0

    const tasks = addresses.map((addr) =>
      queue.add(async () => {
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

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      {/* 顶部标题栏 */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-[1400px] mx-auto px-6 py-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm">
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              Polymarket 钱包分析工具
            </h1>
            <p className="text-sm text-gray-500">
              批量查询和分析 Polymarket 钱包地址的交易数据
            </p>
          </div>
        </div>
      </header>

      {/* 主内容区 */}
      <main className="max-w-[1400px] mx-auto px-6 py-8">
        <SearchSection
          onQuery={handleQuery}
          progress={progress}
          proxyConfig={proxyConfig}
          onProxyChange={handleProxyChange}
        />

        {/* 地址管理面板 */}
        <div className="mx-auto w-full max-w-4xl">
          <AddressManager
            savedAddresses={savedAddresses}
            onSave={handleSaveAddresses}
            onQuery={handleQuery}
            isLoading={progress.isLoading}
          />
        </div>

        {results.length > 0 && (
          <div className="mt-8">
            <ResultsTable results={results} addressNotes={getNotes()} />
          </div>
        )}
      </main>

      {/* 底部 */}
      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-[1400px] mx-auto px-6 py-4 text-center text-sm text-gray-400">
          Polymarket 钱包分析工具 — 数据来源：Polymarket 公开 API
        </div>
      </footer>
    </div>
  )
}

export default App
