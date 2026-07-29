import { useEffect, useRef, useState } from "react";

interface LazyImageProps {
  src: string;
  alt: string;
  width?: number | string;
  height?: number | string;
  className?: string;
  placeholderClassName?: string;
  objectFit?: "cover" | "contain" | "fill" | "none" | "scale-down";
  priority?: boolean;
  style?: React.CSSProperties;
}

export function LazyImage({
  src,
  alt,
  width,
  height,
  className = "",
  placeholderClassName = "",
  objectFit = "cover",
  priority = false,
  style: imgStyle,
}: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(priority);
  const [hasError, setHasError] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (priority) {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: "200px",
        threshold: 0.01,
      },
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, [priority]);

  useEffect(() => {
    if (isLoaded || hasError) {
      setShowSkeleton(false);
      return;
    }

    if (isInView) {
      const timer = setTimeout(() => {
        setShowSkeleton(true);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isInView, isLoaded, hasError]);

  const style: React.CSSProperties = {};
  if (width !== undefined) style.width = width;
  if (height !== undefined) style.height = height;

  return (
    <div
      ref={imgRef}
      className={`relative overflow-hidden bg-zinc-100 dark:bg-zinc-900/50 ${className}`}
      style={style}
    >
      {/* Placeholder skeleton */}
      {showSkeleton && !isLoaded && !hasError && (
        <div
          className={`absolute inset-0 animate-pulse bg-zinc-200 dark:bg-zinc-800/50 ${placeholderClassName}`}
        />
      )}

      {/* Error Fallback */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center border border-zinc-100 bg-zinc-50 dark:border-white/5 dark:bg-zinc-900">
          <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
            Erro ao carregar
          </span>
        </div>
      )}

      {/* Actual image - only load when in viewport */}
      {isInView && (
        <img
          src={src}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding={priority ? "sync" : "async"}
          fetchPriority={priority ? "high" : "auto"}
          onLoad={() => setIsLoaded(true)}
          onError={() => {
            setHasError(true);
            setIsLoaded(true); // Stop skeleton
          }}
          className={`size-full transition-opacity duration-300 ease-out ${
            isLoaded && !hasError ? "opacity-100" : "opacity-0"
          }`}
          style={{ objectFit, ...imgStyle }}
        />
      )}
    </div>
  );
}
