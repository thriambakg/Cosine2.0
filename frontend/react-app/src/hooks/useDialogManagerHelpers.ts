import { useCallback } from 'react';
import { useDialogManager, DialogType } from '../contexts/DialogManagerContext';

export const useDialogManagerHelpers = () => {
  const { openDialog } = useDialogManager();

  const openFilePreview = useCallback((
    item: {
      id: string;
      name: string;
      type: 'context_item' | 'uploaded_file' | 'agent_file';
      s3_key?: string;
      metadata?: any;
      parentId?: string | null;
    },
    user_id: string,
    folder_path?: string
  ) => {
    return openDialog({
      type: 'file_preview',
      title: item.name,
      data: {
        item,
        user_id,
        folder_path: folder_path || '',
      },
    });
  }, [openDialog]);

  const openItemDetails = useCallback((
    itemType: string,
    data: any,
    title?: string,
    options?: {
      folder_path?: string;
      user_id?: string;
      onEnrich?: (enrichedData: any) => void;
      onNavigateToChild?: (childAward: any) => void;
      onNavigateToParent?: (parentAward: any) => void;
      parentAward?: any;
      item_id?: string;
    }
  ) => {
    return openDialog({
      type: 'item_details',
      title: title || 'Item Details',
      data: {
        itemType,
        data,
        title,
        ...options,
      },
    });
  }, [openDialog]);

  return {
    openFilePreview,
    openItemDetails,
  };
};

