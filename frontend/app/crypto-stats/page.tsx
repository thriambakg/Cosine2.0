"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";

// Supported crypto symbols
const CRYPTO_SYMBOLS = ['BTC', 'ETH', 'XRP', 'LTC', 'DOGE', 'ADA', 'SOL'];

// Supported time frames
const TIME_FRAME_MAPPING = { "6mo": 182, "1y": 365, "5y": 1825 };

// Type for crypto stats
interface CryptoStats {
  current_price: number;
  price_change_24h: number;
  annual_return: number;
  volatility: number;
}

// Type for Select dropdown properties
interface SelectProps {
  isOpen: boolean;
  handleToggle: () => void;
  handleSelect: (value: string) => void;
  value: string | null;
}

export default function CryptoStats() {
  const [selectedCrypto, setSelectedCrypto] = useState<string | null>(null);
  const [timeFrame, setTimeFrame] = useState<string | null>(null);
  const [stats, setStats] = useState<CryptoStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check if both selectedCrypto and timeFrame are valid
    if (!selectedCrypto || !timeFrame || !CRYPTO_SYMBOLS.includes(selectedCrypto)) return;
  
    // Type assertion to ensure timeFrame is a valid key of TIME_FRAME_MAPPING
    const period = TIME_FRAME_MAPPING[timeFrame as keyof typeof TIME_FRAME_MAPPING];
  
    // If the timeFrame is invalid, return
    if (!period) return;
  
    // Simulating API response
    const fetchCryptoStats = async (symbol: string, period: number) => {
      try {
        const response = await fetch("http://127.0.0.1:8000/get_crypto_stats", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            selected_crypto_symbol: symbol,
            period: period,
          }),
        });
  
        const data = await response.json();
        if (response.ok) {
          setStats(data); // Update stats with the fetched data
        } else {
          setError(data.detail || "Error fetching data");
        }
      } catch (error) {
        console.error("Error fetching crypto stats:", error);
        setError("Error fetching data");
      }
    };
  
    fetchCryptoStats(selectedCrypto, period);
  }, [selectedCrypto, timeFrame]);

  return (
    <div>
      <h1 className="text-4xl font-bold mb-6">Cryptocurrency Statistics</h1>
      <div className="flex space-x-4 mb-6">
        {/* Cryptocurrency Dropdown */}
        <Select onValueChange={setSelectedCrypto} value={selectedCrypto}>
          {({ isOpen, handleToggle, handleSelect, value }: SelectProps) => (
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
          {({ isOpen, handleToggle, handleSelect, value }: SelectProps) => (
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
  );
}
