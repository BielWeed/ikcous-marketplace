import { LazyImage } from "@/components/LazyImage";
import { cn } from "@/lib/utils";
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

  const handleNavigation = useCallback((link?: string) => {
    if (!link) return;
    if (link.startsWith("/") || !link.includes("://")) {
      try {
        const origin =
          typeof window !== "undefined" ? window.location.origin : "";
        const url = new URL(link, origin);
        const path = url.pathname.slice(1) || "home";
        const viewName = path.startsWith("admin/")
          ? path.replace("admin/", "admin-")
          : path;
        const searchParams = new URLSearchParams(url.search);
        const id = searchParams.get("id") || undefined;

        globalThis.history.pushState({ view: viewName, id }, "", link);
        globalThis.dispatchEvent(new PopStateEvent("popstate"));
      } catch (err) {
        console.error(
          "[BannerCarousel] Navigation failed, using fallback:",
          err,
        );
        window.location.href = link;
      }
    } else {
      window.location.href = link;
    }
  }, []);

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
              onClick={() => handleNavigation(banner.link)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleNavigation(banner.link);
                }
              }}
              aria-label={`${index + 1} de ${validBanners.length}: ${banner.title || ""}`}
            >
              <LazyImage
                src={banner.imageUrl}
                alt={banner.title || ""}
                className="size-full transition-transform [transition-duration:2000ms] [transition-timing-function:cubic-bezier(0.4,0,0.2,1)] group-hover:scale-105"
                priority={index === 0}
                // Banner ocupa a largura toda; era o pior caso (PNG de 1340 kB).
                sizes="100vw"
                quality={70}
              />
              {/* Dynamic Custom Overlay & Content */}
              {(() => {
                const hasOverlayText =
                  banner.showTextOverlay !== false &&
                  ((banner.title && banner.title.trim() !== "") ||
                    (banner.subtitle && banner.subtitle.trim() !== "") ||
                    (banner.buttonText && banner.buttonText.trim() !== "") ||
                    (banner.badgeText && banner.badgeText.trim() !== ""));

                if (!hasOverlayText) return null;

                return (
                  <>
                    <div
                      className="absolute inset-0 transition-opacity"
                      style={{
                        backgroundColor: banner.overlayColor || "#000000",
                        opacity:
                          banner.overlayOpacity !== undefined
                            ? banner.overlayOpacity / 100
                            : 0.4,
                      }}
                    />
                    <div
                      className={cn(
                        "absolute inset-0 flex flex-col p-8 text-white sm:p-12 justify-end select-none",
                        banner.templateType === "split_center" &&
                          "items-center justify-center text-center",
                        banner.templateType === "split_right" &&
                          "items-end justify-end text-right",
                        banner.templateType === "split_left" &&
                          "items-start justify-end text-left",
                        banner.templateType === "glassmorphic" &&
                          "justify-center p-6 text-center",
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-2xl space-y-3 flex flex-col",
                          banner.templateType === "glassmorphic" &&
                            "bg-black/40 backdrop-blur-md border border-white/10 rounded-3xl p-6 sm:p-8 text-center items-center mx-auto",
                        )}
                      >
                        {banner.badgeText && banner.badgeText.trim() !== "" && (
                          <span
                            className={cn(
                              "inline-block rounded-full bg-[#FFBF00] text-black px-3.5 py-1 text-[10px] sm:text-xs font-black uppercase tracking-widest mb-1 w-fit",
                              banner.templateType === "split_right" &&
                                "self-end",
                              banner.templateType === "split_center" &&
                                "mx-auto",
                            )}
                          >
                            {banner.badgeText}
                          </span>
                        )}

                        {banner.title && banner.title.trim() !== "" && (
                          <h2
                            className={cn(
                              "text-2xl font-black leading-none tracking-tighter drop-shadow-2xl sm:text-4xl",
                              banner.fontFamily === "font-serif" &&
                                "font-serif",
                              banner.fontFamily === "font-mono" && "font-mono",
                              banner.fontFamily === "font-display" &&
                                "font-display font-black uppercase",
                              banner.templateType === "neon_glow" &&
                                "text-shadow-[0_0_10px_rgba(255,191,0,0.8)]",
                            )}
                            style={{
                              color: banner.titleColor || undefined,
                              textShadow:
                                banner.templateType === "neon_glow"
                                  ? `0 0 8px ${banner.titleColor || "#FFBF00"}`
                                  : undefined,
                            }}
                          >
                            {banner.title}
                          </h2>
                        )}

                        {banner.subtitle && banner.subtitle.trim() !== "" && (
                          <p
                            className="max-w-full truncate text-xs font-medium text-zinc-300 drop-shadow-md sm:text-sm"
                            style={{ color: banner.subtitleColor || undefined }}
                          >
                            {banner.subtitle}
                          </p>
                        )}

                        {banner.buttonText &&
                          banner.buttonText.trim() !== "" && (
                            <button
                              type="button"
                              className={cn(
                                "mt-2 rounded-xl px-4 py-2 text-xs font-extrabold uppercase tracking-widest transition-transform duration-300 active:scale-95 w-fit shadow-md",
                                banner.templateType === "split_right" &&
                                  "self-end",
                                banner.templateType === "split_center" &&
                                  "mx-auto",
                                banner.templateType === "neon_glow" &&
                                  "animate-pulse",
                              )}
                              style={{
                                backgroundColor:
                                  banner.buttonBgColor || "#FFBF00",
                                color: banner.buttonTextColor || "#000000",
                                boxShadow:
                                  banner.templateType === "neon_glow"
                                    ? `0 0 12px ${banner.buttonBgColor || "#FFBF00"}`
                                    : undefined,
                              }}
                            >
                              {banner.buttonText}
                            </button>
                          )}
                      </div>
                    </div>
                  </>
                );
              })()}
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
