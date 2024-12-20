"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";

// Supported crypto symbols
const CRYPTO_SYMBOLS = ['BTC', 'ETH', 'XRP', 'LTC', 'DOGE', 'ADA', 'SOL'];

// Supported time frames
const TIME_FRAME_MAPPING = { "6mo": 182, "1y": 365, "5y": 1825 };

export default function CryptoStats() {
  const [selectedCrypto, setSelectedCrypto] = useState<string | null>(null);
  const [timeFrame, setTimeFrame] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCrypto || !timeFrame) return;

    // Simulating API response
    const fetchCryptoStats = async () => {
      try {
        // Simulating an API request with a dummy response
        const response = {
          current_price: 30000, // Example current price
          price_change_24h: 5.2, // Example 24h return
          annual_return: 50, // Example annual return
          volatility: 35, // Example volatility
        };

        if (!response) {
          throw new Error('Failed to fetch crypto statistics');
        }

        setStats(response);
        setError(null);
      } catch (err) {
        setError(err.message);
        setStats(null);
      }
    };

    fetchCryptoStats();
  }, [selectedCrypto, timeFrame]);

  return (
    <div>
      <h1 className="text-4xl font-bold mb-6">Cryptocurrency Statistics</h1>
      <div className="flex space-x-4 mb-6">
        {/* Cryptocurrency Dropdown */}
        <Select onValueChange={setSelectedCrypto} value={selectedCrypto}>
          {({ isOpen, handleToggle, handleSelect, value }) => (
            <>
              <SelectTrigger onClick={handleToggle}>
                <SelectValue>{value || "Select Cryptocurrency"}</SelectValue>
              </SelectTrigger>
              <SelectContent isOpen={isOpen}>
                {CRYPTO_SYMBOLS.map((symbol) => (
                  <SelectItem key={symbol} value={symbol} onSelect={handleSelect}>
                    {symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </>
          )}
        </Select>

        {/* Time Frame Dropdown */}
        <Select onValueChange={setTimeFrame} value={timeFrame}>
          {({ isOpen, handleToggle, handleSelect, value }) => (
            <>
              <SelectTrigger onClick={handleToggle}>
                <SelectValue>{value || "Select Time Frame"}</SelectValue>
              </SelectTrigger>
              <SelectContent isOpen={isOpen}>
                {Object.keys(TIME_FRAME_MAPPING).map((key) => (
                  <SelectItem key={key} value={key} onSelect={handleSelect}>
                    {key === "6mo" ? "6 Months" : key === "1y" ? "1 Year" : "5 Years"}
                  </SelectItem>
                ))}
              </SelectContent>
            </>
          )}
        </Select>
      </div>

      {/* Error Handling */}
      {error && (
        <div className="text-red-500 mb-4">{error}</div>
      )}

      {/* Stats Display */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Current Price (USD)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${stats.current_price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                24h Return (%)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.price_change_24h.toFixed(2)}%</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Annual Return (%)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.annual_return.toFixed(2)}%</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Annualized Volatility (%)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.volatility.toFixed(2)}%</div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}