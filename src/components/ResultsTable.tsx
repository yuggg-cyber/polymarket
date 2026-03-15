import type { WalletData } from '@/types'

interface ResultsTableProps {
  results: WalletData[]
}

export default function ResultsTable({ results: _results }: ResultsTableProps) {
  return (
    <div className="mt-8">
      <p className="text-muted-foreground">Results table placeholder — will be built in Step 4</p>
    </div>
  )
}
