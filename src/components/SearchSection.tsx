import type { WalletData, QueryProgress } from '@/types'

interface SearchSectionProps {
  setResults: React.Dispatch<React.SetStateAction<WalletData[]>>
  progress: QueryProgress
  setProgress: React.Dispatch<React.SetStateAction<QueryProgress>>
}

export default function SearchSection({ setResults: _setResults, progress: _progress, setProgress: _setProgress }: SearchSectionProps) {
  return (
    <div className="mb-8 flex flex-col items-center">
      <p className="text-muted-foreground">Search section placeholder — will be built in Step 2</p>
    </div>
  )
}
