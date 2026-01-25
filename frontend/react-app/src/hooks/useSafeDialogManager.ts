import { useContext } from 'react';
import { DialogManagerContext } from '../contexts/DialogManagerContext';

/**
 * Safely gets the dialog manager, returning undefined if not available
 * This allows components to work both inside and outside the DialogManagerProvider
 */
export const useSafeDialogManager = () => {
  try {
    return useContext(DialogManagerContext);
  } catch {
    return undefined;
  }
};















