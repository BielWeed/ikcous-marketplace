// O rascunho de um texto LONGO do painel (descrição de Minha loja, texto da
// política de devolução): o que a lojista digitou e ainda não salvou.
//
// Caça "aba descartada perde rascunho" (27/11): ela escreve, troca de app (vai
// tirar uma foto) e o celular descarta a aba — ao voltar, o texto tinha
// sumido. Mesmas regras do rascunho do produto (`rascunho-do-produto.ts`):
//
//  - a chave leva o id da conta (`chaveDoUsuario`): rascunho de uma conta
//    NUNCA aparece para outra no mesmo aparelho. O prefixo `ikcous_` faz o
//    rascunho sobreviver à purga do aparelho (`localStoragePurgeWhitelist`);
//  - o rascunho VENCE em 7 dias, contados do último salvamento: passado isso
//    é um texto de outra época, e sai do aparelho ao ser lido. Sem carimbo
//    legível não dá para provar que vale: conta como vencido;
//  - nenhuma função lança: navegador com "bloquear dados de sites" faz o
//    próprio acesso ao `localStorage` lançar, e isso não pode quebrar a tela
//    nem transformar um salvamento que deu certo em erro.
import { chaveDoUsuario } from "@/lib/fila-offline-por-usuario";

/** Validade do rascunho: 7 dias, a mesma do rascunho do produto. */
export const PRAZO_DO_RASCUNHO_DE_TEXTO_MS = 7 * 24 * 60 * 60 * 1000;

/** Os textos longos do painel que guardam rascunho. */
export type NomeDoRascunhoDeTexto = "sobre-a-loja" | "politica-de-devolucao";

export interface RascunhoDeTexto {
  /** O que ela digitou. */
  readonly texto: string;
  /** O texto salvo quando o rascunho foi guardado (para dizer se mudou depois). */
  readonly base: string;
}

/** Chave no `localStorage` do rascunho DA CONTA (`null` sem conta). */
export function chaveDoRascunhoDeTexto(
  nome: NomeDoRascunhoDeTexto,
  userId: string | undefined,
): string | null {
  if (!userId) return null;
  return chaveDoUsuario(`ikcous_rascunho_de_texto_${nome}`, userId);
}

/** Apaga o rascunho desta chave. Nunca lança. */
export function apagarRascunhoDeTexto(chave: string): void {
  try {
    localStorage.removeItem(chave);
  } catch (erro) {
    console.warn("[rascunho-de-texto] Não consegui apagar o rascunho:", erro);
  }
}

/** Apaga o rascunho da conta ("Descartar e Sair" do aviso de saída). */
export function descartarRascunhoDeTexto(
  nome: NomeDoRascunhoDeTexto,
  userId: string | undefined,
): void {
  const chave = chaveDoRascunhoDeTexto(nome, userId);
  if (chave) apagarRascunhoDeTexto(chave);
}

/**
 * Guarda o texto com o carimbo de agora. Armazenamento cheio ou bloqueado:
 * só o rascunho fica para trás (devolve `false`), a tela segue.
 */
export function gravarRascunhoDeTexto(
  chave: string,
  rascunho: RascunhoDeTexto,
  agora: number = Date.now(),
): boolean {
  try {
    localStorage.setItem(
      chave,
      JSON.stringify({
        texto: rascunho.texto,
        base: rascunho.base,
        salvoEm: agora,
      }),
    );
    return true;
  } catch (erro) {
    console.warn("[rascunho-de-texto] Não consegui guardar o rascunho:", erro);
    return false;
  }
}

/**
 * Lê o rascunho que ainda vale. Vencido, ilegível ou fora do formato: sai do
 * aparelho e vale "sem rascunho". Armazenamento bloqueado: "sem rascunho".
 */
export function lerRascunhoDeTexto(
  chave: string,
  agora: number = Date.now(),
): RascunhoDeTexto | null {
  let bruto: string | null;
  try {
    bruto = localStorage.getItem(chave);
  } catch {
    return null;
  }
  if (!bruto) return null;
  let lido: unknown;
  try {
    lido = JSON.parse(bruto);
  } catch {
    lido = null;
  }
  const { texto, base, salvoEm } = (lido ?? {}) as Record<string, unknown>;
  const valido =
    typeof texto === "string" &&
    typeof base === "string" &&
    typeof salvoEm === "number" &&
    Number.isFinite(salvoEm) &&
    agora - salvoEm <= PRAZO_DO_RASCUNHO_DE_TEXTO_MS;
  if (!valido) {
    apagarRascunhoDeTexto(chave);
    return null;
  }
  return { texto, base };
}
