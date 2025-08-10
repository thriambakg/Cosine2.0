"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2, Upload, FileText, Image, X, Settings, LogOut, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";

interface Message {
  id: string;
  text: string;
  sender: "user" | "bot";
  timestamp: Date;
  files?: UploadedFile[];
}

interface UploadedFile {
  name: string;
  type: string;
  size: number;
  content: string;
}

export default function ChatPage() {
  // Authentication
  const { user, logout, isLoading: authLoading } = useAuth();

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      text: "🚀 Welcome to Enhanced Cosine AI!\n\nI'm your advanced financial assistant with enhanced capabilities:\n\n💬 Chat Features:\n• Natural language financial analysis\n• Stock analysis and market insights\n• Portfolio optimization guidance\n\n📁 File Upload Support:\n• CSV files for portfolio analysis\n• Text files for document analysis\n• Images for chart interpretation\n\n🎯 Try asking:\n• \"Analyze Apple stock\"\n• \"Help me understand portfolio risk\"\n• Upload a CSV with your holdings!\n\nYou can also select different AI models for specialized analysis.",
      sender: "bot",
      timestamp: new Date(),
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [selectedModel, setSelectedModel] = useState("claude-3-sonnet");
  const [isDragging, setIsDragging] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Route protection and loading state
  // if (authLoading || !user) {
  //   return (
  //     <div className="min-h-screen flex items-center justify-center">
  //       <div className="text-center">
  //         <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
  //         <p className="mt-2 text-gray-600">Loading chat...</p>
  //       </div>
  //     </div>
  //   );
  // }

  const handleFileUpload = (files: FileList) => {
    Array.from(files).forEach((file) => {
      if (file.size > 10 * 1024 * 1024) {
        // Show error for files over 10MB
        const errorMessage: Message = {
          id: Date.now().toString(),
          text: `File "${file.name}" is too large (max 10MB)`,
          sender: "bot",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        const fileData: UploadedFile = {
          name: file.name,
          type: file.type,
          size: file.size,
          content: result.split(',')[1] || result, // Remove data URL prefix if present
        };
        setUploadedFiles((prev) => [...prev, fileData]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeFile = (fileName: string) => {
    setUploadedFiles((prev) => prev.filter((file) => file.name !== fileName));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() && uploadedFiles.length === 0) return;
    if (isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputMessage || (uploadedFiles.length > 0 ? `📁 Uploaded ${uploadedFiles.length} file(s): ${uploadedFiles.map(f => f.name).join(', ')}` : ""),
      sender: "user",
      timestamp: new Date(),
      files: uploadedFiles.length > 0 ? [...uploadedFiles] : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage("");
    const currentFiles = [...uploadedFiles];
    setUploadedFiles([]);
    setIsLoading(true);

    try {
      const payload = {
        message: inputMessage,
        files: currentFiles,
        model: selectedModel,
        timestamp: new Date().toISOString(),
        type: currentFiles.length > 0 ? 'multimodal' : 'text'
      };

      // TODO: Replace with actual API endpoint to your enhanced backend agent
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("Failed to get response");
      }

      const data = await response.json();
      
      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: data.response || "I'm sorry, I couldn't process that request. Please try again.",
        sender: "bot",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, botMessage]);

      // Show processing info if files were involved
      if (currentFiles.length > 0 && data.processed_files !== undefined) {
        const infoMessage: Message = {
          id: (Date.now() + 2).toString(),
          text: `✅ Processed: ${data.processed_files || 0} files | Model: ${selectedModel} | Status: ${data.agent_status || 'active'}`,
          sender: "bot",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, infoMessage]);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: "I'm experiencing some technical difficulties. Please try again later or make sure the backend server is running.",
        sender: "bot",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-12rem)]">
      {/* Enhanced Chat Header */}
      <div className="border-b bg-gradient-to-r from-blue-600 to-purple-600 text-white p-4 rounded-t-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="flex items-center justify-center w-10 h-10 bg-white/20 rounded-full">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">🤖 Cosine AI Assistant</h2>
              <p className="text-sm text-white/80">Enhanced Financial Analysis Companion</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {/* User Profile */}
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <User className="w-4 h-4 text-white" />
                </div>
                <div className="hidden sm:block">
                  <p className="text-sm font-medium">{user?.firstName} {user?.lastName}</p>
                  <div className="flex items-center space-x-1">
                    <p className="text-xs text-white/80">{user?.subscription?.plan || 'Free'} Plan</p>
                    {user?.mfaEnabled && (
                      <Shield className="w-3 h-3 text-green-300" aria-label="2FA Enabled" />
                    )}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={logout}
                className="text-white hover:bg-white/10 hover:text-white"
              >
                <LogOut className="w-4 h-4 mr-1" />
                Sign Out
              </Button>
            </div>
            
            {/* Model Selection */}
            <div className="flex items-center space-x-2">
              <Settings className="w-4 h-4 text-white/80" />
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger className="w-48 bg-white/10 border-white/20 text-white">
                  <SelectValue placeholder="Select AI Model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-3-sonnet">Claude 3 Sonnet (Balanced)</SelectItem>
                  <SelectItem value="claude-3-haiku">Claude 3 Haiku (Fast)</SelectItem>
                  <SelectItem value="gpt-4">GPT-4 (Advanced)</SelectItem>
                  <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo (Quick)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <div className="px-2 py-1 bg-white/20 rounded text-xs">💬 Chat Ready</div>
          <div className="px-2 py-1 bg-white/20 rounded text-xs">📁 File Upload</div>
          <div className="px-2 py-1 bg-white/20 rounded text-xs">🖼️ Image Support</div>
          <div className="px-2 py-1 bg-white/20 rounded text-xs">🤖 Multi-AI</div>
        </div>
      </div>

      {/* Chat Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
        <div className="space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.sender === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`flex max-w-[70%] ${
                  message.sender === "user" ? "flex-row-reverse" : "flex-row"
                } items-start space-x-2`}
              >
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 ${
                    message.sender === "user"
                      ? "bg-blue-600 ml-2"
                      : "bg-gray-200 mr-2"
                  }`}
                >
                  {message.sender === "user" ? (
                    <User className="w-4 h-4 text-white" />
                  ) : (
                    <Bot className="w-4 h-4 text-gray-600" />
                  )}
                </div>
                <Card
                  className={`p-3 ${
                    message.sender === "user"
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white border-gray-200"
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{message.text}</p>
                  {message.files && message.files.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {message.files.map((file, index) => (
                        <div
                          key={index}
                          className={`flex items-center space-x-2 p-2 rounded ${
                            message.sender === "user"
                              ? "bg-blue-700/50"
                              : "bg-gray-100"
                          }`}
                        >
                          {file.type.startsWith('image/') ? (
                            <Image className="w-4 h-4" />
                          ) : (
                            <FileText className="w-4 h-4" />
                          )}
                          <span className="text-xs truncate">{file.name}</span>
                          <span className="text-xs opacity-70">
                            ({(file.size / 1024).toFixed(1)}KB)
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p
                    className={`text-xs mt-1 ${
                      message.sender === "user"
                        ? "text-blue-100"
                        : "text-gray-400"
                    }`}
                  >
                    {message.timestamp.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </Card>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="flex items-start space-x-2">
                <div className="flex items-center justify-center w-8 h-8 bg-gray-200 rounded-full">
                  <Bot className="w-4 h-4 text-gray-600" />
                </div>
                <Card className="p-3 bg-white border-gray-200">
                  <div className="flex items-center space-x-2">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                    <p className="text-sm text-gray-500">
                      Processing with {selectedModel}...
                      {uploadedFiles.length > 0 && ` (${uploadedFiles.length} files)`}
                    </p>
                  </div>
                </Card>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Enhanced Chat Input */}
      <div className="border-t bg-white p-4 rounded-b-lg">
        {/* File Upload Area */}
        <div
          className={`mb-3 p-3 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors ${
            isDragging
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 hover:border-gray-400"
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2" />
          <p className="text-sm text-gray-600">
            📁 Drop files here or <strong>click to upload</strong>
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Supports: CSV, TXT, JSON, Images (JPG, PNG) • Max 10MB
          </p>
        </div>

        {/* Uploaded Files Display */}
        {uploadedFiles.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {uploadedFiles.map((file, index) => (
              <div
                key={index}
                className="flex items-center space-x-2 bg-gray-100 px-3 py-2 rounded-lg"
              >
                {file.type.startsWith('image/') ? (
                  <Image className="w-4 h-4 text-blue-600" />
                ) : (
                  <FileText className="w-4 h-4 text-blue-600" />
                )}
                <span className="text-sm text-gray-700 truncate max-w-32">
                  {file.name}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(file.name);
                  }}
                  className="text-gray-500 hover:text-red-500"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex space-x-2">
          <textarea
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me about stocks, upload files for analysis, or request market insights..."
            className="flex-1 min-h-[2.5rem] max-h-24 p-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isLoading}
            rows={1}
            style={{ 
              height: 'auto',
              minHeight: '2.5rem'
            }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 96) + 'px';
            }}
          />
          <Button
            onClick={handleSendMessage}
            disabled={(!inputMessage.trim() && uploadedFiles.length === 0) || isLoading}
            size="icon"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Press Enter to send • Shift+Enter for new line • Drop files to upload • Model: {selectedModel}
        </p>

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".csv,.txt,.json,.jpg,.jpeg,.png,.gif"
          onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
          className="hidden"
        />
      </div>
    </div>
  );
}
