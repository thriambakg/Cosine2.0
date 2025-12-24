# File Preview Usage Guide

## Overview

The file preview system allows users to view files and context items stored in the integrated filesystem. When users click on a file or context item, they can preview it in a dialog with an option to download.

## Backend Implementation

### File Return Lambda (`/file-download`)

The Lambda now supports two request types:
- `download`: Returns a presigned URL for downloading (existing functionality)
- `preview`: Returns preview data or presigned URLs for viewing

### Preview Types Supported

1. **Context Items (JSON)**: Returns parsed JSON content with metadata
2. **Images**: Returns presigned URL for inline viewing (`Content-Disposition: inline`)
3. **PDFs**: Returns presigned URL for iframe embedding
4. **Text Files**: Returns file content directly
5. **Other Files**: Returns download-only option with message

## Frontend Implementation

### FilePreviewDialog Component

Located at: `Cosine2.0/frontend/react-app/src/components/common/FilePreviewDialog.tsx`

#### Usage Example

```tsx
import { useState } from 'react';
import FilePreviewDialog from '@/components/common/FilePreviewDialog';
import { useAuth } from '@/contexts/AuthContext';

function MyComponent() {
  const { user } = useAuth();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  const handleItemClick = (item: any) => {
    setSelectedItem(item);
    setPreviewOpen(true);
  };

  return (
    <>
      {/* Your file list/item rendering */}
      <div onClick={() => handleItemClick(item)}>
        {item.name}
      </div>

      {/* Preview Dialog */}
      {selectedItem && (
        <FilePreviewDialog
          open={previewOpen}
          onClose={() => {
            setPreviewOpen(false);
            setSelectedItem(null);
          }}
          item={{
            id: selectedItem.id,
            name: selectedItem.name,
            type: selectedItem.type, // 'context_item' | 'uploaded_file' | 'agent_file'
            s3_key: selectedItem.s3_key,
            metadata: selectedItem.metadata,
          }}
          user_id={user?.id || ''}
        />
      )}
    </>
  );
}
```

### API Usage

```typescript
import { fileReturnAPI } from '@/services/api';

// Preview a file
const response = await fileReturnAPI.previewFile({
  user_id: 'user-id',
  s3_key: 'users/user-id/filesys/folder/file.json',
  item_type: 'context_item',
  request_type: 'preview',
});

if (response.success && response.data) {
  console.log('Preview type:', response.data.preview_type);
  console.log('Preview URL:', response.data.preview_url);
  console.log('Download URL:', response.data.download_url);
}

// Download a file
const downloadResponse = await fileReturnAPI.downloadFile({
  user_id: 'user-id',
  s3_key: 'users/user-id/filesys/folder/file.json',
  filename: 'file.json',
});
```

## Preview Dialog Features

1. **Context Items**: Displays formatted JSON with title, subtitle, and metadata
2. **Images**: Shows image preview with download option
3. **PDFs**: Embeds PDF viewer in iframe
4. **Text Files**: Displays text content in a scrollable code block
5. **Other Files**: Shows file icon with download option

## Security

- All preview requests validate user ownership of files
- Presigned URLs expire after 1 hour
- S3 keys are validated to ensure they belong to the requesting user
- No direct S3 URLs are exposed to the frontend

