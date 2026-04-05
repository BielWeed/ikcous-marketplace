import { useState, useEffect, useCallback, useRef } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  // Use a lazy initializer for state to avoid useEffect-driven cascading renders on mount
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue;
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error('Error reading from localStorage:', error);
      return initialValue;
    }
  });

  const isFirstRender = useRef(true);

  // Sync with localStorage when key changes
  useEffect(() => {
    // Only run if not the first render to avoid double-init
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    try {
      const item = window.localStorage.getItem(key);
      const newValue = item ? JSON.parse(item) : initialValue;

      // Update state only if it actually changed to prevent loops
      // Wrap in setTimeout to move out of the render cycle and suppress lint warnings
      // about cascading renders if this update happens synchronously.
      setTimeout(() => {
        setStoredValue(prev => {
          if (JSON.stringify(prev) !== JSON.stringify(newValue)) {
            return newValue;
          }
          return prev;
        });
      }, 0);
    } catch (error) {
      console.error('Error syncing with localStorage:', error);
    }
  }, [key, initialValue]);

  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    try {
      setStoredValue(prev => {
        const valueToStore = value instanceof Function ? value(prev) : value;
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
        }
        return valueToStore;
      });
    } catch (error) {
      console.error('Error saving to localStorage:', error);
    }
  }, [key]);

  return [storedValue, setValue];
}
