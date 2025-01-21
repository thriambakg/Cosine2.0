"use client"

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const STOCK_TICKERS = [
  "AAPL", "TSLA", "GOOGL", "AMZN", "MSFT", "META", 
  "NFLX", "NVDA", "SPY", "VTI", "MSCI", "BA", "GE", 
  "INTC", "IBM", "DIS", "GS", "WMT", "JPM", "BABA"
]

interface Alert {
  email: string
  ticker: string
  price_threshold: number
  current_price: number
  comparison_mode: string
}

export function StockAlerts() {
  const [email, setEmail] = useState('')
  const [ticker, setTicker] = useState('')
  const [priceThreshold, setPriceThreshold] = useState('')
  const [comparisonMode, setComparisonMode] = useState('Greater Than')
  const [alerts, setAlerts] = useState<Alert[]>([])

  const addAlert = async () => {
    // TODO: Implement actual alert setting using an API
    const newAlert: Alert = {
      email,
      ticker,
      price_threshold: parseFloat(priceThreshold),
      current_price: Math.random() * 1000,
      comparison_mode: comparisonMode
    }
    setAlerts([...alerts, newAlert])
    // Reset form
    setEmail('')
    setTicker('')
    setPriceThreshold('')
    setComparisonMode('Greater Than')
  }

  const clearAlerts = () => {
    setAlerts([])
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          type="email"
          placeholder="Email Address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          placeholder="Stock Ticker Symbol"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
        />
        <Select value={comparisonMode} onValueChange={setComparisonMode}>
          <SelectTrigger>
            <SelectValue placeholder="Price Condition" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Greater Than">Greater Than</SelectItem>
            <SelectItem value="Less Than">Less Than</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="number"
          placeholder="Price Threshold ($)"
          value={priceThreshold}
          onChange={(e) => setPriceThreshold(e.target.value)}
        />
      </div>
      <Button onClick={addAlert}>Add Alert</Button>

      {alerts.length > 0 && (
        <div className="mt-8">
          <h2 className="text-2xl font-bold mb-4">Your Active Alerts</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Alert Price</TableHead>
                <TableHead>Current Price</TableHead>
                <TableHead>Condition</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.map((alert, index) => (
                <TableRow key={index}>
                  <TableCell>{alert.email}</TableCell>
                  <TableCell>{alert.ticker}</TableCell>
                  <TableCell>${alert.price_threshold.toFixed(2)}</TableCell>
                  <TableCell>${alert.current_price.toFixed(2)}</TableCell>
                  <TableCell>{alert.comparison_mode}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Button variant="destructive" onClick={clearAlerts} className="mt-4">Clear All Alerts</Button>
        </div>
      )}
    </div>
  )
}

