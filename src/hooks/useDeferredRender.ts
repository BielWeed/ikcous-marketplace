import { useState, useEffect } from 'react';

export function useDeferredRender(delayMs = 250) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsReady(true);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  return isReady;
}
