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

function getMonthEnd() {
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
  return end.toISOString()
}

export function parseEventsToMarkets(events: EventData[]): MarketItem[] {
  const endMax = getMonthEnd()
  const allMarkets: MarketItem[] = []

  for (const event of events) {
    const eventTags = (event.tags || []) as MarketTag[]

    for (const market of event.markets || []) {
      if (!market.active || market.closed) continue

      const marketEnd = new Date(market.endDate)
      const monthEnd = new Date(endMax)
      const nowDate = new Date()
      if (marketEnd > monthEnd || marketEnd < nowDate) continue

      const outcomes = parseOutcomes(market.outcomes)
      const prices = parsePrices(market.outcomePrices)

      allMarkets.push({
        id: market.id,
        question: market.question,
        slug: market.slug,
        endDate: market.endDate,
        image: market.image || event.image,
        outcomes,
        outcomePrices: prices,
        volume: parseFloat(market.volume) || 0,
        volume24hr: market.volume24hr || 0,
        liquidity: market.liquidityNum || market.liquidity || 0,
        description: market.description || '',
        eventTitle: event.title,
        eventSlug: event.slug,
        tags: eventTags,
      })
    }
  }

  return allMarkets
}
