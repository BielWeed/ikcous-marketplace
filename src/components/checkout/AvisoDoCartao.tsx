import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Check,
  Clock,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

/**
 * Peças de apresentação da tela do cartão (redesenho de 16/10/2026): o painel
 * de aviso e o botão. Sem regra de pagamento aqui — só aparência e
 * acessibilidade, para todos os estados da tela falarem do mesmo jeito.
 *
 * - Texto de ação com 16 px e alvo de toque de 44 px (`min-h-11`).
 * - Foco visível no teclado.
 * - Quando o painel é de erro, o foco vai para o título assim que ele
 *   aparece: o leitor de tela lê o motivo e quem usa teclado não fica
 *   procurando o que aconteceu.
 * - O giro do spinner respeita `prefers-reduced-motion` (`motion-safe:`).
 */

export type TomDoPainel = "erro" | "alerta" | "info" | "sucesso";

type EstiloDoTom = { caixa: string; icone: string; Icone: LucideIcon };

// `switch`, não objeto indexado por variável: é o que a catraca de segurança
// (`security/detect-object-injection`) aceita.
function estiloDoTom(tom: TomDoPainel): EstiloDoTom {
  switch (tom) {
    case "erro":
      return {
        caixa: "border-red-200 bg-red-50 text-red-900",
        icone: "text-red-600",
        Icone: AlertCircle,
      };
    case "alerta":
      return {
        caixa: "border-amber-300 bg-amber-50 text-amber-950",
        icone: "text-amber-700",
        Icone: Clock,
      };
    case "sucesso":
      return {
        caixa: "border-emerald-200 bg-emerald-50 text-emerald-950",
        icone: "text-emerald-700",
        Icone: Check,
      };
    default:
      return {
        caixa: "border-zinc-200 bg-zinc-50 text-zinc-900",
        icone: "text-zinc-600",
        Icone: Clock,
      };
  }
}

export function PainelDoCartao({
  tom,
  titulo,
  detalhe,
  carregando = false,
  focarNoTitulo = false,
  children,
}: {
  tom: TomDoPainel;
  titulo: ReactNode;
  detalhe?: ReactNode;
  /** Troca o ícone do tom por um spinner (o painel "Confirmando…"). */
  carregando?: boolean;
  /** Painéis de erro: leva o foco ao título ao aparecer. */
  focarNoTitulo?: boolean;
  /** Os botões do painel (`BotaoDoCartao`). */
  children?: ReactNode;
}) {
  const idTitulo = useId();
  const tituloRef = useRef<HTMLParagraphElement>(null);
  const { caixa, icone, Icone } = estiloDoTom(tom);

  useEffect(() => {
    if (focarNoTitulo) tituloRef.current?.focus();
  }, [focarNoTitulo]);

  return (
    <div
      role="group"
      aria-labelledby={idTitulo}
      className={cn("space-y-3 rounded-xl border p-4", caixa)}
    >
      <div className="flex items-start gap-3">
        {carregando ? (
          <Loader2
            aria-hidden="true"
            className={cn(
              "mt-0.5 size-5 shrink-0 motion-safe:animate-spin",
              icone,
            )}
          />
        ) : (
          <Icone
            aria-hidden="true"
            className={cn("mt-0.5 size-5 shrink-0", icone)}
          />
        )}
        <div className="min-w-0 space-y-1">
          {/* `tabIndex={-1}`: recebe foco por código, nunca entra na ordem do
              Tab. O contorno só aparece com o foco vindo do teclado. */}
          <p
            id={idTitulo}
            ref={tituloRef}
            tabIndex={-1}
            className="rounded text-base font-semibold leading-snug outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
          >
            {titulo}
          </p>
          {detalhe ? (
            <div className="text-sm leading-snug">{detalhe}</div>
          ) : null}
        </div>
      </div>
      {children ? <div className="grid gap-2">{children}</div> : null}
    </div>
  );
}

export function BotaoDoCartao({
  variante = "secundario",
  onClick,
  children,
}: {
  variante?: "primario" | "secundario";
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-11 w-full items-center justify-center rounded-xl px-4 py-2.5 text-base font-bold",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2",
        variante === "primario"
          ? "bg-primary text-primary-foreground active:brightness-90"
          : "border border-zinc-300 bg-white text-zinc-900 active:bg-zinc-100",
      )}
    >
      {children}
    </button>
  );
}
