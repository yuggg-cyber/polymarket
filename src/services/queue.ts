import type { WalletData } from '@/types'

/**
 * Process a queue of items with concurrency control.
 * @param items - Array of items to process
 * @param processor - Async function to process each item
 * @param onResult - Callback when each item completes
 * @param concurrency - Maximum number of concurrent operations
 */
export async function processQueue(
  items: string[],
  processor: (item: string) => Promise<WalletData>,
  onResult: (result: WalletData, index: number) => void,
  concurrency: number = 5
): Promise<void> {
  let currentIndex = 0

  async function processNext(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++
      const item = items[index]

      try {
        const result = await processor(item)
        onResult(result, index)
      } catch (error) {
        const errorResult: WalletData = {
          address: item,
          totalTrades: 0,
          totalVolume: 0,
          totalPnL: 0,
          roi: 0,
          winRate: 0,
          totalInvested: 0,
          totalReturn: 0,
          activeDays: 0,
          maxSingleTradePnL: 0,
          portfolioValue: 0,
          status: 'error',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        }
        onResult(errorResult, index)
      }
    }
  }

  // Create `concurrency` number of workers
  const workers: Promise<void>[] = []
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(processNext())
  }

  await Promise.all(workers)
}
