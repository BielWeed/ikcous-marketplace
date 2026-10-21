import type { KpiCardConfig } from "@/components/admin/AdminKpiCarousel";
import { type TomDeEstado, classeDoTexto } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";

export type MetricaDoPainel = KpiCardConfig & { readonly tom?: TomDeEstado };
import { ChevronDown, ChevronUp, Info } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import "./metricas-do-painel.css";

const BOTAO_METRICAS =
  "flex min-h-11 min-w-11 items-center gap-1 text-xs font-semibold text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300";

function NumeroAdaptavel({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className: string;
}) {
  const numeroRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const numero = numeroRef.current;
    const caixa = numero?.parentElement;
    if (!numero || !caixa) return;
    let ativo = true;

    const ajustar = () => {
      if (!ativo || caixa.clientWidth === 0) return;
      numero.style.fontSize = "";
      const largura = numero.getBoundingClientRect().width;
      const disponivel = caixa.getBoundingClientRect().width;
      if (largura > disponivel) {
        numero.style.fontSize = `${(Math.max(0, disponivel - 0.5) / largura) * 100}%`;
      }
    };

    ajustar();
    const observador =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(ajustar);
    observador?.observe(caixa.closest(".metricas-painel") ?? caixa);
    void document.fonts?.ready.then(ajustar);
    return () => {
      ativo = false;
      observador?.disconnect();
    };
  }, [children]);

  return (
    <h3 className={className}>
      <span ref={numeroRef} className="metricas-painel-numero">
        {children}
      </span>
    </h3>
  );
}

function ValorDoResumo({ valor }: { readonly valor: string | number }) {
  return typeof valor === "string" && valor.startsWith("R$") ? (
    <>
      <span className="metricas-painel-moeda">R$</span>
      {valor.slice(2)}
    </>
  ) : (
    valor
  );
}

