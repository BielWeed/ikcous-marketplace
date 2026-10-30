import { useCartContext } from "@/contexts/CartContext";
import { useStore } from "@/contexts/StoreContext";
// T3 (23/09/2026, fim das cópias — lição #53): este banner só conhecia a
// regra LOCAL, mas dizia "toda a loja"/"Grátis" sem qualificar — e agora
// LOCAL e NACIONAL podem divergir de verdade (ex.: frete grátis só na
// cidade, transportadora sempre paga). Sem CEP da visitante (é a Home), a
// única promessa segura de anunciar é a LOCAL — mas com o QUALIFICADOR "na
// cidade" sempre que ela não empatar com a nacional (`!promessas.iguais`),
// para nunca prometer grátis nacional que a loja não dá.
import { atingiuOMinimo } from "@/lib/atingiu-o-minimo";
import { promessasDeFrete } from "@/lib/estrategias-de-frete";
// FRETE V2 (frente B, 03/09): o que a Home anuncia passa a ser derivado do
// PRESET escolhido pelo lojista — fonte única em presets-de-frete-gratis.ts.
import { presetDoConfig } from "@/lib/presets-de-frete-gratis";
import { formatCurrency } from "@/lib/utils";
import type { View } from "@/types";
import { Check, CheckCircle2, Sparkles, Truck } from "lucide-react";

interface FreeShippingBlockProps {
  /** Mantida no contrato público — a frente visual da Home ainda passa, mas
   *  o bloco não navega mais para auth: o grátis não é prêmio de login
   *  desde o modelo de presets (frente B, 03/09). */
  readonly onNavigate?: (view: View) => void;
}

/** O aviso da HOME: lê o total do carrinho do contexto. */
export function FreeShippingBlock(_props: FreeShippingBlockProps) {
  const { cartTotal } = useCartContext();
  return <AvisoDeFreteGratis cartTotal={cartTotal} />;
}

/**
 * O aviso de frete grátis em si — UMA conta e UM desenho para a Home e para o
 * Carrinho (30/10/2026). O carrinho só mostrava o progresso para quem estava
 * logada e já tinha o frete cotado; convidada, ou quem ainda não escolheu a
 * entrega, via "Frete A calcular" enquanto a Home dizia "Liberado" ou "Faltam
 * R$ X". Quem quer o aviso fora da Home passa o total que está mostrando,
 * em vez de reescrever a regra: limite, "na cidade" e meta em centavos vêm
 * daqui, da configuração da loja.
 */
