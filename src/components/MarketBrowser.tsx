import { useState, useRef, useCallback } from 'react'
import {
  ExternalLink,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Calendar,
  Filter,
  X,
  DollarSign,
  Star,
  ArrowLeft,
  Trash2,
} from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

/* ============ 类型定义 ============ */

export interface MarketTag {
  id: string
  label: string
  slug: string
}

export interface MarketItem {
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

export interface EventData {
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

function timeRemaining(iso: string): { days: number; hours: number; minutes: number } {
  const now = new Date()
  const end = new Date(iso)
  const diffMs = Math.max(0, end.getTime() - now.getTime())
  const days = Math.floor(diffMs / 86400000)
  const hours = Math.floor(diffMs / 3600000)
  const minutes = Math.max(1, Math.floor(diffMs / 60000))
  return { days, hours, minutes }
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

/** 加密价格预测相关 tag slug */
const CRYPTO_PRICE_SLUGS = new Set([
  'crypto-prices', 'hit-price',
])

/** 加密价格预测关键词（市场标题匹配） */
const CRYPTO_PRICE_KEYWORDS = [
  '5-minute', '15-minute', '1-hour', '4-hour',
  '5 minute', '15 minute', '1 hour', '4 hour',
  'green candle', 'red candle',
  'price above', 'price below', 'close above', 'close below',
]

function isCryptoPriceEvent(tags: MarketTag[], question: string): boolean {
  // 通过 tag 判断
  if (tags.some((t) => CRYPTO_PRICE_SLUGS.has(t.slug?.toLowerCase() || ''))) return true
  // 通过市场标题关键词判断（短期价格涨跌预测）
  const q = question.toLowerCase()
  if (CRYPTO_PRICE_KEYWORDS.some((kw) => q.includes(kw))) return true
  return false
}

function isWeatherEvent(_tags: MarketTag[], question: string): boolean {
  return question.toLowerCase().includes('temperature')
}

function isUpOrDownEvent(question: string): boolean {
  return question.toLowerCase().includes('up or down')
}

/** 解析用户输入的最低交易量字符串为数字（支持 K/M 后缀） */
function parseVolumeInput(input: string): number {
  if (!input.trim()) return 0
  const cleaned = input.trim().toUpperCase().replace(/[$,\s]/g, '')
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*(K|M)?$/)
  if (!match) return 0
  const num = parseFloat(match[1])
  const suffix = match[2]
  if (suffix === 'M') return num * 1_000_000
  if (suffix === 'K') return num * 1_000
  return num
}

/* ============ 解析函数（供外部使用） ============ */

/** 获取本月最后一天 */
function getMonthEnd() {
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
  return end.toISOString()
}

/** 解析 API 返回的事件数据为 MarketItem 列表 */
export function parseEventsToMarkets(events: EventData[]): MarketItem[] {
  const endMax = getMonthEnd()
  const allMarkets: MarketItem[] = []

  for (const event of events) {
    const eventTags = (event.tags || []) as MarketTag[]

    for (const m of event.markets || []) {
      if (!m.active || m.closed) continue

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

  return allMarkets
}

/* ============ 市场浏览器UI状态（提升到App层级以保持切换页面时的状态） ============ */

export interface MarketBrowserUIState {
  searchTerm: string
  sortBy: 'endDate' | 'volume' | 'volume24hr' | 'yesPrice'
  sortAsc: boolean
  page: number
  showSports: boolean
  showCrypto: boolean
  showWeather: boolean
  showUpOrDown: boolean
  minVolumeInput: string
  showFavoritesOnly: boolean
}

export const DEFAULT_MARKET_UI_STATE: MarketBrowserUIState = {
  searchTerm: '',
  sortBy: 'volume',
  sortAsc: false,
  page: 1,
  showSports: false,
  showCrypto: false,
  showWeather: true,
  showUpOrDown: true,
  minVolumeInput: '',
  showFavoritesOnly: false,
}

/* ============ 收藏功能 localStorage ============ */

const FAVORITES_STORAGE_KEY = 'polymarket_market_favorites'

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch { /* ignore */ }
  return new Set()
}

function saveFavorites(favs: Set<string>) {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...favs]))
  } catch { /* ignore */ }
}

