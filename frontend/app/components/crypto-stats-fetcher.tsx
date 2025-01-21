"use client"

import { useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useTimeFrame } from "@/contexts/TimeFrameContext"

const CRYPTO_SYMBOLS = ["BTC", "ETH", "XRP", "LTC", "DOGE", "ADA", "SOL"]

interface CryptoStats {
  current_price: number
  price_change_24h: number
  annual_return: number
  volatility: number
}

export function CryptoStatsFetcher() {
  const [selectedCrypto, setSelectedCrypto] = useState<string>("BTC")
  const [stats, setStats] = useState<CryptoStats | null>(null)
  const { timeFrame } = useTimeFrame()

  const fetchCryptoStats = async () => {
    // TODO: Implement actual API call
    const mockStats: CryptoStats = {
      current_price: Math.random() * 50000,
      price_change_24h: (Math.random() - 0.5) * 10,
      annual_return: (Math.random() - 0.5) * 100,
      volatility: Math.random() * 50,
    }
    setStats(mockStats)
  }

  const handleCryptoChange = (value: string) => {
    setSelectedCrypto(value)
    fetchCryptoStats()
  }

  return (
    <div className="space-y-4">
      <Select value={selectedCrypto} onValueChange={handleCryptoChange}>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="Select cryptocurrency" />
        </SelectTrigger>
        <SelectContent>
          {CRYPTO_SYMBOLS.map((symbol) => (
            <SelectItem key={symbol} value={symbol}>
              {symbol}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Current Price (USD)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${stats.current_price.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>24h Return (%)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{stats.price_change_24h.toFixed(2)}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Annual Return (%)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{stats.annual_return.toFixed(2)}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Annualized Volatility (%)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{stats.volatility.toFixed(2)}%</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

