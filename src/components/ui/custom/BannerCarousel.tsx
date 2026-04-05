import { useState, useEffect, useCallback } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import type { Banner } from '@/types';

interface BannerCarouselProps {
  banners: Banner[];
  autoPlay?: boolean;
  interval?: number;
}

export function BannerCarousel({ banners, autoPlay = true, interval = 5000 }: BannerCarouselProps) {
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

    // Use requestAnimationFrame to avoid synchronous state updates during render/mount
    const initialSelect = () => requestAnimationFrame(() => onSelect());
    initialSelect();

    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);

    return () => {
      emblaApi.off('select', onSelect);
      emblaApi.off('reInit', onSelect);
    };
  }, [emblaApi, onSelect]);

  useEffect(() => {
    if (!autoPlay || !emblaApi || banners.length <= 1) return;

    const timer = setInterval(() => {
      emblaApi.scrollNext();
    }, interval);

    return () => clearInterval(timer);
  }, [autoPlay, emblaApi, interval, banners.length]);

  const validBanners = banners.filter(b => b.imageUrl && b.imageUrl.trim() !== '');

  if (validBanners.length === 0) return null;

  return (
    <div
      className="relative w-full aspect-[2/1] md:aspect-[4/1] bg-zinc-100 premium-shadow touch-pan-y overflow-hidden"
      style={{ minHeight: '200px' }} // Safety for very small screens
      role="region"
      aria-roledescription="carousel"
      aria-label="Destaques e Promoções"
    >
      {/* Viewport */}
      <div className="overflow-hidden h-full" ref={emblaRef}>
        {/* Container */}
        <div className="flex h-full">
          {validBanners.map((banner, index) => (
            <div
              key={banner.id}
              className="flex-[0_0_100%] min-w-0 relative cursor-pointer group h-full"
              onClick={() => banner.link && (window.location.href = banner.link)}
              role="group"
              aria-roledescription="slide"
              aria-label={`${index + 1} de ${validBanners.length}: ${banner.title || ''}`}
            >
              <img
                src={banner.imageUrl}
                alt={banner.title || ''}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-&lsqb;2000ms&rsqb; cubic-bezier(0.4, 0, 0.2, 1)"
                loading={index === 0 ? "eager" : "lazy"}
                fetchPriority={index === 0 ? "high" : "auto"}
                decoding="async"
              />
              {/* Ultra Premium Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              {/* Content */}
              <div className="absolute bottom-0 left-0 right-0 p-8 sm:p-12 text-white">
                <h2 className="text-2xl sm:text-4xl font-black tracking-tighter leading-none mb-3 drop-shadow-2xl">
                  {(banner.title || '').split(' ').map((word, i) => (
                    <span key={i} className={i === 0 ? 'text-primary-foreground' : ''}>{word} </span>
                  ))}
                </h2>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Indicators - Refined */}
      {banners.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center justify-center gap-2 z-20">
          {banners.map((_, index) => (
            <button
              key={index}
              onClick={() => emblaApi?.scrollTo(index)}
              className={`h-1.5 rounded-full transition-all duration-500 ${index === currentIndex
                ? 'w-10 bg-white'
                : 'w-2 bg-white/30 hover:bg-white/50'
                }`}
              aria-label={`Ir para slide ${index + 1}`}
              aria-current={index === currentIndex}
            />
          ))}
        </div>
      )}
    </div>
  );
}
