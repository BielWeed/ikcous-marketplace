import {
  anunciarAtualizacaoConcluida,
  useEstadoDaAtualizacao,
} from "@/lib/atualizacao/estado-da-atualizacao";
import {
  CHAVE_MOTIVO_DE_RECARGA,
  type RecargaDescrita,
  consumirOrigemDaAtualizacao,
  descreveMotivoDeRecarga,
  limpaMotivoDeRecarga,
} from "@/lib/motivo-de-recarga";
import { registrarNovidadesDaAtualizacao } from "@/lib/novidades/armazenamento-local";
import { cn } from "@/lib/utils";
import { nucleoSemver } from "@/lib/versao-do-servidor";
import { motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, Clock3, LoaderCircle } from "lucide-react";
import { useEffect } from "react";

/** Se nenhuma ilha chegar a montar, a conclusão some sozinha depois disto. */
const PRAZO_DE_RESERVA_DO_BOOT_MS = 15_000;

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
  const reduzMovimento = useReducedMotion();
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
    texto = "Atualização pronta — instala ao terminar";
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
        <motion.span
          initial={
            reduzMovimento ? false : { opacity: 0, scale: 0.8, width: 36 }
          }
          animate={{ opacity: 1, scale: 1, width: "auto" }}
          transition={
            reduzMovimento
              ? { duration: 0 }
              : { type: "spring", stiffness: 350, damping: 30, mass: 0.8 }
          }
          className={cn(
            "inline-flex min-h-9 min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-full border border-zinc-700 bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 py-1.5 pl-2 pr-3.5 text-white shadow-[0_8px_25px_rgba(0,0,0,0.4)]",
            className,
          )}
        >
          <Icone
            aria-hidden="true"
            className={cn(
              "size-5 shrink-0",
              fase === "concluida" ? "text-emerald-300" : "text-zinc-200",
              fase === "instalando" &&
                !reduzMovimento &&
                "animate-spin motion-reduce:animate-none",
            )}
          />
          <span className="min-w-0 whitespace-normal text-[11px] font-bold leading-tight tracking-tight sm:text-xs">
            {texto}
          </span>
        </motion.span>
      )}
    </span>
  );
}

/** Consome a prova uma vez. Só o boot de outro build anuncia conclusão;
 * recuperações continuam com seu aviso neutro, devolvido para o App. */
export function aoIniciarAposAtualizacao(
  versaoAtual: string,
): RecargaDescrita | null {
  let bruto: string | null = null;
  try {
    bruto = localStorage.getItem(CHAVE_MOTIVO_DE_RECARGA);
  } catch {
    // A evidência da aba ainda pode existir com localStorage indisponível.
  }
  const { trocouDeBuild, de } = consumirOrigemDaAtualizacao(versaoAtual);
  limpaMotivoDeRecarga();
  if (trocouDeBuild) {
    anunciarAtualizacaoConcluida({ duracaoMs: PRAZO_DE_RESERVA_DO_BOOT_MS });
    const para = nucleoSemver(versaoAtual);
    if (para) {
      registrarNovidadesDaAtualizacao({ de: nucleoSemver(de), para });
    }
    return null;
  }

  const motivo = descreveMotivoDeRecarga(bruto);
  // Inclui os motivos antigos de atualização: sem prova, nenhum deles
  // pode ressuscitar o toast de sucesso que a ilha substituiu.
  return motivo?.tom === "success"
    ? descreveMotivoDeRecarga("atualizacao-nao-confirmada")
    : motivo;
}
