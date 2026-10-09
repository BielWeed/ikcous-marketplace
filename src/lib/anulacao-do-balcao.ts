// Anular venda do balcão (migration 20261204000000): as três decisões de TELA
// que cercam a RPC `anular_venda_presencial`, todas puras.
//
//  1. `podeAnularVendaDoBalcao` — quando o botão aparece. É só ESPELHO: quem
//     decide de verdade é o banco (a RPC recusa o que não for do balcão, do
//     mesmo dia da loja, recebido na hora e inteiro). Esconder o botão evita
//     convidar o lojista a um clique que será recusado; o banco continua a
//     única autoridade (por isso a tela também traduz a recusa).
//  2. `mensagemDaFalhaDaAnulacao` — traduz a falha da RPC em português.
//  3. `orientacaoDeDevolucao` — o app NÃO devolve o dinheiro: ele só corrige o
//     estoque, o Financeiro e o caixa. Devolver ao cliente é feito na mão,
//     e a tela diz como, conforme a forma que o cliente pagou.

import { hojeEmSaoPaulo } from "@/lib/financeiro";
import { formatCurrency } from "@/lib/utils";
import type { Order } from "@/types";

/** O teto do motivo na RPC (`char_length(v_motivo) > 500` → 22023). */
export const MOTIVO_MAXIMO_DA_ANULACAO = 500;

export const FRASE_MOTIVO_OBRIGATORIO = "Informe o motivo para anular a venda.";

/** Espelha o banco: o motivo precisa de ao menos uma letra ou um número (um
 * espaço de largura zero passa no `trim` e não é motivo). */
export function motivoTemTexto(motivo: string): boolean {
  return /[\p{L}\p{N}]/u.test(motivo);
}

/** Só o que a regra do botão lê de um pedido. */
type VendaAnulavel = Pick<
  Order,
  "canal" | "status" | "paymentStatus" | "paymentMethod" | "pagamentoRecebidoEm"
>;

const FORMAS_DO_BALCAO: readonly string[] = ["cash", "pix", "card"];

/**
 * Venda do balcão, entregue, recebida na hora, paga em dinheiro/PIX/maquininha
 * e com o recebimento carimbado HOJE no calendário da loja (America/Sao_Paulo —
 * a mesma régua do Financeiro e da RPC: `fin__dia = fin__hoje`).
 *
 * Não olha `valor_estornado`, devolução nem estorno do app: a ficha não
 * carrega isso, e o banco recusa com a frase certa se existir.
 */
export function podeAnularVendaDoBalcao(
  venda: VendaAnulavel,
  agora: Date = new Date(),
): boolean {
  if (venda.canal !== "presencial") return false;
  if (venda.status !== "delivered") return false;
  if (venda.paymentStatus !== "recebido_na_entrega") return false;
  if (!FORMAS_DO_BALCAO.includes(venda.paymentMethod)) return false;
  if (!venda.pagamentoRecebidoEm) return false;
  const recebidoEm = new Date(venda.pagamentoRecebidoEm);
  if (Number.isNaN(recebidoEm.getTime())) return false;
  return hojeEmSaoPaulo(recebidoEm) === hojeEmSaoPaulo(agora);
}

function codigoDoErro(erro: unknown): string | null {
  if (typeof erro !== "object" || erro === null || !("code" in erro)) {
    return null;
  }
  const codigo = (erro as { code: unknown }).code;
  return typeof codigo === "string" ? codigo : null;
}

function mensagemDoErro(erro: unknown): string | null {
  if (typeof erro !== "object" || erro === null || !("message" in erro)) {
    return null;
  }
  const mensagem = (erro as { message: unknown }).message;
  return typeof mensagem === "string" && mensagem.trim() !== ""
    ? mensagem
    : null;
}

const FRASE_ANULACAO_NAO_LIBERADA =
  "A anulação ainda não está liberada neste servidor. Avise quem cuida do app.";
const FRASE_SEM_CONEXAO =
  "Não consegui confirmar com o servidor. Confira a venda antes de tentar de novo: se ela já foi anulada, o app avisa.";
const FRASE_GENERICA = "Não consegui anular agora. Tente de novo.";

/**
 * Traduz a falha de `anular_venda_presencial`. As frases do banco (22023 e
 * 42501) já são em português e escritas para o lojista — inclusive a do dia
 * que passou ("Só dá para anular no mesmo dia da venda. Para outro dia,
 * registre uma devolução.") —, então só são repassadas. O que o banco NÃO
 * escreve (função inexistente no servidor, rede) vira frase daqui. Nunca
 * mostra código, nome de função nem stack.
 */
export function mensagemDaFalhaDaAnulacao(erro: unknown): string {
  const codigo = codigoDoErro(erro);
  const doBanco = mensagemDoErro(erro);

  // PGRST202: a função não está no schema cache = migration não aplicada
  // nesta loja. Tentar de novo não resolve.
  if (codigo === "PGRST202") return FRASE_ANULACAO_NAO_LIBERADA;
  // Alguns clientes devolvem só o texto ("Could not find the function ...").
  if (doBanco !== null && /could not find the function/i.test(doBanco)) {
    return FRASE_ANULACAO_NAO_LIBERADA;
  }
  // Sem código = não veio do Postgres (rede caindo, fetch abortado).
  if (codigo === null) return FRASE_SEM_CONEXAO;
  if (codigo === "42501") {
    return doBanco ?? "Só quem é da loja pode anular uma venda.";
  }
  if (codigo === "22023") {
    return doBanco ?? "Esta venda não pode ser anulada aqui.";
  }
  return doBanco ?? FRASE_GENERICA;
}

/** Começo da frase quando outro aparelho pode já ter devolvido o dinheiro. */
export const SE_O_DINHEIRO_NAO_VOLTOU =
  "Se o dinheiro ainda não voltou ao cliente,";

/**
 * O que o lojista faz com o dinheiro depois de anular. O app não devolve
 * nada: o estorno é manual, fora dele. Com `talvezJaDevolvido` (a venda já
 * estava anulada: outro aparelho pode ter devolvido) a instrução vira
 * condicional, para o segundo aparelho não mandar devolver duas vezes.
 */
export function orientacaoDeDevolucao(
  forma: string | null | undefined,
  total: number,
  talvezJaDevolvido = false,
): string {
  if (!(total > 0))
    return "A venda não tinha valor: não há dinheiro a devolver.";
  const valor = formatCurrency(total);
  if (talvezJaDevolvido) {
    const antes = SE_O_DINHEIRO_NAO_VOLTOU;
    if (forma === "cash") return `${antes} devolva ${valor} em dinheiro.`;
    if (forma === "pix") return `${antes} devolva ${valor} por PIX.`;
    if (forma === "card") {
      return `${antes} faça o estorno de ${valor} na maquininha.`;
    }
    return `${antes} devolva ${valor}.`;
  }
  if (forma === "cash") return `Devolva ${valor} em dinheiro ao cliente.`;
  if (forma === "pix") return `Devolva ${valor} ao cliente por PIX.`;
  if (forma === "card") {
    return `Faça o estorno de ${valor} na maquininha.`;
  }
  return `Devolva ${valor} ao cliente.`;
}
