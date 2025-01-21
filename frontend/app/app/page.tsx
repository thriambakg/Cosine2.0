import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function Home() {
  return (
    <div>
      <h1 className="text-4xl font-bold mb-8">Cosine - Your Interactive Investment Assistant</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Stock Volatility</CardTitle>
            <CardDescription>Fetch volatility for various stocks</CardDescription>
          </CardHeader>
          <CardContent>
            <p>Access real-time stock volatility data.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cryptocurrency Statistics</CardTitle>
            <CardDescription>Get detailed crypto information</CardDescription>
          </CardHeader>
          <CardContent>
            <p>View current prices, returns, and volatility for popular cryptocurrencies.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Portfolio Risk Calculator</CardTitle>
            <CardDescription>Analyze your investment portfolio</CardDescription>
          </CardHeader>
          <CardContent>
            <p>Calculate risk metrics for your stock portfolio.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Stock Alerts</CardTitle>
            <CardDescription>Set up price alerts for stocks</CardDescription>
          </CardHeader>
          <CardContent>
            <p>Receive notifications when stocks reach your target prices.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Option Pricing</CardTitle>
            <CardDescription>Black-Scholes option pricing calculator</CardDescription>
          </CardHeader>
          <CardContent>
            <p>Calculate option prices using the Black-Scholes model.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Heatmap Visualization</CardTitle>
            <CardDescription>Visualize option prices</CardDescription>
          </CardHeader>
          <CardContent>
            <p>Generate heatmaps for option prices based on stock price and volatility.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

