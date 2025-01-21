"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTimeFrame } from '@/contexts/TimeFrameContext'

export function TimeFrameSelector() {
  const { timeFrame, setTimeFrame } = useTimeFrame()

  return (
    <div>
      <Select value={timeFrame} onValueChange={setTimeFrame}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Select time frame" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="6mo">6 Months</SelectItem>
          <SelectItem value="1y">1 Year</SelectItem>
          <SelectItem value="5y">5 Years</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

