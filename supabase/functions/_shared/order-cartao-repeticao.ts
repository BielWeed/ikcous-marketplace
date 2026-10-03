/**
 * Criação da order de CARTÃO com UMA repetição sem os campos opcionais de
 * antifraude (03/10/2026).
 *
 * POR QUE EXISTE. Os campos de antifraude (`items`, `payer.phone`,
 * `payer.address`, `shipment`, e o nome na fatura) são OPCIONAIS na Orders
 * API — e um deles recusado (400 `property_value` em `items[0].external_code`,
 * em compra real) derrubou a cobrança de cartão INTEIRA. Falta de sinal só
 * enfraquece o antifraude; um 400 impede o cliente de pagar. Então: quando o
 * MP recusa a REQUISIÇÃO por validação e a recusa aponta SOMENTE para campo
 * opcional, repete-se UMA vez sem eles.
 *
 * O QUE TORNA ISSO SEGURO (cada item tem teste e mutação em
 * `order-cartao-repeticao_test.ts`):
 *
 *  1. SÓ o HTTP 400. Timeout/rede (status 0), 5xx, 408, 409, 423 e 429 deixam
 *     o resultado DESCONHECIDO — o MP pode ter criado a order antes de a
 *     resposta se perder, e uma segunda chamada com chave nova cobraria em
 *     dobro. 402 é "a order FOI criada e o pagamento falhou" (tabela de erros
 *     da referência create-order): repetir geraria outra order. 401/403 não
 *     processaram nada e repetir não muda a credencial.
 *  2. Um 400 de validação é recusa da REQUISIÇÃO, anterior à criação da order
 *     (a mesma tabela de erros reserva "Order was created but some transaction
 *     failed" ao 402). Defesa em profundidade: se o corpo do erro carregar uma
 *     order (`id`/`data`), NÃO repete — ela poderia existir.
 *  3. A repetição usa uma chave de idempotência NOVA (`<chave>:r1`). A doc da
 *     Orders API devolve 409 `idempotency_key_already_used` para a MESMA chave
 *     com corpo DIFERENTE, e não documenta se um 400 "consome" a chave; a
 *     própria doc manda, no 409, "tentar de novo com um valor novo". Chave
 *     nova NUNCA é recusada como duplicada, e não duplica cobrança porque a
 *     chamada anterior (400) não criou order (item 2). A chave nova não colide
 *     com a da próxima tentativa do pedido (`:c<n+1>`).
 *  4. NO MÁXIMO duas chamadas: o resultado da segunda é o resultado final.
 *  5. Só vale se TODOS os erros são de validação de campo E TODOS os campos
 *     citados são opcionais — erro sem campo identificável, campo obrigatório
 *     (`payer.email`, `transactions...`, `total_amount`) ou campo misto NÃO
 *     repete: sem prova de que é só opcional, vale o comportamento de antes.
 */
import { caminhosDeCampoPorErro, criarOrder } from "./mercadopago.ts";

/** `errors[].code` de validação de CAMPO da referência create-order. Ficam
 * de fora, de propósito: `required_properties` (falta algo obrigatório),
 * `invalid_total_amount`, `invalid_card_token`, idempotência, e tudo que não
 * é "um valor de propriedade está errado". */
const CODIGOS_400_DE_VALIDACAO_DE_CAMPO = new Set([
  "property_value",
  "property_type",
  "invalid_properties",
  "unsupported_properties",
  "maximum_items",
  "minimum_items",
]);

/** Raízes opcionais (índice de array já removido). */
const RAIZES_OPCIONAIS = ["items", "payer.phone", "payer.address", "shipment"];
const CAMINHO_DO_NOME_NA_FATURA = "transactions.payments.payment_method.statement_descriptor";

function ehCaminhoOpcional(caminho: string): boolean {
  const semIndice = caminho.replace(/\[\d+\]/g, "");
  if (semIndice === CAMINHO_DO_NOME_NA_FATURA) return true;
  return RAIZES_OPCIONAIS.some((raiz) => semIndice === raiz || semIndice.startsWith(`${raiz}.`));
}

/** `type` sozinho é a palavra da frase ("must be of type integer"), não o
 * campo `type` da order — e o `type` real nunca é opcional. */
function ehCampoDeVerdade(caminho: string): boolean {
  return caminho !== "type";
}

