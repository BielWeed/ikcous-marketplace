import type { OrderStatus } from "@/types";
import { Check, Home, Package, Truck, XCircle } from "lucide-react";

interface OrderTimelineProps {
  status: OrderStatus;
}

export function OrderTimeline({ status }: OrderTimelineProps) {
  const steps = [
    { key: "pending", label: "Recebido", icon: Check },
    { key: "processing", label: "Preparando", icon: Package },
    { key: "shipping", label: "Em rota", icon: Truck },
    { key: "delivered", label: "Entregue", icon: Home },
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

  // Linha COMPACTA (pedido do dono, 24/09/2026, prints a 375px): círculos de
  // 48px e rótulos em caixa-alta com tracking largo encostavam uns nos outros
  // ("PREPARANDO" não cabia na coluna de ~74px). Agora: círculo de 32px,
  // rótulo em caixa normal a 11px (o piso legível do teste de a11y), e a
  // trilha ancorada no CENTRO da 1a e da última coluna (12,5% de cada lado,
  // porque as 4 colunas são flex-1) — antes o recuo era um número mágico em
  // px que desalinhava conforme a largura.
  const progresso = safeIndex / (steps.length - 1);

  return (
    <div className="relative py-1">
      {/* Trilha de fundo, na altura do centro dos círculos (32px / 2) */}
      <div
        aria-hidden="true"
        className="absolute inset-x-[12.5%] top-[19px] h-0.5 rounded-full bg-zinc-100"
      />

      {/* Trilha percorrida */}
      <div
        aria-hidden="true"
        className="absolute left-[12.5%] top-[19px] h-0.5 rounded-full bg-emerald-500 transition-[width] duration-700 ease-out motion-reduce:transition-none"
        style={{ width: `${progresso * 75}%` }}
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
        className="m-0 flex w-full list-none items-start justify-between p-0"
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
              className="relative z-10 flex min-w-0 flex-1 flex-col items-center"
            >
              <div
                aria-hidden="true"
                className={`relative flex size-8 items-center justify-center rounded-full border transition-colors duration-500 ${
                  isCompleted
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : isCurrent
                      ? "border-zinc-900 bg-zinc-900 text-white ring ring-emerald-500/25"
                      : "border-zinc-200 bg-white text-zinc-400"
                }`}
              >
                {isCompleted ? (
                  <Check className="size-3.5 stroke-[3px]" />
                ) : (
                  <Icon className="size-3.5" />
                )}

                {isCurrent && (
                  <span className="absolute -right-0.5 -top-0.5 flex size-2.5">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:animate-none" />
                    <span className="relative inline-flex size-2.5 rounded-full border border-white bg-emerald-500" />
                  </span>
                )}
              </div>
              <span
                className={`mt-1.5 max-w-full truncate px-0.5 text-center text-[11px] leading-tight transition-colors duration-500 ${
                  isCurrent
                    ? "font-bold text-zinc-900"
                    : isActive
                      ? "font-semibold text-zinc-700"
                      : "font-medium text-zinc-500"
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
