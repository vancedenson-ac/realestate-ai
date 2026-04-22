import { cn } from "@/lib/utils";
import { getStateDisplayName, getStateBadgeClass } from "@/lib/utils";
import type { TransactionState } from "@/types/api";

interface TransactionStateBadgeProps {
  state: TransactionState;
  className?: string;
}

export function TransactionStateBadge({ state, className }: TransactionStateBadgeProps) {
  return (
    <span className={cn(getStateBadgeClass(state), className)}>
      {getStateDisplayName(state)}
    </span>
  );
}
