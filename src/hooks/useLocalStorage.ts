import { useCallback, useEffect, useRef, useState } from "react";

function lerValorCompativel<T>(item: string | null, initialValue: T): T {
  if (!item) return initialValue;
  const value: unknown = JSON.parse(item);
  // Protege a estrutura sem descartar uniões primitivas como number | "all".
  if (
    (typeof value === "object") !== (typeof initialValue === "object") ||
    (value === null) !== (initialValue === null) ||
    Array.isArray(value) !== Array.isArray(initialValue)
  ) {
    return initialValue;
  }
  return value as T;
}

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  // Use a lazy initializer for state to avoid useEffect-driven cascading renders on mount
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const item = window.localStorage.getItem(key);
      return lerValorCompativel(item, initialValue);
    } catch (error) {
      console.error("Error reading from localStorage:", error);
      return initialValue;
    }
  });

  const isFirstRender = useRef(true);
  // `initialValue` costuma chegar como literal novo a cada render (`[]`, `{}`):
  // nas deps do efeito de sync ele o re-rodaria a cada render. Fica em ref.
  const initialValueRef = useRef(initialValue);
  useEffect(() => {
    initialValueRef.current = initialValue;
  });
  // Último valor conhecido, síncrono: permite gravar FORA do updater do
  // setState (o updater tem de ser puro e roda dentro do render).
  const valorRef = useRef(storedValue);
  useEffect(() => {
    valorRef.current = storedValue;
  }, [storedValue]);

  // Sync with localStorage when key changes
  useEffect(() => {
    // Only run if not the first render to avoid double-init
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    try {
      const item = window.localStorage.getItem(key);
      const newValue = lerValorCompativel(item, initialValueRef.current);

      // Update state only if it actually changed to prevent loops
      // Wrap in setTimeout to move out of the render cycle and suppress lint warnings
      // about cascading renders if this update happens synchronously.
      setTimeout(() => {
        setStoredValue((prev) => {
          if (JSON.stringify(prev) !== JSON.stringify(newValue)) {
            return newValue;
          }
          return prev;
        });
      }, 0);
    } catch (error) {
      console.error("Error syncing with localStorage:", error);
    }
  }, [key]);

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      try {
        const valueToStore =
          value instanceof Function ? value(valorRef.current) : value;
        valorRef.current = valueToStore;
        setStoredValue(valueToStore);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
        }
      } catch (error) {
        console.error("Error saving to localStorage:", error);
      }
    },
    [key],
  );

  return [storedValue, setValue];
}
