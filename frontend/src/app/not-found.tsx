'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'

export default function NotFound() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    // List of valid app routes
    const validRoutes = [
      '/',
      '/login',
      '/chat',
      '/crypto-stats',
      '/heatmap',
      '/option-pricing',
      '/portfolio-risk',
      '/robinhood',
      '/stock-alerts',
      '/stock-volatility',
      '/auth/callback'
    ]

    // If this is a valid route that just needs client-side routing, 
    // redirect to it via the router
    if (validRoutes.includes(pathname)) {
      router.replace(pathname)
    } else {
      // For invalid routes, redirect to home
      router.replace('/')
    }
  }, [pathname, router])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
        <p className="mt-2 text-gray-600">Loading...</p>
      </div>
    </div>
  )
}
