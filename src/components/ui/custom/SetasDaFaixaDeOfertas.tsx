import { useTelaDeComputador } from "@/hooks/useTelaDeComputador";
import type { UseEmblaCarouselType } from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

export type ApiDaFaixa = NonNullable<UseEmblaCarouselType[1]>;

// Posição estável: a seta de voltar fica ao lado da de avançar mesmo quando só uma delas aparece.
// 16px da borda + 40px da seta + 8px de respiro = 64px (`right-16`). A moldura do título reserva
// 112px (`lg:pr-28`) para o título não passar por baixo delas.
const CLASSE_SETA =
  "absolute top-2 z-20 hidden size-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 lg:flex";

/**
 * Setas para o mouse nas faixas de ofertas que rolam para o lado (Lateral, Lateral em duas fileiras e
 * Compacto), só no computador (>= 1024px). Essas faixas rolam pelo Embla (não há scroll nativo), então
 * quem diz se há mais para o lado é o próprio Embla; cada seta só existe quando há conteúdo escondido
 * naquela direção. No celular não renderiza nada: o toque já arrasta a faixa.
 * Vai dentro da `<section className="relative">` da faixa.
 */
export function SetasDaFaixaDeOfertas({
  api,
  itens = "ofertas",
}: {
  api: ApiDaFaixa | undefined;
  itens?: string;
}) {
  const computador = useTelaDeComputador();
  const [podeVoltar, setPodeVoltar] = useState(false);
  const [podeAvancar, setPodeAvancar] = useState(false);
  useEffect(() => {
    if (!api || !computador) return;
    const atualizar = () => {
      setPodeVoltar(api.canScrollPrev());
      setPodeAvancar(api.canScrollNext());
    };
    atualizar();
    api.on("select", atualizar);
    api.on("reInit", atualizar);
    return () => {
      api.off("select", atualizar);
      api.off("reInit", atualizar);
    };
  }, [api, computador]);
  if (!api || !computador) return null;
  // Quem pediu menos movimento não vê a faixa deslizar: o Embla pula direto (`jump`).
  const reduzirMovimento = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  return (
    <>
      {podeVoltar && (
        <button
          type="button"
          aria-label={`Ver ${itens} anteriores`}
          onClick={() => api.scrollPrev(reduzirMovimento())}
          className={`${CLASSE_SETA} right-16`}
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
      )}
      {podeAvancar && (
        <button
          type="button"
          aria-label={`Ver ${itens} seguintes`}
          onClick={() => api.scrollNext(reduzirMovimento())}
          className={`${CLASSE_SETA} right-4`}
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      )}
    </>
  );
}
