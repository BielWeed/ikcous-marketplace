import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  type LucideIcon,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";

export type TomDoSelo = "ok" | "atencao" | "erro" | "neutro";

// Cada tom tem COR e ÍCONE próprios: a cor nunca é a única pista (regra
// visual do dono; quem não distingue verde de vermelho lê o ícone e o texto).
function tonDoSelo(tom: TomDoSelo): { icone: LucideIcon; classe: string } {
  switch (tom) {
    case "ok":
      return {
        icone: CheckCircle2,
        classe: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
      };
    case "atencao":
      return {
        icone: AlertTriangle,
        classe: "border-amber-500/30 bg-amber-500/10 text-amber-300",
      };
    case "erro":
      return {
        icone: XCircle,
        classe: "border-red-500/30 bg-red-500/10 text-red-300",
      };
    default:
      return {
        icone: Info,
        classe: "border-white/10 bg-zinc-900/60 text-zinc-300",
      };
  }
}

/** Selo de status do painel: ícone (aria-hidden) + texto visível + cor. */
export function SeloDeStatus({
  tom = "neutro",
  children,
  className,
}: {
  readonly tom?: TomDoSelo;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const { icone: Icone, classe } = tonDoSelo(tom);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold",
        classe,
        className,
      )}
    >
      <Icone aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{children}</span>
    </span>
  );
}
