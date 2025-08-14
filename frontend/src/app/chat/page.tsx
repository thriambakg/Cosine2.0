"use client";

import { ChatInterfaceMUI } from '@/components/chat';
import AppLayout from '@/components/layout/AppLayout';
import AuthWrapper from '@/components/AuthWrapper';

export default function ChatPage() {
  return (
    <AuthWrapper>
      <AppLayout>
        <ChatInterfaceMUI />
      </AppLayout>
    </AuthWrapper>
  );
}