export function MetricasDoPainel({
  titulo,
  legendasDoResumo,
  cards,
  loading = false,
  nota = titulo,
  onEntender,
  indicesDoRodape = [2, 3],
}: {
  readonly titulo: string;
  readonly legendasDoResumo: readonly string[];
  readonly cards: readonly MetricaDoPainel[];
  readonly loading?: boolean;
  readonly nota?: ReactNode;
  readonly onEntender?: () => void;
  readonly indicesDoRodape?: readonly [number, number];
}) {
  const [expandido, setExpandido] = useState(false);
  const esqueleto = (
    <span
      aria-hidden="true"
      className="inline-block h-5 w-12 max-w-full animate-pulse rounded bg-white/5"
    />
  );
  const entender = onEntender ? (
    <button
      type="button"
      aria-label="Entender valores"
      aria-haspopup="dialog"
      onClick={onEntender}
      className={cn(BOTAO_METRICAS, "size-11 shrink-0 justify-center")}
    >
      <Info aria-hidden="true" className="size-4" />
    </button>
  ) : null;

  return (
    <section
      aria-label={titulo}
      aria-busy={loading}
      data-expandido={expandido}
      className={cn(
        "metricas-painel min-w-0",
        expandido ? "h-[404px]" : "h-[148px]",
      )}
    >
      {(loading || cards.every((card) => card.value === "—")) && (
        <p role="status" className="sr-only">
          Aguardando métricas
        </p>
      )}
      <div className="metricas-painel-resumo h-full">
        <div
          className={cn(
            "metricas-painel-nota border-b border-admin-border px-3 text-[11px] text-zinc-400",
            expandido
              ? "h-7 overflow-y-auto leading-[14px]"
              : "h-7 truncate leading-7",
          )}
        >
          {nota}
        </div>
        <div
          className={
            expandido
              ? "metricas-painel-cabecalho flex items-center justify-between gap-2"
              : "metricas-painel-principais h-[76px]"
          }
        >
          {expandido ? (
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              {titulo}
            </h2>
          ) : (
            cards.slice(0, 2).map((card, i) => (
              <div
                key={card.label}
                role="group"
                aria-label={card.label}
                className="metricas-painel-destaque min-w-0"
              >
                <card.icon
                  aria-hidden="true"
                  className={cn(
                    "size-6 shrink-0 rounded-lg border border-current bg-white/5 p-1",
                    card.accent,
                  )}
                />
                <div className="min-w-0">
                  <p className="sr-only">{card.label}</p>
                  <span
                    aria-hidden="true"
                    className="metricas-painel-legenda block break-words text-xs text-zinc-400"
                  >
                    {legendasDoResumo.at(i) ?? card.label}
                  </span>
                  <NumeroAdaptavel
                    className={cn(
                      "metricas-painel-valor break-words text-[22px] font-bold tabular-nums leading-tight",
                      card.tom ? classeDoTexto(card.tom) : "text-white",
                    )}
                  >
                    {loading ? esqueleto : <ValorDoResumo valor={card.value} />}
                  </NumeroAdaptavel>
                  <p className="sr-only">{card.subValue}</p>
                </div>
              </div>
            ))
          )}
          {expandido && entender}
          <button
            type="button"
            onClick={() => setExpandido(!expandido)}
            aria-expanded={expandido}
            className={`${BOTAO_METRICAS} metricas-painel-controle shrink-0`}
          >
            {expandido ? (
              <>
                Recolher
                <ChevronUp
                  aria-hidden="true"
                  className="size-4 text-violet-300"
                />
              </>
            ) : (
              <>
                <ChevronDown
                  aria-hidden="true"
                  className="size-6 rounded-lg bg-violet-300/10 p-1 text-violet-300"
                />
                Expandir
              </>
            )}
          </button>
        </div>
        {expandido ? (
          <div className="metricas-painel-grade grid grid-cols-2 gap-2.5">
            {cards.map((card) => (
              <article
                key={card.label}
                aria-label={card.label}
                data-metrica
                className="min-w-0 rounded-2xl bg-admin-surface p-2"
              >
                <card.icon
                  aria-hidden="true"
                  className={cn(
                    "mb-2 size-8 rounded-xl border border-current bg-white/5 p-1.5",
                    card.accent,
                  )}
                />
                <NumeroAdaptavel
                  className={cn(
                    "mt-1 break-words text-xl font-bold tabular-nums leading-tight",
                    card.tom ? classeDoTexto(card.tom) : "text-white",
                  )}
                >
                  {loading ? esqueleto : card.value}
                </NumeroAdaptavel>
                <p className="mt-2 break-words text-xs font-semibold text-zinc-100">
                  {card.label}
                  {card.parcial && " (parcial)"}
                </p>
                <p className="sr-only">{card.subValue}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="metricas-painel-secundarias flex h-10 w-full items-center gap-3 text-xs text-zinc-400">
            {indicesDoRodape.map((indice) => {
              const card = cards.at(indice);
              if (!card) return null;
              return (
                <div
                  key={card.label}
                  role="group"
                  aria-label={card.label}
                  className="metricas-painel-detalhe flex min-w-0 max-w-full items-center gap-1"
                >
                  <card.icon
                    aria-hidden="true"
                    className={cn(
                      "size-4 shrink-0 rounded bg-white/5",
                      card.accent,
                    )}
                  />
                  <div className="flex min-w-0 items-baseline gap-1">
                    <p className="sr-only">{card.label}</p>
                    <span
                      aria-hidden="true"
                      className="min-w-0 max-w-full break-words"
                    >
                      {legendasDoResumo.at(indice) ?? card.label}
                    </span>
                    <NumeroAdaptavel className="min-w-0 max-w-full break-words text-xs font-bold tabular-nums text-white">
                      {loading ? esqueleto : card.value}
                    </NumeroAdaptavel>
                    <p className="sr-only">{card.subValue}</p>
                  </div>
                </div>
              );
            })}
            {entender}
          </div>
        )}
      </div>
    </section>
  );
}
