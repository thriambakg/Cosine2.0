"use client"

import { TimeFrameSelector } from './time-frame-selector'
import { useName } from '@/contexts/UserContext'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { LogOut, User } from 'lucide-react'

export function Header() {
  const { name } = useName()
  const { user, logout } = useAuth()

  const handleLogout = async () => {
    try {
      await logout()
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  return (
    <header className="bg-white border-b sticky top-0 z-10 w-[87vw] mx-auto">
      <div className="flex justify-between items-center h-16 px-4 md:px-6">
        {/* Left-aligned welcome text */}
        <h1 className="text-xl md:text-2xl font-bold truncate">
          Welcome {name}
        </h1>

        {/* Right-aligned controls */}
        <div className="flex items-center space-x-4">
          <TimeFrameSelector />
          
          {/* User info and logout */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 bg-gray-50 px-3 py-2 rounded-lg">
              <User className="w-4 h-4 text-gray-600" />
              <span className="text-sm text-gray-700 font-medium">
                {user?.email}
              </span>
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleLogout}
              className="flex items-center space-x-2 hover:bg-red-50 hover:border-red-200 hover:text-red-600"
            >
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}