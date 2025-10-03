# Tile Common Components

This folder contains shared components and hooks for all tile types.

## Pinning System

### Files

1. **`useTilePinning.ts`** - Hook for managing tile pin state and API calls
2. **`PinButton.tsx`** - Reusable pin button component
3. **`index.ts`** - Barrel export for easy imports

### Usage

#### In any tile component:

```tsx
import { useTilePinning, PinButton } from './common';

const MyTile: React.FC<TileProps> = ({ id, isPinned, onSettingsChange, ...props }) => {
  // Initialize pinning hook (delegates to parent's onSettingsChange)
  const { isPinned: pinnedState, togglePin } = useTilePinning({
    initialPinned: isPinned,
    onPinChange: (pinned) => {
      onSettingsChange(id, { isPinned: pinned });
    },
  });

  // Use pinnedState to control tile behavior
  return (
    <Box
      sx={{
        cursor: pinnedState ? 'default' : 'grab',
        // ... other styles
      }}
      onMouseDown={pinnedState ? undefined : onDragStart}
    >
      {/* Add pin button to header */}
      <PinButton
        isPinned={pinnedState}
        onTogglePin={togglePin}
      />
      
      {/* Rest of tile content */}
    </Box>
  );
};
```

### Features

- **Visual Indication**: 
  - Pin icon changes: filled (orange) when pinned, outlined (gray) when unpinned
  - Small pin indicator badge next to tile title when pinned
  - No border changes - keeps consistent styling

- **Locked Behavior**:
  - Pinned tiles cannot be dragged (`onMouseDown` is disabled)
  - Pinned tiles cannot be resized
  - Cursor changes to `default` instead of `grab`
  - No hover transform or shadow effects

- **Parent Integration**:
  - Delegates to parent component's `onSettingsChange` callback
  - Parent component handles API calls and state persistence
  - Consistent with other tile settings (timeframe, displayOptions, autoRefresh)

### Implementation Checklist

To add pinning to a tile:

1. ✅ Import the hook and button component
2. ✅ Initialize `useTilePinning` hook with initial state and callback
3. ✅ Add `<PinButton />` to tile header
4. ✅ Use `pinnedState` to control:
   - Cursor (pinned = default, unpinned = grab)
   - Drag handler (pinned = undefined, unpinned = onDragStart)
   - Resize handler (pinned = disabled)
   - Hover effects (pinned = disabled)
5. ✅ Add pin indicator icon next to title (optional)

### Completed Tiles

- [x] CryptoTile

### Pending Tiles

- [ ] StockTile
- [ ] NewsTile
- [ ] StockScreenerTile
- [ ] PlaceholderTile

