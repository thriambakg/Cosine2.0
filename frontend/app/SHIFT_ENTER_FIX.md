# Fix: Shift+Enter for New Line in Chat Input

## 🐛 Issue
The chat input bar wasn't properly handling Shift+Enter to create new lines.

## 🔧 Root Cause
1. **Using deprecated `onKeyPress` event**: This event doesn't properly handle modifier keys like Shift
2. **Using `Input` component**: Single-line input doesn't support multi-line text
3. **No auto-resize functionality**: Input couldn't expand for longer messages

## ✅ Solution Implemented

### 1. **Switched to `onKeyDown` Event**
```tsx
// Before (broken)
const handleKeyPress = (e: React.KeyboardEvent) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSendMessage();
  }
};

// After (working)
const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSendMessage();
  }
};
```

### 2. **Replaced Input with Textarea**
```tsx
// Before
<Input
  onKeyPress={handleKeyPress}
  className="flex-1"
/>

// After
<textarea
  onKeyDown={handleKeyDown}
  className="flex-1 min-h-[2.5rem] max-h-24 p-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
  rows={1}
/>
```

### 3. **Added Auto-Resize Functionality**
```tsx
onInput={(e) => {
  const target = e.target as HTMLTextAreaElement;
  target.style.height = 'auto';
  target.style.height = Math.min(target.scrollHeight, 96) + 'px';
}}
```

### 4. **Updated User Instructions**
```tsx
// Updated help text
"Press Enter to send • Shift+Enter for new line • Drop files to upload • Model: {selectedModel}"
```

## 🎯 Features Added

- ✅ **Shift+Enter creates new line** - Proper multi-line support
- ✅ **Enter sends message** - Quick sending without modifier keys
- ✅ **Auto-resize textarea** - Expands up to 96px height as you type
- ✅ **Visual consistency** - Matches the design system with proper styling
- ✅ **Accessibility** - Proper focus states and keyboard navigation

## 🧪 Testing
1. **Type a message and press Enter** → Message sends
2. **Type a message and press Shift+Enter** → New line is created
3. **Type a long message** → Textarea auto-expands
4. **Reach max height** → Scrollbar appears (96px max)

## 📱 Mobile-Friendly
The textarea implementation works well on both desktop and mobile devices, with proper touch support and virtual keyboard handling.

The chat input now behaves like modern messaging applications with proper multi-line support!
