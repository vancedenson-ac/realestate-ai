import { LoadingSpinner } from "@/components/loading-spinner";

/**
 * Root loading UI: shown while the root segment (e.g. "/") is loading.
 * Reduces flash of empty content or routing quirks on first load.
 */
export default function RootLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );
}
