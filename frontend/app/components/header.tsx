"use client"

import { TimeFrameSelector } from './time-frame-selector'
import { useName } from '@/contexts/UserContext'

export function Header() {
  const { name } = useName()

  return (
    <header className="bg-white border-b sticky top-0 z-10 w-[87vw] mx-auto">
      <div className="flex justify-between items-center h-16 px-4 md:px-6">
        {/* Left-aligned welcome text */}
        <h1 className="text-xl md:text-2xl font-bold truncate">
          Welcome {name}
        </h1>

        {/* Right-aligned TimeFrameSelector */}
        <div className="flex items-center">
          <TimeFrameSelector />
        </div>
      </div>
    </header>
  )
}