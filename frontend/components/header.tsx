"use client"

import { TimeFrameSelector } from './time-frame-selector'
import { useName } from '@/contexts/UserContext'

export function Header() {
  const { name } = useName()

  return (
    <header className="bg-white border-b p-4 sticky top-0 z-10 h-16 w-full">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Welcome {name}</h1>
        <TimeFrameSelector />
      </div>
    </header>
  )
}

