import type { KpiCardConfig } from "@/components/admin/AdminKpiCarousel";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from "lucide-react";
import { useRef, useState } from "react";
import { BOTAO_CLIENTES, FOCO_CLIENTES } from "./FolhaClientes";

const RESUMOS = ["Total", "Novos · 30d", "Média/pedido", "Pedidos"];

export function MetricasClientes({
  cards,
}: { readonly cards: readonly KpiCardConfig[] }) {
  const [modo, setModo] = useState<"resumo" | "grade" | "carrossel">("resumo");
  const [grupo, setGrupo] = useState(0);
  const faixa = useRef<HTMLDivElement>(null);
  const irAoGrupo = (indice: number) => {
    setGrupo(indice);
    faixa.current?.scrollTo?.({
      left: indice * faixa.current.clientWidth,
      behavior: "smooth",
    });
  };

  return (
    <section aria-label="Métricas de Clientes" className="min-w-0">
      {cards.every((card) => card.value === "—") && (
        <p
          role="status"
          className="mb-2 text-[11px] font-semibold text-zinc-400"
        >
          Aguardando métricas
        </p>
      )}
      {modo === "resumo" ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-white/10 bg-[#101013] px-2 py-1">
          {cards.slice(0, 2).map((card, i) => (
            <div
              key={card.label}
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
                <span className="sr-only">{card.label}</span>
                <strong className="block break-words text-[22px] font-bold tabular-nums leading-tight">
                  {card.value}
                </strong>
                <span
                  aria-hidden="true"
                  className="block text-xs text-zinc-400"
                >
                  {RESUMOS.at(i)}
                </span>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setModo("grade")}
            aria-expanded={false}
            className={`flex min-h-11 items-center gap-1 text-xs font-semibold ${FOCO_CLIENTES}`}
          >
            <ChevronDown
              aria-hidden="true"
              className="size-6 rounded-lg bg-violet-300/10 p-1 text-violet-300"
            />
            Expandir
          </button>
          <div className="flex w-full flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400">
            {cards.slice(2).map((card, i) => (
              <div
                key={card.label}
                className="flex min-w-0 flex-wrap items-center gap-1"
              >
                <card.icon
                  aria-hidden="true"
                  className={cn(
                    "size-4 shrink-0 rounded bg-white/5",
                    card.accent,
                  )}
                />
                <span className="sr-only">
                  {card.label} · {card.subValue}
                </span>
                <span aria-hidden="true">{RESUMOS.at(i + 2)}</span>{" "}
                <strong className="break-words font-bold tabular-nums text-white">
                  {card.value}
                </strong>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Métricas de Clientes
            </h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setModo("resumo")}
                className={`flex min-h-11 items-center gap-1 text-xs font-semibold ${FOCO_CLIENTES}`}
              >
                Recolher
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 text-violet-300"
                />
              </button>
              <button
                type="button"
                onClick={() => {
                  setGrupo(0);
                  faixa.current?.scrollTo?.({ left: 0 });
                  setModo(modo === "grade" ? "carrossel" : "grade");
                }}
                aria-expanded={modo === "grade"}
                className={`flex min-h-11 items-center gap-1 text-xs font-semibold ${FOCO_CLIENTES}`}
              >
                {modo === "grade" ? "Carrossel" : "Expandir"}
                <ChevronUp
                  aria-hidden="true"
                  className="size-4 text-violet-300"
                />
              </button>
            </div>
          </div>
          <div
            ref={faixa}
            onScroll={(e) => {
              if (modo === "carrossel" && e.currentTarget.clientWidth)
                setGrupo(
                  Math.round(
                    e.currentTarget.scrollLeft / e.currentTarget.clientWidth,
                  ),
                );
            }}
            className={
              modo === "grade"
                ? "grid grid-cols-2 gap-3 lg:grid-cols-4"
                : "custom-scrollbar-hidden flex snap-x snap-mandatory overflow-x-auto"
            }
          >
            {cards.map((card) => (
              <div
                key={card.label}
                data-metrica
                className={cn(
                  "min-w-0 rounded-2xl bg-[#101013] p-3",
                  modo === "carrossel" && "w-full shrink-0 snap-start",
                )}
              >
                <card.icon
                  aria-hidden="true"
                  className={cn(
                    "mb-2 size-8 rounded-xl border border-current bg-white/5 p-1.5",
                    card.accent,
                  )}
                />
                <strong className="mt-1 block break-words text-xl font-bold tabular-nums">
                  {card.value}
                </strong>
                <span className="mt-2 block text-xs font-semibold">
                  {card.label}
                </span>
                <span className="mt-2 block text-xs text-zinc-400">
                  {card.subValue}
                </span>
              </div>
            ))}
          </div>
          {modo === "carrossel" && (
            <div className="mt-3 space-y-2">
              <p aria-live="polite" className="text-[11px] text-zinc-400">
                Carrossel · Grupo {grupo + 1} de {cards.length}
              </p>
              <div className="flex flex-wrap gap-2">
                {cards.map((card, i) => (
                  <button
                    key={card.label}
                    type="button"
                    onClick={() => irAoGrupo(i)}
                    aria-label={`Mostrar o grupo ${i + 1} de ${cards.length}`}
                    aria-current={grupo === i ? "true" : undefined}
                    className={cn(
                      BOTAO_CLIENTES,
                      "min-w-11",
                      grupo === i && "border-[#F5C542] bg-[#F5C542]/10",
                    )}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-label="Grupo anterior de métricas"
                  disabled={grupo === 0}
                  onClick={() => irAoGrupo(grupo - 1)}
                  className={`${BOTAO_CLIENTES} disabled:text-zinc-400`}
                >
                  <ChevronLeft
                    aria-hidden="true"
                    className="size-4 text-violet-300"
                  />
                  Anterior
                </button>
                <button
                  type="button"
                  aria-label="Próximo grupo de métricas"
                  disabled={grupo >= cards.length - 1}
                  onClick={() => irAoGrupo(grupo + 1)}
                  className={`${BOTAO_CLIENTES} disabled:text-zinc-400`}
                >
                  Próximo
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 text-violet-300"
                  />
                </button>
              </div>
              {grupo === 0 && (
                <p className="text-[11px] text-zinc-400">
                  Primeiro grupo · Anterior indisponível
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
