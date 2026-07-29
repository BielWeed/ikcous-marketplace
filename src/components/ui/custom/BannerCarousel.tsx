import { LazyImage } from "@/components/LazyImage";
import type { Banner } from "@/types";
import useEmblaCarousel from "embla-carousel-react";
import { memo, useCallback, useEffect, useState } from "react";

interface BannerCarouselProps {
  banners: Banner[];
  autoPlay?: boolean;
  interval?: number;
}

export const BannerCarousel = memo(function BannerCarousel({
  banners,
  autoPlay = true,
  interval = 5000,
}: BannerCarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    duration: 30,
    skipSnaps: false,
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

    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);

    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
    };
  }, [emblaApi, onSelect]);

  useEffect(() => {
    if (!autoPlay || !emblaApi || banners.length <= 1) return;

    const timer = setInterval(() => {
      emblaApi.scrollNext();
    }, interval);

    return () => clearInterval(timer);
  }, [autoPlay, emblaApi, interval, banners.length]);

  const validBanners = banners.filter(
    (b) => b.imageUrl && b.imageUrl.trim() !== "",
  );

  if (validBanners.length === 0) return null;

  return (
    <div
      className="premium-shadow relative aspect-[2/1] w-full touch-pan-y overflow-hidden bg-zinc-100 md:aspect-[4/1]"
      style={{ minHeight: "200px" }} // Safety for very small screens
      role="region"
      aria-roledescription="carousel"
      aria-label="Destaques e Promoções"
    >
      {/* Viewport */}
      <div className="h-full overflow-hidden" ref={emblaRef}>
        {/* Container */}
        <div className="flex h-full">
          {validBanners.map((banner, index) => (
            <div
              key={banner.id}
              className="group relative h-full min-w-0 flex-[0_0_100%] cursor-pointer"
              onClick={() =>
                banner.link && (window.location.href = banner.link)
              }
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (banner.link) {
                    window.location.href = banner.link;
                  }
                }
              }}
              aria-label={`${index + 1} de ${validBanners.length}: ${banner.title || ""}`}
            >
              <LazyImage
                src={banner.imageUrl}
                alt={banner.title || ""}
                className="size-full transition-transform [transition-duration:2000ms] [transition-timing-function:cubic-bezier(0.4,0,0.2,1)] group-hover:scale-105"
                priority={index === 0}
              />
              {/* Ultra Premium Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              {/* Content */}
              {banner.title && (
                <div className="absolute inset-x-0 bottom-0 p-8 text-white sm:p-12">
                  <h2 className="mb-3 text-2xl font-black leading-none tracking-tighter drop-shadow-2xl sm:text-4xl">
                    {banner.title.split(" ").map((word, i) => (
                      <span
                        key={i}
                        className={i === 0 ? "text-primary-foreground" : ""}
                      >
                        {word}{" "}
                      </span>
                    ))}
                  </h2>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Indicators - Refined */}
      {validBanners.length > 1 && (
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center justify-center gap-2">
          {validBanners.map((_, index) => (
            <button
              key={index}
              onClick={() => emblaApi?.scrollTo(index)}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                index === currentIndex
                  ? "w-10 bg-white"
                  : "w-2 bg-white/30 hover:bg-white/50"
              }`}
              aria-label={`Ir para slide ${index + 1}`}
              aria-current={index === currentIndex}
            />
          ))}
        </div>
      )}
    </div>
  );
});