export function AvisoDeFreteGratis({
  cartTotal,
}: {
  readonly cartTotal: number;
}) {
  const { config } = useStore();

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
  const minShipping = config.freeShippingMin;
  const totalCartValue = cartTotal || 0;
  const remaining = Math.max(0, minShipping - totalCartValue);
  const isGoalReached = atingiuOMinimo(totalCartValue, minShipping);
  const progressPercent = Math.min((totalCartValue / minShipping) * 100, 100);

  if (config.freeShippingCardStyle === "compacto") {
    const sempre = preset === "sempre";
    const liberado = isGoalReached || sempre;
    const Icone = liberado ? Check : Truck;
    // O SVG gira -90° em torno da origem: o centro (20,20) vira (-20,20) e
    // o arco começa no topo. pathLength=100 deixa o traço em porcentagem.
    const anel = { cx: -20, cy: 20, r: 18.25, pathLength: 100 };
    const progresso = liberado ? 100 : Math.max(0, progressPercent || 0);
    return (
      <div className="flex min-h-[66px] w-full items-center gap-2.5 rounded-[18px] border border-zinc-800 bg-zinc-950 px-3 py-2 text-white">
        <div
          {...(sempre
            ? {}
            : {
                role: "progressbar",
                "aria-label": "Progresso para o frete grátis",
                "aria-valuemin": 0,
                "aria-valuemax": 100,
                "aria-valuenow": Math.floor(progressPercent),
                "aria-valuetext": `${formatCurrency(totalCartValue)} de ${formatCurrency(minShipping)} para o frete grátis`,
              })}
          className="relative shrink-0"
        >
          <svg
            aria-hidden="true"
            width="40"
            height="40"
            fill="none"
            strokeWidth="3.5"
          >
            <g transform="rotate(-90)">
              <circle {...anel} stroke="#27272A" />
              {/* Progresso 0 não desenha o arco: a ponta redonda faria um
                  pontinho verde no topo, dizendo que algo já andou. */}
              {progresso > 0 && (
                <circle
                  {...anel}
                  stroke="#10B981"
                  strokeLinecap="round"
                  strokeDasharray={100}
                  strokeDashoffset={100 - progresso}
                />
              )}
            </g>
          </svg>
          <Icone
            aria-hidden="true"
            size={18}
            className={`absolute inset-0 m-auto ${liberado ? "text-emerald-400" : "text-zinc-400"}`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase leading-[13px] tracking-[0.06em] text-zinc-400">
            Frete grátis{soLocal ? " na cidade" : ""}
          </p>
          <h3
            className={`text-base font-bold tabular-nums leading-5${liberado ? " text-emerald-400" : ""}`}
          >
            {liberado ? "Liberado" : `Faltam ${formatCurrency(remaining)}`}
          </h3>
          <p className="text-xs tabular-nums leading-[15px] text-zinc-400">
            {sempre
              ? soLocal
                ? "Pedido com entrega local sai grátis."
                : "Todo pedido sai com entrega grátis."
              : liberado
                ? "Já vale para o seu carrinho."
                : totalCartValue > 0
                  ? `${formatCurrency(totalCartValue)} de ${formatCurrency(minShipping)}`
                  : `Compras a partir de ${formatCurrency(minShipping)}`}
          </p>
        </div>
      </div>
    );
  }

  // Selo "Liberado" dos dois cards premium (o mesmo markup, escrito uma vez).
  const seloLiberado = (
    <div className="flex h-5 shrink-0 items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-950/80 px-2.5 shadow-2xs">
      <Sparkles
        aria-hidden="true"
        className="size-3 text-emerald-400 motion-safe:animate-pulse"
      />
      <span className="text-[11px] font-bold text-emerald-400">Liberado</span>
    </div>
  );

  if (preset === "sempre") {
    return (
      <div className="group relative flex min-h-[172px] flex-col overflow-hidden rounded-[24px] border border-zinc-800 bg-zinc-950 p-3.5 shadow-md transition-all duration-300 hover:border-zinc-700">
        <div className="absolute -right-6 -top-6 size-24 rounded-full bg-emerald-500/10 blur-2xl transition-all duration-700 group-hover:bg-emerald-500/20" />
        <div className="relative z-10 flex flex-1 flex-col justify-center">
          <div className="flex gap-2.5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[14px] border border-zinc-800 bg-zinc-900 shadow-inner">
              <CheckCircle2
                aria-hidden="true"
                className="size-5 text-emerald-400"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold leading-[14px] text-zinc-400">
                {soLocal ? "Entrega na cidade" : "Toda a loja"}
              </div>
              <h3 className="mt-0.5 text-[15px] font-bold leading-5 text-white">
                <span className="text-emerald-400 font-extrabold">
                  {soLocal
                    ? "Frete grátis na cidade"
                    : "Frete grátis em toda a loja"}
                </span>
              </h3>
            </div>
          </div>
          <p className="mt-2 text-xs font-medium leading-4 text-zinc-300">
            {soLocal
              ? "Pedido com entrega local sai grátis."
              : "Qualquer pedido sai com entrega grátis."}
          </p>
        </div>
        <div className="h-2 shrink-0" />
        <div className="relative z-10 mt-auto flex h-5 items-center gap-2.5">
          {/* Grátis incondicional: não há progresso a fazer. */}
          <div
            aria-hidden="true"
            className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800"
          >
            <div className="h-full w-full rounded-full bg-emerald-500" />
          </div>
          {seloLiberado}
        </div>
      </div>
    );
  }

  // preset "acima_de_valor": a meta de valor vale para TODO MUNDO — a trava
  // de login que existia aqui morreu com o modelo de presets (frente B,
  // CartContext.tsx): convidado tem o mesmo direito ao grátis da loja, e
  // pedir login como condição era promessa falsa.
  // T3 (23/09): quando local e nacional divergem (`soLocal`), o headline
  // ganha o qualificador "na cidade" -- essa meta só vale para entrega
  // local, e sem ele a visitante lia "Frete Grátis" pensando em qualquer
  // destino (o mesmo bug que a Home tinha antes desta frente).
  const renderHeadline = () => {
    if (isGoalReached) {
      return (
        <>
          Oba!{" "}
          <span className="text-emerald-400 font-extrabold">
            Frete Grátis {soLocal ? "na Cidade " : ""}Liberado!
          </span>
          {" "}🎉
        </>
      );
    }
    if (totalCartValue > 0) {
      return (
        <>
          Falta pouquinho pro{" "}
          <span className="text-emerald-400 font-extrabold">
            Frete Grátis{soLocal ? " na Cidade" : ""}!
          </span>
          {" "}✨
        </>
      );
    }
    return (
      <>
        Frete{" "}
        <span className="text-emerald-400 font-extrabold italic">
          Grátis{soLocal ? " na Cidade" : ""}
        </span>
      </>
    );
  };

  const renderSubtext = () => {
    if (isGoalReached) {
      return soLocal
        ? "Seu carrinho já ganhou entrega local grátis!"
        : "Seu carrinho já ganhou entrega grátis!";
    }
    if (totalCartValue > 0) {
      return (
        <>
          Adicione mais{" "}
          <span className="font-bold text-white underline decoration-emerald-500">
            {formatCurrency(remaining)}
          </span>{" "}
          para garantir o frete grátis{soLocal ? " na cidade" : ""}!
        </>
      );
    }
    // Carrinho vazio: o fato verdadeiro da loja — vale para convidado e
    // logado (a regra de grátis não depende mais de login, frente B).
    // Frase curta de propósito (relato do dono, 12/09/2026): a versão antiga
    // ("Ganhe frete grátis em compras acima de R$ X") cortava com reticências
    // numa tela estreita, sobretudo com meta alta. Esta cabe mesmo com
    // R$ 1.999,90 e continua dizendo a mesma coisa útil: a partir de quanto
    // o frete é grátis. `soLocal`: o valor é só da entrega LOCAL (a
    // transportadora tem outra regra/nenhuma) — dizer isso evita prometer
    // grátis nacional que a loja não dá.
    return soLocal
      ? `A partir de ${formatCurrency(minShipping)} em compras, na entrega local.`
      : `A partir de ${formatCurrency(minShipping)} em compras.`;
  };

  // FRETE V2: um único render — convidado e logado têm a mesma regra de
  // grátis agora, e o antigo bloco "Faça login para ganhar frete grátis"
  // (estado convidado com CTA ENTRAR) era a promessa falsa que a trava
  // `&& user` sustentava no carrinho.
  return (
    <div className="group relative flex min-h-[172px] flex-col overflow-hidden rounded-[24px] border border-zinc-800 bg-zinc-950 p-3.5 shadow-md transition-all duration-300 hover:border-zinc-700">
      <div className="absolute -right-6 -top-6 size-24 rounded-full bg-emerald-500/10 blur-2xl transition-all duration-700 group-hover:bg-emerald-500/20" />
      <div className="relative z-10 flex flex-1 flex-col justify-center">
        <div className="flex gap-2.5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[14px] border border-zinc-800 bg-zinc-900 shadow-inner">
            {isGoalReached ? (
              <CheckCircle2
                aria-hidden="true"
                className="size-5 text-emerald-400"
              />
            ) : (
              <Truck aria-hidden="true" className="size-5 text-emerald-400" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] leading-[14px]">
              {/* A cidade só qualifica a cobertura local, nunca a nacional. */}
              {config.storeCity && config.shippingCoverage === "local" && (
                <div className="font-bold uppercase tracking-wider text-emerald-400">
                  {config.storeCity}
                </div>
              )}
              <div className="font-semibold text-zinc-400">
                {isGoalReached
                  ? soLocal
                    ? "Meta Atingida na Cidade"
                    : "Meta Atingida"
                  : soLocal
                    ? "Entrega Grátis na Cidade"
                    : "Entrega Grátis"}
              </div>
            </div>
            <h3 className="mt-0.5 text-[15px] font-bold leading-5 text-white">
              {renderHeadline()}
            </h3>
          </div>
        </div>
        <p className="mt-2 text-xs font-medium leading-4 text-zinc-300">
          {renderSubtext()}
        </p>
      </div>
      <div className="h-2 shrink-0" />
      <div className="relative z-10 mt-auto flex h-5 items-center gap-2.5">
        <div
          role="progressbar"
          aria-label="Progresso para o frete grátis"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.floor(progressPercent)}
          aria-valuetext={`${formatCurrency(totalCartValue)} de ${formatCurrency(minShipping)} para o frete grátis`}
          className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800"
        >
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width] duration-700 motion-reduce:transition-none"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        {isGoalReached ? (
          seloLiberado
        ) : (
          <span className="shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums text-white">
            {formatCurrency(totalCartValue)}{" "}
            <span className="font-medium text-zinc-400">de</span>{" "}
            {formatCurrency(minShipping)}
          </span>
        )}
      </div>
    </div>
  );
}
