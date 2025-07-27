import React, { useState, useRef, useEffect } from "react";

interface Message {
  id: string;
  text: string;
  sender: "user" | "bot";
  timestamp: Date;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      text: "Hello! I'm your AI financial assistant powered by Cosine. I can help you with stock analysis, portfolio management, market insights, and more. What would you like to know about the markets today?",
      sender: "bot",
      timestamp: new Date(),
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputMessage,
      sender: "user",
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage("");
    setIsLoading(true);

    try {
      // For local development, connect to local backend server
      const response = await fetch("http://localhost:8000/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: inputMessage }),
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
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: "I'm experiencing some technical difficulties. Please try again later or make sure the local backend server is running.",
        sender: "bot",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div style={{ 
      display: "flex", 
      flexDirection: "column", 
      height: "100vh", 
      maxHeight: "calc(100vh - 3rem)",
      fontFamily: "system-ui, -apple-system, sans-serif"
    }}>
      {/* Chat Header */}
      <div style={{
        borderBottom: "1px solid #e5e7eb",
        backgroundColor: "white",
        padding: "1rem",
        borderTopLeftRadius: "0.5rem",
        borderTopRightRadius: "0.5rem"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "2.5rem",
            height: "2.5rem",
            backgroundColor: "#dbeafe",
            borderRadius: "50%"
          }}>
            🤖
          </div>
          <div>
            <h2 style={{ fontSize: "1.125rem", fontWeight: "600", color: "#111827", margin: 0 }}>
              Cosine AI Assistant (Local)
            </h2>
            <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
              Your Financial Analysis Companion - Development Mode
            </p>
          </div>
        </div>
      </div>

      {/* Chat Messages */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "1rem"
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {messages.map((message) => (
            <div
              key={message.id}
              style={{
                display: "flex",
                justifyContent: message.sender === "user" ? "flex-end" : "flex-start"
              }}
            >
              <div style={{
                display: "flex",
                flexDirection: message.sender === "user" ? "row-reverse" : "row",
                alignItems: "flex-start",
                gap: "0.5rem",
                maxWidth: "70%"
              }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "2rem",
                  height: "2rem",
                  borderRadius: "50%",
                  backgroundColor: message.sender === "user" ? "#2563eb" : "#e5e7eb",
                  color: message.sender === "user" ? "white" : "#374151",
                  flexShrink: 0,
                  marginLeft: message.sender === "user" ? "0.5rem" : 0,
                  marginRight: message.sender === "user" ? 0 : "0.5rem"
                }}>
                  {message.sender === "user" ? "👤" : "🤖"}
                </div>
                <div style={{
                  padding: "0.75rem",
                  borderRadius: "0.5rem",
                  backgroundColor: message.sender === "user" ? "#2563eb" : "white",
                  color: message.sender === "user" ? "white" : "#111827",
                  border: message.sender === "user" ? "none" : "1px solid #e5e7eb",
                  boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)"
                }}>
                  <p style={{ fontSize: "0.875rem", whiteSpace: "pre-wrap", margin: 0 }}>
                    {message.text}
                  </p>
                  <p style={{
                    fontSize: "0.75rem",
                    marginTop: "0.25rem",
                    margin: 0,
                    color: message.sender === "user" ? "#bfdbfe" : "#9ca3af"
                  }}>
                    {message.timestamp.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "2rem",
                  height: "2rem",
                  backgroundColor: "#e5e7eb",
                  borderRadius: "50%"
                }}>
                  🤖
                </div>
                <div style={{
                  padding: "0.75rem",
                  backgroundColor: "white",
                  border: "1px solid #e5e7eb",
                  borderRadius: "0.5rem",
                  boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <div style={{
                      width: "1rem",
                      height: "1rem",
                      border: "2px solid #e5e7eb",
                      borderTop: "2px solid #6b7280",
                      borderRadius: "50%",
                      animation: "spin 1s linear infinite"
                    }} />
                    <p style={{ fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
                      Analyzing...
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Chat Input */}
      <div style={{
        borderTop: "1px solid #e5e7eb",
        backgroundColor: "white",
        padding: "1rem",
        borderBottomLeftRadius: "0.5rem",
        borderBottomRightRadius: "0.5rem"
      }}>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask me about stocks, portfolios, market analysis..."
            disabled={isLoading}
            style={{
              flex: 1,
              padding: "0.5rem 0.75rem",
              border: "1px solid #d1d5db",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
              outline: "none",
              ":focus": {
                borderColor: "#2563eb",
                boxShadow: "0 0 0 3px rgba(37, 99, 235, 0.1)"
              }
            }}
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputMessage.trim() || isLoading}
            style={{
              padding: "0.5rem",
              backgroundColor: !inputMessage.trim() || isLoading ? "#d1d5db" : "#2563eb",
              color: "white",
              border: "none",
              borderRadius: "0.375rem",
              cursor: !inputMessage.trim() || isLoading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "2.5rem",
              height: "2.5rem"
            }}
          >
            {isLoading ? "⏳" : "➤"}
          </button>
        </div>
        <p style={{ 
          fontSize: "0.75rem", 
          color: "#6b7280", 
          marginTop: "0.5rem", 
          margin: "0.5rem 0 0 0" 
        }}>
          Press Enter to send • Shift+Enter for new line • Local Development Mode
        </p>
      </div>

      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
