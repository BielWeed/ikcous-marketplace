import { useState, useRef, useEffect } from 'react';

interface LazyImageProps {
    src: string;
    alt: string;
    width?: number | string;
    height?: number | string;
    className?: string;
    placeholderClassName?: string;
    objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
}

export function LazyImage({
    src,
    alt,
    width = '100%',
    height = 'auto',
    className = '',
    placeholderClassName = '',
    objectFit = 'cover',
}: LazyImageProps) {
    const [isLoaded, setIsLoaded] = useState(false);
    const [isInView, setIsInView] = useState(false);
    const [hasError, setHasError] = useState(false);
    const imgRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsInView(true);
                    observer.disconnect();
                }
            },
            {
                rootMargin: '100px', // Slightly larger margin for smoother experience
                threshold: 0.01,
            }
        );

        if (imgRef.current) {
            observer.observe(imgRef.current);
        }

        return () => observer.disconnect();
    }, []);

    return (
        <div
            ref={imgRef}
            className={`relative overflow-hidden bg-zinc-100 ${className}`}
            style={{ width, height }}
        >
            {/* Placeholder skeleton */}
            {!isLoaded && !hasError && (
                <div
                    className={`absolute inset-0 bg-zinc-200 animate-pulse ${placeholderClassName}`}
                />
            )}

            {/* Error Fallback */}
            {hasError && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-50 border border-zinc-100">
                    <span className="text-[10px] text-zinc-400 font-medium">Erro ao carregar</span>
                </div>
            )}

            {/* Actual image - only load when in viewport */}
            {isInView && (
                <img
                    src={src}
                    alt={alt}
                    loading="lazy"
                    onLoad={() => setIsLoaded(true)}
                    onError={() => {
                        setHasError(true);
                        setIsLoaded(true); // Stop skeleton
                    }}
                    className={`w-full h-full transition-opacity duration-300 ${isLoaded && !hasError ? 'opacity-100' : 'opacity-0'
                        }`}
                    style={{ objectFit }}
                />
            )}
        </div>
    );
}
