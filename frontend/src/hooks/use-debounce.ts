"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * Returns a debounced value that updates after `delayMs` of no changes.
 * Use for search inputs so API calls (or heavy filters) run only after the user pauses typing.
 * The input stays responsive (controlled by immediate value); only the debounced value is delayed.
 */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}

/**
 * Returns a stable callback that invokes the given function after `delayMs` of no calls.
 * Use for debouncing event handlers (e.g. onBoundsChange) when you don't need the debounced value in state.
 */
export function useDebouncedCallback<T extends (...args: unknown[]) => void>(
  fn: T,
  delayMs: number,
): T {
  const timeoutRef = { current: null as ReturnType<typeof setTimeout> | null };
  const fnRef = { current: fn };
  fnRef.current = fn;

  const debounced = useCallback(
    ((...args: Parameters<T>) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        fnRef.current(...args);
      }, delayMs);
    }) as T,
    [delayMs],
  );

  return debounced;
}
