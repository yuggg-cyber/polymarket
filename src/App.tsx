import { useState, useCallback, useEffect, useRef } from 'react'
import type { WalletData, QueryProgress, ProxyConfig, AddressType } from '@/types'
import { fetchWalletData, resolveAccountToPolymarket } from '@/services/polymarket'
import { createQueue } from '@/services/queue'
import { SearchSection } from '@/components/SearchSection'
import { ResultsTable } from '@/components/ResultsTable'
import { ProxySettings } from '@/components/ProxySettings'
import { AddressExtractor } from '@/components/AddressExtractor'
import { Drawer } from '@/components/ui/drawer'
import { MarketBrowser, parseEventsToMarkets } from '@/components/MarketBrowser'
import type { MarketItem, EventData } from '@/components/MarketBrowser'

const STORAGE_KEY_PROXY = 'polymarket_proxy'
const STORAGE_KEY_MEMO_RESULTS = 'polymarket_memo_results'
const STORAGE_KEY_MEMO_TIME = 'polymarket_memo_time'
const STORAGE_KEY_NOTES = 'polymarket_address_notes'

/** 每个请求之间的延迟（毫秒） */
const REQUEST_DELAY_MS = 200

const DEFAULT_PROXY: ProxyConfig = {
  enabled: false,
  host: '',
  port: '',
  userPrefix: '',
  password: '',
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

  // ====== 地址类型 ======
  const [addressType, setAddressType] = useState<AddressType>('polymarket')

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

  // ====== 地址备注（全局，所有标签页共享） ======
  const [addressNotes, setAddressNotes] = useState<Record<string, string>>(
    () => loadFromStorage(STORAGE_KEY_NOTES, {})
  )

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

  // 页面模式：wallet=钱包分析, market=市场浏览
  const [pageMode, setPageMode] = useState<'wallet' | 'market'>('wallet')

  // ====== 市场浏览数据（提升到 App 层级，避免切换页面时重新加载） ======
  const [marketData, setMarketData] = useState<MarketItem[]>([])
  const [marketLoading, setMarketLoading] = useState(false)
  const [marketStreaming, setMarketStreaming] = useState(false)
  const [marketError, setMarketError] = useState<string | null>(null)
  const marketAbortRef = useRef<AbortController | null>(null)
  const marketDataLoaded = useRef(false)

  /** 获取市场数据（流式 NDJSON 解析 + 增量渲染） */
  const fetchMarketData = useCallback(async () => {
    if (marketAbortRef.current) marketAbortRef.current.abort()
    const controller = new AbortController()
    marketAbortRef.current = controller

    setMarketLoading(true)
    setMarketStreaming(false)
    setMarketError(null)
    setMarketData([])

    const now = new Date()
    const endMax = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()
    const nowISO = now.toISOString()

    try {
      const url = `/api/markets?end_date_min=${encodeURIComponent(nowISO)}&end_date_max=${encodeURIComponent(endMax)}`
      const resp = await fetch(url, { signal: controller.signal })
      if (!resp.ok) throw new Error(`API 请求失败: ${resp.status}`)

      const contentType = resp.headers.get('content-type') || ''

      if (contentType.includes('application/x-ndjson')) {
        // 流式 NDJSON 解析：边接收边渲染
        const reader = resp.body?.getReader()
        if (!reader) throw new Error('无法读取响应流')

        const decoder = new TextDecoder()
        let buffer = ''
        let pendingEvents: EventData[] = []
        let allMarkets: MarketItem[] = []
        let lastFlush = Date.now()
        const FLUSH_INTERVAL = 300 // 每 300ms 刷新一次 UI

        const flushPending = () => {
          if (pendingEvents.length === 0) return
          const newMarkets = parseEventsToMarkets(pendingEvents)
          allMarkets = [...allMarkets, ...newMarkets]
          setMarketData([...allMarkets])
          pendingEvents = []
          lastFlush = Date.now()
        }

          // 第一批数据到达后切换到流式加载状态
        let firstBatchReceived = false

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || '' // 最后一个可能不完整

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            try {
              const event = JSON.parse(trimmed) as EventData
              pendingEvents.push(event)
            } catch {
              // 跳过解析失败的行
            }
          }

          // 第一批数据到达后立即刷新，切换到流式加载状态
          if (!firstBatchReceived && pendingEvents.length > 0) {
            flushPending()
            firstBatchReceived = true
            setMarketLoading(false)
            setMarketStreaming(true)
          } else if (Date.now() - lastFlush >= FLUSH_INTERVAL) {
            flushPending()
          }
        }

        // 处理 buffer 中剩余的数据
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer.trim()) as EventData
            pendingEvents.push(event)
          } catch { /* ignore */ }
        }

        // 最终刷新
        flushPending()
        setMarketStreaming(false)
        marketDataLoaded.current = true
      } else {
        // 兼容旧的 JSON 数组响应格式
        const events: EventData[] = await resp.json()
        const allMarkets = parseEventsToMarkets(events)
        setMarketData(allMarkets)
        marketDataLoaded.current = true
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      setMarketError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setMarketLoading(false)
      setMarketStreaming(false)
    }
  }, [])

  // 首次切换到市场浏览时自动加载数据（仅加载一次）
  useEffect(() => {
    if (pageMode === 'market' && !marketDataLoaded.current && !marketLoading) {
      fetchMarketData()
    }
  }, [pageMode, fetchMarketData, marketLoading])

  // 抽屉状态
  const [proxyDrawerOpen, setProxyDrawerOpen] = useState(false)
  const [extractDrawerOpen, setExtractDrawerOpen] = useState(false)

  const handleProxyChange = useCallback((config: ProxyConfig) => {
    setProxyConfig(config)
    saveToStorage(STORAGE_KEY_PROXY, config)
  }, [])

  /** 更新某个地址的备注 */
  const handleNoteChange = useCallback((address: string, note: string) => {
    setAddressNotes((prev) => {
      const updated = { ...prev }
      const key = address.toLowerCase()
      if (note.trim()) {
        updated[key] = note.trim()
      } else {
        delete updated[key]
      }
      saveToStorage(STORAGE_KEY_NOTES, updated)
      return updated
    })
  }, [])

  /** 通用批量查询函数，操作指定标签页的 state */
  const runQuery = useCallback(async (
    addresses: string[],
    targetTab: TabMode,
    isMemo: boolean,
    addrType: AddressType = 'polymarket',
  ) => {
    const setResults = getSetResultsForTab(targetTab)
    const setProgress = getSetProgressForTab(targetTab)

    if (isMemo) isMemoQueryRef.current = true

    // ====== 账户地址模式：先解析为 Polymarket 地址 ======
    let queryAddresses: { input: string; polymarket: string }[] = []

    if (addrType === 'account') {
      // 先显示"正在解析账户地址"的状态
      setResults([])
      setProgress({ total: addresses.length, completed: 0, isLoading: true, failedCount: 0, startTime: Date.now() })

      // 初始化所有地址为 loading 状态
      const resolvingResults: WalletData[] = addresses.map((addr) => ({
        address: addr,
        profit: 0,
        availableBalance: 0,
        portfolioValue: 0,
        netWorth: 0,
        holdingPnl: 0,
        totalVolume: 0,
        marketsTraded: 0,
        lastActiveDay: null,
        activeDays: 0,
        activeMonths: 0,
        positions: [],
        status: 'loading' as const,
        errorMessage: '正在识别关联的 Polymarket 地址...',
      }))
      setResults(resolvingResults)

      // 并发解析账户地址
      const resolveQueue = createQueue(3)
      // 使用 Map 按原始输入顺序记录每个地址的解析结果
      const resolveResultMap = new Map<string, { safes: string[]; error?: string }>()

      const resolveTasks = addresses.map((addr) =>
        resolveQueue.add(async () => {
          try {
            const safes = await resolveAccountToPolymarket(addr)
            if (safes.length === 0) {
              resolveResultMap.set(addr, { safes: [], error: '未找到关联的 Polymarket 账户' })
            } else {
              resolveResultMap.set(addr, { safes })
            }
          } catch {
            resolveResultMap.set(addr, { safes: [], error: '账户地址解析失败' })
          }
        })
      )

      await Promise.allSettled(resolveTasks)

      // 按原始输入顺序构建结果：先放该地址解析出的 safe，解析失败的也按原位放置
      const orderedErrors: WalletData[] = []
      const orderedResolveResults: { input: string; polymarket: string }[] = []
      const allInitial: WalletData[] = []

      for (const addr of addresses) {
        const result = resolveResultMap.get(addr)
        if (!result || result.error) {
          const errorEntry: WalletData = {
            address: addr,
            profit: 0,
            availableBalance: 0,
            portfolioValue: 0,
            netWorth: 0,
            holdingPnl: 0,
            totalVolume: 0,
            marketsTraded: 0,
            lastActiveDay: null,
            activeDays: 0,
            activeMonths: 0,
            positions: [],
            status: 'error' as const,
            errorMessage: result?.error || '账户地址解析失败',
          }
          orderedErrors.push(errorEntry)
          allInitial.push(errorEntry)
        } else {
          for (const safe of result.safes) {
            orderedResolveResults.push({ input: addr, polymarket: safe })
            allInitial.push({
              address: safe,
              originalAddress: addr,
              profit: 0,
              availableBalance: 0,
              portfolioValue: 0,
              netWorth: 0,
              holdingPnl: 0,
              totalVolume: 0,
              marketsTraded: 0,
              lastActiveDay: null,
              activeDays: 0,
              activeMonths: 0,
              positions: [],
              status: 'loading' as const,
            })
          }
        }
      }

      if (orderedResolveResults.length === 0) {
        setResults(allInitial)
        setProgress({ total: addresses.length, completed: addresses.length, isLoading: false })
        if (isMemo) {
          isMemoQueryRef.current = false
        }
        return
      }

      queryAddresses = orderedResolveResults
      setResults(allInitial)
      setProgress({ total: allInitial.length, completed: orderedErrors.length, isLoading: true })

    } else {
      queryAddresses = addresses.map((addr) => ({ input: addr, polymarket: addr }))

      setResults([])
      setProgress({ total: addresses.length, completed: 0, isLoading: true, failedCount: 0, startTime: Date.now() })

      const initialResults: WalletData[] = addresses.map((addr) => ({
        address: addr,
        profit: 0,
        availableBalance: 0,
        portfolioValue: 0,
        netWorth: 0,
        holdingPnl: 0,
        totalVolume: 0,
        marketsTraded: 0,
        lastActiveDay: null,
        activeDays: 0,
        activeMonths: 0,
        positions: [],
        status: 'loading' as const,
      }))
      setResults(initialResults)
    }

    // ====== 开始查询数据 ======
    const concurrency = proxyConfig.enabled ? 8 : 3
    const queue = createQueue(concurrency)

    const tasks = queryAddresses.map(({ input, polymarket }, idx) =>
      queue.add(async () => {
        if (idx > 0) {
          await sleep(REQUEST_DELAY_MS)
        }
        const data = await fetchWalletData(
          polymarket,
          proxyConfig.enabled ? proxyConfig : undefined
        )
        if (addrType === 'account' && input !== polymarket) {
          data.originalAddress = input
        }
        const isFailed = data.status === 'error' || data.status === 'partial'
        setProgress((prev) => ({
          ...prev,
          completed: prev.completed + 1,
          currentAddress: polymarket,
          failedCount: (prev.failedCount || 0) + (isFailed ? 1 : 0),
        }))
        setResults((prev) =>
          prev.map((r) => (r.address === polymarket ? data : r))
        )
        return data
      })
    )

    await Promise.allSettled(tasks)
    setProgress((prev) => ({ ...prev, isLoading: false, currentAddress: undefined }))

    // 如果是记忆查询，查询完成后自动保存
    if (isMemo) {
      setResults((prev) => {
        const timeStr = new Date().toLocaleString('zh-CN')
        saveToStorage(STORAGE_KEY_MEMO_RESULTS, prev)
        saveToStorage(STORAGE_KEY_MEMO_TIME, timeStr)
        setMemoSavedTime(timeStr)
        return prev
      })
      isMemoQueryRef.current = false
    }
  }, [proxyConfig]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 单个查询 / 批量查询 */
  const handleQuery = useCallback(async (addresses: string[]) => {
    await runQuery(addresses, activeTab, false, addressType)
  }, [runQuery, activeTab, addressType])

  /** 记忆查询：新地址追加到已有结果中，已存在的地址则刷新数据 */
  const handleMemoQuery = useCallback(async (addresses: string[]) => {
    // 保留当前记忆查询中不在本次查询范围内的旧结果
    const newAddrSet = new Set(addresses.map((a) => a.toLowerCase()))
    const existingResults = memoResults.filter(
      (r) => !newAddrSet.has(r.address.toLowerCase())
    )

    // 先把旧结果保留，然后追加新查询的 loading 状态
    if (existingResults.length > 0) {
      setMemoResults(existingResults)
    }

    await runQuery(addresses, 'memo', true, addressType)

    // 查询完成后，合并旧结果和新结果
    setMemoResults((prev) => {
      // prev 此时只包含本次查询的结果，需要把旧结果合并进来
      const prevAddrSet = new Set(prev.map((r) => r.address.toLowerCase()))
      const toKeep = existingResults.filter(
        (r) => !prevAddrSet.has(r.address.toLowerCase())
      )
      const merged = [...toKeep, ...prev]
      saveToStorage(STORAGE_KEY_MEMO_RESULTS, merged)
      const timeStr = new Date().toLocaleString('zh-CN')
      saveToStorage(STORAGE_KEY_MEMO_TIME, timeStr)
      setMemoSavedTime(timeStr)
      setMemoProgress({ total: merged.length, completed: merged.length, isLoading: false })
      return merged
    })
  }, [runQuery, addressType, memoResults])

  /** 清除已保存的记忆查询数据 */
  const handleMemoClear = useCallback(() => {
    // 清除记忆查询中地址的备注
    setAddressNotes((prev) => {
      const updated = { ...prev }
      for (const r of memoResults) {
        delete updated[r.address.toLowerCase()]
      }
      saveToStorage(STORAGE_KEY_NOTES, updated)
      return updated
    })
    removeFromStorage(STORAGE_KEY_MEMO_RESULTS)
    removeFromStorage(STORAGE_KEY_MEMO_TIME)
    setMemoSavedTime('')
    setMemoResults([])
    setMemoProgress({ total: 0, completed: 0, isLoading: false })
  }, [memoResults])

  /** 删除某个地址（从当前标签页的结果中移除） */
  const handleDeleteAddress = useCallback((address: string) => {
    const setResults = getSetResultsForTab(activeTab)
    setResults((prev) => {
      const updated = prev.filter((r) => r.address !== address)
      if (activeTab === 'memo') {
        if (updated.length > 0) {
          saveToStorage(STORAGE_KEY_MEMO_RESULTS, updated)
          const timeStr = new Date().toLocaleString('zh-CN')
          saveToStorage(STORAGE_KEY_MEMO_TIME, timeStr)
          setMemoSavedTime(timeStr)
        } else {
          removeFromStorage(STORAGE_KEY_MEMO_RESULTS)
          removeFromStorage(STORAGE_KEY_MEMO_TIME)
          setMemoSavedTime('')
        }
      }
      return updated
    })
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 刷新单个地址的数据 */
  const handleRefreshSingle = useCallback(async (address: string) => {
    const data = await fetchWalletData(
      address,
      proxyConfig.enabled ? proxyConfig : undefined
    )
    const setResults = getSetResultsForTab(activeTab)
    setResults((prev) =>
      prev.map((r) => (r.address === address ? { ...data, originalAddress: r.originalAddress } : r))
    )
  }, [proxyConfig, activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 刷新全部 */
  const handleRefreshAll = useCallback(async () => {
    if (currentResults.length === 0) return
    const addresses = currentResults.map((r) => r.address)
    const isMemo = activeTab === 'memo'
    await runQuery(addresses, activeTab, isMemo, 'polymarket')
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
      failedCount: 0,
      startTime: Date.now(),
    }))

    setResults((prev) =>
      prev.map((r) =>
        r.status === 'error'
          ? { ...r, status: 'loading' as const, errorMessage: undefined, failedFields: undefined }
          : r
      )
    )

    const concurrency = proxyConfig.enabled ? 8 : 3
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
        const isFailed = data.status === 'error' || data.status === 'partial'
        setProgress((prev) => ({
          ...prev,
          completed,
          currentAddress: wallet.address,
          failedCount: (prev.failedCount || 0) + (isFailed ? 1 : 0),
        }))
        setResults((prev) =>
          prev.map((r) => (r.address === wallet.address ? { ...data, originalAddress: r.originalAddress } : r))
        )
        return data
      })
    )

    await Promise.allSettled(tasks)
    setProgress((prev) => ({ ...prev, isLoading: false, currentAddress: undefined }))
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
        <div className="max-w-[1800px] mx-auto px-6 py-5 flex items-center gap-4">
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2.5">
              <img
                src="/logo.png"
                alt="Logo"
                className="h-7 w-auto"
              />
              {pageMode === 'wallet' ? 'Polymarket 钱包分析' : 'Polymarket 市场浏览'}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {pageMode === 'wallet'
                ? '批量查询和分析 Polymarket 钱包地址的交易数据'
                : '浏览本月到期的活跃预测市场及实时胜率'}
            </p>
          </div>

          {/* 右侧功能按钮 */}
          <div className="flex items-center gap-2">
            {/* 页面切换按钮 */}
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setPageMode('wallet')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  pageMode === 'wallet'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                钱包分析
              </button>
              <button
                onClick={() => setPageMode('market')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  pageMode === 'market'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                市场浏览
              </button>
            </div>
            <button
              onClick={() => setExtractDrawerOpen(true)}
              className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-gray-800 transition-colors"
            >
              地址提取
            </button>
            <button
              onClick={() => setProxyDrawerOpen(true)}
              className="relative px-4 py-2 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-gray-800 transition-colors"
            >
              代理设置
              {proxyConfig.enabled && (
                <span className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* 地址提取抽屉 */}
      <Drawer
        open={extractDrawerOpen}
        onClose={() => setExtractDrawerOpen(false)}
        title="地址提取"
      >
        <AddressExtractor />
      </Drawer>

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

      {/* 主内容区 */}
      {pageMode === 'wallet' ? (
        <main className="max-w-[1800px] mx-auto px-6 py-8">
          <SearchSection
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onQuery={handleQuery}
            onMemoQuery={handleMemoQuery}
            progress={currentProgress}
            proxyConfig={proxyConfig}
            hasResults={currentResults.length > 0}
            addressType={addressType}
            onAddressTypeChange={setAddressType}
          />

          {currentResults.length > 0 && (
            <div className="mt-8">
              <ResultsTable
                results={currentResults}
                addressNotes={addressNotes}
                onNoteChange={handleNoteChange}
                isLoading={currentProgress.isLoading}
                onRefreshSingle={handleRefreshSingle}
                onRefreshAll={handleRefreshAll}
                onRetryFailed={handleRetryFailed}
                onMemoClear={handleMemoClear}
                onDeleteAddress={handleDeleteAddress}
                isMemoTab={activeTab === 'memo'}
                memoSavedTime={memoSavedTime}
              />
            </div>
          )}
        </main>
      ) : (
        <MarketBrowser
          markets={marketData}
          loading={marketLoading}
          streaming={marketStreaming}
          error={marketError}
          onRefresh={fetchMarketData}
        />
      )}
    </div>
  )
}

export default App
