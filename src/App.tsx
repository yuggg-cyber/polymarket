import { useState, useCallback, useEffect, useRef } from 'react'
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
const STORAGE_KEY_MEMO_RESULTS = 'polymarket_memo_results'
const STORAGE_KEY_MEMO_TIME = 'polymarket_memo_time'

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

type TabMode = 'single' | 'batch' | 'memo'

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

function removeFromStorage(key: string) {
  try {
    localStorage.removeItem(key)
  } catch { /* ignore */ }
}

/** 延迟工具函数 */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function App() {
  // 从 localStorage 加载记忆查询的缓存数据
  const cachedMemoResults = loadFromStorage<WalletData[]>(STORAGE_KEY_MEMO_RESULTS, [])
  const cachedMemoTime = loadFromStorage<string>(STORAGE_KEY_MEMO_TIME, '')
  const hasCachedMemo = cachedMemoResults.length > 0

  // ====== 当前激活的标签页 ======
  const [activeTab, setActiveTab] = useState<TabMode>(hasCachedMemo ? 'memo' : 'single')

  // ====== 三个标签页各自独立的结果 ======
  const [singleResults, setSingleResults] = useState<WalletData[]>([])
  const [batchResults, setBatchResults] = useState<WalletData[]>([])
  const [memoResults, setMemoResults] = useState<WalletData[]>(cachedMemoResults)

  // ====== 三个标签页各自独立的进度 ======
  const [singleProgress, setSingleProgress] = useState<QueryProgress>({ total: 0, completed: 0, isLoading: false })
  const [batchProgress, setBatchProgress] = useState<QueryProgress>({ total: 0, completed: 0, isLoading: false })
  const [memoProgress, setMemoProgress] = useState<QueryProgress>({
    total: hasCachedMemo ? cachedMemoResults.length : 0,
    completed: hasCachedMemo ? cachedMemoResults.length : 0,
    isLoading: false,
  })

  // ====== 根据当前标签页获取对应的 results / setResults / progress / setProgress ======
  const getResultsForTab = (tab: TabMode) => {
    if (tab === 'single') return singleResults
    if (tab === 'batch') return batchResults
    return memoResults
  }
  const getSetResultsForTab = (tab: TabMode) => {
    if (tab === 'single') return setSingleResults
    if (tab === 'batch') return setBatchResults
    return setMemoResults
  }
  const getProgressForTab = (tab: TabMode) => {
    if (tab === 'single') return singleProgress
    if (tab === 'batch') return batchProgress
    return memoProgress
  }
  const getSetProgressForTab = (tab: TabMode) => {
    if (tab === 'single') return setSingleProgress
    if (tab === 'batch') return setBatchProgress
    return setMemoProgress
  }

  // 当前标签页的数据
  const currentResults = getResultsForTab(activeTab)
  const currentProgress = getProgressForTab(activeTab)

  // 记忆查询保存时间
  const [memoSavedTime, setMemoSavedTime] = useState<string>(cachedMemoTime)

  // 用于标记当前正在执行的查询是否是记忆查询
  const isMemoQueryRef = useRef(false)

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

  /** 通用批量查询函数，操作指定标签页的 state */
  const runQuery = useCallback(async (
    addresses: string[],
    targetTab: TabMode,
    isMemo: boolean,
  ) => {
    const setResults = getSetResultsForTab(targetTab)
    const setProgress = getSetProgressForTab(targetTab)

    if (isMemo) isMemoQueryRef.current = true

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

    const concurrency = proxyConfig.enabled ? 8 : 5
    const queue = createQueue(concurrency)
    let completed = 0

    const finalResults: WalletData[] = [...initialResults]

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
        const i = finalResults.findIndex((r) => r.address === addr)
        if (i !== -1) finalResults[i] = data
        return data
      })
    )

    await Promise.allSettled(tasks)
    setProgress((prev) => ({ ...prev, isLoading: false }))

    // 如果是记忆查询，查询完成后自动保存
    if (isMemo) {
      const timeStr = new Date().toLocaleString('zh-CN')
      saveToStorage(STORAGE_KEY_MEMO_RESULTS, finalResults)
      saveToStorage(STORAGE_KEY_MEMO_TIME, timeStr)
      setMemoSavedTime(timeStr)
      isMemoQueryRef.current = false
    }
  }, [proxyConfig]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 单个查询 / 批量查询 */
  const handleQuery = useCallback(async (addresses: string[]) => {
    await runQuery(addresses, activeTab, false)
  }, [runQuery, activeTab])

  /** 记忆查询 */
  const handleMemoQuery = useCallback(async (addresses: string[]) => {
    await runQuery(addresses, 'memo', true)
  }, [runQuery])

  /** 刷新已保存的记忆查询数据 */
  const handleMemoRefresh = useCallback(async () => {
    const cached = loadFromStorage<WalletData[]>(STORAGE_KEY_MEMO_RESULTS, [])
    if (cached.length === 0) return
    const addresses = cached.map((r) => r.address)
    await runQuery(addresses, 'memo', true)
  }, [runQuery])

  /** 清除已保存的记忆查询数据 */
  const handleMemoClear = useCallback(() => {
    removeFromStorage(STORAGE_KEY_MEMO_RESULTS)
    removeFromStorage(STORAGE_KEY_MEMO_TIME)
    setMemoSavedTime('')
    setMemoResults([])
    setMemoProgress({ total: 0, completed: 0, isLoading: false })
  }, [])

  /** 刷新单个地址的数据 */
  const handleRefreshSingle = useCallback(async (address: string) => {
    const data = await fetchWalletData(
      address,
      proxyConfig.enabled ? proxyConfig : undefined
    )
    const setResults = getSetResultsForTab(activeTab)
    setResults((prev) =>
      prev.map((r) => (r.address === address ? data : r))
    )
  }, [proxyConfig, activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 刷新全部 */
  const handleRefreshAll = useCallback(async () => {
    if (currentResults.length === 0) return
    const addresses = currentResults.map((r) => r.address)
    const isMemo = activeTab === 'memo'
    await runQuery(addresses, activeTab, isMemo)
  }, [currentResults, activeTab, runQuery])

  /** 重试失败 */
  const handleRetryFailed = useCallback(async () => {
    const setResults = getSetResultsForTab(activeTab)
    const setProgress = getSetProgressForTab(activeTab)

    const failedAddresses = currentResults.filter((r) => r.status === 'error' || r.status === 'partial')
    if (failedAddresses.length === 0) return

    setProgress((prev) => ({
      ...prev,
      total: failedAddresses.length,
      completed: 0,
      isLoading: true,
    }))

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
  }, [currentResults, proxyConfig, activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // 当记忆查询的结果中单个地址刷新/重试完成后，同步更新 localStorage
  useEffect(() => {
    if (activeTab === 'memo' && !memoProgress.isLoading && memoResults.length > 0) {
      const hasLoading = memoResults.some((r) => r.status === 'loading' || r.status === 'pending')
      if (!hasLoading) {
        const timeStr = new Date().toLocaleString('zh-CN')
        saveToStorage(STORAGE_KEY_MEMO_RESULTS, memoResults)
        saveToStorage(STORAGE_KEY_MEMO_TIME, timeStr)
        setMemoSavedTime(timeStr)
      }
    }
  }, [memoResults, memoProgress.isLoading, activeTab])

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
          isLoading={currentProgress.isLoading}
        />
      </Drawer>

      {/* 主内容区 */}
      <main className="max-w-[1400px] mx-auto px-6 py-8">
        <SearchSection
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onQuery={handleQuery}
          onMemoQuery={handleMemoQuery}
          onMemoRefresh={handleMemoRefresh}
          onMemoClear={handleMemoClear}
          memoSavedTime={memoSavedTime}
          hasMemoData={memoResults.length > 0 || !!loadFromStorage<WalletData[]>(STORAGE_KEY_MEMO_RESULTS, []).length}
          progress={currentProgress}
          proxyConfig={proxyConfig}
          hasResults={currentResults.length > 0}
        />

        {currentResults.length > 0 && (
          <div className="mt-8">
            {/* 记忆查询结果提示 */}
            {activeTab === 'memo' && memoSavedTime && !currentProgress.isLoading && (
              <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
                已保存的记忆查询结果（保存于 {memoSavedTime}）
              </div>
            )}
            <ResultsTable
              results={currentResults}
              addressNotes={getNotes()}
              isLoading={currentProgress.isLoading}
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
