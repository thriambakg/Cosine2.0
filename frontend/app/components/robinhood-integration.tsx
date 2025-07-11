"use client"

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTimeFrame } from '@/contexts/TimeFrameContext'

interface RobinhoodAuth {
  username: string
  password: string
  mfaCode: string
}

interface AccountInfo {
  user_id: string
  username: string
  email: string
  account_number: string
  total_portfolio_value: number
  day_change: number
  day_change_percent: number
}

interface PortfolioAnalysis {
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

export function RobinhoodIntegration() {
  const [auth, setAuth] = useState<RobinhoodAuth>({
    username: '',
    password: '',
    mfaCode: ''
  })
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requiresMfa, setRequiresMfa] = useState(false)
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null)
  const [portfolioAnalysis, setPortfolioAnalysis] = useState<PortfolioAnalysis | null>(null)
  const [emptyPortfolio, setEmptyPortfolio] = useState(false)
  const [showMockData, setShowMockData] = useState(false)
  const { timeFrame } = useTimeFrame()

  // API endpoint - uses local server for development, Lambda for production
  const API_ENDPOINT = process.env.NEXT_PUBLIC_ROBINHOOD_API_URL || 'http://localhost:5000/robinhood'

  const handleLogin = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'authenticate',
          username: auth.username,
          password: auth.password,
          mfa_code: requiresMfa ? auth.mfaCode : undefined
        })
      })

      const data = await response.json()

      if (response.ok) {
        setIsAuthenticated(true)
        setAccountInfo(data.account_info)
        setRequiresMfa(false)
        setError(null)
      } else if (response.status === 202 && data.requires_mfa) {
        setRequiresMfa(true)
        setError('Please enter your MFA code')
      } else {
        setError(data.error || 'Authentication failed')
      }
    } catch (err) {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleGetPortfolioAnalysis = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'get_portfolio_analysis',
          period: timeFrame
        })
      })

      const data = await response.json()

      if (response.ok) {
        if (data.empty_portfolio) {
          setEmptyPortfolio(true)
          setPortfolioAnalysis(data.mock_portfolio_analysis)
          setError(`${data.message}: ${data.suggestions.reason}`)
        } else {
          setEmptyPortfolio(false)
          setPortfolioAnalysis(data.portfolio_analysis)
        }
        
        if (data.account_info) {
          setAccountInfo(data.account_info)
        }
      } else {
        setError(data.error || 'Failed to get portfolio analysis')
      }
    } catch (err) {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleGetMockPortfolioAnalysis = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`${API_ENDPOINT}/mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          period: timeFrame
        })
      })

      const data = await response.json()

      if (response.ok) {
        setPortfolioAnalysis(data.portfolio_analysis)
        setAccountInfo(data.account_info)
        setShowMockData(true)
        setEmptyPortfolio(false)
        setError(null)
      } else {
        setError(data.error || 'Failed to get mock portfolio analysis')
      }
    } catch (err) {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    setLoading(true)

    try {
      await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'logout'
        })
      })

      // Reset state
      setIsAuthenticated(false)
      setAccountInfo(null)
      setPortfolioAnalysis(null)
      setEmptyPortfolio(false)
      setShowMockData(false)
      setAuth({ username: '', password: '', mfaCode: '' })
      setRequiresMfa(false)
      setError(null)
    } catch (err) {
      setError('Logout failed')
    } finally {
      setLoading(false)
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Connect Your Robinhood Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-800">
                <strong>⚠️ Important:</strong> This integration uses an unofficial Robinhood API. 
                Please be aware that this may violate Robinhood's terms of service and could result in account restrictions.
                Use at your own risk.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Username/Email</label>
              <Input
                type="text"
                value={auth.username}
                onChange={(e) => setAuth({ ...auth, username: e.target.value })}
                placeholder="Enter your Robinhood username or email"
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Password</label>
              <Input
                type="password"
                value={auth.password}
                onChange={(e) => setAuth({ ...auth, password: e.target.value })}
                placeholder="Enter your Robinhood password"
                disabled={loading}
              />
            </div>

            {requiresMfa && (
              <div>
                <label className="block text-sm font-medium mb-2">MFA Code</label>
                <Input
                  type="text"
                  value={auth.mfaCode}
                  onChange={(e) => setAuth({ ...auth, mfaCode: e.target.value })}
                  placeholder="Enter your 6-digit MFA code"
                  disabled={loading}
                />
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <Button 
              onClick={handleLogin}
              disabled={loading || !auth.username || !auth.password || (requiresMfa && !auth.mfaCode)}
              className="w-full"
            >
              {loading ? 'Connecting...' : (requiresMfa ? 'Verify MFA' : 'Connect to Robinhood')}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Account Info */}
      {accountInfo && (
        <Card>
          <CardHeader>
            <CardTitle>Account Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-gray-600">Account</p>
                <p className="font-semibold">{accountInfo.username}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Portfolio Value</p>
                <p className="font-semibold">${accountInfo.total_portfolio_value?.toFixed(2) || '0.00'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Day Change</p>
                <p className={`font-semibold ${(accountInfo.day_change || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  ${(accountInfo.day_change || 0).toFixed(2)} ({(accountInfo.day_change_percent || 0).toFixed(2)}%)
                </p>
              </div>
              <div>
                <Button onClick={handleLogout} variant="outline" size="sm">
                  Logout
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Portfolio Analysis Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Portfolio Risk Analysis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Button 
              onClick={handleGetPortfolioAnalysis}
              disabled={loading}
            >
              {loading ? 'Analyzing...' : 'Analyze My Portfolio'}
            </Button>
            <Button 
              onClick={handleGetMockPortfolioAnalysis}
              disabled={loading}
              variant="outline"
            >
              {loading ? 'Loading Mock Data...' : 'Load Mock Portfolio'}
            </Button>
            <p className="text-sm text-gray-600 self-center">
              Analysis period: {timeFrame}
            </p>
          </div>

          {error && (
            <div className={`border rounded-lg p-3 ${
              emptyPortfolio 
                ? 'bg-blue-50 border-blue-200' 
                : 'bg-red-50 border-red-200'
            }`}>
              <p className={`text-sm ${
                emptyPortfolio 
                  ? 'text-blue-800' 
                  : 'text-red-800'
              }`}>
                {error}
              </p>
              {emptyPortfolio && (
                <div className="mt-2 text-sm text-blue-700">
                  <p className="font-medium">What you can do:</p>
                  <ul className="list-disc list-inside mt-1 space-y-1">
                    <li>Click "Load Mock Portfolio" to see how the analysis works</li>
                    <li>Add some stocks to your Robinhood account first</li>
                    <li>This is normal for new or empty accounts</li>
                  </ul>
                </div>
              )}
            </div>
          )}

          {showMockData && portfolioAnalysis && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <p className="text-sm text-yellow-800">
                <strong>📊 Demo Data:</strong> This analysis uses mock data for demonstration. 
                Your actual portfolio analysis will show real holdings when you have stocks in your account.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Portfolio Analysis Results */}
      {portfolioAnalysis && (
        <Card>
          <CardHeader>
            <CardTitle>Portfolio Analysis Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Portfolio Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <p className="text-sm text-blue-600">Total Value</p>
                <p className="text-xl font-bold text-blue-800">
                  ${portfolioAnalysis.total_portfolio_value.toFixed(2)}
                </p>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <p className="text-sm text-green-600">Expected Return</p>
                <p className="text-xl font-bold text-green-800">
                  {portfolioAnalysis.portfolio_expected_return.toFixed(2)}%
                </p>
              </div>
              <div className="bg-yellow-50 p-4 rounded-lg">
                <p className="text-sm text-yellow-600">Volatility (Risk)</p>
                <p className="text-xl font-bold text-yellow-800">
                  {portfolioAnalysis.portfolio_volatility.toFixed(2)}%
                </p>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <p className="text-sm text-purple-600">Sharpe Ratio</p>
                <p className="text-xl font-bold text-purple-800">
                  {portfolioAnalysis.sharpe_ratio.toFixed(2)}
                </p>
              </div>
            </div>

            {/* Individual Stock Details */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Individual Holdings</h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-gray-300">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-300 px-4 py-2 text-left">Stock</th>
                      <th className="border border-gray-300 px-4 py-2 text-right">Shares</th>
                      <th className="border border-gray-300 px-4 py-2 text-right">Price</th>
                      <th className="border border-gray-300 px-4 py-2 text-right">Value</th>
                      <th className="border border-gray-300 px-4 py-2 text-right">Weight</th>
                      <th className="border border-gray-300 px-4 py-2 text-right">Return</th>
                      <th className="border border-gray-300 px-4 py-2 text-right">Volatility</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(portfolioAnalysis.stock_details).map(([ticker, details]) => (
                      <tr key={ticker}>
                        <td className="border border-gray-300 px-4 py-2 font-medium">{ticker}</td>
                        <td className="border border-gray-300 px-4 py-2 text-right">{details.shares}</td>
                        <td className="border border-gray-300 px-4 py-2 text-right">
                          ${details.current_price.toFixed(2)}
                        </td>
                        <td className="border border-gray-300 px-4 py-2 text-right">
                          ${details.total_value.toFixed(2)}
                        </td>
                        <td className="border border-gray-300 px-4 py-2 text-right">
                          {details.weight.toFixed(1)}%
                        </td>
                        <td className="border border-gray-300 px-4 py-2 text-right">
                          {details.annual_return.toFixed(2)}%
                        </td>
                        <td className="border border-gray-300 px-4 py-2 text-right">
                          {details.annual_volatility.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
