import { anunciarAtualizacaoConcluida } from "@/lib/atualizacao/estado-da-atualizacao";
import {
  CHAVE_MOTIVO_DE_RECARGA,
  type RecargaDescrita,
  consumirOrigemDaAtualizacao,
  descreveMotivoDeRecarga,
  limpaMotivoDeRecarga,
} from "@/lib/motivo-de-recarga";
import { registrarNovidadesAoIniciar } from "@/lib/novidades/armazenamento-local";

// Arquivo SEM animação de propósito: o App.tsx importa isto no caminho estático
// do primeiro paint, e a ilha (que usa framer-motion) fica fora dele.
/** Quanto a conclusão anunciada no boot espera a ilha montar. */
export const PRAZO_DE_RESERVA_DO_BOOT_MS = 15_000;

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
  registrarNovidadesAoIniciar(versaoAtual, trocouDeBuild ? de : null);
  limpaMotivoDeRecarga();
  if (trocouDeBuild) {
    anunciarAtualizacaoConcluida({ duracaoMs: PRAZO_DE_RESERVA_DO_BOOT_MS });
    return null;
  }

  const motivo = descreveMotivoDeRecarga(bruto);
  // Inclui os motivos antigos de atualização: sem prova, nenhum deles
  // pode ressuscitar o toast de sucesso que a ilha substituiu.
  return motivo?.tom === "success"
    ? descreveMotivoDeRecarga("atualizacao-nao-confirmada")
    : motivo;
}
