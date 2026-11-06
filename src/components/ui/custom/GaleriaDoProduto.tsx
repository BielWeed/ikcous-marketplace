import { useTelaDeComputador } from "@/hooks/useTelaDeComputador";
import { isViewTransitionSupported } from "@/hooks/useViewTransition";
import {
  comMarcaDeTentativa,
  conjuntoComMarcaDeTentativa,
  conjuntoDeImagens,
  imagemRedimensionada,
  usarImagemOriginal,
} from "@/lib/imageUrl";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// Mesma sequência do LazyImage (vitrine): espera (ms) antes de cada nova
// tentativa AUTOMÁTICA de uma foto que falhou. O tamanho da lista é o teto --
// depois dela só o toque da cliente tenta de novo.
const ESPERAS_DE_NOVA_TENTATIVA_MS: readonly number[] = [1500, 3000];

// ±20% sobre a espera, para fotos que falham juntas não tentarem em rajada.
function comVariacao(esperaMs: number): number {
  return Math.round(esperaMs * (0.8 + Math.random() * 0.4));
}

/**
 * Foto que falha numa rede fraca não é definitiva na primeira vez. `ciclo`
 * conta os pedidos já refeitos: serve de `key` da <img> (elemento novo, pedido
 * novo) e de marca na URL (`_r=N`, para não reaproveitar uma falha guardada).
 * A original tentada pelo `usarImagemOriginal` (transformação fora do ar) vem
 * ANTES; só a falha da original gasta uma tentativa automática.
 */
function useFotoQueTentaDeNovo(foto: string) {
  const [ciclo, setCiclo] = useState(0);
  const [desistiu, setDesistiu] = useState(false);
  const automaticasRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const limparTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  useEffect(() => limparTimer, [limparTimer]);

  const aoFalhar = (imagem: HTMLImageElement) => {
    if (usarImagemOriginal(imagem, comMarcaDeTentativa(foto, ciclo))) return;
    const espera = ESPERAS_DE_NOVA_TENTATIVA_MS.at(automaticasRef.current);
    if (espera === undefined) {
      setDesistiu(true);
      return;
    }
    if (timerRef.current) return;
    automaticasRef.current += 1;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setCiclo((c) => c + 1);
    }, comVariacao(espera));
  };

  // Toque da cliente no aviso: pede de novo na hora e devolve o fôlego das
  // tentativas automáticas.
  const tentarDeNovo = () => {
    limparTimer();
    automaticasRef.current = 0;
    setDesistiu(false);
    setCiclo((c) => c + 1);
  };

  return { ciclo, desistiu, aoFalhar, tentarDeNovo };
}

interface FotoDaFaixaProps {
  foto: string;
  nome: string;
  posicao: number;
  /** Só a primeira foto, quando a transição de vista está ligada. */
  comTransicao: boolean;
}

/** A foto grande de uma posição da faixa, com nova tentativa e aviso. */
function FotoDaFaixa({ foto, nome, posicao, comTransicao }: FotoDaFaixaProps) {
  const { ciclo, desistiu, aoFalhar, tentarDeNovo } =
    useFotoQueTentaDeNovo(foto);
  return (
    <>
      {!desistiu && (
        <img
          key={ciclo}
          src={comMarcaDeTentativa(
            imagemRedimensionada(foto, { width: 960, quality: 80 }),
            ciclo,
          )}
          srcSet={conjuntoComMarcaDeTentativa(
            conjuntoDeImagens(foto, [480, 640, 960, 1280], 80) || undefined,
            ciclo,
          )}
          // Ocupa a largura toda no celular; a partir do desktop fica limitada pela altura.
          sizes="(min-width: 1024px) 720px, 100vw"
          alt={nome}
          draggable={false}
          onError={(event) => aoFalhar(event.currentTarget)}
          className="main-product-image h-full w-auto max-w-full select-none object-contain"
          // Só a primeira foto é pedida já; as outras esperam a faixa
          // chegar perto delas.
          loading={posicao === 0 ? "eager" : "lazy"}
          fetchPriority={posicao === 0 ? "high" : "auto"}
          decoding="async"
          style={
            (comTransicao
              ? { viewTransitionName: "product-image" }
              : undefined) as CSSProperties
          }
        />
      )}
      {/* Falha definitiva (as novas tentativas automáticas acabaram): aviso
          discreto, e o toque pede a foto de novo. `z-10` e `stopPropagation`
          como no LazyImage: o toque não pode cair na foto nem subir. */}
      {desistiu && (
        <button
          type="button"
          aria-label={`A foto de ${nome} não carregou. Toque para tentar de novo`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            tentarDeNovo();
          }}
          className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-50"
        >
          <span className="px-2 text-center text-xs font-medium text-zinc-600">
            Toque para tentar de novo
          </span>
        </button>
      )}
    </>
  );
}

