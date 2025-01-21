"use client"

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface OptionPrices {
  call: number
  put: number
}

export function OptionPricing() {
  const [S, setS] = useState('100')
  const [K, setK] = useState('110')
  const [T, setT] = useState('1')
  const [r, setR] = useState('0.05')
  const [sigma, setSigma] = useState('0.2')
  const [prices, setPrices] = useState<OptionPrices | null>(null)

  const calculatePrices = async () => {
    // TODO: Implement actual Black-Scholes calculation using an API
    const mockPrices: OptionPrices = {
      call: Math.random() * 10,
      put: Math.random() * 10
    }
    setPrices(mockPrices)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Input
          type="number"
          placeholder="Current Stock Price (S)"
          value={S}
          onChange={(e) => setS(e.target.value)}
        />
        <Input
          type="number"
          placeholder="Strike Price (K)"
          value={K}
          onChange={(e) => setK(e.target.value)}
        />
        <Input
          type="number"
          placeholder="Time to Maturity (T) in years"
          value={T}
          onChange={(e) => setT(e.target.value)}
        />
        <Input
          type="number"
          placeholder="Risk-Free Interest Rate (r)"
          value={r}
          onChange={(e) => setR(e.target.value)}
        />
        <Input
          type="number"
          placeholder="Volatility (σ)"
          value={sigma}
          onChange={(e) => setSigma(e.target.value)}
        />
      </div>
      <Button onClick={calculatePrices}>Calculate Option Prices</Button>

      {prices && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
          <Card>
            <CardHeader>
              <CardTitle>Call Option Price</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${prices.call.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Put Option Price</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${prices.put.toFixed(2)}</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

