import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useSafeDialogManager } from '../../hooks/useSafeDialogManager';
import ItemDetailsDialog, { ItemType } from './ItemDetailsDialog';

interface DemoDialogRendererProps {
  /** Container element to render dialogs inside (e.g. demo section); dialogs stay constrained when page scrolls */
  containerRef: React.RefObject<HTMLElement | null>;
}

/**
 * Renders item_details dialogs that have constrainToDemo: true (opened from demo tiles).
 * Dialogs are portaled into the container so they stay within the demo area when scrolling.
 * Closable only (no minimize).
 */
const DemoDialogRenderer: React.FC<DemoDialogRendererProps> = ({ containerRef }) => {
  const dialogManager = useSafeDialogManager();
  const [cachedData, setCachedData] = useState<Map<string, any>>(new Map());

  if (!dialogManager) return null;

  const { dialogs, closeDialog, updateDialog } = dialogManager;
  const demoDialogs = useMemo(
    () => dialogs.filter((d) => d.type === 'item_details' && d.data?.constrainToDemo === true),
    [dialogs]
  );

  const dialogIds = useMemo(() => demoDialogs.map((d) => d.id).join(','), [demoDialogs]);
  useEffect(() => {
    const loadCache = () => {
      const cache = new Map<string, any>();
      demoDialogs.forEach((dialog) => {
        try {
          const cached = sessionStorage.getItem(`dialog-cache-${dialog.id}`);
          if (cached) cache.set(dialog.id, JSON.parse(cached));
        } catch {
          // ignore
        }
      });
      setCachedData(cache);
    };
    if ('requestIdleCallback' in window) {
      requestIdleCallback(loadCache, { timeout: 500 });
    } else {
      setTimeout(loadCache, 0);
    }
  }, [dialogIds, demoDialogs]);

  const handlersRef = useRef<Map<string, { handleClose: () => void; handleCacheContent: (content: any) => void }>>(new Map());
  demoDialogs.forEach((dialog) => {
    if (!handlersRef.current.has(dialog.id)) {
      handlersRef.current.set(dialog.id, {
        handleClose: () => closeDialog(dialog.id),
        handleCacheContent: (content: any) => updateDialog(dialog.id, { cachedContent: content }),
      });
    }
  });
  useEffect(() => {
    const ids = new Set(demoDialogs.map((d) => d.id));
    handlersRef.current.forEach((_, id) => {
      if (!ids.has(id)) handlersRef.current.delete(id);
    });
  }, [demoDialogs]);

  const containerEl = containerRef.current;
  if (demoDialogs.length === 0 || !containerEl) return null;

  return (
    <>
      {demoDialogs.map((dialog) => {
        if (dialog.isMinimized || !dialog.data?.itemType || !dialog.data?.data) return null;
        const handlers = handlersRef.current.get(dialog.id);
        if (!handlers) return null;
        return (
          <ItemDetailsDialog
            key={dialog.id}
            open={true}
            onClose={handlers.handleClose}
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
            onCacheContent={handlers.handleCacheContent}
            cachedContent={dialog.cachedContent ?? cachedData.get(dialog.id)}
            zIndex={dialog.zIndex ?? 1000}
            disableMinimize
            containerElement={containerEl}
            useDemoData
          />
        );
      })}
    </>
  );
};

export default DemoDialogRenderer;
