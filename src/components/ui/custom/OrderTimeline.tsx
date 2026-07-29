import type { OrderStatus } from "@/types";
import { Check, Home, Package, Truck, XCircle } from "lucide-react";

interface OrderTimelineProps {
  status: OrderStatus;
}

export function OrderTimeline({ status }: OrderTimelineProps) {
  const steps = [
    { key: "pending", label: "Recebido", icon: Check },
    { key: "processing", label: "Preparando", icon: Package },
    { key: "shipping", label: "Em Rota", icon: Truck },
    { key: "delivered", label: "Entregue", icon: Home },
  ];

  if (status === "cancelled") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-red-600">
        <XCircle className="size-5" />
        <span className="text-sm font-medium">Pedido Cancelado</span>
      </div>
    );
  }

  const currentStepIndex = steps.findIndex((s) => s.key === status);
  // Se o status for um que não mapeamos (raro), garantimos um fallback
  const safeIndex = currentStepIndex === -1 ? 0 : currentStepIndex;

  return (
    <div className="relative flex w-full items-start justify-between px-2 py-6">
      {/* Background Line */}
      <div className="absolute inset-x-[30px] top-[48px] h-[3px] rounded-full bg-zinc-100" />

      {/* Active Line */}
      <div
        className="absolute left-[30px] top-[48px] h-[3px] rounded-full bg-emerald-500 transition-all duration-1000 ease-in-out"
        style={{
          width: `calc(${Math.max(0, (safeIndex / (steps.length - 1)) * 100)}% - 0px)`,
          maxWidth: "calc(100% - 60px)",
        }}
      />

      {steps.map((step, index) => {
        const Icon = step.icon;
        const isActive = index <= safeIndex;
        const isCompleted = index < safeIndex;
        const isCurrent = index === safeIndex;

        return (
          <div
            key={step.key}
            className="relative z-10 flex flex-1 flex-col items-center"
          >
            <div
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
            <span
              className={`mt-3 text-center text-[8px] font-black uppercase tracking-[0.2em] transition-colors duration-500 ${
                isActive ? "text-zinc-900" : "text-zinc-300"
              }`}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
