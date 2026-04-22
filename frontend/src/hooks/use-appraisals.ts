"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { appraisalsApi } from "@/lib/api";
import type { AppraisalCreate } from "@/types/api";

export function useCreateAppraisal(transactionId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: AppraisalCreate) =>
      appraisalsApi.create(user, transactionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transaction", transactionId] });
    },
  });
}
