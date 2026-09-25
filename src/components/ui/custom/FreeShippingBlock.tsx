import { useCartContext } from "@/contexts/CartContext";
import { useStore } from "@/contexts/StoreContext";
// T3 (23/09/2026, fim das cópias — lição #53): este banner só conhecia a
// regra LOCAL, mas dizia "toda a loja"/"Grátis" sem qualificar — e agora
// LOCAL e NACIONAL podem divergir de verdade (ex.: frete grátis só na
// cidade, transportadora sempre paga). Sem CEP da visitante (é a Home), a
// única promessa segura de anunciar é a LOCAL — mas com o QUALIFICADOR "na
// cidade" sempre que ela não empatar com a nacional (`!promessas.iguais`),
// para nunca prometer grátis nacional que a loja não dá.
import { promessasDeFrete } from "@/lib/estrategias-de-frete";
// FRETE V2 (frente B, 03/09): o que a Home anuncia passa a ser derivado do
// PRESET escolhido pelo lojista — fonte única em presets-de-frete-gratis.ts.
import { presetDoConfig } from "@/lib/presets-de-frete-gratis";
import { formatCurrency } from "@/lib/utils";
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
  const promessas = promessasDeFrete(config);
  const soLocal = !promessas.iguais;

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
                  {soLocal ? "Entrega na cidade" : "Toda a loja"}
                </span>
              </div>
              <h3 className="truncate text-xs font-bold leading-tight text-white sm:text-sm">
                <span className="text-emerald-400 font-extrabold">
                  {soLocal
                    ? "Frete grátis na cidade"
                    : "Frete grátis em toda a loja"}
                </span>
              </h3>
              <p className="truncate text-[10px] font-medium text-zinc-400">
                {soLocal
                  ? "Pedido com entrega local sai grátis."
                  : "Qualquer pedido sai com entrega grátis."}
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

  // AVISO MINIMALISTA (pedido do dono, 24/09/2026, print a 375px): "Falta
  // pouquinho pro Frete Grátis na ..." e "Adicione mais R$ 0,20 para garantir
  // o frete ..." cortavam com reticências, e o valor que falta ficava
  // escondido no fim da frase. Agora a FRASE é o valor: "Faltam R$ 0,20 para
  // o frete grátis" (cabe a 375px mesmo com R$ 1.999,90 — ~38 caracteres
  // numa coluna de ~259px), e o contexto do limite vira a barra + "R$ 149,80
  // de R$ 150,00" na mesma linha. Nenhum texto usa `truncate`: se um dia não
  // couber, quebra linha em vez de esconder. O qualificador "na cidade"
  // (T3, 23/09 — só quando local e nacional divergem) mora no rótulo de cima,
  // que já existia, para a frase principal não crescer. A conta
  // (`remaining`, `isGoalReached`, `progressPercent`) é a mesma de antes.
  const qualificador = soLocal ? " na cidade" : "";

  const rotulo = isGoalReached
    ? soLocal
      ? "Meta Atingida na Cidade"
      : "Meta Atingida"
    : soLocal
      ? "Entrega Grátis na Cidade"
      : "Entrega Grátis";

  const valorAtual = formatCurrency(totalCartValue);
  const valorMeta = formatCurrency(minShipping);

  return (
    <div className="group relative h-full overflow-hidden rounded-[24px] border border-zinc-800 bg-zinc-950 p-3.5 shadow-md transition-colors duration-300 hover:border-zinc-700 sm:p-4">
      <div
        aria-hidden="true"
        className="absolute -right-6 -top-6 size-24 rounded-full bg-emerald-500/10 blur-2xl"
      />

      <div className="relative z-10 flex items-center gap-3">
        <div
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 shadow-inner"
        >
          {isGoalReached ? (
            <CheckCircle2 className="size-5 text-emerald-400" />
          ) : (
            <Truck className="size-5 text-emerald-400" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex flex-wrap items-center gap-x-1.5">
            {/* Sem cidade configurada — ou com cobertura NACIONAL, em que
                o selo leria como "entrega só em <cidade>" e seria falso
                (#525) — o rótulo e o ponto separador somem os dois:
                "Entrega Grátis" fica sozinho, nunca "• Entrega Grátis"
                com o separador órfão. */}
            {config.storeCity && config.shippingCoverage === "local" && (
              <>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                  {config.storeCity}
                </span>
                <span
                  aria-hidden="true"
                  className="size-1 shrink-0 rounded-full bg-zinc-700"
                />
              </>
            )}
            <span className="text-[10px] font-semibold text-zinc-400">
              {rotulo}
            </span>
          </div>

          {isGoalReached ? (
            <>
              <h3 className="text-[13px] font-bold leading-tight text-white sm:text-sm">
                <span className="font-extrabold text-emerald-400">
                  Frete Grátis {soLocal ? "na Cidade " : ""}Liberado!
                </span>
              </h3>
              <p className="text-[11px] font-medium leading-snug text-zinc-400">
                {soLocal
                  ? "Seu carrinho já ganhou entrega local grátis!"
                  : "Seu carrinho já ganhou entrega grátis!"}
              </p>
            </>
          ) : totalCartValue > 0 ? (
            <>
              <h3 className="text-[13px] font-bold leading-tight text-white sm:text-sm">
                Faltam{" "}
                <span className="whitespace-nowrap font-extrabold tabular-nums text-emerald-400">
                  {formatCurrency(remaining)}
                </span>{" "}
                para o frete grátis
              </h3>
              <div className="mt-1.5 flex items-center gap-2">
                <div
                  role="progressbar"
                  aria-label={`Progresso para o frete grátis${qualificador}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progressPercent)}
                  aria-valuetext={`${valorAtual} de ${valorMeta}`}
                  className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-zinc-800"
                >
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-[width] duration-700 motion-reduce:transition-none"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <p className="shrink-0 whitespace-nowrap text-[11px] font-medium tabular-nums text-zinc-400">
                  <span className="text-zinc-200">{valorAtual}</span> de{" "}
                  {valorMeta}
                </p>
              </div>
            </>
          ) : (
            <>
              <h3 className="text-[13px] font-bold leading-tight text-white sm:text-sm">
                Frete{" "}
                <span className="font-extrabold italic text-emerald-400">
                  Grátis{soLocal ? " na Cidade" : ""}
                </span>
              </h3>
              {/* Carrinho vazio: o fato verdadeiro da loja — vale para
                  convidado e logado (a regra de grátis não depende mais de
                  login, frente B). Frase curta de propósito (relato do dono,
                  12/09/2026): cabe mesmo com R$ 1.999,90. `soLocal`: o valor
                  é só da entrega LOCAL — dizer isso evita prometer grátis
                  nacional que a loja não dá. */}
              <p className="text-[11px] font-medium leading-snug text-zinc-400">
                {soLocal
                  ? `A partir de ${valorMeta} em compras, na entrega local.`
                  : `A partir de ${valorMeta} em compras.`}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Meta atingida: a barra cheia no rodapé fecha o card, como antes. */}
      {isGoalReached && (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-1 bg-emerald-500"
        />
      )}
    </div>
  );
}
