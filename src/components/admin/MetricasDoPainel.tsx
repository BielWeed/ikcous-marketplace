import type { KpiCardConfig } from "@/components/admin/AdminKpiCarousel";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

const BOTAO_METRICAS =
  "flex min-h-11 min-w-11 items-center gap-1 text-xs font-semibold text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300";

export function MetricasDoPainel({
  titulo,
  legendasDoResumo,
  cards,
  loading = false,
}: {
  readonly titulo: string;
  readonly legendasDoResumo: readonly string[];
  readonly cards: readonly KpiCardConfig[];
  readonly loading?: boolean;
}) {
  const [expandido, setExpandido] = useState(false);
  const esqueleto = (
    <span
      aria-hidden="true"
      className="inline-block h-5 w-12 max-w-full animate-pulse rounded bg-white/5"
    />
  );

  return (
    <section aria-label={titulo} aria-busy={loading} className="min-w-0">
      {(loading || cards.every((card) => card.value === "—")) && (
        <p
          role="status"
          className="mb-2 text-[11px] font-semibold text-zinc-400"
        >
          Aguardando métricas
        </p>
      )}
      <div
        className={
          expandido
            ? undefined
            : "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-white/10 bg-[#101013] px-2 py-1"
        }
      >
        <div
          className={
            expandido
              ? "mb-3 flex flex-wrap items-center justify-between gap-2"
              : "contents"
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
                className="flex min-w-0 flex-1 items-center gap-2"
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
                  <h3 className="break-words text-[22px] font-bold tabular-nums leading-tight text-white">
                    {loading ? esqueleto : card.value}
                  </h3>
                  <span
                    aria-hidden="true"
                    className="block break-words text-xs text-zinc-400"
                  >
                    {legendasDoResumo.at(i) ?? card.label}
                  </span>
                  <p className="sr-only">{card.subValue}</p>
                </div>
              </div>
            ))
          )}
          <button
            type="button"
            onClick={() => setExpandido(!expandido)}
            aria-expanded={expandido}
            className={`${BOTAO_METRICAS} shrink-0`}
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
          <div className="grid grid-cols-2 gap-3">
            {cards.map((card) => (
              <article
                key={card.label}
                aria-label={card.label}
                data-metrica
                className="min-w-0 rounded-2xl bg-[#101013] p-3"
              >
                <card.icon
                  aria-hidden="true"
                  className={cn(
                    "mb-2 size-8 rounded-xl border border-current bg-white/5 p-1.5",
                    card.accent,
                  )}
                />
                <h3 className="mt-1 break-words text-xl font-bold tabular-nums leading-tight text-white">
                  {loading ? esqueleto : card.value}
                </h3>
                <p className="mt-2 break-words text-xs font-semibold text-zinc-100">
                  {card.label}
                </p>
                <p className="mt-2 break-words text-xs text-zinc-400">
                  {card.subValue}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <div className="flex w-full flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400">
            {cards.slice(2).map((card, i) => (
              <div
                key={card.label}
                role="group"
                aria-label={card.label}
                className="flex min-w-0 max-w-full items-center gap-1"
              >
                <card.icon
                  aria-hidden="true"
                  className={cn(
                    "size-4 shrink-0 rounded bg-white/5",
                    card.accent,
                  )}
                />
                <div className="flex min-w-0 flex-wrap items-baseline gap-1">
                  <p className="sr-only">{card.label}</p>
                  <span
                    aria-hidden="true"
                    className="min-w-0 max-w-full break-words"
                  >
                    {legendasDoResumo.at(i + 2) ?? card.label}
                  </span>
                  <h3 className="min-w-0 max-w-full break-words text-xs font-bold tabular-nums text-white">
                    {loading ? esqueleto : card.value}
                  </h3>
                  <p className="sr-only">{card.subValue}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
