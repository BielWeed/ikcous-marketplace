import { LazyImage } from "@/components/LazyImage";
import { modeloDoBanner } from "@/lib/banner-modelos";
import { classeDoScrimDoBanner } from "@/lib/banner-scrim";
import { carrosselPodeGirar } from "@/lib/carrossel-visivel";
import { destinoDoBanner } from "@/lib/destino-do-banner";
import { IMAGEM_DO_BANNER } from "@/lib/imagem-do-banner";
import { nomeTemConteudoVisivel } from "@/lib/nome-visivel";
import { rolarAoCatalogo } from "@/lib/rolar-ao-catalogo";
import { cn } from "@/lib/utils";
import type { Banner } from "@/types";
import useEmblaCarousel from "embla-carousel-react";
import {
  type TouchEvent,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { BannerPronto } from "./BannerPronto";

interface BannerCarouselProps {
  banners: Banner[];
  autoPlay?: boolean;
  interval?: number;
  /**
   * A primeira foto entra de uma vez, sem o esmaecer de 300 ms. Só o carrossel
   * do topo da Home liga: é o banner que a cliente espera na primeira visita
   * (o LCP só era marcado no fim do esmaecer). Meio e rodapé seguem esmaecendo.
   */
  primeiraSemFade?: boolean;
}

export const BannerCarousel = memo(function BannerCarousel({
  banners,
  autoPlay = true,
  interval = 5000,
  primeiraSemFade = false,
}: BannerCarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    duration: 30,
    skipSnaps: false,
  });
  const [currentIndex, setCurrentIndex] = useState(0);
  // As fotos do 2º banner em diante só começavam a baixar quando o slide já
  // entrava na tela (a faixa do carrossel corta o que está fora, e o observador
  // do LazyImage não o vê). Elas passam a baixar assim que a PRIMEIRA carrega:
  // antes disso competiriam com ela, e é ela que a cliente espera.
  const [primeiraCarregou, setPrimeiraCarregou] = useState(false);
  const aoCarregarAPrimeira = useCallback(() => setPrimeiraCarregou(true), []);
  // Pausa do autoplay (WCAG 2.2.2 — laudo de acessibilidade 05/09, M7): mouse
  // em cima, foco de teclado dentro do carrossel, ou o sistema pedindo menos
  // movimento. Nenhuma das duas muda o visual — só some o `setInterval`.
  // Dois motivos independentes (revisão do PR #477, rodada 2): mouse e foco
  // cada um com o próprio booleano, para a saída de um não zerar o outro
  // (ex.: mouse sai com o foco ainda dentro não pode destravar o autoplay).
  const [hoverAtivo, setHoverAtivo] = useState(false);
  const [focoAtivo, setFocoAtivo] = useState(false);
  // Terceiro motivo: o dedo em cima do banner (no celular não há mouse nem
  // foco, e o slide avançava no meio do arrasto).
  const [toqueAtivo, setToqueAtivo] = useState(false);
  const ultimoToqueEm = useRef(0);
  const pausado = hoverAtivo || focoAtivo || toqueAtivo;
  const registrarToque = useCallback(() => {
    ultimoToqueEm.current = Date.now();
  }, []);
  const handleTouchStart = useCallback(() => {
    registrarToque();
    setToqueAtivo(true);
  }, [registrarToque]);
  const handleTouchFim = useCallback(
    (evento: TouchEvent<HTMLDivElement>) => {
      registrarToque();
      // Com dois dedos, soltar um deles dispara `touchend` mas o outro segue
      // em cima: só solta a pausa quando não resta nenhum contato.
      setToqueAtivo((evento.touches?.length ?? 0) > 0);
    },
    [registrarToque],
  );
  // O navegador pode perder o `touchend` (troca de app com o dedo na tela):
  // ao ocultar a aba, o toque deixa de valer e a pausa não fica presa.
  useEffect(() => {
    if (!toqueAtivo) return;
    const aoMudarVisibilidade = () => {
      if (document.hidden) setToqueAtivo(false);
    };
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () =>
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
  }, [toqueAtivo]);
  const handleMouseEnter = useCallback(() => {
    // Mouse emulado após toque não tem mouseleave até o próximo toque fora.
    if (Date.now() - ultimoToqueEm.current < 1000) return;
    setHoverAtivo(true);
  }, []);
  const handleFocus = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    // Clique também foca: só o teclado deve manter o carrossel pausado.
    let deTeclado = true;
    try {
      deTeclado = (e.target as Element).matches(":focus-visible");
    } catch {
      // Navegador antigo: preserva a pausa acessível.
    }
    setFocoAtivo(deTeclado);
  }, []);
  const [menosMovimento, setMenosMovimento] = useState(false);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setMenosMovimento(mq.matches);

    const aoMudar = (e: MediaQueryListEvent) => setMenosMovimento(e.matches);

    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", aoMudar);
      return () => mq.removeEventListener("change", aoMudar);
    }
    // Safari antigo não tem addEventListener em MediaQueryList.
    mq.addListener(aoMudar);
    return () => mq.removeListener(aoMudar);
  }, []);

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
    if (
      !autoPlay ||
      pausado ||
      menosMovimento ||
      !emblaApi ||
      banners.length <= 1
    )
      return;

    const timer = setInterval(() => {
      // Home escondida (aba/tela de outra rota) ou aba do navegador oculta: não gira.
      if (!carrosselPodeGirar(emblaApi.rootNode?.())) return;
      emblaApi.scrollNext();
    }, interval);

    return () => clearInterval(timer);
  }, [autoPlay, pausado, menosMovimento, emblaApi, interval, banners.length]);

  // `link` já passou por `destinoDoBanner`: só chega aqui um caminho do app
  // ou um endereço http/https (nunca `javascript:`, `data:`, `//outro-site`).
  const handleNavigation = useCallback((link: string) => {
    if (link.startsWith("/")) {
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

        // `from` (como o card do produto grava) diz à seta Voltar do App que
        // há uma tela atrás: ela recua de verdade (history.back) em vez de
        // empilhar outra Início por cima do destino.
        // Repetir o destino atual não cria uma parada vazia no Voltar.
        if (url.href !== window.location.href) {
          globalThis.history.pushState(
            {
              view: viewName,
              id,
              from: globalThis.history.state?.view ?? "home",
            },
            "",
            link,
          );
          globalThis.dispatchEvent(new PopStateEvent("popstate"));
        }
        // Toque no banner é intenção explícita: rola mesmo se a categoria
        // já for a atual.
        if (searchParams.has("category")) rolarAoCatalogo();
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

  // Banner antigo: `/produtos` (não existe) e categoria com nome cru.
  // Link que o banner não pode abrir dá `null`: ele só aparece, não navega.
  const slides = validBanners.map((banner) => ({
    banner,
    destino: destinoDoBanner(banner.link),
    descricao:
      [banner.title, banner.subtitle, banner.badgeText, banner.buttonText]
        .map((texto) => texto?.trim())
        .find(Boolean) || "Promoção da loja",
  }));

  return (
    <div
      // Caixa 2:1 em toda largura (a arte recomendada pelo painel é 1200x600),
      // sem altura mínima: ela cortava a arte no celular. No computador a
      // largura para em 1040px para o banner não ocupar a primeira tela toda.
      className="premium-shadow relative aspect-[2/1] w-full touch-pan-y overflow-hidden bg-zinc-100 md:mx-auto md:max-w-[1040px]"
      role="region"
      aria-roledescription="carousel"
      aria-label="Destaques e Promoções"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchFim}
      onTouchCancel={handleTouchFim}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHoverAtivo(false)}
      onFocus={handleFocus}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setFocoAtivo(false);
      }}
    >
      {/* Viewport */}
      <div className="h-full overflow-hidden" ref={emblaRef}>
        {/* Container */}
        <div className="flex h-full">
          {slides.map(({ banner, destino, descricao }, index) => (
            <div
              key={banner.id}
              className={cn(
                "group relative h-full min-w-0 flex-[0_0_100%]",
                destino !== null && "cursor-pointer",
              )}
              onClick={
                destino === null ? undefined : () => handleNavigation(destino)
              }
              role={destino === null ? "group" : "button"}
              aria-roledescription={destino === null ? "slide" : undefined}
              tabIndex={destino === null ? undefined : 0}
              onKeyDown={
                destino === null
                  ? undefined
                  : (e) => {
                      // Só o slide em foco abre o destino: Enter/Espaço num
                      // botão de dentro (ex.: "tentar de novo" da foto) é do botão.
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleNavigation(destino);
                      }
                    }
              }
              aria-label={`${index + 1} de ${validBanners.length}: ${descricao}`}
            >
              {modeloDoBanner(banner.templateType) ? (
                <BannerPronto
                  banner={banner}
                  prioridade={primeiraSemFade && index === 0}
                  semFade={primeiraSemFade && index === 0}
                  carregarCedo={index > 0 && primeiraCarregou}
                  aoCarregar={index === 0 ? aoCarregarAPrimeira : undefined}
                  varios={validBanners.length > 1}
                  semDestino={destino === null}
                />
              ) : (
                <>
                  <LazyImage
                    src={banner.imageUrl}
                    alt={descricao}
                    className="size-full transition-transform [transition-duration:2000ms] [transition-timing-function:cubic-bezier(0.4,0,0.2,1)] group-hover:scale-105"
                    priority={primeiraSemFade && index === 0}
                    semFade={primeiraSemFade && index === 0}
                    carregarCedo={index > 0 && primeiraCarregou}
                    aoCarregar={index === 0 ? aoCarregarAPrimeira : undefined}
                    // Banner ocupa a largura toda; era o pior caso (PNG de 1340 kB).
                    sizes={IMAGEM_DO_BANNER.sizes}
                    quality={IMAGEM_DO_BANNER.quality}
                  />
                  {/* Dynamic Custom Overlay & Content */}
                  {(() => {
                    const hasOverlayText =
                      banner.showTextOverlay !== false &&
                      (nomeTemConteudoVisivel(banner.title) ||
                        nomeTemConteudoVisivel(banner.subtitle) ||
                        (destino !== null &&
                          nomeTemConteudoVisivel(banner.buttonText)) ||
                        nomeTemConteudoVisivel(banner.badgeText));

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
                        {classeDoScrimDoBanner(banner.templateType) !== "" && (
                          <div
                            aria-hidden="true"
                            className={cn(
                              "pointer-events-none absolute inset-0",
                              classeDoScrimDoBanner(banner.templateType),
                            )}
                          />
                        )}
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
                            {nomeTemConteudoVisivel(banner.badgeText) && (
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

                            {nomeTemConteudoVisivel(banner.title) && (
                              <h2
                                className={cn(
                                  "text-2xl font-black leading-none tracking-tighter drop-shadow-2xl sm:text-4xl",
                                  banner.fontFamily === "font-serif" &&
                                    "font-serif",
                                  banner.fontFamily === "font-mono" &&
                                    "font-mono",
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

                            {nomeTemConteudoVisivel(banner.subtitle) && (
                              <p
                                className="max-w-full truncate text-xs font-medium text-zinc-300 drop-shadow-md sm:text-sm"
                                style={{
                                  color: banner.subtitleColor || undefined,
                                }}
                              >
                                {banner.subtitle}
                              </p>
                            )}

                            {destino !== null &&
                              nomeTemConteudoVisivel(banner.buttonText) && (
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
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Indicators - Refined */}
      {/* Alvo de toque 44x44 (pacote visual 02/09): o desenho do dot NAO
          mudou - ele virou um <span> dentro de um botao de 44px. A fileira
          usa items-end para o dot continuar EXATAMENTE onde estava (centro a
          19px da base do banner); o alvo de toque cresce para DENTRO do
          banner, sem clipar no overflow-hidden e sem invadir o que vem abaixo. */}
      {validBanners.length > 1 && (
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-end justify-center gap-2">
          {validBanners.map((_, index) => (
            <button
              key={index}
              onClick={() => emblaApi?.scrollTo(index)}
              className="group flex size-11 items-end justify-center"
              aria-label={`Ir para slide ${index + 1}`}
              aria-current={index === currentIndex}
            >
              <span
                className={`h-1.5 rounded-full transition-all duration-500 ${
                  index === currentIndex
                    ? "w-10 bg-white"
                    : "w-2 bg-white/30 group-hover:bg-white/50"
                }`}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
