"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/auth-context";
import { useChatRooms, useChatMessages, useSendMessage } from "@/hooks/use-chat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { LoadingSpinner } from "@/components/loading-spinner";
import { EmptyState } from "@/components/empty-state";
import { toastError } from "@/lib/toast";
import { formatRelativeTime, truncateId } from "@/lib/utils";
import { MessageSquare, Send, Users, Hash } from "lucide-react";

export default function ChatPage() {
  const { user, isHydrated } = useAuth();
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");

  const { data: rooms, isLoading: loadingRooms, error: roomsError, refetch: refetchRooms } = useChatRooms();
  const { data: messages, isLoading: loadingMessages } = useChatMessages(selectedRoomId || "");
  const sendMessageMutation = useSendMessage(selectedRoomId || "");

  useEffect(() => {
    if (roomsError) toastError(roomsError, "Failed to load conversations");
  }, [roomsError]);

  if (!isHydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const selectedRoom = rooms?.find((r) => r.room_id === selectedRoomId);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !selectedRoomId) return;

    try {
      await sendMessageMutation.mutateAsync({ content: messageInput });
      setMessageInput("");
    } catch (err) {
      toastError(err, "Failed to send message");
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-6">
      {/* Room List */}
      <Card className="w-80 flex-shrink-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Conversations
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingRooms ? (
            <div className="flex h-32 items-center justify-center">
              <LoadingSpinner />
            </div>
          ) : roomsError ? (
            <div className="p-4">
              <Button variant="outline" onClick={() => refetchRooms()}>
                Retry
              </Button>
            </div>
          ) : !rooms || rooms.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon="inbox"
                title="No conversations"
                description="You don't have any chat rooms yet."
              />
            </div>
          ) : (
            <ScrollArea className="h-[calc(100vh-16rem)]">
              {rooms.map((room) => (
                <button
                  key={room.room_id}
                  onClick={() => setSelectedRoomId(room.room_id)}
                  className={`w-full p-4 text-left transition-colors hover:bg-accent ${
                    selectedRoomId === room.room_id ? "bg-accent" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      {room.room_type === "TRANSACTION" ? (
                        <Hash className="h-5 w-5 text-primary" />
                      ) : (
                        <Users className="h-5 w-5 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <p className="font-medium truncate">
                        {room.name || (room.transaction_id ? `Transaction ${truncateId(room.transaction_id)}` : "Chat Room")}
                      </p>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {room.room_type}
                        </Badge>
                        {room.is_archived && (
                          <Badge variant="secondary" className="text-xs">
                            Archived
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Chat Area */}
      <Card className="flex flex-1 flex-col">
        {selectedRoom ? (
          <>
            <CardHeader className="border-b">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>
                    {selectedRoom.name || (selectedRoom.transaction_id ? `Transaction ${truncateId(selectedRoom.transaction_id)}` : "Chat Room")}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {selectedRoom.room_type} chat
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col p-0">
              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                {loadingMessages ? (
                  <div className="flex h-32 items-center justify-center">
                    <LoadingSpinner />
                  </div>
                ) : !messages || messages.length === 0 ? (
                  <EmptyState
                    icon="inbox"
                    title="No messages yet"
                    description="Start the conversation!"
                  />
                ) : (
                  <div className="space-y-4">
                    {messages.map((message) => {
                      const isOwnMessage = message.sender_id === user.user_id;
                      return (
                        <div
                          key={message.message_id}
                          className={`flex gap-3 ${isOwnMessage ? "flex-row-reverse" : ""}`}
                        >
                          <Avatar className="h-8 w-8">
                            <AvatarFallback>
                              {message.sender_id.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div
                            className={`max-w-[70%] rounded-lg p-3 ${
                              isOwnMessage
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted"
                            }`}
                          >
                            {!message.is_deleted ? (
                              <p className="text-sm">{message.content}</p>
                            ) : (
                              <p className="text-sm italic opacity-50">
                                Message deleted
                              </p>
                            )}
                            <p
                              className={`mt-1 text-xs ${
                                isOwnMessage
                                  ? "text-primary-foreground/70"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {formatRelativeTime(message.created_at)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>

              {/* Message Input */}
              <div className="border-t p-4">
                <form onSubmit={handleSendMessage} className="flex gap-2">
                  <Input
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    placeholder="Type a message..."
                    disabled={sendMessageMutation.isPending}
                  />
                  <Button
                    type="submit"
                    disabled={!messageInput.trim() || sendMessageMutation.isPending}
                  >
                    {sendMessageMutation.isPending ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </form>
              </div>
            </CardContent>
          </>
        ) : (
          <CardContent className="flex flex-1 items-center justify-center">
            <EmptyState
              icon="inbox"
              title="Select a conversation"
              description="Choose a chat room from the list to start messaging."
            />
          </CardContent>
        )}
      </Card>
    </div>
  );
}
