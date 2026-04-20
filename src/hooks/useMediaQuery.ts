import { useState, useEffect } from 'react';

export function useMediaQuery(query: string) {
    const [matches, setMatches] = useState(false);

    useEffect(() => {
        if (globalThis.window === undefined) return;

        const mediaQuery = globalThis.window.matchMedia(query);
        setMatches(mediaQuery.matches);
        const handleChange = (e: MediaQueryListEvent | MediaQueryList) => setMatches(e.matches);
        
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, [query]);

    return matches;
}
