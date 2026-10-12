import { cn } from "@/lib/utils";
import { Loader2, type LucideIcon } from "lucide-react";
import type { ComponentPropsWithRef } from "react";

type Variante = "primaria" | "secundaria" | "perigo";

const VARIANTES: Record<Variante, string> = {
  primaria: "bg-admin-gold text-black hover:bg-admin-gold/90",
  secundaria:
    "border border-white/10 bg-white/[0.04] text-zinc-100 hover:bg-white/[0.08]",
  perigo:
    "border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20",
};

/**
 * Botão de ação do painel: alvo de toque de 44px (`min-h-11 min-w-11`, spec
 * painel-simples §7), `type="button"` por padrão (não envia formulário sem
 * querer) e texto em frase normal, 12px ou mais. `carregando` desabilita,
 * marca `aria-busy` e troca o ícone por um spinner — o texto continua, então
 * o nome acessível não muda no meio do clique.
 */
export function AcaoDoPainel({
  variante = "primaria",
  icone: Icone,
  carregando = false,
  disabled,
  className,
  children,
  type = "button",
  ...resto
}: Omit<ComponentPropsWithRef<"button">, "type"> & {
  readonly variante?: Variante;
  readonly icone?: LucideIcon;
  readonly carregando?: boolean;
  readonly type?: "button" | "submit" | "reset";
}) {
  return (
    <button
      {...resto}
      type={type}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold disabled:cursor-not-allowed disabled:opacity-50",
        // eslint-disable-next-line security/detect-object-injection -- chave tipada, não entrada do usuário
        VARIANTES[variante],
        className,
      )}
    >
      {carregando ? (
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      ) : (
        Icone && <Icone aria-hidden="true" className="size-4" />
      )}
      {children}
    </button>
  );
}