/* ============ 主组件 ============ */

interface MarketBrowserProps {
  markets: MarketItem[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  uiState: MarketBrowserUIState
  onUIStateChange: (state: MarketBrowserUIState) => void
}

export function MarketBrowser({ markets, loading, error, onRefresh, uiState, onUIStateChange }: MarketBrowserProps) {
  const tableRef = useRef<HTMLDivElement>(null)
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites)

  // 从 uiState 解构
  const { searchTerm, sortBy, sortAsc, page, showSports, showCrypto, showWeather, showUpOrDown, minVolumeInput, showFavoritesOnly } = uiState

  // 更新UI状态的辅助函数
  const updateUI = useCallback((partial: Partial<MarketBrowserUIState>) => {
    onUIStateChange({ ...uiState, ...partial })
  }, [uiState, onUIStateChange])

  const [showClearFavConfirm, setShowClearFavConfirm] = useState(false)

  // 收藏切换
  const toggleFavorite = useCallback((marketId: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(marketId)) {
        next.delete(marketId)
      } else {
        next.add(marketId)
      }
      saveFavorites(next)
      return next
    })
  }, [])

  // 清空所有收藏
  const clearAllFavorites = useCallback(() => {
    setFavorites(new Set())
    saveFavorites(new Set())
    updateUI({ showFavoritesOnly: false, page: 1 })
    setShowClearFavConfirm(false)
  }, [updateUI])

  const PAGE_SIZE = 30

  const minVolume = parseVolumeInput(minVolumeInput)

  /* ============ 过滤和排序 ============ */

  const filtered = markets.filter((m) => {
    // 收藏过滤
    if (showFavoritesOnly && !favorites.has(m.id)) return false
    // 体育过滤
    if (!showSports && isSportsEvent(m.tags)) return false
    // 加密价格预测过滤
    if (!showCrypto && isCryptoPriceEvent(m.tags, m.question)) return false
    // 天气预测过滤
    if (!showWeather && isWeatherEvent(m.tags, m.question)) return false
    // Up or Down 过滤
    if (!showUpOrDown && isUpOrDownEvent(m.question)) return false
    // 最低总交易量过滤
    if (minVolume > 0 && m.volume < minVolume) return false
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
      updateUI({ sortAsc: !sortAsc, page: 1 })
    } else {
      updateUI({ sortBy: field, sortAsc: false, page: 1 })
    }
  }

  const scrollToTable = () => {
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
  const cryptoCount = markets.filter((m) => isCryptoPriceEvent(m.tags, m.question)).length
  const weatherCount = markets.filter((m) => isWeatherEvent(m.tags, m.question)).length
  const upOrDownCount = markets.filter((m) => isUpOrDownEvent(m.question)).length
  const nonSportsCount = markets.length - sportsCount
  const favoritesCount = markets.filter((m) => favorites.has(m.id)).length

  return (
    <div className="max-w-[1800px] mx-auto px-3 py-4 md:px-6 md:py-8">
      {/* 标题和统计 - 加载时隐藏 */}
      {!loading && (
      <div className="mb-4 md:mb-6">
        <div className="flex items-center justify-end gap-2 mb-3 md:mb-4">
          {/* 收藏筛选按钮 */}
          {showFavoritesOnly ? (
            <>
              <button
                onClick={() => updateUI({ showFavoritesOnly: false, page: 1 })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors bg-amber-500 border-amber-500 text-white md:gap-2 md:px-4 md:py-2 md:text-sm"
              >
                <ArrowLeft className="w-3.5 h-3.5 md:w-4 md:h-4" />
                返回市场
              </button>
              {favoritesCount > 0 && (
                <button
                  onClick={() => setShowClearFavConfirm(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-500 bg-white hover:bg-red-50 transition-colors md:gap-2 md:px-4 md:py-2 md:text-sm"
                >
                  <Trash2 className="w-3.5 h-3.5 md:w-4 md:h-4" />
                  清空收藏
                </button>
              )}
            </>
          ) : (
            <button
              onClick={() => updateUI({ showFavoritesOnly: true, page: 1 })}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors bg-white border-gray-200 text-gray-600 hover:bg-gray-50 md:gap-2 md:px-4 md:py-2 md:text-sm"
            >
              <Star className="w-3.5 h-3.5 md:w-4 md:h-4" />
              收藏 ({favoritesCount})
            </button>
          )}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors md:gap-2 md:px-4 md:py-2 md:text-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新数据
          </button>
        </div>

        {/* 统计卡片 */}
          <div className="grid grid-cols-3 gap-2 mb-4 md:grid-cols-4 md:gap-4 md:mb-6 lg:grid-cols-7">
            <div className="bg-white rounded-lg border border-gray-200 p-2.5 md:p-4">
              <div className="text-xs text-gray-500 md:text-sm">总市场数</div>
              <div className="text-lg font-bold text-gray-900 mt-0.5 md:text-2xl md:mt-1">{markets.length}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-2.5 md:p-4">
              <div className="text-xs text-gray-500 md:text-sm">非体育市场</div>
              <div className="text-lg font-bold text-blue-600 mt-0.5 md:text-2xl md:mt-1">{nonSportsCount}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-2.5 md:p-4">
              <div className="text-xs text-gray-500 md:text-sm">体育赛事</div>
              <div className="text-lg font-bold text-orange-500 mt-0.5 md:text-2xl md:mt-1">{sportsCount}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-2.5 md:p-4">
              <div className="text-xs text-gray-500 md:text-sm">加密预测</div>
              <div className="text-lg font-bold text-purple-600 mt-0.5 md:text-2xl md:mt-1">{cryptoCount}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-2.5 md:p-4">
              <div className="text-xs text-gray-500 md:text-sm">天气预测</div>
              <div className="text-lg font-bold text-sky-600 mt-0.5 md:text-2xl md:mt-1">{weatherCount}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-2.5 md:p-4">
              <div className="text-xs text-gray-500 md:text-sm">Up or Down</div>
              <div className="text-lg font-bold text-amber-600 mt-0.5 md:text-2xl md:mt-1">{upOrDownCount}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-2.5 md:p-4">
              <div className="text-xs text-gray-500 md:text-sm">当前显示</div>
              <div className="text-lg font-bold text-emerald-600 mt-0.5 md:text-2xl md:mt-1">{filtered.length}</div>
            </div>
          </div>

        {/* 搜索和过滤 */}
        
          <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-3">
            <div className="relative flex-1 min-w-0 md:min-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => { updateUI({ searchTerm: e.target.value, page: 1 }) }}
                placeholder="搜索市场名称、事件、标签..."
                className="w-full pl-10 pr-10 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent md:py-2.5"
              />
              {searchTerm && (
                <button
                  onClick={() => { updateUI({ searchTerm: '', page: 1 }) }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5 md:gap-3">
              <button
                onClick={() => { updateUI({ showSports: !showSports, page: 1 }) }}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors md:gap-1.5 md:px-4 md:py-2.5 md:text-sm ${
                  !showSports
                    ? 'bg-blue-500 border-blue-500 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Filter className="w-3 h-3 md:w-4 md:h-4" />
                {!showSports ? '已排除体育赛事' : '排除体育赛事'}
              </button>

              <button
                onClick={() => { updateUI({ showCrypto: !showCrypto, page: 1 }) }}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors md:gap-1.5 md:px-4 md:py-2.5 md:text-sm ${
                  !showCrypto
                    ? 'bg-blue-500 border-blue-500 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Filter className="w-3 h-3 md:w-4 md:h-4" />
                {!showCrypto ? '已排除加密预测' : '排除加密预测'}
              </button>

              <button
                onClick={() => { updateUI({ showWeather: !showWeather, page: 1 }) }}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors md:gap-1.5 md:px-4 md:py-2.5 md:text-sm ${
                  !showWeather
                    ? 'bg-blue-500 border-blue-500 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Filter className="w-3 h-3 md:w-4 md:h-4" />
                {!showWeather ? '已排除天气预测' : '排除天气预测'}
              </button>

              <button
                onClick={() => { updateUI({ showUpOrDown: !showUpOrDown, page: 1 }) }}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors md:gap-1.5 md:px-4 md:py-2.5 md:text-sm ${
                  !showUpOrDown
                    ? 'bg-blue-500 border-blue-500 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Filter className="w-3 h-3 md:w-4 md:h-4" />
                {!showUpOrDown ? '已排除 Up or Down' : '排除 Up or Down'}
              </button>

              {/* 最低总交易量筛选 */}
              <div className="relative min-w-[130px] md:min-w-[160px]">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 md:left-3 md:w-4 md:h-4" />
                <input
                  type="text"
                  value={minVolumeInput}
                  onChange={(e) => { updateUI({ minVolumeInput: e.target.value, page: 1 }) }}
                  placeholder="最低交易量 如 200K"
                  className={`w-full pl-7 pr-7 py-1.5 text-xs rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent md:pl-9 md:pr-8 md:py-2.5 md:text-sm ${
                    minVolume > 0
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-gray-200 bg-white text-gray-700'
                  }`}
                />
                {minVolumeInput && (
                  <button
                    onClick={() => { updateUI({ minVolumeInput: '', page: 1 }) }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
        </div>
        
      </div>
      )}

      {/* 加载状态 —— 骨架屏 */}
      {loading && (
        <div className="space-y-3 md:space-y-4">
          {/* 骨架屏：统计卡片 */}
          <div className="grid grid-cols-3 gap-2 md:grid-cols-4 md:gap-4 lg:grid-cols-7">
            {[...Array(7)].map((_, i) => (
              <div key={i} className={`bg-white rounded-lg border border-gray-200 p-2.5 md:p-4 ${i >= 3 ? 'hidden md:block' : ''} ${i >= 4 ? 'md:hidden lg:block' : ''}`}>
                <div className="h-3 w-12 rounded-md md:w-16" style={{ background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)', backgroundSize: '200% 100%', animation: `skeleton-shimmer 1.5s ease-in-out infinite ${i * 0.1}s` }} />
                <div className="h-5 w-10 rounded-md mt-2 md:h-7 md:w-12 md:mt-3" style={{ background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)', backgroundSize: '200% 100%', animation: `skeleton-shimmer 1.5s ease-in-out infinite ${i * 0.1 + 0.05}s` }} />
              </div>
            ))}
          </div>

          {/* 骨架屏：搜索栏占位 */}
          <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-3">
            <div className="flex-1 min-w-0 h-[38px] rounded-lg md:min-w-[240px] md:h-[42px]" style={{ background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)', backgroundSize: '200% 100%', animation: 'skeleton-shimmer 1.5s ease-in-out infinite 0s' }} />
            <div className="flex flex-wrap gap-1.5 md:gap-3">
              <div className="h-[30px] w-[100px] rounded-lg md:h-[42px] md:w-[140px]" style={{ background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)', backgroundSize: '200% 100%', animation: 'skeleton-shimmer 1.5s ease-in-out infinite 0.1s' }} />
              <div className="h-[30px] w-[100px] rounded-lg md:h-[42px] md:w-[140px]" style={{ background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)', backgroundSize: '200% 100%', animation: 'skeleton-shimmer 1.5s ease-in-out infinite 0.2s' }} />
              <div className="h-[30px] w-[100px] rounded-lg md:h-[42px] md:w-[140px]" style={{ background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)', backgroundSize: '200% 100%', animation: 'skeleton-shimmer 1.5s ease-in-out infinite 0.3s' }} />
              <div className="h-[30px] w-[100px] rounded-lg md:h-[42px] md:w-[140px]" style={{ background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)', backgroundSize: '200% 100%', animation: 'skeleton-shimmer 1.5s ease-in-out infinite 0.4s' }} />
              <div className="h-[30px] w-[100px] rounded-lg md:h-[42px] md:w-[160px]" style={{ background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)', backgroundSize: '200% 100%', animation: 'skeleton-shimmer 1.5s ease-in-out infinite 0.5s' }} />
            </div>
          </div>

          {/* 骨架屏：表格（移动端卡片式） */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* 表头 - 移动端隐藏 */}
            <div className="hidden md:flex items-center gap-4 px-4 py-3 border-b border-gray-100">
              <div className="h-3 w-8 rounded" style={{ background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)', backgroundSize: '200% 100%', animation: 'skeleton-shimmer 1.5s ease-in-out infinite 0s' }} />
              <div className="h-3 flex-1 max-w-[260px] rounded" style={{ background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)', backgroundSize: '200% 100%', animation: 'skeleton-shimmer 1.5s ease-in-out infinite 0.05s' }} />
              <div className="h-3 w-16 rounded" style={{ background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)', backgroundSize: '200% 100%', animation: 'skeleton-shimmer 1.5s ease-in-out infinite 0.1s' }} />
              <div className="h-3 w-16 rounded" style={{ background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)', backgroundSize: '200% 100%', animation: 'skeleton-shimmer 1.5s ease-in-out infinite 0.15s' }} />
              <div className="h-3 w-20 rounded" style={{ background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)', backgroundSize: '200% 100%', animation: 'skeleton-shimmer 1.5s ease-in-out infinite 0.2s' }} />
              <div className="h-3 w-20 rounded" style={{ background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)', backgroundSize: '200% 100%', animation: 'skeleton-shimmer 1.5s ease-in-out infinite 0.25s' }} />
              <div className="h-3 w-16 rounded" style={{ background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)', backgroundSize: '200% 100%', animation: 'skeleton-shimmer 1.5s ease-in-out infinite 0.3s' }} />
            </div>
            {/* 骨架行 */}
            {[...Array(6)].map((_, i) => {
              const sk = (delay: number) => ({
                background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)',
                backgroundSize: '200% 100%',
                animation: `skeleton-shimmer 1.5s ease-in-out infinite ${delay}s`,
              })
              const base = i * 0.08
              return (
                <div key={i} className="px-3 py-3 border-b border-gray-50 md:px-4 md:py-4">
                  {/* 移动端骨架 */}
                  <div className="flex items-start gap-2.5 md:hidden">
                    <div className="w-9 h-9 rounded-lg flex-shrink-0" style={sk(base)} />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 rounded w-full" style={sk(base + 0.04)} />
                      <div className="h-3 rounded w-2/3" style={sk(base + 0.06)} />
                      <div className="flex gap-3 mt-2">
                        <div className="h-4 w-14 rounded" style={sk(base + 0.08)} />
                        <div className="h-4 w-14 rounded" style={sk(base + 0.1)} />
                        <div className="h-4 w-16 rounded" style={sk(base + 0.12)} />
                      </div>
                    </div>
                  </div>
                  {/* PC 端骨架 */}
                  <div className="hidden md:flex items-center gap-4">
                    <div className="h-4 w-6 rounded" style={sk(base)} />
                    <div className="flex items-center gap-3 flex-1">
                      <div className="w-10 h-10 rounded-lg flex-shrink-0" style={sk(base + 0.02)} />
                      <div className="flex-1 space-y-2">
                        <div className="h-3.5 rounded w-3/4" style={sk(base + 0.04)} />
                        <div className="h-2.5 rounded w-1/2" style={sk(base + 0.06)} />
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-1.5 min-w-[60px]">
                      <div className="h-4 w-12 rounded" style={sk(base + 0.08)} />
                      <div className="h-1.5 w-14 rounded-full" style={sk(base + 0.1)} />
                    </div>
                    <div className="flex flex-col items-center gap-1.5 min-w-[60px]">
                      <div className="h-4 w-12 rounded" style={sk(base + 0.12)} />
                      <div className="h-1.5 w-14 rounded-full" style={sk(base + 0.14)} />
                    </div>
                    <div className="h-4 w-16 rounded" style={sk(base + 0.16)} />
                    <div className="h-4 w-16 rounded" style={sk(base + 0.18)} />
                    <div className="h-4 w-20 rounded" style={sk(base + 0.2)} />
                    <div className="h-5 w-10 rounded-full" style={sk(base + 0.22)} />
                    <div className="flex gap-1">
                      <div className="h-5 w-10 rounded" style={sk(base + 0.24)} />
                      <div className="h-5 w-8 rounded" style={sk(base + 0.26)} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 错误状态 - 加载时隐藏 */}
      {!loading && error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 md:p-4 md:text-sm">
          {error}
        </div>
      )}

      {/* 市场表格 */}
      {!loading && !error && (
        <>
          <div ref={tableRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* PC 端表格 */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full" style={{ tableLayout: 'fixed' }}>
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600" style={{ width: '44px' }}>
                      <Star className="w-4 h-4 inline text-gray-400" />
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600" style={{ width: '48px' }}>#</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">
                      预测市场
                    </th>
                    <th
                      className="px-4 py-3 text-center text-sm font-semibold text-gray-600 cursor-pointer hover:text-blue-600" style={{ width: '100px' }}
                      onClick={() => handleSort('yesPrice')}
                    >
                      YES 胜率 <SortIcon field="yesPrice" />
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600" style={{ width: '100px' }}>
                      NO 胜率
                    </th>
                    <th
                      className="px-4 py-3 text-right text-sm font-semibold text-gray-600 cursor-pointer hover:text-blue-600" style={{ width: '100px' }}
                      onClick={() => handleSort('volume')}
                    >
                      总交易量 <SortIcon field="volume" />
                    </th>
                    <th
                      className="px-4 py-3 text-right text-sm font-semibold text-gray-600 cursor-pointer hover:text-blue-600" style={{ width: '100px' }}
                      onClick={() => handleSort('volume24hr')}
                    >
                      24h交易量 <SortIcon field="volume24hr" />
                    </th>
                    <th
                      className="px-4 py-3 text-center text-sm font-semibold text-gray-600 cursor-pointer hover:text-blue-600" style={{ width: '110px' }}
                      onClick={() => handleSort('endDate')}
                    >
                      结束日期 <SortIcon field="endDate" />
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600" style={{ width: '80px' }}>
                      剩余时间
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600" style={{ width: '120px' }}>
                      标签
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-16 text-center text-gray-400">
                        {searchTerm ? '没有找到匹配的市场' : '暂无数据'}
                      </td>
                    </tr>
                  ) : (
                    paged.map((m, idx) => {
                      const yesPrice = m.outcomePrices[0] || 0
                      const noPrice = m.outcomePrices[1] || 0
                      const yesPct = (yesPrice * 100).toFixed(1)
                      const noPct = (noPrice * 100).toFixed(1)
                      const { days, hours, minutes } = timeRemaining(m.endDate)
                      const isSports = isSportsEvent(m.tags)
                      const rowNum = (page - 1) * PAGE_SIZE + idx + 1

                      return (
                        <tr
                          key={m.id}
                          className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors"
                        >
                          {/* 收藏 */}
                          <td className="px-2 py-3.5 text-center">
                            <button
                              onClick={() => toggleFavorite(m.id)}
                              className="p-1 rounded hover:bg-gray-100 transition-colors"
                              title={favorites.has(m.id) ? '取消收藏' : '收藏'}
                            >
                              <Star className={`w-4 h-4 transition-colors ${favorites.has(m.id) ? 'text-amber-400 fill-amber-400' : 'text-gray-300 hover:text-amber-300'}`} />
                            </button>
                          </td>
                          {/* 序号 */}
                          <td className="px-4 py-3.5 text-sm text-gray-400 tabular-nums">
                            {rowNum}
                          </td>

                          {/* 市场名称 */}
                          <td className="px-4 py-3.5 overflow-hidden">
                            <div className="flex items-start gap-3 overflow-hidden">
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
                                  className="text-sm font-medium text-gray-900 hover:text-blue-600 transition-colors line-clamp-1"
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

                          {/* 剩余时间 */}
                          <td className="px-4 py-3.5 text-center">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              isSports ? (
                                days <= 3 ? 'bg-red-50 text-red-600' :
                                days <= 7 ? 'bg-orange-50 text-orange-600' :
                                'bg-gray-100 text-gray-600'
                              ) : (
                                hours === 0 ? 'bg-red-100 text-red-700' :
                                days === 0 ? 'bg-red-100 text-red-700' :
                                days <= 3 ? 'bg-red-50 text-red-600' :
                                days <= 7 ? 'bg-orange-50 text-orange-600' :
                                'bg-gray-100 text-gray-600'
                              )
                            }`}>
                              {isSports
                                ? `${Math.max(1, days)}天`
                                : days > 0 ? `${days}天` : hours > 0 ? `${hours}小时` : `${minutes}分钟`
                              }
                            </span>
                          </td>

                          {/* 标签 */}
                          <td className="px-4 py-3.5 overflow-hidden">
                            <div className="flex flex-nowrap gap-1 overflow-hidden">
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

            {/* 移动端卡片列表 */}
            <div className="md:hidden divide-y divide-gray-100">
              {/* 移动端排序栏 */}
              <div className="flex items-center gap-1 px-3 py-2 bg-gray-50 border-b border-gray-200 overflow-x-auto">
                <span className="text-xs text-gray-500 flex-shrink-0">排序:</span>
                {([
                  { field: 'volume' as const, label: '总交易量' },
                  { field: 'volume24hr' as const, label: '24h量' },
                  { field: 'yesPrice' as const, label: 'YES胜率' },
                  { field: 'endDate' as const, label: '结束日期' },
                ] as const).map(({ field, label }) => (
                  <button
                    key={field}
                    onClick={() => handleSort(field)}
                    className={`flex-shrink-0 px-2 py-1 text-xs rounded-md transition-colors ${
                      sortBy === field
                        ? 'bg-blue-500 text-white'
                        : 'text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {label}
                    {sortBy === field && (
                      sortAsc ? <TrendingUp className="w-3 h-3 inline ml-0.5" /> : <TrendingDown className="w-3 h-3 inline ml-0.5" />
                    )}
                  </button>
                ))}
              </div>

              {paged.length === 0 ? (
                <div className="px-3 py-12 text-center text-gray-400 text-sm">
                  {searchTerm ? '没有找到匹配的市场' : '暂无数据'}
                </div>
              ) : (
                paged.map((m, idx) => {
                  const yesPrice = m.outcomePrices[0] || 0
                  const noPrice = m.outcomePrices[1] || 0
                  const yesPct = (yesPrice * 100).toFixed(1)
                  const noPct = (noPrice * 100).toFixed(1)
                  const { days, hours, minutes } = timeRemaining(m.endDate)
                  const isSports = isSportsEvent(m.tags)
                  const rowNum = (page - 1) * PAGE_SIZE + idx + 1

                  return (
                    <div
                      key={m.id}
                      className="block px-3 py-3 active:bg-gray-50 transition-colors"
                    >
                      {/* 顶部：收藏 + 图片 + 标题 */}
                      <div className="flex items-start gap-2">
                        <button
                          onClick={() => toggleFavorite(m.id)}
                          className="p-0.5 rounded mt-0.5 flex-shrink-0"
                        >
                          <Star className={`w-4 h-4 transition-colors ${favorites.has(m.id) ? 'text-amber-400 fill-amber-400' : 'text-gray-300'}`} />
                        </button>
                        {m.image && (
                          <img
                            src={m.image}
                            alt=""
                            className="w-9 h-9 rounded-lg object-cover flex-shrink-0 mt-0.5"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        )}
                        <a
                          href={`https://polymarket.com/event/${m.eventSlug || m.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 min-w-0"
                        >
                          <div className="text-sm font-medium text-gray-900 line-clamp-2 leading-snug">
                            <span className="text-xs text-gray-400 mr-1">{rowNum}.</span>
                            {m.question}
                          </div>
                        </a>
                      </div>

                      {/* 中部：YES/NO 胜率 + 交易量 */}
                      <div className="flex items-center gap-3 mt-2 ml-[30px]">
                        {/* YES */}
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-400">YES</span>
                          <span className={`text-sm font-semibold tabular-nums ${
                            yesPrice >= 0.7 ? 'text-emerald-600' :
                            yesPrice >= 0.4 ? 'text-blue-600' :
                            'text-gray-600'
                          }`}>
                            {yesPct}%
                          </span>
                        </div>
                        {/* NO */}
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-400">NO</span>
                          <span className={`text-sm font-semibold tabular-nums ${
                            noPrice >= 0.7 ? 'text-red-500' :
                            noPrice >= 0.4 ? 'text-blue-600' :
                            'text-gray-600'
                          }`}>
                            {noPct}%
                          </span>
                        </div>
                        <span className="text-xs text-gray-300">|</span>
                        {/* 总交易量 */}
                        <span className="text-xs text-gray-500 tabular-nums">{formatVolume(m.volume)}</span>
                        {/* 剩余时间 */}
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                          isSports ? (
                            days <= 3 ? 'bg-red-50 text-red-600' :
                            days <= 7 ? 'bg-orange-50 text-orange-600' :
                            'bg-gray-100 text-gray-600'
                          ) : (
                            hours === 0 ? 'bg-red-100 text-red-700' :
                            days === 0 ? 'bg-red-100 text-red-700' :
                            days <= 3 ? 'bg-red-50 text-red-600' :
                            days <= 7 ? 'bg-orange-50 text-orange-600' :
                            'bg-gray-100 text-gray-600'
                          )
                        }`}>
                          {isSports
                            ? `${Math.max(1, days)}天`
                            : days > 0 ? `${days}天` : hours > 0 ? `${hours}小时` : `${minutes}分钟`
                          }
                        </span>
                      </div>

                      {/* 底部：标签 */}
                      {m.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5 ml-[30px]">
                          {m.tags.slice(0, 2).map((t) => (
                            <span
                              key={t.id}
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-500"
                            >
                              {t.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex flex-col gap-2 px-3 py-2.5 border-t border-gray-200 bg-gray-50 md:flex-row md:items-center md:justify-between md:px-4 md:py-3">
                <div className="text-xs text-gray-500 text-center md:text-sm md:text-left">
                  共 {sorted.length} 个市场，第 {page}/{totalPages} 页
                </div>
                <div className="flex items-center justify-center gap-1 md:gap-2">
                  <button
                    onClick={() => { updateUI({ page: Math.max(1, page - 1) }); scrollToTable() }}
                    disabled={page <= 1}
                    className="p-1 rounded-lg border border-gray-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors md:p-1.5"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {/* 页码按钮 - 移动端显示更少 */}
                  {Array.from({ length: Math.min(typeof window !== 'undefined' && window.innerWidth < 768 ? 5 : 7, totalPages) }, (_, i) => {
                    const maxShow = typeof window !== 'undefined' && window.innerWidth < 768 ? 5 : 7
                    let pageNum: number
                    if (totalPages <= maxShow) {
                      pageNum = i + 1
                    } else if (page <= Math.ceil(maxShow / 2)) {
                      pageNum = i + 1
                    } else if (page >= totalPages - Math.floor(maxShow / 2)) {
                      pageNum = totalPages - maxShow + 1 + i
                    } else {
                      pageNum = page - Math.floor(maxShow / 2) + i
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => { updateUI({ page: pageNum }); scrollToTable() }}
                        className={`w-7 h-7 rounded-lg text-xs font-medium transition-colors md:w-8 md:h-8 md:text-sm ${
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
                    onClick={() => { updateUI({ page: Math.min(totalPages, page + 1) }); scrollToTable() }}
                    disabled={page >= totalPages}
                    className="p-1 rounded-lg border border-gray-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors md:p-1.5"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      {/* 清空收藏确认弹窗 */}
      <ConfirmDialog
        open={showClearFavConfirm}
        title="清空收藏"
        message={`确定要清空所有 ${favoritesCount} 个收藏吗？该操作不可恢复。`}
        confirmText="确认清空"
        cancelText="取消"
        variant="danger"
        onConfirm={clearAllFavorites}
        onCancel={() => setShowClearFavConfirm(false)}
      />
    </div>
  )
}
