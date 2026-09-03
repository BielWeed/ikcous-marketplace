import { memo } from "react";

/**
 * Faixa-resumo da tela de Frete — direção D aprovada pelo dono (03/09/2026,
 * 3 rodadas de iteração visual): substitui o hero de cards-índice com glow,
 * que ele reprovou ("o visual não mudou nada").
 *
 * O desenho é UMA faixa entre duas hairlines com gradiente verde sutil no
 * topo — desktop: 3 colunas separadas por hairline vertical; celular: 3
 * LINHAS COMPACTAS, rótulo à esquerda e valor à direita NA MESMA linha, com
 * as notas ocultas e 16px de padding horizontal interno (conserto direto
 * das duas reclamações do dono no celular: conteúdo grudado na borda e
 * altura desperdiçada).
 *
 * Os três estados vêm PRONTOS da view (derivados do config SALVO, nunca do
 * formulário — a faixa descreve a realidade da loja; a intenção pendente
 * tem a barra de salvar fixa no rodapé). Markup burro de propósito: a regra
 * de derivação mora em UM lugar (AdminShippingView), e aqui não há como
 * divergir.
 *
 * Números grandes tabulares (`tabular-nums`), verde do token --admin-accent
 * (nada de hex fora do sistema) e sem webfont novo — a fonte é a stack do
 * app. Os stats NÃO são botões: o índice-clicável do hero antigo morreu com
 * o desenho novo.
 */

export interface StatusDaFaixaFrete {
  /** Rótulo curto da coluna ("Na sua cidade", "Frete grátis"). */
  readonly rotulo: string;
  /** O estado REAL, em linguagem de lojista ("R$ 10 por entrega"). */
  readonly valor: string;
  /** Nota de contexto — OCULTA no celular (a linha compacta não a comporta). */
  readonly detalhe?: string;
  readonly tom: "positivo" | "atencao" | "neutro";
}

const PONTO: Record<StatusDaFaixaFrete["tom"], string | null> = {
  positivo: "bg-admin-accent shadow-[0_0_8px] shadow-admin-accent/60",
  atencao: "bg-amber-400 shadow-[0_0_8px] shadow-amber-400/50",
  // Neutro não acende ponto nenhum — igual ao mockup (o "Frete grátis"
  // desligado não leva bolinha).
  neutro: null,
};

export const FreteResumoFaixa = memo(function FreteResumoFaixa({
  status,
}: {
  readonly status: readonly [
    StatusDaFaixaFrete,
    StatusDaFaixaFrete,
    StatusDaFaixaFrete,
  ];
}) {
  return (
    <section
      aria-label="Como a entrega funciona hoje"
      className="border-y border-white/10 bg-gradient-to-b from-admin-accent/[0.06] to-transparent"
    >
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1.15fr]">
        {status.map((item, i) => {
          const ponto = PONTO[item.tom];
          return (
            <div
              key={item.rotulo}
              className={`flex items-center justify-between gap-3 px-4 py-3 md:block md:px-7 md:py-6 ${
                i === 0
                  ? "md:pl-6"
                  : "border-t border-white/5 md:border-l md:border-t-0"
              }`}
            >
              <div className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                {ponto && (
                  <span
                    aria-hidden="true"
                    className={`size-1.5 shrink-0 rounded-full ${ponto}`}
                  />
                )}
                {item.rotulo}
              </div>
              <div className="text-right text-lg font-bold tracking-tight tabular-nums text-zinc-100 md:mt-2 md:text-left md:text-[26px] md:leading-tight">
                {item.valor}
              </div>
              {item.detalhe && (
                <div className="hidden text-[12.5px] leading-snug text-zinc-500 md:mt-1.5 md:block">
                  {item.detalhe}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
});
