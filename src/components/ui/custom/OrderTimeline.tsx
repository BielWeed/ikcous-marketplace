import {
  ROTULOS_DAS_ETAPAS,
  ROTULO_RETIRADA_PRONTA,
} from "@/lib/rotulos-das-etapas";
import type { OrderStatus } from "@/types";
import { Check, Home, Package, Store, Truck, XCircle } from "lucide-react";

interface OrderTimelineProps {
  status: OrderStatus;
  /** Retirada na loja: ninguém leva o pedido, a cliente busca — a etapa
   * `shipping` se chama "Pronto para retirar" (só texto e ícone; mesmo nome
   * da ficha do pedido, em todos os estados). */
  retiradaNaLoja?: boolean;
  /** Perfil: quatro barras finas com o nome da etapa embaixo (mesma lista
   * nomeada e mesma etapa atual falada; só muda o desenho). */
  compacto?: boolean;
}

export function OrderTimeline({
  status,
  retiradaNaLoja = false,
  compacto = false,
}: OrderTimelineProps) {
  const steps = [
    { key: "pending", label: ROTULOS_DAS_ETAPAS.recebido, icon: Check },
    { key: "processing", label: ROTULOS_DAS_ETAPAS.separado, icon: Package },
    retiradaNaLoja
      ? { key: "shipping", label: ROTULO_RETIRADA_PRONTA, icon: Store }
      : { key: "shipping", label: ROTULOS_DAS_ETAPAS.aCaminho, icon: Truck },
    { key: "delivered", label: ROTULOS_DAS_ETAPAS.entregue, icon: Home },
  ];

  if (status === "cancelled") {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-red-600"
      >
        <XCircle aria-hidden="true" className="size-5" />
        <span className="text-sm font-medium">Pedido Cancelado</span>
      </div>
    );
  }

  const currentStepIndex = steps.findIndex((s) => s.key === status);
  // Se o status for um que não mapeamos (raro), garantimos um fallback
  const safeIndex = currentStepIndex === -1 ? 0 : currentStepIndex;

  if (compacto) {
    return (
      <>
        {/* eslint-disable-next-line jsx-a11y/no-redundant-roles -- list-style:none apaga o papel de lista no Safari/VoiceOver */}
        <ol
          aria-label="Andamento do pedido"
          // biome-ignore lint/a11y/noRedundantRoles: list-style:none apaga o papel de lista no Safari/VoiceOver
          role="list"
          className="m-0 flex list-none gap-2 p-0 max-[359px]:-mx-2 max-[359px]:gap-1"
        >
          {steps.map((step, index) => (
            <li
              key={step.key}
              className="flex-auto"
              aria-current={index === safeIndex ? "step" : undefined}
            >
              <div
                aria-hidden="true"
                className={`h-1 rounded-full ${index <= safeIndex ? "bg-foreground" : "bg-border"}`}
              />
              <span
                className={`mt-2 block text-xs leading-tight max-[359px]:tracking-tight ${
                  index === safeIndex
                    ? "font-bold text-foreground"
                    : index < safeIndex
                      ? "font-medium text-foreground"
                      : "font-medium text-muted-foreground"
                }`}
              >
                {step.label}
              </span>
              <span className="sr-only">
                {index < safeIndex
                  ? "etapa concluída"
                  : index === safeIndex
                    ? "etapa atual"
                    : "etapa ainda não alcançada"}
              </span>
            </li>
          ))}
        </ol>
      </>
    );
  }

  return (
    <div className="relative px-2 py-6">
      {/* Background Line */}
      <div
        aria-hidden="true"
        className="absolute inset-x-[30px] top-[48px] h-[3px] rounded-full bg-zinc-100"
      />

      {/* Active Line */}
      <div
        aria-hidden="true"
        className="absolute left-[30px] top-[48px] h-[3px] rounded-full bg-emerald-500 transition-all duration-1000 ease-in-out"
        style={{
          width: `calc(${Math.max(0, (safeIndex / (steps.length - 1)) * 100)}% - 0px)`,
          maxWidth: "calc(100% - 60px)",
        }}
      />

      {/*
        O <ol> carrega o flex (não `display: contents`): esse display remove o
        elemento -- e, em algumas versões de navegador, os <li> e o sr-only
        junto -- da árvore de acessibilidade (MDN, Web/CSS/display-box#accessibility).
        `role="list"` é explícito porque `list-style: none` faz o VoiceOver (Safari)
        deixar de anunciar a lista como lista.
      */}
      {/* eslint-disable-next-line jsx-a11y/no-redundant-roles -- list-style:none apaga o papel de lista no Safari/VoiceOver */}
      <ol
        aria-label="Andamento do pedido"
        // biome-ignore lint/a11y/noRedundantRoles: list-style:none apaga o papel de lista no Safari/VoiceOver
        role="list"
        className="m-0 flex w-full list-none items-start justify-between gap-2 p-0"
      >
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isActive = index <= safeIndex;
          const isCompleted = index < safeIndex;
          const isCurrent = index === safeIndex;

          return (
            <li
              key={step.key}
              aria-current={isCurrent ? "step" : undefined}
              className="relative z-10 flex flex-1 flex-col items-center"
            >
              <div
                aria-hidden="true"
                className={`relative flex size-12 items-center justify-center rounded-full border-2 transition-all duration-700 ${
                  isCompleted
                    ? "border-emerald-500 bg-emerald-500 text-white shadow-lg shadow-emerald-100/50"
                    : isCurrent
                      ? "scale-110 border-zinc-900 bg-zinc-900 text-white shadow-xl shadow-zinc-200 ring-4 ring-emerald-500/25"
                      : "border-zinc-200 bg-white text-zinc-300"
                }`}
              >
                {isCompleted ? (
                  <Check className="size-5 stroke-[3px]" />
                ) : (
                  <Icon
                    className={`size-5 ${isCurrent ? "animate-pulse" : ""}`}
                  />
                )}

                {isCurrent && (
                  <span className="absolute -right-0.5 -top-0.5 flex size-3">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex size-3 rounded-full border border-zinc-900 bg-emerald-500" />
                  </span>
                )}
              </div>
              {/* 11px é o piso de legibilidade (linha-do-tempo-do-pedido-legivel.test).
                  Os rótulos colavam: em maiúsculas com `tracking-[0.2em]`,
                  "PREPARANDO" passava da coluna (~65px a 375px). Em caixa
                  normal e sem espaçamento extra, cada rótulo cabe na sua
                  coluna com folga para o vizinho. */}
              <span
                className={`mt-3 w-full text-center text-[11px] font-bold leading-tight tracking-normal transition-colors duration-500 ${
                  isActive ? "text-zinc-900" : "text-zinc-500"
                }`}
              >
                {step.label}
              </span>
              <span className="sr-only">
                {isCompleted
                  ? "etapa concluída"
                  : isCurrent
                    ? "etapa atual"
                    : "etapa ainda não alcançada"}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
