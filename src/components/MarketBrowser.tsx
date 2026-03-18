import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Loader2,
  ExternalLink,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Calendar,
  BarChart3,
  Filter,
  X,
} from 'lucide-react'

/* ============ 类型定义 ============ */

interface MarketTag {
  id: string
  label: string
  slug: string
}

interface MarketItem {
  id: string
  question: string
  slug: string
  endDate: string
  image?: string
  outcomes: string[]
  outcomePrices: number[]
  volume: number
  volume24hr: number
  liquidity: number
  description?: string
  eventTitle?: string
  eventSlug?: string
  tags: MarketTag[]
}

interface EventData {
  id: string
  title: string
  slug: string
  endDate: string
  image?: string
  tags: MarketTag[]
  markets: {
    id: string
    question: string
    slug: string
    endDate: string
    image?: string
    outcomes: string
    outcomePrices: string
    volume: string
    volume24hr?: number
    liquidity?: number
    liquidityNum?: number
    description?: string
    active: boolean
    closed: boolean
  }[]
}

/* ============ 工具函数 ============ */

function parseOutcomes(raw: string): string[] {
  try {
    return JSON.parse(raw)
  } catch {
    return ['Yes', 'No']
  }
}

function parsePrices(raw: string): number[] {
  try {
    return JSON.parse(raw).map(Number)
  } catch {
    return [0, 0]
  }
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}

function daysUntil(iso: string): number {
  const now = new Date()
  const end = new Date(iso)
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400000))
}

/** 体育相关 tag slug 黑名单 */
const SPORTS_SLUGS = new Set([
  'sports', 'soccer', 'football', 'basketball', 'baseball', 'tennis', 'hockey',
  'nba', 'nfl', 'mlb', 'nhl', 'cricket', 'mma', 'ufc', 'boxing', 'f1',
  'racing', 'golf', 'rugby', 'volleyball', 'table-tennis', 'esports',
  'nba-finals', 'nba-champion', 'stanley-cup', 'super-bowl', 'world-cup',
  'fifa-world-cup', 'premier-league', 'la-liga', 'serie-a', 'bundesliga',
  'champions-league', 'europa-league', 'march-madness', 'ncaab', 'ncaaf',
  'nba-draft', 'nfl-draft', 'college-football-playoffs', 'carabao-cup',
  'league-of-legends', 'valorant', 'counter-strike', 'dota', 'games',
])

function isSportsEvent(tags: MarketTag[]): boolean {
  return tags.some((t) => SPORTS_SLUGS.has(t.slug?.toLowerCase() || ''))
}

/* ============ 主组件 ============ */

