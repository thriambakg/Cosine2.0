import { RobinhoodIntegration } from '@/components/robinhood-integration'

export default function RobinhoodPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Robinhood Integration</h1>
          <p className="text-gray-600 mt-2">
            Connect your Robinhood account to analyze your portfolio with our advanced risk assessment tools.
          </p>
        </div>
        <RobinhoodIntegration />
      </div>
    </div>
  )
}
