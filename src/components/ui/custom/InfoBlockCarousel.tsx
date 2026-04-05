import { useState, useEffect, useCallback, type ReactNode, Children } from 'react';
import useEmblaCarousel from 'embla-carousel-react';

interface InfoBlockCarouselProps {
    children: ReactNode;
    autoPlay?: boolean;
    interval?: number;
}

export function InfoBlockCarousel({ children, autoPlay = true, interval = 6000 }: InfoBlockCarouselProps) {
    const childrenArray = Children.toArray(children);
    const [emblaRef, emblaApi] = useEmblaCarousel({
        loop: true,
        duration: 30,
        skipSnaps: false
    });
    const [currentIndex, setCurrentIndex] = useState(0);

    const onSelect = useCallback(() => {
        if (!emblaApi) return;
        setCurrentIndex(emblaApi.selectedScrollSnap());
    }, [emblaApi]);

    useEffect(() => {
        if (!emblaApi) return;
        onSelect();
        emblaApi.on('select', onSelect);
        emblaApi.on('reInit', onSelect);
        return () => {
            emblaApi.off('select', onSelect);
            emblaApi.off('reInit', onSelect);
        };
    }, [emblaApi, onSelect]);

    useEffect(() => {
        if (!autoPlay || !emblaApi || childrenArray.length <= 1) return;
        const timer = setInterval(() => {
            emblaApi.scrollNext();
        }, interval);
        return () => clearInterval(timer);
    }, [autoPlay, emblaApi, interval, childrenArray.length]);

    return (
        <div className="relative w-full px-4 mt-2">
            <div className="overflow-hidden rounded-[2rem]" ref={emblaRef}>
                <div className="flex">
                    {childrenArray.map((child, index) => (
                        <div key={index} className="flex-[0_0_100%] min-w-0">
                            {child}
                        </div>
                    ))}
                </div>
            </div>

            {/* Indicators */}
            {childrenArray.length > 1 && (
                <div className="flex justify-center gap-1.5 mt-3">
                    {childrenArray.map((_, index) => (
                        <button
                            key={index}
                            onClick={() => emblaApi?.scrollTo(index)}
                            className={`h-1 rounded-full transition-all duration-500 ${index === currentIndex ? 'w-6 bg-emerald-500' : 'w-1.5 bg-zinc-800 hover:bg-zinc-700'
                                }`}
                            aria-label={`Go to slide ${index + 1}`}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
