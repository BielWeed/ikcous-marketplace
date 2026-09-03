import { useCartContext } from "@/contexts/CartContext";
import { useStore } from "@/contexts/StoreContext";
import { formatCurrency } from "@/lib/utils";
// FRETE V2 (frente B, 03/09): o que a Home anuncia passa a ser derivado do
// PRESET escolhido pelo lojista — fonte única em presets-de-frete-gratis.ts.
import { presetDoConfig } from "@/lib/presets-de-frete-gratis";
import type { View } from "@/types";
import { CheckCircle2, Sparkles, Truck } from "lucide-react";

interface FreeShippingBlockProps {
  /** Mantida no contrato público — a frente visual da Home ainda passa, mas
   *  o bloco não navega mais para auth: o grátis não é prêmio de login
   *  desde o modelo de presets (frente B, 03/09). */
  readonly onNavigate?: (view: View) => void;
}

export function FreeShippingBlock(_props: FreeShippingBlockProps) {
  const { config } = useStore();
  const { cartTotal } = useCartContext();

  // Regra desligada no admin: não anunciar frete grátis que a loja não oferece.
  // (Preset "por_produto" grava a sentinela -1 e cai aqui de propósito: quem
  // comunica o grátis por produto é a MARCAÇÃO no produto — o selo —, não uma
  // barra de valor na Home que não teria número nenhum para mostrar.)
  if (!(config.freeShippingMin > 0)) {
    return null;
  }

  const preset = presetDoConfig(config.freeShippingMin);

  // FRETE V2: a sentinela 0,01 = "sempre grátis". Sem este ramo, a Home
  // mostrava a meta real de R$ 0,01: "Ganhe frete grátis em compras acima de
  // R$ 0,01" e "faltam R$ 0,01" — a loja que dá grátis SEMPRE não tem meta.
  if (preset === "sempre") {
    return (
      <div className="group relative h-full overflow-hidden rounded-[24px] border border-zinc-800 bg-zinc-950 p-3.5 shadow-md transition-all duration-300 hover:border-zinc-700 sm:p-4">
        <div className="absolute -right-6 -top-6 size-24 rounded-full bg-emerald-500/10 blur-2xl transition-all duration-700 group-hover:bg-emerald-500/20" />

        <div className="relative z-10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="flex size-11 flex-shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 shadow-inner">
              <CheckCircle2 className="size-5 text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex items-center gap-1.5 overflow-hidden">
                <span className="truncate text-[9px] font-semibold text-zinc-400">
                  Toda a loja
                </span>
              </div>
              <h3 className="truncate text-xs font-bold leading-tight text-white sm:text-sm">
                <span className="text-emerald-400 font-extrabold">
                  Frete grátis em toda a loja
                </span>
              </h3>
              <p className="truncate text-[10px] font-medium text-zinc-400">
                Qualquer pedido sai com entrega grátis.
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <div className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-950/80 px-3 py-1 shadow-2xs">
              <Sparkles className="size-3 text-emerald-400 animate-pulse" />
              <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                Liberado
              </span>
            </div>
          </div>
        </div>

        {/* Barra cheia: o grátis é incondicional, não há progresso a fazer. */}
        <div className="absolute inset-x-0 bottom-0 h-1 bg-zinc-900">
          <div className="h-full w-full bg-emerald-500" />
        </div>
      </div>
    );
  }

  // preset "acima_de_valor": a meta de valor vale para TODO MUNDO — a trava
  // de login que existia aqui morreu com o modelo de presets (frente B,
  // CartContext.tsx): convidado tem o mesmo direito ao grátis da loja, e
  // pedir login como condição era promessa falsa.
  const minShipping = config.freeShippingMin;
  const totalCartValue = cartTotal || 0;
  const remaining = Math.max(0, minShipping - totalCartValue);
  const isGoalReached = totalCartValue >= minShipping;

  const progressPercent = Math.min((totalCartValue / minShipping) * 100, 100);

  const renderHeadline = () => {
    if (isGoalReached) {
      return (
        <>
          Oba!{" "}
          <span className="text-emerald-400 font-extrabold">
            Frete Grátis Liberado!
          </span>{" "}
          🎉
        </>
      );
    }
    if (totalCartValue > 0) {
      return (
        <>
          Falta pouquinho pro{" "}
          <span className="text-emerald-400 font-extrabold">Frete Grátis!</span>{" "}
          ✨
        </>
      );
    }
    return (
      <>
        Frete{" "}
        <span className="text-emerald-400 font-extrabold italic">Grátis</span>
      </>
    );
  };

  const renderSubtext = () => {
    if (isGoalReached) {
      return "Sua sacola já ganhou entrega grátis!";
    }
    if (totalCartValue > 0) {
      return (
        <>
          Adicione mais{" "}
          <span className="font-bold text-white underline decoration-emerald-500">
            {formatCurrency(remaining)}
          </span>{" "}
          para garantir o frete grátis!
        </>
      );
    }
    // Carrinho vazio: o fato verdadeiro da loja — vale para convidado e
    // logado (a regra de grátis não depende mais de login, frente B).
    return `Ganhe frete grátis em compras acima de ${formatCurrency(minShipping)}.`;
  };

  // FRETE V2: um único render — convidado e logado têm a mesma regra de
  // grátis agora, e o antigo bloco "Faça login para ganhar frete grátis"
  // (estado convidado com CTA ENTRAR) era a promessa falsa que a trava
  // `&& user` sustentava no carrinho.
  return (
    <div className="group relative h-full overflow-hidden rounded-[24px] border border-zinc-800 bg-zinc-950 p-3.5 shadow-md transition-all duration-300 hover:border-zinc-700 sm:p-4">
      {/* Subtle Glow */}
      <div className="absolute -right-6 -top-6 size-24 rounded-full bg-emerald-500/10 blur-2xl transition-all duration-700 group-hover:bg-emerald-500/20" />

      <div className="relative z-10 flex items-center justify-between gap-3">
        {/* Esquerda: Ícone + Copy */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex size-11 flex-shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 shadow-inner transition-transform duration-300 group-hover:scale-105">
            {isGoalReached ? (
              <CheckCircle2 className="size-5 text-emerald-400" />
            ) : (
              <Truck className="size-5 text-emerald-400" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex items-center gap-1.5 overflow-hidden">
              {/* Sem cidade configurada, o rótulo e o ponto separador somem
                  os dois — "Entrega Grátis" fica sozinho, nunca "• Entrega
                  Grátis" com o separador órfão. */}
              {config.storeCity && (
                <>
                  <span className="whitespace-nowrap text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                    {config.storeCity}
                  </span>
                  <div className="size-1 flex-shrink-0 rounded-full bg-zinc-700" />
                </>
              )}
              <span className="truncate text-[9px] font-semibold text-zinc-400">
                {isGoalReached ? "Meta Atingida" : "Entrega Grátis"}
              </span>
            </div>

            <h3 className="truncate text-xs font-bold leading-tight text-white sm:text-sm">
              {renderHeadline()}
            </h3>

            <p className="truncate text-[10px] font-medium text-zinc-400">
              {renderSubtext()}
            </p>
          </div>
        </div>

        {/* Direita: Badge do Valor / Progresso */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {isGoalReached ? (
            <div className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-950/80 px-3 py-1 shadow-2xs">
              <Sparkles className="size-3 text-emerald-400 animate-pulse" />
              <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                Liberado
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-end">
              <span className="text-[11px] font-bold leading-tight text-white sm:text-xs">
                {formatCurrency(totalCartValue)}
              </span>
              <span className="text-[8px] font-semibold uppercase tracking-wider text-emerald-400">
                {totalCartValue > 0
                  ? `de ${formatCurrency(minShipping)}`
                  : "no carrinho"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Slim Progress Bar no Rodapé */}
      <div className="absolute inset-x-0 bottom-0 h-1 bg-zinc-900">
        <div
          className="h-full bg-emerald-500 transition-all duration-700"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}
