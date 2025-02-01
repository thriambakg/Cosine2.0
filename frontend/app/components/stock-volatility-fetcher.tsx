"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTimeFrame } from "@/contexts/TimeFrameContext";

const STOCK_TICKERS = [
  "AAPL", "TSLA", "GOOGL", "AMZN", "MSFT", "META",
  "NFLX", "NVDA", "SPY", "VTI", "MSCI", "BA", "GE",
  "INTC", "IBM", "DIS", "GS", "WMT", "JPM", "BABA"
];

export function StockVolatilityFetcher() {
  const [ticker, setTicker] = useState("");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [volatility, setVolatility] = useState<number | null>(null);
  const { timeFrame } = useTimeFrame();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase();
    setTicker(value);
    setSuggestions(STOCK_TICKERS.filter((t) => t.startsWith(value)));
  };

  const fetchVolatility = async () => {
    if (!ticker) return; // Prevents fetching if input is empty

    setSelectedTicker(ticker); // Lock in the ticker value
    const mockVolatility = Math.random() * 0.5; // Simulated API call
    setVolatility(mockVolatility);
  };

  return (
    <div className="space-y-4">
      <div className="flex space-x-2">
        <Input
          type="text"
          placeholder="Enter Stock Ticker Symbol"
          value={ticker}
          onChange={handleInputChange}
        />
        <Button onClick={fetchVolatility}>Fetch Volatility</Button>
      </div>
      {suggestions.length > 0 && (
        <div className="text-sm text-gray-600">
          Suggestions: {suggestions.join(", ")}
        </div>
      )}
      {volatility !== null && selectedTicker && (
        <div className="text-lg font-semibold">
          Volatility for {selectedTicker} ({timeFrame}): {volatility.toFixed(4)}
        </div>
      )}
    </div>
  );
}
