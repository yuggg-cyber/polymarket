import { useState } from 'react'
import type { WalletData, QueryProgress } from '@/types'
import SearchSection from '@/components/SearchSection'
import ResultsTable from '@/components/ResultsTable'

function App() {
  const [results, setResults] = useState<WalletData[]>([])
  const [progress, setProgress] = useState<QueryProgress>({
    total: 0,
    completed: 0,
    isLoading: false,
  })

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* Header */}
        <header className="mb-12 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground md:text-5xl">
            <span className="text-primary">Polymarket</span> Wallet Analyzer
          </h1>
          <p className="mt-3 text-lg text-muted-foreground">
            Track and analyze Polymarket wallet addresses — P&L, ROI, Win Rate, and more.
          </p>
        </header>

        {/* Search Section */}
        <SearchSection
          setResults={setResults}
          progress={progress}
          setProgress={setProgress}
        />

        {/* Results Section */}
        {results.length > 0 && (
          <ResultsTable results={results} />
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-border py-6 text-center text-sm text-muted-foreground">
        <p>Polymarket Wallet Analyzer — Powered by Polymarket public APIs</p>
      </footer>
    </div>
  )
}

export default App
