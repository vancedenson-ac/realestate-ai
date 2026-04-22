"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { chatApi } from "@/lib/api";
import { STALE_TIME_DYNAMIC, STALE_TIME_DETAIL, STALE_TIME_CHAT } from "@/lib/query-config";
import type { ChatRoomCreate, MessageCreate } from "@/types/api";

export function useChatRooms() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["chat-rooms", user.user_id, user.organization_id],
    queryFn: () => chatApi.listRooms(user),
    enabled: !!user,
    staleTime: STALE_TIME_DYNAMIC,
  });
}

export function useChatRoom(roomId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["chat-room", roomId, user.user_id, user.organization_id],
    queryFn: () => chatApi.getRoom(user, roomId),
    enabled: !!user && !!roomId,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useChatMessages(roomId: string, params?: { cursor?: string; limit?: number }) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["chat-messages", roomId, user.user_id, user.organization_id, params],
    queryFn: () => chatApi.listMessages(user, roomId, params),
    enabled: !!user && !!roomId,
    staleTime: STALE_TIME_CHAT,
    refetchInterval: 5000, // Poll every 5 seconds
  });
}

export function useCreateChatRoom() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ChatRoomCreate) => chatApi.createRoom(user, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-rooms"] });
    },
  });
}

export function useSendMessage(roomId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: MessageCreate) => chatApi.sendMessage(user, roomId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages", roomId] });
    },
  });
}
