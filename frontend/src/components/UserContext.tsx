"use client"

import React, { createContext, useContext, useState } from 'react'

interface UserContextType {
  name: string
  setName: (name: string) => void
}

const UserContext = createContext<UserContextType | undefined>(undefined)

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [name, setName] = useState<string>("Placeholder name")

  return (
    <UserContext.Provider value={{ name, setName }}>
      {children}
    </UserContext.Provider>
  )
}

export function useName() {
  const context = useContext(UserContext)
  if (context === undefined) {
    throw new Error('useName must be used within a UserProvider')
  }
  return context
}

