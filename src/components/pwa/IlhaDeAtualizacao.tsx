import {
  anunciarAtualizacaoConcluida,
  useEstadoDaAtualizacao,
} from "@/lib/atualizacao/estado-da-atualizacao";
import { cn } from "@/lib/utils";
import { CheckCircle2, Clock3, LoaderCircle } from "lucide-react";
import { useEffect } from "react";

type VarianteDaIlha = "cliente" | "painel";

/** A mesma regra governa a cápsula, seu espaço e o degrau da barra. */
export function useIlhaDeAtualizacaoAtiva(
  variante: VarianteDaIlha = "cliente",
): boolean {
  const { fase } = useEstadoDaAtualizacao();
  return (
    fase === "instalando" ||
    fase === "concluida" ||
    (variante === "painel" && fase === "aguardando")
  );
}

export function IlhaDeAtualizacao({
  variante = "cliente",
  className,
}: {
  variante?: VarianteDaIlha;
  className?: string;
}) {
  const { fase } = useEstadoDaAtualizacao();
  // O boot anuncia a conclusão com um prazo longo de reserva: no painel, a
  // barra só monta depois de o acesso ser conferido, e os 3 s não podem
  // correr antes de a ilha existir na tela. Ao montar, o prazo recomeça —
  // mesma fase, então ninguém é avisado de nada além do novo temporizador.
  useEffect(() => {
    if (fase === "concluida") anunciarAtualizacaoConcluida();
  }, [fase]);
  let texto = "";
  if (fase === "instalando") texto = "Atualizando o app…";
  if (fase === "concluida") texto = "Pronto! App atualizado";
  if (fase === "aguardando" && variante === "painel") {
    texto = "Atualização pronta";
  }
  const Icone =
    fase === "instalando"
      ? LoaderCircle
      : fase === "concluida"
        ? CheckCircle2
        : Clock3;

  return (
    // A região fica montada vazia antes de receber texto: leitores de tela
    // podem anunciar a mudança sem mover o foco de quem está trabalhando.
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="contents"
    >
      {texto && (
        <span
          className={cn(
            // Entrada por CSS (tailwindcss-animate), sem framer-motion no
            // primeiro paint; `motion-safe:` já respeita "menos movimento".
            "inline-flex min-h-9 min-w-0 max-w-full motion-safe:duration-300 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-90 items-center gap-2 overflow-hidden rounded-full border border-zinc-700 bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 py-1.5 pl-2 pr-3.5 text-white shadow-[0_8px_25px_rgba(0,0,0,0.4)]",
            variante === "painel" && "min-h-6 gap-1 px-2 py-0.5 shadow-sm",
            className,
          )}
        >
          <Icone
            aria-hidden="true"
            className={cn(
              "shrink-0",
              variante === "painel" ? "size-3.5" : "size-5",
              fase === "concluida" ? "text-emerald-300" : "text-zinc-200",
              fase === "instalando" && "motion-safe:animate-spin",
            )}
          />
          <span
            className={cn(
              "min-w-0 whitespace-normal text-[11px] font-bold leading-tight tracking-tight sm:text-xs",
              variante === "painel" &&
                "whitespace-nowrap text-[10px] sm:text-[10px]",
            )}
          >
            {texto}
          </span>
        </span>
      )}
    </span>
  );
}
