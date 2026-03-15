import { useState, useMemo } from 'react'
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Copy,
  ExternalLink,
  Check,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import type { WalletData, SortField, SortDirection } from '@/types'

interface ResultsTableProps {
  results: WalletData[]
}

// Format helpers
function formatUSD(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`
  }
  return `$${value.toFixed(2)}`
}

function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`
  }
  return value.toLocaleString()
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function getPnLColor(value: number): string {
  if (value > 0) return 'text-profit'
  if (value < 0) return 'text-loss'
  return 'text-muted-foreground'
}

const SORTABLE_COLUMNS: { field: SortField; label: string }[] = [
  { field: 'totalPnL', label: 'Total P&L' },
  { field: 'roi', label: 'ROI' },
  { field: 'winRate', label: 'Win Rate' },
  { field: 'totalVolume', label: 'Volume' },
  { field: 'totalTrades', label: 'Trades' },
  { field: 'totalInvested', label: 'Invested' },
  { field: 'totalReturn', label: 'Return' },
  { field: 'activeDays', label: 'Active Days' },
  { field: 'portfolioValue', label: 'Portfolio' },
]

export default function ResultsTable({ results }: ResultsTableProps) {
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null)

  const sortedResults = useMemo(() => {
    if (!sortField) return results

    return [...results].sort((a, b) => {
      const aVal = a[sortField] as number
      const bVal = b[sortField] as number
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
    })
  }, [results, sortField, sortDirection])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  const handleCopy = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address)
      setCopiedAddress(address)
      setTimeout(() => setCopiedAddress(null), 2000)
    } catch {
      // Fallback for clipboard API
      const textarea = document.createElement('textarea')
      textarea.value = address
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopiedAddress(address)
      setTimeout(() => setCopiedAddress(null), 2000)
    }
  }

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="ml-1 h-3 w-3 text-primary" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3 text-primary" />
    )
  }

  // Single result card view
  if (results.length === 1) {
    const wallet = results[0]
    return <SingleWalletCard wallet={wallet} onCopy={handleCopy} copiedAddress={copiedAddress} />
  }

  // Multi-result table view
  return (
    <div className="mt-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">
          Query Results ({results.filter(r => r.status === 'success').length}/{results.length})
        </h2>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border">
              <TableHead className="w-[160px] text-muted-foreground">Wallet</TableHead>
              {SORTABLE_COLUMNS.map(col => (
                <TableHead key={col.field} className="text-muted-foreground">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 font-medium text-muted-foreground hover:text-foreground hover:bg-transparent"
                    onClick={() => handleSort(col.field)}
                  >
                    {col.label}
                    {getSortIcon(col.field)}
                  </Button>
                </TableHead>
              ))}
              <TableHead className="text-muted-foreground">Max P&L</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedResults.map((wallet) => (
              <TableRow key={wallet.address} className="border-border">
                <TableCell>
                  <div className="flex items-center gap-1">
                    {wallet.status === 'loading' || wallet.status === 'pending' ? (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    ) : wallet.status === 'error' ? (
                      <AlertCircle className="h-3 w-3 text-destructive" />
                    ) : null}
                    <span className="font-mono text-xs">{shortenAddress(wallet.address)}</span>
                    <button
                      onClick={() => handleCopy(wallet.address)}
                      className="ml-1 text-muted-foreground hover:text-foreground cursor-pointer"
                      title="Copy address"
                    >
                      {copiedAddress === wallet.address ? (
                        <Check className="h-3 w-3 text-primary" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                    <a
                      href={`https://polygonscan.com/address/${wallet.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                      title="View on PolygonScan"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </TableCell>
                <TableCell className={getPnLColor(wallet.totalPnL)}>
                  {wallet.status === 'success' ? formatUSD(wallet.totalPnL) : '-'}
                </TableCell>
                <TableCell className={getPnLColor(wallet.roi)}>
                  {wallet.status === 'success' ? formatPercent(wallet.roi) : '-'}
                </TableCell>
                <TableCell>
                  {wallet.status === 'success' ? `${wallet.winRate.toFixed(1)}%` : '-'}
                </TableCell>
                <TableCell>
                  {wallet.status === 'success' ? formatUSD(wallet.totalVolume) : '-'}
                </TableCell>
                <TableCell>
                  {wallet.status === 'success' ? formatNumber(wallet.totalTrades) : '-'}
                </TableCell>
                <TableCell>
                  {wallet.status === 'success' ? formatUSD(wallet.totalInvested) : '-'}
                </TableCell>
                <TableCell className={getPnLColor(wallet.totalReturn - wallet.totalInvested)}>
                  {wallet.status === 'success' ? formatUSD(wallet.totalReturn) : '-'}
                </TableCell>
                <TableCell>
                  {wallet.status === 'success' ? wallet.activeDays : '-'}
                </TableCell>
                <TableCell>
                  {wallet.status === 'success' ? formatUSD(wallet.portfolioValue) : '-'}
                </TableCell>
                <TableCell className={getPnLColor(wallet.maxSingleTradePnL)}>
                  {wallet.status === 'success' ? formatUSD(wallet.maxSingleTradePnL) : '-'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ============================================================
// Single wallet card view (for single query)
// ============================================================

interface SingleWalletCardProps {
  wallet: WalletData
  onCopy: (address: string) => void
  copiedAddress: string | null
}

function SingleWalletCard({ wallet, onCopy, copiedAddress }: SingleWalletCardProps) {
  if (wallet.status === 'pending' || wallet.status === 'loading') {
    return (
      <div className="mt-8 flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Loading wallet data...</span>
      </div>
    )
  }

  if (wallet.status === 'error') {
    return (
      <div className="mt-8 rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
        <p className="mt-2 text-destructive">
          {wallet.errorMessage || 'Failed to fetch wallet data'}
        </p>
      </div>
    )
  }

  const cards = [
    { label: 'Total Trades', value: formatNumber(wallet.totalTrades), color: '' },
    { label: 'Total Volume (USD)', value: formatUSD(wallet.totalVolume), color: '' },
    { label: 'Win Rate', value: `${wallet.winRate.toFixed(1)}%`, color: '' },
    {
      label: 'Total P&L (USD)',
      value: formatUSD(wallet.totalPnL),
      color: getPnLColor(wallet.totalPnL),
    },
    {
      label: 'ROI',
      value: formatPercent(wallet.roi),
      color: getPnLColor(wallet.roi),
    },
    { label: 'Total Invested', value: formatUSD(wallet.totalInvested), color: '' },
    {
      label: 'Total Return',
      value: formatUSD(wallet.totalReturn),
      color: getPnLColor(wallet.totalReturn - wallet.totalInvested),
    },
    { label: 'Active Days', value: String(wallet.activeDays), color: '' },
    {
      label: 'Max Single Trade P&L',
      value: formatUSD(wallet.maxSingleTradePnL),
      color: getPnLColor(wallet.maxSingleTradePnL),
    },
    { label: 'Portfolio Value (USD)', value: formatUSD(wallet.portfolioValue), color: '' },
  ]

  return (
    <div className="mt-8">
      {/* Wallet address header */}
      <div className="mb-6 flex items-center gap-3">
        <span className="font-mono text-lg font-semibold text-foreground">
          {shortenAddress(wallet.address)}
        </span>
        <button
          onClick={() => onCopy(wallet.address)}
          className="text-muted-foreground hover:text-foreground cursor-pointer"
          title="Copy full address"
        >
          {copiedAddress === wallet.address ? (
            <Check className="h-4 w-4 text-primary" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
        <a
          href={`https://polygonscan.com/address/${wallet.address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground"
          title="View on PolygonScan"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-border bg-card p-5 transition-colors hover:bg-accent/50"
          >
            <p className="text-sm text-muted-foreground">{card.label}</p>
            <p className={`mt-2 text-2xl font-bold ${card.color || 'text-foreground'}`}>
              {card.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
