import { AlertCircle, ChevronDown } from "lucide-react";
import { memo } from "react";

/**
 * Hero da tela de Frete v2 (frente frete-v2-0309, ordem do dono: tela
 * "moderna, minimalista, PREMIUM", reconhecível como outra ao primeiro
 * olhar). Responde em UMA olhada a pergunta que a tela antiga escondia em
 * quatro cards: "como a entrega funciona HOJE?".
 *
 * Os três estados vêm PRONTOS da view (derivados do config SALVO, nunca do
 * formulário — o hero descreve a realidade da loja, não a intenção pendente
 * de salvar; quando há intenção pendente, o selo "alterações não salvas"
 * aparece por cima). Este componente é markup burro de propósito: a regra
 * de derivação mora em UM lugar (AdminShippingView), e aqui não há como
 * divergir.
 *
 * Cada status rola até o bloco correspondente — o hero é também o índice
 * da tela.
 */

export interface StatusDoHeroFrete {
  /** id do bloco correspondente na tela (para o scroll). */
  readonly id: string;
  readonly rotulo: string;
  /** O estado REAL, em linguagem de lojista ("R$ 10 por entrega"). */
  readonly valor: string;
  readonly detalhe?: string;
  readonly tom: "positivo" | "atencao" | "neutro";
}

const TOM_DOT: Record<StatusDoHeroFrete["tom"], string> = {
  positivo: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]",
  atencao: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]",
  neutro: "bg-zinc-600",
};

export const FreteResumoHero = memo(function FreteResumoHero({
  status,
  sujo,
  onIrParaBloco,
}: {
  readonly status: readonly [
    StatusDoHeroFrete,
    StatusDoHeroFrete,
    StatusDoHeroFrete,
  ];
  /** Há mudanças no formulário ainda não salvas no config. */
  readonly sujo: boolean;
  readonly onIrParaBloco: (id: string) => void;
}) {
  return (
    <section
      aria-label="Como a entrega funciona hoje"
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-zinc-900 via-zinc-950 to-black p-5 shadow-2xl sm:p-6"
    >
      {/* Glow dourado no topo — a assinatura visual da tela (reconhecível
          ao primeiro olhar), feito só com o token que o painel já usa. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-admin-gold/70 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 left-1/2 h-32 w-2/3 -translate-x-1/2 rounded-full bg-admin-gold/10 blur-3xl"
      />

      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
          Como a entrega funciona hoje
        </h2>
        {sujo && (
          <span className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-300 duration-200 animate-in fade-in">
            <AlertCircle className="size-3" />
            Alterações não salvas — confira e salve
          </span>
        )}
      </div>

      <div className="relative mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {status.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onIrParaBloco(item.id)}
            className="group flex items-start gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-3.5 text-left transition-all duration-300 hover:border-white/15 hover:bg-white/[0.06] active:scale-[0.98]"
          >
            <span
              className={`mt-1.5 size-2 shrink-0 rounded-full ${TOM_DOT[item.tom]}`}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                {item.rotulo}
              </span>
              <span className="mt-0.5 block truncate text-sm font-extrabold text-white">
                {item.valor}
              </span>
              {item.detalhe && (
                <span className="mt-0.5 block truncate text-[10.5px] font-medium text-zinc-500">
                  {item.detalhe}
                </span>
              )}
            </span>
            <ChevronDown className="mt-1 size-3.5 shrink-0 text-zinc-600 transition-colors group-hover:text-zinc-400" />
          </button>
        ))}
      </div>
    </section>
  );
});
