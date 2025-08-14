"use client";

import { ChatInterfaceMUI } from '@/components/chat';
import AppLayout from '@/components/layout/AppLayout';
import AuthWrapper from '@/components/AuthWrapper';

export default function ChatPage() {
  return (
    <AuthWrapper>
      <AppLayout>
        <div style={{ padding: '20px' }}>
          <h1>Chat Page Test</h1>
          <p>If you can see this, the routing is working.</p>
          <ChatInterfaceMUI />
        </div>
      </AppLayout>
    </AuthWrapper>
  );
}