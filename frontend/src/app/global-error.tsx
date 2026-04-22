"use client";

import { useEffect } from "react";

/**
 * Catches errors in the root layout. When active, replaces the entire
 * root layout so we must define our own html/body.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error boundary caught:", error.message, error.digest ?? "", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "32rem", margin: "0 auto" }}>
        <h1 style={{ color: "#b91c1c", marginBottom: "0.5rem" }}>Something went wrong</h1>
        <p style={{ color: "#6b7280", marginBottom: "1.5rem" }}>
          A critical error occurred. Please try again or refresh the page.
        </p>
        {process.env.NODE_ENV === "development" && error?.message && (
          <pre style={{ background: "#f3f4f6", padding: "1rem", borderRadius: "0.5rem", fontSize: "0.875rem", overflow: "auto" }}>
            {error.message}
          </pre>
        )}
        <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "0.5rem 1rem",
              background: "#2563eb",
              color: "white",
              border: "none",
              borderRadius: "0.375rem",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            Try again
          </button>
          <a
            href="/"
            style={{
              padding: "0.5rem 1rem",
              border: "1px solid #d1d5db",
              borderRadius: "0.375rem",
              color: "#374151",
              textDecoration: "none",
              fontSize: "0.875rem",
            }}
          >
            Go to dashboard
          </a>
        </div>
      </body>
    </html>
  );
}
