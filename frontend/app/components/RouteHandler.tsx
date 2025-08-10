'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function RouteHandler() {
  const router = useRouter()

  useEffect(() => {
    // Check if we have an intended path stored from the SPA routing script
    const intendedPath = sessionStorage.getItem('intendedPath')
    
    if (intendedPath && intendedPath !== window.location.pathname) {
      // Clear the stored path
      sessionStorage.removeItem('intendedPath')
      
      // Navigate to the intended route
      router.replace(intendedPath)
    }
  }, [router])

  return null // This component doesn't render anything
}
