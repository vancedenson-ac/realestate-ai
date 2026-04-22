/**
 * Toast notifications for errors, success, and champagne moments.
 * Uses sonner for brief bottom-center toasts; errors use getApiErrorMessage for consistent copy.
 * Champagne moments use a custom top-center toast (dark card, celebratory styling).
 */

import { toast as sonnerToast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { ChampagneToastContent } from "@/components/champagne-toast";
import type { ChampagneMomentOverview } from "@/types/api";

const DEFAULT_ERROR_FALLBACK = "Something went wrong. Please try again.";

/** Show a brief error toast. Use for all API/mutation errors and load failures. */
export function toastError(error: unknown, fallback = DEFAULT_ERROR_FALLBACK): void {
  const message = getApiErrorMessage(error, fallback);
  sonnerToast.error(message, {
    duration: 3000,
    position: "bottom-center",
  });
}

/** Show a brief success toast. */
export function toastSuccess(message: string): void {
  sonnerToast.success(message, {
    duration: 3000,
    position: "bottom-center",
  });
}

/** Show a custom champagne moment toast (dark card, celebratory icon, title + message). Position: top-center. */
export function toastChampagne(moment: ChampagneMomentOverview): void {
  sonnerToast.custom(() => <ChampagneToastContent moment={moment} />, {
    duration: 4000,
    position: "top-center",
  });
}
