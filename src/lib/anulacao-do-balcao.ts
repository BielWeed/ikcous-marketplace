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
import { fraseEscritaPelaCasa } from "@/lib/frase-escrita-pela-casa";
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
  // `code: ""` é o que o postgrest-js devolve quando o `fetch` falhou: não veio
  // resposta do servidor, então não há código (e a mensagem é texto de rede).
  return typeof codigo === "string" && codigo !== "" ? codigo : null;
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
export const FRASE_SEM_CONEXAO_DA_ANULACAO =
  "Não consegui confirmar com o servidor. Confira a venda antes de tentar de novo: se ela já foi anulada, o app avisa.";
const FRASE_SESSAO_EXPIRADA =
  "A sua sessão expirou. Saia e entre de novo na conta e tente anular de novo.";
const FRASE_GENERICA = "Não consegui anular agora. Tente de novo.";

// F7 do painel simples — venda do balcão não se CANCELA (nasce entregue, e
// "Cancelar pedido" não existe para entregue): o caminho é ANULAR, e só no
// mesmo dia. A 1ª frase é a da recusa do banco (migration 20261204000000,
// `anular_venda_presencial`); a 2ª da recusa ("registre uma devolução") NÃO
// vale aqui: o lojista não abre devolução de balcão no painel
// (`solicitar_devolucao` exige o cliente logado, `user_id = auth.uid()`).
// No balcão não há arrependimento (ele exige canal 'online'): sobra troca ou
// vício, pedidos pelo cliente — e só se a venda nasceu na conta dele
// (`registrar_venda_presencial(p_cliente_user_id)`; não há vínculo depois).
// A ficha do pedido e o recibo da tela Vender dizem a MESMA coisa: a frase
// mora aqui, num lugar só.
export const FRASE_ANULAR_SO_NO_MESMO_DIA =
  "Só dá para anular no mesmo dia da venda.";
export const DEPOIS_DO_DIA_COM_CLIENTE =
  "Depois disso, a troca ou o reparo de defeito só podem ser pedidos pelo cliente, no app, dentro do prazo da loja.";
export const DEPOIS_DO_DIA_SEM_CLIENTE =
  "Esta venda não está na conta de nenhum cliente: o app não abre devolução para ela.";

/** O pedido de "registre uma devolução" que o banco acrescenta às recusas do
 * dia ("Para outro dia, registre uma devolução.") e do recebimento refeito
 * ("... Registre uma devolução."). */
const PEDIDO_DE_DEVOLUCAO =
  /\s*(?:Para outro dia, )?registre uma devolu(?:ç|c)(?:ã|a)o\.?/i;

/**
 * Tira da frase do banco o "registre uma devolução", que a lojista não tem
 * como fazer. Na recusa do dia, no lugar dele entra o que de fato resta (a
 * mesma frase da ficha do pedido); nas demais, só some o pedido impossível.
 */
function semPedidoDeDevolucao(frase: string, clienteComConta: boolean): string {
  if (!PEDIDO_DE_DEVOLUCAO.test(frase)) return frase;
  const resto = frase.replace(PEDIDO_DE_DEVOLUCAO, "").trim();
  if (resto === FRASE_ANULAR_SO_NO_MESMO_DIA) {
    return `${resto} ${
      clienteComConta ? DEPOIS_DO_DIA_COM_CLIENTE : DEPOIS_DO_DIA_SEM_CLIENTE
    }`;
  }
  return resto;
}

/**
 * Traduz a falha de `anular_venda_presencial`. A frase do banco só chega à
 * tela quando a CASA a escreveu (`fraseEscritaPelaCasa`: os `RAISE` em
 * português das migrations, com 22023/42501, ou sem código, com P0001/P0002) —
 * com uma exceção: o "registre uma devolução" do fim das recusas do dia e do
 * recebimento refeito vira o que resta de verdade (ver `semPedidoDeDevolucao`;
 * `clienteComConta` escolhe a frase). Texto técnico do Postgres/PostgREST
 * ("canceling statement due to statement timeout", "JWT expired", "permission
 * denied for function ...") nunca aparece, nem sob um código que a casa
 * também usa: vira frase daqui. Estouro do servidor (57014) e conexão caindo
 * (08, 57P) não provam que NÃO anulou, e a tela não afirma nem uma coisa nem
 * outra: manda conferir. Nunca mostra código, nome de função nem stack.
 */
export function mensagemDaFalhaDaAnulacao(
  erro: unknown,
  clienteComConta = false,
): string {
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
  if (codigo === null) return FRASE_SEM_CONEXAO_DA_ANULACAO;
  // Sessão vencida no PostgREST: a chamada nem chegou à função.
  if (codigo === "PGRST301" || codigo === "PGRST302" || codigo === "PGRST303") {
    return FRASE_SESSAO_EXPIRADA;
  }
  // Estouro de tempo do banco ou conexão/servidor caindo: pode ter anulado.
  if (
    codigo === "57014" ||
    codigo.startsWith("08") ||
    codigo.startsWith("57P")
  ) {
    return FRASE_SEM_CONEXAO_DA_ANULACAO;
  }
  const daCasa = fraseEscritaPelaCasa(codigo, doBanco);
  if (codigo === "42501") {
    return daCasa ?? "Só quem é da loja pode anular uma venda.";
  }
  if (codigo === "22023") {
    return daCasa
      ? semPedidoDeDevolucao(daCasa, clienteComConta)
      : "Esta venda não pode ser anulada aqui.";
  }
  return daCasa ?? FRASE_GENERICA;
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