export function MarketBrowser() {
  const [markets, setMarkets] = useState<MarketItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'endDate' | 'volume' | 'volume24hr' | 'yesPrice'>('volume')
  const [sortAsc, setSortAsc] = useState(false)
  const [page, setPage] = useState(1)
  const [totalLoaded, setTotalLoaded] = useState(0)
  const [showSports, setShowSports] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const PAGE_SIZE = 30

  // 获取本月最后一天
  const getMonthEnd = () => {
    const now = new Date()
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
    return end.toISOString()
  }

  const fetchMarkets = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    const allMarkets: MarketItem[] = []
    const endMax = getMonthEnd()
    const now = new Date().toISOString()
    let offset = 0
    const limit = 200

    try {
      // 使用 events 端点获取数据（包含 tags 信息）
      while (true) {
        if (controller.signal.aborted) break

        const url = `/api/markets?end_date_min=${encodeURIComponent(now)}&end_date_max=${encodeURIComponent(endMax)}&limit=${limit}&offset=${offset}`
        const resp = await fetch(url, { signal: controller.signal })
        if (!resp.ok) throw new Error(`API 请求失败: ${resp.status}`)

        const events: EventData[] = await resp.json()
        if (events.length === 0) break

        for (const event of events) {
          const eventTags = (event.tags || []) as MarketTag[]

          for (const m of event.markets || []) {
            // 只要活跃且未关闭的市场
            if (!m.active || m.closed) continue

            // 检查市场的 endDate 是否在本月底之前
            const mEnd = new Date(m.endDate)
            const monthEnd = new Date(endMax)
            const nowDate = new Date()
            if (mEnd > monthEnd || mEnd < nowDate) continue

            const outcomes = parseOutcomes(m.outcomes)
            const prices = parsePrices(m.outcomePrices)

            allMarkets.push({
              id: m.id,
              question: m.question,
              slug: m.slug,
              endDate: m.endDate,
              image: m.image || event.image,
              outcomes,
              outcomePrices: prices,
              volume: parseFloat(m.volume) || 0,
              volume24hr: m.volume24hr || 0,
              liquidity: m.liquidityNum || m.liquidity || 0,
              description: m.description || '',
              eventTitle: event.title,
              eventSlug: event.slug,
              tags: eventTags,
            })
          }
        }

        offset += limit
        setTotalLoaded(allMarkets.length)

        // 安全上限
        if (offset > 5000) break
      }

      setMarkets(allMarkets)
      setPage(1)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMarkets()
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [fetchMarkets])

  /* ============ 过滤和排序 ============ */

  const filtered = markets.filter((m) => {
    // 体育过滤
    if (!showSports && isSportsEvent(m.tags)) return false
    // 搜索过滤
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      return (
        m.question.toLowerCase().includes(term) ||
        (m.eventTitle || '').toLowerCase().includes(term) ||
        m.tags.some((t) => t.label.toLowerCase().includes(term))
      )
    }
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0
    switch (sortBy) {
      case 'endDate':
        cmp = new Date(a.endDate).getTime() - new Date(b.endDate).getTime()
        break
      case 'volume':
        cmp = a.volume - b.volume
        break
      case 'volume24hr':
        cmp = a.volume24hr - b.volume24hr
        break
      case 'yesPrice':
        cmp = (a.outcomePrices[0] || 0) - (b.outcomePrices[0] || 0)
        break
    }
    return sortAsc ? cmp : -cmp
  })

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortBy(field)
      setSortAsc(false)
    }
    setPage(1)
  }

  const SortIcon = ({ field }: { field: typeof sortBy }) => {
    if (sortBy !== field) return null
    return sortAsc ? (
      <TrendingUp className="w-3.5 h-3.5 inline ml-1" />
    ) : (
      <TrendingDown className="w-3.5 h-3.5 inline ml-1" />
    )
  }

  /* ============ 统计卡片 ============ */

  const sportsCount = markets.filter((m) => isSportsEvent(m.tags)).length
  const nonSportsCount = markets.length - sportsCount

  return (
    <div className="max-w-[1800px] mx-auto px-6 py-8">
      {/* 标题和统计 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-500" />
              本月到期预测市场
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              展示截至本月底结束的所有活跃预测市场及实时胜率
            </p>
          </div>
          <button
            onClick={fetchMarkets}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新数据
          </button>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-500">总市场数</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{markets.length}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-500">非体育市场</div>
            <div className="text-2xl font-bold text-blue-600 mt-1">{nonSportsCount}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-500">体育赛事</div>
            <div className="text-2xl font-bold text-orange-500 mt-1">{sportsCount}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-500">当前显示</div>
            <div className="text-2xl font-bold text-emerald-600 mt-1">{filtered.length}</div>
          </div>
        </div>

        {/* 搜索和过滤 */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setPage(1) }}
              placeholder="搜索市场名称、事件、标签..."
              className="w-full pl-10 pr-10 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {searchTerm && (
              <button
                onClick={() => { setSearchTerm(''); setPage(1) }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            onClick={() => { setShowSports(!showSports); setPage(1) }}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
              showSports
                ? 'bg-orange-50 border-orange-200 text-orange-700'
                : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Filter className="w-4 h-4" />
            {showSports ? '显示全部（含体育）' : '已排除体育赛事'}
          </button>
        </div>
      </div>

      {/* 加载状态 */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <span className="text-sm text-gray-500">
              正在加载市场数据... 已获取 {totalLoaded} 个市场
            </span>
          </div>
        </div>
      )}

      {/* 错误状态 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 市场表格 */}
      {!loading && !error && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600 w-12">#</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600 min-w-[300px]">
                      预测市场
                    </th>
                    <th
                      className="px-4 py-3 text-center text-sm font-semibold text-gray-600 cursor-pointer hover:text-blue-600 min-w-[120px]"
                      onClick={() => handleSort('yesPrice')}
                    >
                      YES 胜率 <SortIcon field="yesPrice" />
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600 min-w-[120px]">
                      NO 胜率
                    </th>
                    <th
                      className="px-4 py-3 text-right text-sm font-semibold text-gray-600 cursor-pointer hover:text-blue-600 min-w-[100px]"
                      onClick={() => handleSort('volume')}
                    >
                      总交易量 <SortIcon field="volume" />
                    </th>
                    <th
                      className="px-4 py-3 text-right text-sm font-semibold text-gray-600 cursor-pointer hover:text-blue-600 min-w-[100px]"
                      onClick={() => handleSort('volume24hr')}
                    >
                      24h交易量 <SortIcon field="volume24hr" />
                    </th>
                    <th
                      className="px-4 py-3 text-center text-sm font-semibold text-gray-600 cursor-pointer hover:text-blue-600 min-w-[110px]"
                      onClick={() => handleSort('endDate')}
                    >
                      结束日期 <SortIcon field="endDate" />
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600 min-w-[80px]">
                      剩余天数
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600 min-w-[120px]">
                      标签
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-16 text-center text-gray-400">
                        {searchTerm ? '没有找到匹配的市场' : '暂无数据'}
                      </td>
                    </tr>
                  ) : (
                    paged.map((m, idx) => {
                      const yesPrice = m.outcomePrices[0] || 0
                      const noPrice = m.outcomePrices[1] || 0
                      const yesPct = (yesPrice * 100).toFixed(1)
                      const noPct = (noPrice * 100).toFixed(1)
                      const days = daysUntil(m.endDate)
                      const rowNum = (page - 1) * PAGE_SIZE + idx + 1

                      return (
                        <tr
                          key={m.id}
                          className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors"
                        >
                          {/* 序号 */}
                          <td className="px-4 py-3.5 text-sm text-gray-400 tabular-nums">
                            {rowNum}
                          </td>

                          {/* 市场名称 */}
                          <td className="px-4 py-3.5">
                            <div className="flex items-start gap-3">
                              {m.image && (
                                <img
                                  src={m.image}
                                  alt=""
                                  className="w-10 h-10 rounded-lg object-cover flex-shrink-0 mt-0.5"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                                />
                              )}
                              <div className="min-w-0">
                                <a
                                  href={`https://polymarket.com/event/${m.eventSlug || m.slug}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm font-medium text-gray-900 hover:text-blue-600 transition-colors line-clamp-2"
                                >
                                  {m.question}
                                  <ExternalLink className="w-3 h-3 inline ml-1 text-gray-400" />
                                </a>
                                {m.eventTitle && m.eventTitle !== m.question && (
                                  <div className="text-xs text-gray-400 mt-0.5 truncate">
                                    {m.eventTitle}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* YES 胜率 */}
                          <td className="px-4 py-3.5 text-center">
                            <div className="flex flex-col items-center">
                              <span className={`text-base font-semibold tabular-nums ${
                                yesPrice >= 0.7 ? 'text-emerald-600' :
                                yesPrice >= 0.4 ? 'text-blue-600' :
                                'text-gray-600'
                              }`}>
                                {yesPct}%
                              </span>
                              {/* 进度条 */}
                              <div className="w-16 h-1.5 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
                                <div
                                  className="h-full bg-emerald-500 rounded-full transition-all"
                                  style={{ width: `${yesPct}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          {/* NO 胜率 */}
                          <td className="px-4 py-3.5 text-center">
                            <div className="flex flex-col items-center">
                              <span className={`text-base font-semibold tabular-nums ${
                                noPrice >= 0.7 ? 'text-red-500' :
                                noPrice >= 0.4 ? 'text-blue-600' :
                                'text-gray-600'
                              }`}>
                                {noPct}%
                              </span>
                              <div className="w-16 h-1.5 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
                                <div
                                  className="h-full bg-red-400 rounded-full transition-all"
                                  style={{ width: `${noPct}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          {/* 总交易量 */}
                          <td className="px-4 py-3.5 text-right text-sm font-medium text-gray-700 tabular-nums">
                            {formatVolume(m.volume)}
                          </td>

                          {/* 24h 交易量 */}
                          <td className="px-4 py-3.5 text-right text-sm font-medium text-gray-700 tabular-nums">
                            {formatVolume(m.volume24hr)}
                          </td>

                          {/* 结束日期 */}
                          <td className="px-4 py-3.5 text-center text-sm text-gray-600">
                            <div className="flex items-center justify-center gap-1">
                              <Calendar className="w-3.5 h-3.5 text-gray-400" />
                              {formatDate(m.endDate)}
                            </div>
                          </td>

                          {/* 剩余天数 */}
                          <td className="px-4 py-3.5 text-center">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              days <= 3 ? 'bg-red-50 text-red-600' :
                              days <= 7 ? 'bg-orange-50 text-orange-600' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {days}天
                            </span>
                          </td>

                          {/* 标签 */}
                          <td className="px-4 py-3.5">
                            <div className="flex flex-wrap gap-1">
                              {m.tags.slice(0, 3).map((t) => (
                                <span
                                  key={t.id}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-500"
                                >
                                  {t.label}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
                <div className="text-sm text-gray-500">
                  共 {sorted.length} 个市场，第 {page}/{totalPages} 页
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page <= 1}
                    className="p-1.5 rounded-lg border border-gray-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {/* 页码按钮 */}
                  {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                    let pageNum: number
                    if (totalPages <= 7) {
                      pageNum = i + 1
                    } else if (page <= 4) {
                      pageNum = i + 1
                    } else if (page >= totalPages - 3) {
                      pageNum = totalPages - 6 + i
                    } else {
                      pageNum = page - 3 + i
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setPage(pageNum)}
                        className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                          page === pageNum
                            ? 'bg-blue-500 text-white'
                            : 'text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {pageNum}
                      </button>
                    )
                  })}
                  <button
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page >= totalPages}
                    className="p-1.5 rounded-lg border border-gray-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
