import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSafeDialogManager } from '../../hooks/useSafeDialogManager';
import FilePreviewDialog from './FilePreviewDialog';
import ItemDetailsDialog, { ItemType } from './ItemDetailsDialog';

const ManagedDialogRenderer: React.FC = () => {
  const dialogManager = useSafeDialogManager();
  
  // Early return if dialog manager is not available
  if (!dialogManager) {
    return null;
  }
  
  const { dialogs, closeDialog, updateDialog, bringToFront } = dialogManager;
  const [cachedData, setCachedData] = useState<Map<string, any>>(new Map());
  const cacheContentRefs = useRef<Map<string, string>>(new Map()); // Track cached content strings to prevent infinite loops
  
  // Debounce bringToFront to avoid excessive updates
  const bringToFrontRef = useRef<Map<string, number>>(new Map());
  const debouncedBringToFront = useCallback((id: string) => {
    const now = Date.now();
    const lastCall = bringToFrontRef.current.get(id) || 0;
    // Only call if it's been more than 100ms since last call
    if (now - lastCall > 100) {
      bringToFrontRef.current.set(id, now);
      bringToFront(id);
    }
  }, [bringToFront]);

  // Load cached data from sessionStorage - only when dialog IDs change, non-blocking
  const dialogIds = useMemo(() => dialogs.map(d => d.id).join(','), [dialogs.map(d => d.id).join(',')]);
  useEffect(() => {
    // Load cache asynchronously to avoid blocking
    const loadCache = () => {
      const cache = new Map<string, any>();
      dialogs.forEach(dialog => {
        try {
          const cached = sessionStorage.getItem(`dialog-cache-${dialog.id}`);
          if (cached) {
            cache.set(dialog.id, JSON.parse(cached));
          }
        } catch (e) {
          // Ignore
        }
      });
      setCachedData(cache);
    };

    if ('requestIdleCallback' in window) {
      requestIdleCallback(loadCache, { timeout: 500 });
    } else {
      setTimeout(loadCache, 0);
    }
  }, [dialogIds]);

  // Save cached data to sessionStorage when dialogs update - debounced and non-blocking
  const saveCacheTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dialogsRef = useRef(dialogs);
  dialogsRef.current = dialogs; // Keep ref in sync

  useEffect(() => {
    if (saveCacheTimeoutRef.current) {
      clearTimeout(saveCacheTimeoutRef.current);
    }
    
    // Debounce sessionStorage writes and make them non-blocking
    saveCacheTimeoutRef.current = setTimeout(() => {
      const saveCache = () => {
        dialogsRef.current.forEach(dialog => {
          if (dialog.cachedContent) {
            try {
              sessionStorage.setItem(`dialog-cache-${dialog.id}`, JSON.stringify(dialog.cachedContent));
            } catch (e) {
              // Ignore
            }
          }
        });
      };

      // Use requestIdleCallback if available for non-blocking writes
      if ('requestIdleCallback' in window) {
        requestIdleCallback(saveCache, { timeout: 1000 });
      } else {
        setTimeout(saveCache, 0);
      }
    }, 500); // Wait 500ms before writing
    
    return () => {
      if (saveCacheTimeoutRef.current) {
        clearTimeout(saveCacheTimeoutRef.current);
      }
    };
  }, [dialogs]);

  // Memoize handlers to prevent recreation on every render
  const handlersRef = useRef<Map<string, {
    handleClose: () => void;
    handleMinimize: () => void;
    handleUpdatePosition: (pos: { x: number; y: number }) => void;
    handleUpdateSize: (sz: { width: number; height: number }) => void;
    handleCacheContent: (content: any) => void;
    handleBringToFront: () => void;
  }>>(new Map());

  // Create or update handlers for each dialog
  dialogs.forEach(dialog => {
    if (!handlersRef.current.has(dialog.id)) {
      handlersRef.current.set(dialog.id, {
        handleClose: () => closeDialog(dialog.id),
        handleMinimize: () => updateDialog(dialog.id, { isMinimized: true }),
        handleUpdatePosition: (pos: { x: number; y: number }) => updateDialog(dialog.id, { position: pos }),
        handleUpdateSize: (sz: { width: number; height: number }) => updateDialog(dialog.id, { size: sz }),
        handleCacheContent: (content: any) => {
          const contentString = JSON.stringify(content);
          const previousContent = cacheContentRefs.current.get(dialog.id);
          if (previousContent !== contentString) {
            cacheContentRefs.current.set(dialog.id, contentString);
            updateDialog(dialog.id, { cachedContent: content });
          }
        },
        handleBringToFront: () => debouncedBringToFront(dialog.id),
      });
    }
  });

  // Clean up handlers for removed dialogs
  const dialogIdsSet = useMemo(() => new Set(dialogs.map(d => d.id)), [dialogs.map(d => d.id).join(',')]);
  useEffect(() => {
    handlersRef.current.forEach((_, id) => {
      if (!dialogIdsSet.has(id)) {
        handlersRef.current.delete(id);
      }
    });
  }, [dialogIdsSet]);

  return (
    <>
      {dialogs.map((dialog) => {
        if (dialog.isMinimized) {
          return null; // Don't render minimized dialogs
        }

        // Skip dialogs constrained to demo (rendered by DemoDialogRenderer inside demo section)
        if (dialog.data?.constrainToDemo) {
          return null;
        }

        // Skip dialogs with invalid or missing data structure
        if (!dialog.data) {
          console.warn(`Dialog ${dialog.id} has no data, skipping render`);
          return null;
        }

        const handlers = handlersRef.current.get(dialog.id);
        if (!handlers) return null;

        if (dialog.type === 'file_preview') {
          // Validate file_preview data structure
          if (!dialog.data.item || !dialog.data.user_id) {
            console.warn(`Dialog ${dialog.id} has invalid file_preview data, skipping render`);
            return null;
          }
          return (
            <FilePreviewDialog
              key={dialog.id}
              open={true}
              onClose={handlers.handleClose}
              onMinimize={handlers.handleMinimize}
              item={dialog.data.item}
              user_id={dialog.data.user_id}
              folder_path={dialog.data.folder_path}
              dialogId={dialog.id}
              initialPosition={dialog.position}
              initialSize={dialog.size}
              onPositionChange={handlers.handleUpdatePosition}
              onSizeChange={handlers.handleUpdateSize}
              onCacheContent={handlers.handleCacheContent}
              cachedContent={dialog.cachedContent || cachedData.get(dialog.id)}
              zIndex={dialog.zIndex || 1000}
              onBringToFront={handlers.handleBringToFront}
            />
          );
        } else if (dialog.type === 'item_details') {
          // Validate item_details data structure
          if (!dialog.data.itemType || !dialog.data.data) {
            console.warn(`Dialog ${dialog.id} has invalid item_details data, skipping render`);
            return null;
          }
          
          return (
            <ItemDetailsDialog
              key={dialog.id}
              open={true}
              onClose={handlers.handleClose}
              onMinimize={handlers.handleMinimize}
              itemType={dialog.data.itemType as ItemType}
              data={dialog.data.data}
              title={dialog.data.title || dialog.title}
              folder_path={dialog.data.folder_path}
              user_id={dialog.data.user_id}
              onEnrich={dialog.data.onEnrich}
              onNavigateToChild={dialog.data.onNavigateToChild}
              onNavigateToParent={dialog.data.onNavigateToParent}
              parentAward={dialog.data.parentAward}
              item_id={dialog.data.item_id}
              dialogId={dialog.id}
              initialPosition={dialog.position}
              initialSize={dialog.size}
              onPositionChange={handlers.handleUpdatePosition}
              onSizeChange={handlers.handleUpdateSize}
              onCacheContent={handlers.handleCacheContent}
              cachedContent={dialog.cachedContent || cachedData.get(dialog.id)}
              zIndex={dialog.zIndex || 1000}
              onBringToFront={handlers.handleBringToFront}
            />
          );
        }
        return null;
      })}
    </>
  );
};

export default ManagedDialogRenderer;

