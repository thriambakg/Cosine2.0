import React, { useState } from "react";

export function Select({ onValueChange, value, children }) {
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = () => setIsOpen((prev) => !prev);
  const handleSelect = (value) => {
    onValueChange(value);  // Pass the selected value to the parent
    setIsOpen(false);       // Close the dropdown after selection
  };

  return (
    <div className="relative">
      {children({ isOpen, handleToggle, handleSelect, value })}
    </div>
  );
}

export function SelectTrigger({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full p-2 border border-gray-300 rounded-md text-sm"
    >
      {children}
    </button>
  );
}

export function SelectContent({ isOpen, children }) {
  if (!isOpen) return null;

  return (
    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg">
      {children}
    </div>
  );
}

export function SelectItem({ value, children, onSelect }) {
  return (
    <div
      onClick={() => onSelect(value)}
      className="p-2 cursor-pointer hover:bg-gray-100"
    >
      {children}
    </div>
  );
}

export function SelectValue({ children }) {
  return (
    <span className="block p-2 text-gray-700">{children}</span>
  );
}