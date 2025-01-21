import { CryptoStatsFetcher } from '@/components/crypto-stats-fetcher'

export default function CryptoStatsPage() {
  return (
    <div>
      <h1 className="text-4xl font-bold mb-8">Cryptocurrency Statistics</h1>
      <CryptoStatsFetcher />
    </div>
  )
}

