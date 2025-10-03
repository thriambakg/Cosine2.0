import { useCallback, useRef, useEffect } from 'react';

interface UseTilePinningProps {
  initialPinned: boolean;
  onPinChange: (isPinned: boolean) => void;
}

interface UseTilePinningReturn {
  isPinned: boolean;
  togglePin: () => void;
}

/**
 * Common hook for tile pinning functionality
 * Delegates to parent component's onPinChange callback (matching other tile settings)
 */
export const useTilePinning = ({
  initialPinned,
  onPinChange,
}: UseTilePinningProps): UseTilePinningReturn => {
  
  // Use ref to track current pin state to avoid stale closures
  const isPinnedRef = useRef(initialPinned);
  
  // Update ref when prop changes
  useEffect(() => {
    isPinnedRef.current = initialPinned;
  }, [initialPinned]);
  
  const togglePin = useCallback(() => {
    const newPinState = !isPinnedRef.current;
    onPinChange(newPinState);
  }, [onPinChange]);

  return {
    isPinned: initialPinned,
    togglePin,
  };
};

