import {
  atributosDeImagem,
  comMarcaDeTentativa,
  conjuntoComMarcaDeTentativa,
} from "@/lib/imageUrl";
import { useCallback, useEffect, useRef, useState } from "react";

// Espera (ms) antes de cada nova tentativa AUTOMÁTICA de uma foto que falhou:
// curta e crescente. O tamanho da lista é o teto -- depois dela só o toque da
// cliente tenta de novo.
const ESPERAS_DE_NOVA_TENTATIVA_MS: readonly number[] = [1500, 3000];

// ±20% sobre a espera: numa grade de 30 fotos com a rede morta, todas falham no
// mesmo instante, e sem variação as novas tentativas saíam em rajada sincronizada.
function comVariacao(esperaMs: number): number {
  return Math.round(esperaMs * (0.8 + Math.random() * 0.4));
}

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
  /**
   * Quanto espaço a imagem ocupa no layout (ex.: "100vw", "(min-width: 640px) 260px, 50vw").
   * Informar isto liga o redimensionamento pelo Supabase Storage: sem ele, a
   * imagem continua sendo servida no tamanho original, como era antes.
   */
  sizes?: string;
  /** Qualidade da imagem redimensionada, 20–100. Padrão 75. */
  quality?: number;
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
  sizes,
  quality = 75,
}: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(priority);
  const [hasError, setHasError] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  // Se o endpoint de transformação falhar (plano alterado, arquivo exótico),
  // recai para a URL original em vez de mostrar erro ao cliente.
  const [transformacaoFalhou, setTransformacaoFalhou] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);

  // Rede fraca (3G, sinal oscilando): a falha de verdade não é definitiva na
  // primeira vez. `ciclo` conta os pedidos já refeitos -- serve de `key` do
  // <img> (elemento novo, pedido novo) e de marca na URL (`_r=N`, para não
  // reaproveitar uma falha guardada). `automaticasRef` conta só as tentativas
  // que o próprio componente agendou; o teto é o tamanho da lista, não há laço.
  const [ciclo, setCiclo] = useState(0);
  const automaticasRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const limparTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Foto nova (src diferente): o erro e as tentativas da foto antiga não valem
  // para ela. O ajuste de estado durante a renderização é o jeito que o React
  // recomenda -- num efeito, o aviso de erro velho piscaria por cima da foto nova.
  const [srcVisto, setSrcVisto] = useState(src);
  if (src !== srcVisto) {
    setSrcVisto(src);
    setHasError(false);
    setCiclo(0);
  }
  // Tira o relógio pendente ao trocar de foto e ao sair da tela.
  useEffect(() => {
    automaticasRef.current = 0;
    return limparTimer;
  }, [src, limparTimer]);

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

  // Só redimensiona quando o chamador declarou `sizes` — sem isso o navegador
  // não teria como escolher a variante certa do srcSet.
  const podeRedimensionar = Boolean(sizes) && !transformacaoFalhou;
  const atributos = atributosDeImagem(src, {
    sizes: podeRedimensionar ? sizes : undefined,
    quality,
  });

  // Toque da cliente no aviso de falha: pede de novo na hora e devolve o
  // fôlego das tentativas automáticas. `stopPropagation` porque o aviso mora
  // dentro de cards clicáveis -- tentar de novo não pode abrir o produto.
  // `preventDefault` por precaução: se um dia a foto morar dentro de um <a>,
  // o toque não pode navegar.
  const tentarDeNovo = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    limparTimer();
    automaticasRef.current = 0;
    setHasError(false);
    setIsLoaded(false);
    setTransformacaoFalhou(false);
    setCiclo((c) => c + 1);
  };

  const style: React.CSSProperties = {};
  if (width !== undefined) style.width = width;
  if (height !== undefined) style.height = height;

  return (
    <div
      ref={imgRef}
      // `isolate`: o `z-10` do botão de tentar de novo vale só DENTRO da foto.
      // Sem isto a raiz (relative, z-index auto) não forma camada própria e o
      // botão passava por cima do coração do card e do texto/botão do banner.
      className={`relative isolate overflow-hidden bg-zinc-100 dark:bg-zinc-900/50 ${className}`}
      style={style}
    >
      {/* Placeholder skeleton */}
      {showSkeleton && !isLoaded && !hasError && (
        <div
          className={`absolute inset-0 animate-pulse bg-zinc-200 dark:bg-zinc-800/50 ${placeholderClassName}`}
        />
      )}

      {/* Falha definitiva (as novas tentativas automáticas acabaram): aviso
          discreto, e o toque pede a foto de novo. */}
      {hasError && (
        <button
          type="button"
          aria-label={
            alt
              ? `A foto "${alt}" não carregou. Toque para tentar de novo`
              : "A foto não carregou. Toque para tentar de novo"
          }
          onClick={tentarDeNovo}
          // `z-10` NÃO é enfeite: a <img> logo abaixo fica invisível
          // (opacity-0) mas CONTINUA no lugar, e `opacity` < 1 cria camada
          // própria que, vindo depois no DOM, pintava POR CIMA do botão
          // (z-index auto) e engolia o toque -- o clique caía no card e abria
          // o produto. Medido no Chromium real; jsdom não enxerga empilhamento.
          className="absolute inset-0 z-10 flex items-center justify-center border border-zinc-100 bg-zinc-50 dark:border-white/5 dark:bg-zinc-900"
        >
          <span className="px-2 text-center text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
            Toque para tentar de novo
          </span>
        </button>
      )}

      {/* Actual image - only load when in viewport */}
      {isInView && (
        <img
          key={ciclo}
          src={comMarcaDeTentativa(atributos.src, ciclo)}
          srcSet={conjuntoComMarcaDeTentativa(atributos.srcSet, ciclo)}
          sizes={atributos.sizes}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding={priority ? "sync" : "async"}
          fetchPriority={priority ? "high" : "auto"}
          onLoad={() => setIsLoaded(true)}
          onError={() => {
            // Primeira falha com transformação em uso: tenta a URL original
            // antes de desistir.
            if (atributos.src !== src || atributos.srcSet) {
              setTransformacaoFalhou(true);
              return;
            }
            // Falha de verdade: ainda há nova tentativa automática? Agenda
            // (uma só por vez) e deixa o esqueleto no lugar -- nada de aviso
            // de erro enquanto há esperança.
            const espera = ESPERAS_DE_NOVA_TENTATIVA_MS.at(
              automaticasRef.current,
            );
            if (espera !== undefined) {
              if (timerRef.current) return;
              automaticasRef.current += 1;
              timerRef.current = setTimeout(() => {
                timerRef.current = null;
                // Recomeça pela foto pequena: se a rede estava só oscilando,
                // a original (muito maior) seria o pior pedido no 3G.
                setTransformacaoFalhou(false);
                setCiclo((c) => c + 1);
              }, comVariacao(espera));
              return;
            }
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