/** A miniatura do computador: tenta de novo sozinha (o aviso fica na foto grande). */
function Miniatura({ foto }: { foto: string }) {
  const { ciclo, aoFalhar } = useFotoQueTentaDeNovo(foto);
  return (
    <img
      key={ciclo}
      src={comMarcaDeTentativa(
        imagemRedimensionada(foto, { width: 200, quality: 80 }),
        ciclo,
      )}
      alt=""
      onError={(event) => aoFalhar(event.currentTarget)}
      loading="lazy"
      decoding="async"
      className="lg:size-full lg:object-contain"
    />
  );
}

interface GaleriaDoProdutoProps {
  /** Todas as fotos da galeria, na ordem em que a cliente as percorre. */
  fotos: string[];
  nome: string;
  /** Foto em primeiro plano (0 = a primeira). */
  indice: number;
  onMudarIndice: (indice: number) => void;
  /** Botões que flutuam sobre a foto (favoritar, compartilhar). */
  acoes?: ReactNode;
}

const sombraDoBotao =
  "pointer-events-auto relative flex size-8 items-center justify-center rounded-full bg-white/80 shadow-premium backdrop-blur-md transition-all after:absolute after:-inset-1.5 after:content-[''] hover:bg-white active:scale-95";

/**
 * Galeria de fotos da página do produto.
 *
 * As fotos ficam lado a lado numa faixa que rola na horizontal com ENCAIXE
 * (CSS scroll-snap): no celular a cliente passa as fotos com o dedo, e quem
 * resolve o gesto, a inércia e o encaixe é o próprio navegador -- sem
 * biblioteca e sem tratar toque na mão. Setas e bolinhas (e miniaturas, no
 * computador) continuam existindo e andam a faixa até a foto pedida.
 *
 * A foto em primeiro plano é a que está encaixada na faixa; `indice` e a
 * posição de rolagem se mantêm iguais nos dois sentidos (ver `destinoRef`).
 */
