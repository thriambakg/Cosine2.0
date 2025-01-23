"use client"

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTimeFrame } from '@/contexts/TimeFrameContext'

interface PortfolioEntry {
  stock: string
  shares: number
}

interface PortfolioResults {
  total_portfolio_value: number
  portfolio_expected_return: number
  portfolio_volatility: number
  sharpe_ratio: number
  stock_details: {
    [key: string]: {
      weight: number
      annual_return: number
      annual_volatility: number
      shares: number
      current_price: number
      total_value: number
    }
  }
}

export function PortfolioRiskCalculator() {
  const [entries, setEntries] = useState<PortfolioEntry[]>([{ stock: '', shares: 0 }])
  const [results, setResults] = useState<PortfolioResults | null>(null)
  const { timeFrame } = useTimeFrame()

  const addEntry = () => {
    setEntries([...entries, { stock: '', shares: 0 }])
  }

  const removeEntry = (index: number) => {
    setEntries(entries.filter((_, i) => i !== index))
  }

  const updateEntry = (index: number, field: keyof PortfolioEntry, value: string | number) => {
    const newEntries = [...entries]
    newEntries[index] = { ...newEntries[index], [field]: value }
    setEntries(newEntries)
  }

  const calculateRisk = async () => {
    // TODO: Implement actual risk calculation using an API
    const mockResults: PortfolioResults = {
      total_portfolio_value: 100000,
      portfolio_expected_return: 8.5,
      portfolio_volatility: 15.2,
      sharpe_ratio: 0.56,
      stock_details: entries.reduce((acc, entry) => {
        acc[entry.stock] = {
          weight: Math.random(),
          annual_return: Math.random() * 20,
          annual_volatility: Math.random() * 30,
          shares: entry.shares,
          current_price: Math.random() * 1000,
          total_value: entry.shares * (Math.random() * 1000)
        }
        return acc
      }, {} as PortfolioResults['stock_details'])
    }
    setResults(mockResults)
  }

  return (
    <div className="space-y-4">
      {entries.map((entry, index) => (
        <div key={index} className="flex space-x-2">
          <Input
            placeholder="Stock Ticker"
            value={entry.stock}
            onChange={(e) => updateEntry(index, 'stock', e.target.value)}
          />
          <Input
            type="number"
            placeholder="Number of Shares"
            value={entry.shares}
            onChange={(e) => updateEntry(index, 'shares', parseFloat(e.target.value))}
          />
          <Button variant="destructive" onClick={() => removeEntry(index)}>Remove</Button>
        </div>
      ))}
      <Button onClick={addEntry}>Add Stock</Button>
      <Button onClick={calculateRisk}>Calculate Portfolio Risk</Button>

      {results && (
        <div className="mt-8">
          <h2 className="text-2xl font-bold mb-4">Portfolio Results ({timeFrame})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Total Portfolio Value</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">${results.total_portfolio_value.toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Expected Annual Return</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{results.portfolio_expected_return.toFixed(2)}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Portfolio Volatility</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{results.portfolio_volatility.toFixed(2)}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Sharpe Ratio</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{results.sharpe_ratio.toFixed(2)}</p>
              </CardContent>
            </Card>
          </div>

          <h3 className="text-xl font-bold mt-8 mb-4">Individual Stock Details</h3>
          <table className="w-full">
            <thead>
              <tr>
                <th>Stock</th>
                <th>Weight</th>
                <th>Annual Return</th>
                <th>Annual Volatility</th>
                <th>Shares</th>
                <th>Current Price</th>
                <th>Total Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(results.stock_details).map(([stock, details]) => (
                <tr key={stock}>
                  <td>{stock}</td>
                  <td>{(details.weight * 100).toFixed(2)}%</td>
                  <td>{details.annual_return.toFixed(2)}%</td>
                  <td>{details.annual_volatility.toFixed(2)}%</td>
                  <td>{details.shares}</td>
                  <td>${details.current_price.toFixed(2)}</td>
                  <td>${details.total_value.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

