import React, { useState, ReactNode } from "react";

// Define types for the props
interface SelectProps {
  onValueChange: (value: string) => void; // Function to handle the value change
  value: string | null; // The current value selected
  children: (args: { isOpen: boolean; handleToggle: () => void; handleSelect: (value: string) => void; value: string | null }) => ReactNode; // Function that renders the dropdown UI
}

export function Select({ onValueChange, value, children }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = () => setIsOpen((prev) => !prev);
  const handleSelect = (value: string) => {
    onValueChange(value);  // Pass the selected value to the parent
    setIsOpen(false);       // Close the dropdown after selection
  };

  return (
    <div className="relative">
      {children({ isOpen, handleToggle, handleSelect, value })}
    </div>
  );
}

export function SelectTrigger({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full p-2 border border-gray-300 rounded-md text-sm"
    >
      {children}
    </button>
  );
}

export function SelectContent({ isOpen, children }: { isOpen: boolean; children: ReactNode }) {
  if (!isOpen) return null;

  return (
    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg">
      {children}
    </div>
  );
}

export function SelectItem({ value, children, onSelect }: { value: string; children: ReactNode; onSelect: (value: string) => void }) {
  return (
    <div
      onClick={() => onSelect(value)}
      className="p-2 cursor-pointer hover:bg-gray-100"
    >
      {children}
    </div>
  );
}

export function SelectValue({ children }: { children: ReactNode }) {
  return (
    <span className="block p-2 text-gray-700">{children}</span>
  );
}
