import React, { useEffect, useState } from 'react';
import { useDialogManager } from '../../contexts/DialogManagerContext';
import FilePreviewDialog from './FilePreviewDialog';
import ItemDetailsDialog, { ItemType } from './ItemDetailsDialog';

const ManagedDialogRenderer: React.FC = () => {
  const { dialogs, closeDialog, updateDialog } = useDialogManager();
  const [cachedData, setCachedData] = useState<Map<string, any>>(new Map());

  // Load cached data from sessionStorage
  useEffect(() => {
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
  }, [dialogs.map(d => d.id).join(',')]);

  // Save cached data to sessionStorage when dialogs update
  useEffect(() => {
    dialogs.forEach(dialog => {
      if (dialog.cachedContent) {
        try {
          sessionStorage.setItem(`dialog-cache-${dialog.id}`, JSON.stringify(dialog.cachedContent));
        } catch (e) {
          // Ignore
        }
      }
    });
  }, [dialogs]);

  return (
    <>
      {dialogs.map((dialog) => {
        if (dialog.isMinimized) {
          return null; // Don't render minimized dialogs
        }

        const handleClose = () => {
          closeDialog(dialog.id);
        };

        const handleMinimize = () => {
          updateDialog(dialog.id, { isMinimized: true });
        };

        const handleUpdatePosition = (pos: { x: number; y: number }) => {
          updateDialog(dialog.id, { position: pos });
        };

        const handleUpdateSize = (sz: { width: number; height: number }) => {
          updateDialog(dialog.id, { size: sz });
        };

        const handleCacheContent = (content: any) => {
          updateDialog(dialog.id, { cachedContent: content });
        };

        if (dialog.type === 'file_preview') {
          return (
            <FilePreviewDialog
              key={dialog.id}
              open={true}
              onClose={handleClose}
              onMinimize={handleMinimize}
              item={dialog.data.item}
              user_id={dialog.data.user_id}
              folder_path={dialog.data.folder_path}
              dialogId={dialog.id}
              initialPosition={dialog.position}
              initialSize={dialog.size}
              onPositionChange={handleUpdatePosition}
              onSizeChange={handleUpdateSize}
              onCacheContent={handleCacheContent}
              cachedContent={dialog.cachedContent || cachedData.get(dialog.id)}
            />
          );
        } else if (dialog.type === 'item_details') {
          return (
            <ItemDetailsDialog
              key={dialog.id}
              open={true}
              onClose={handleClose}
              onMinimize={handleMinimize}
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
              onPositionChange={handleUpdatePosition}
              onSizeChange={handleUpdateSize}
              onCacheContent={handleCacheContent}
              cachedContent={dialog.cachedContent || cachedData.get(dialog.id)}
            />
          );
        }
        return null;
      })}
    </>
  );
};

export default ManagedDialogRenderer;