export function GaleriaDoProduto({
  fotos,
  nome,
  indice,
  onMudarIndice,
  acoes,
}: GaleriaDoProdutoProps) {
  const computador = useTelaDeComputador();
  const faixaRef = useRef<HTMLDivElement>(null);
  // Foto que uma rolagem INICIADA POR NÓS (seta, bolinha, miniatura, escolha
  // de variação) ainda está alcançando. Enquanto existe, os eventos de
  // rolagem do caminho são ignorados -- sem isso a bolinha ativa piscaria
  // por todas as fotos do meio e o efeito de baixo refaria o pedido.
  const destinoRef = useRef<number | null>(null);
  const total = fotos.length;

  // `indice` mudou por fora (seta, bolinha, miniatura, variação): leva a
  // faixa até lá. Se a faixa já está ali (o gesto da cliente foi quem mudou
  // o índice), não faz nada. Com um destino NOSSO ainda pendente a faixa pode
  // "estar" na foto pedida só porque o deslize anterior mal começou (Próxima e
  // logo Anterior): aí o pedido novo segue e cancela o antigo.
  useEffect(() => {
    const faixa = faixaRef.current;
    if (!faixa || faixa.clientWidth === 0) return;
    const atual = Math.round(faixa.scrollLeft / faixa.clientWidth);
    if (atual === indice && destinoRef.current === null) return;
    destinoRef.current = indice;
    const semMovimento = globalThis.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
    faixa.scrollTo?.({
      left: indice * faixa.clientWidth,
      behavior: semMovimento ? "auto" : "smooth",
    });
  }, [indice]);

  // O navegador avisa quando a rolagem assenta: libera o filtro acima mesmo
  // que a rolagem tenha parado antes do destino (ex.: foto removida).
  useEffect(() => {
    const faixa = faixaRef.current;
    if (!faixa) return;
    const assentou = () => {
      destinoRef.current = null;
    };
    faixa.addEventListener("scrollend", assentou);
    return () => faixa.removeEventListener("scrollend", assentou);
  }, []);

  const aoRolar = () => {
    const faixa = faixaRef.current;
    if (!faixa || faixa.clientWidth === 0) return;
    const atual = Math.round(faixa.scrollLeft / faixa.clientWidth);
    if (destinoRef.current !== null) {
      if (atual === destinoRef.current) destinoRef.current = null;
      return;
    }
    if (atual !== indice && atual >= 0 && atual < total) onMudarIndice(atual);
  };

  // A cliente pegou a faixa (dedo, roda do mouse, teclado): o gesto dela
  // manda, qualquer destino pendente nosso deixa de valer.
  const gestoDaCliente = () => {
    destinoRef.current = null;
  };

  const proxima = () => onMudarIndice((indice + 1) % total);
  const anterior = () => onMudarIndice((indice - 1 + total) % total);
  const varias = total > 1;

  return (
    <>
      <div
        className={cn(
          "group relative aspect-[4/3] overflow-hidden rounded-b-[2rem] bg-[#F8F9FA] sm:aspect-[4/3]",
          "lg:aspect-square lg:max-h-[calc(100dvh-var(--header-height)-220px)] lg:rounded-3xl",
          // Ring sutil de definição: a caixa #F8F9FA sobre página branca
          // "sumia" no desktop (achado da prévia de 29/09) -- o traço
          // quase invisível separa a galeria do fundo sem virar cartão.
          "lg:ring-1 lg:ring-zinc-950/5",
        )}
      >
        <div
          ref={faixaRef}
          // tabIndex: a faixa é rolável -- sem foco, o teclado não a alcança.
          tabIndex={varias ? 0 : undefined}
          role={varias ? "region" : undefined}
          aria-roledescription={varias ? "carrossel" : undefined}
          aria-label={varias ? `Fotos de ${nome}` : undefined}
          onScroll={aoRolar}
          onPointerDown={gestoDaCliente}
          onWheel={gestoDaCliente}
          onKeyDown={gestoDaCliente}
          className={cn(
            "scrollbar-hide relative flex size-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
          )}
        >
          {fotos.map((foto, posicao) => (
            <div
              key={`${foto}-${posicao}`}
              role={varias ? "group" : undefined}
              aria-roledescription={varias ? "foto" : undefined}
              aria-label={varias ? `${posicao + 1} de ${total}` : undefined}
              // `relative` + `isolate`: o aviso de nova tentativa cobre só ESTA
              // foto, e o `z-10` dele não vaza para as setas e bolinhas.
              className="relative isolate flex size-full shrink-0 basis-full snap-center snap-always items-center justify-center"
            >
              <FotoDaFaixa
                foto={foto}
                nome={nome}
                posicao={posicao}
                comTransicao={
                  isViewTransitionSupported && posicao === 0 && indice === 0
                }
              />
            </div>
          ))}
        </div>

        {/* Navigation Arrows */}
        {varias && (
          <div
            className={cn(
              "pointer-events-none absolute inset-0 flex items-center justify-between px-4 opacity-100 transition-opacity duration-300 hover-hover:opacity-0 hover-hover:group-hover:opacity-100 hover-hover:group-focus-within:opacity-100",
              "lg:!opacity-100",
            )}
          >
            <button
              type="button"
              onClick={anterior}
              // Laudo de acessibilidade 03/09, achado 2: botões de ícone sem
              // nome nenhum para o leitor de tela.
              aria-label="Foto anterior"
              // Laudo 05/09, M4: `after:-inset-1.5` amplia o alvo de toque
              // de 32px para 44px (recomendado mobile) sem mudar o visual.
              className={cn(
                sombraDoBotao,
                // Setas maiores no desktop: no leitor de 27" o alvo de
                // 32px flutuava pequeno demais dentro da foto quadrada.
                "lg:size-10",
              )}
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={proxima}
              aria-label="Próxima foto"
              className={cn(sombraDoBotao, "lg:size-10")}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}

        {/* Indicador de posição: bolinhas. A pílula é ESCURA translúcida: a
            versão de vidro branco sumia sobre foto de fundo claro (e a
            maioria das fotos de produto tem fundo branco). */}
        {varias && (
          <div
            className={cn(
              "absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full border border-white/20 bg-zinc-900/45 px-3 py-1.5 shadow-lg backdrop-blur-xl",
              "lg:hidden",
            )}
          >
            {fotos.map((foto, posicao) => (
              <button
                key={`${foto}-${posicao}`}
                type="button"
                onClick={() => onMudarIndice(posicao)}
                // Laudo de acessibilidade 03/09, achado 2: as bolinhas eram
                // "botão, botão, botão" — agora dizem qual foto abrem e qual
                // é a atual (`aria-current`).
                aria-label={`Foto ${posicao + 1} de ${total}`}
                aria-current={posicao === indice ? "true" : undefined}
                // Laudo 05/09, M4: bolinha de 4px (h-1) era alvo de toque
                // abaixo do mínimo WCAG de 24px — pseudo-elemento invisível
                // amplia a área SEM mudar o visual. Laudo Opus 07/09 (C1):
                // o inset é 10px só na VERTICAL (4+20 = 24px); na horizontal
                // fica em 3px porque as bolinhas ficam a 6px uma da outra
                // (gap-1.5) — o inset quadrado de 10px fazia a área da
                // bolinha seguinte cobrir a anterior e ROUBAR o toque
                // (regressão medida no preview do PR #437). Alvo de 24px de
                // LARGURA exige aumentar o gap — decisão visual do dono.
                className={`relative h-1 rounded-full transition-all duration-500 after:absolute after:-inset-y-2.5 after:inset-x-[-3px] after:content-[''] ${
                  posicao === indice
                    ? "w-6 bg-white"
                    : "w-1.5 bg-white/50 hover:bg-white/70"
                }`}
              />
            ))}
          </div>
        )}

        {/* O leitor de tela ouve a foto nova quando a faixa muda. */}
        {varias && (
          <span aria-live="polite" className="sr-only">
            {`Foto ${indice + 1} de ${total}`}
          </span>
        )}

        {acoes}
      </div>

      {computador && varias && (
        <div
          className="lg:mt-4 lg:flex lg:flex-wrap lg:gap-3"
          role="group"
          aria-label="Fotos do produto"
        >
          {fotos.map((foto, posicao) => (
            <button
              key={`${foto}-${posicao}`}
              type="button"
              aria-label={`Ver foto ${posicao + 1} de ${total}`}
              aria-current={posicao === indice ? "true" : undefined}
              onClick={() => onMudarIndice(posicao)}
              className={cn(
                "lg:size-[72px] lg:overflow-hidden lg:rounded-xl lg:border-2 lg:bg-zinc-50 lg:p-1 lg:transition-colors lg:focus-visible:outline-none lg:focus-visible:ring-2 lg:focus-visible:ring-primary lg:focus-visible:ring-offset-2 lg:shadow-sm",
                posicao === indice
                  ? "lg:border-primary"
                  : "lg:border-zinc-200 lg:hover:border-zinc-400",
              )}
            >
              <Miniatura foto={foto} />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