/**
 * O corpo de erro de um 400 recusa SOMENTE campos opcionais de antifraude?
 * `false` na dúvida — quem chama então NÃO repete.
 */
export function recusaApontaSoCamposOpcionais(corpoDoErro: unknown): boolean {
  if (!corpoDoErro || typeof corpoDoErro !== "object") return false;
  const corpo = corpoDoErro as Record<string, unknown>;
  // Order no corpo do erro = ela pode existir: nunca repete.
  if ((corpo.id !== undefined && corpo.id !== null) || (corpo.data !== undefined && corpo.data !== null)) {
    return false;
  }
  const erros = Array.isArray(corpo.errors) ? corpo.errors : [];
  if (erros.length === 0) return false;
  const caminhosPorErro = caminhosDeCampoPorErro(corpo);
  return erros.every((erro, i) => {
    const codigo = (erro as Record<string, unknown> | null)?.code;
    if (typeof codigo !== "string" || !CODIGOS_400_DE_VALIDACAO_DE_CAMPO.has(codigo)) return false;
    const caminhos = (caminhosPorErro.at(i) ?? []).filter(ehCampoDeVerdade);
    return caminhos.length > 0 && caminhos.every(ehCaminhoOpcional);
  });
}

/**
 * Cópia do corpo SEM `items`, `shipment`, `payer.phone`, `payer.address` e o
 * nome na fatura. Não altera o original. `removeu` diz se havia algo a tirar
 * (sem isso a "repetição" mandaria o mesmo corpo).
 */
export function corpoSemCamposOpcionais(
  corpo: Record<string, unknown>,
): { corpo: Record<string, unknown>; removeu: boolean } {
  const copia = structuredClone(corpo);
  let removeu = false;
  const tirar = (objeto: unknown, chave: string) => {
    if (objeto && typeof objeto === "object" && Object.hasOwn(objeto, chave)) {
      Reflect.deleteProperty(objeto, chave);
      removeu = true;
    }
  };
  tirar(copia, "items");
  tirar(copia, "shipment");
  tirar(copia.payer, "phone");
  tirar(copia.payer, "address");
  const transacoes = copia.transactions as Record<string, unknown> | undefined;
  const pagamentos = Array.isArray(transacoes?.payments) ? transacoes.payments as unknown[] : [];
  for (const pagamento of pagamentos) {
    tirar((pagamento as Record<string, unknown> | null)?.payment_method, "statement_descriptor");
  }
  return { corpo: copia, removeu };
}

/** Chave de idempotência da repetição: derivada da original, sempre DIFERENTE
 * dela, e sem colidir com `:c<n>` (a próxima tentativa do pedido). */
function chaveDaRepeticao(chave: string): string {
  return `${chave}:r1`;
}

/**
 * `criarOrder` do cartão com a repetição descrita no topo do arquivo. Mesmo
 * contrato de `criarOrder` (nunca rejeita; `{ ok: false, status }` nos erros) —
 * o resultado devolvido é o da ÚLTIMA chamada feita.
 */
export async function criarOrderDeCartao(
  args: Parameters<typeof criarOrder>[0],
): ReturnType<typeof criarOrder> {
  const primeira = await criarOrder(args);
  if (primeira.ok || primeira.status !== 400) return primeira;
  if (!recusaApontaSoCamposOpcionais(primeira.corpoDoErro)) return primeira;
  const { corpo, removeu } = corpoSemCamposOpcionais(args.corpo);
  if (!removeu) return primeira;

  // Só os CAMINHOS dos campos (já provados opcionais) vão para o log — nunca
  // valor, nunca o corpo. O mesmo corte do `resumoSemDadoPessoal`: três
  // dígitos seguidos num "caminho" seriam valor colado.
  const campos = [...new Set(caminhosDeCampoPorErro(primeira.corpoDoErro).flat().filter(ehCampoDeVerdade))]
    .filter((c) => !/\d{3,}/.test(c))
    .slice(0, 6);
  console.warn(
    "mercadopago: orders (cartão) repetindo UMA vez sem os campos opcionais de antifraude",
    JSON.stringify({ campos }),
  );
  return await criarOrder({ ...args, corpo, chaveIdempotencia: chaveDaRepeticao(args.chaveIdempotencia) });
}
