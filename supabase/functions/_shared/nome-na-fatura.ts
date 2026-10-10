/**
 * Nome que aparece na FATURA do cartao do comprador (03/10/2026).
 *
 * POR QUE EXISTE. O checklist de qualidade do Mercado Pago pede o nome da loja
 * na fatura (item 16), e ele reduz a contestacao "nao reconheco esta compra".
 *
 * FONTE (lida em 03/10/2026) — Orders API, `POST /v1/orders`:
 *   https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/create-order/post
 *   (versao markdown: o mesmo caminho com `.md` no fim) —
 *   `transactions.payments[].payment_method.statement_descriptor` (string,
 *   opcional): "Description used to identify the charge on the buyer's payment
 *   method statement. Send this value in each order creation request where
 *   you want the description to appear... Accepts up to 50 characters."
 *
 * O LIMITE. A referencia da Orders API diz 50, mas as DEMAIS referencias do
 * MP dizem menos para o mesmo conceito: 13 caracteres no Checkout Pro
 * (`checkout-pro-preferences/additional-settings/invoice-description`) e
 * "aproximadamente 10, conforme o emissor" no `config.statement_descriptor`
 * da order do Checkout Pro. A bandeira e o emissor truncam de qualquer jeito,
 * entao o limite aqui e' o MENOR que o proprio MP documenta com numero — 13 —:
 * um nome mais curto so' perde caracteres que a fatura cortaria, e um mais
 * longo arriscaria um 400 (que a repeticao sem opcionais cobre, mas e' uma
 * chamada a mais). Os caracteres permitidos NAO estao documentados para a
 * Orders API: fica so' o que e' seguro em qualquer sistema — A-Z, 0-9 e espaco.
 *
 * REGRA DE OURO: e' OPCIONAL e DEFENSIVO. Nome ausente, vazio ou imprestavel
 * NAO manda o campo; nunca lanca; nada e' logado (o nome da loja pode ser
 * dado de cliente); a leitura nunca segura a cobranca alem do prazo.
 */

import { comPrazo, PRAZO_DA_LEITURA_MS } from "./dados-antifraude.ts";

/** Menor limite que o MP documenta com numero para o nome na fatura. */
export const LIMITE_DO_NOME_NA_FATURA = 13;

/** Entrada acima disto e' lixo, nao nome de loja — corta antes de normalizar. */
const TETO_DA_ENTRADA = 200;

/**
 * Nome da loja -> texto para `statement_descriptor`: sem acento (decompoe e
 * descarta as marcas; `NFKD` tambem traz largura total e ligaduras para ASCII),
 * so' A-Z, 0-9 e espaco (o resto vira espaco, colapsado), MAIUSCULO, cortado
 * em `LIMITE_DO_NOME_NA_FATURA` sem espaco sobrando nas pontas. Vazio ou
 * nao-texto -> `undefined` (o campo nao e' enviado). Idempotente: normalizar
 * a saida devolve a saida — e' por isso que `montarCorpoCartaoOrders` pode
 * conferir de novo sem divergir de quem leu.
 */
export function nomeNaFatura(bruto: unknown): string | undefined {
  if (typeof bruto !== "string") return undefined;
  const limpo = bruto
    .slice(0, TETO_DA_ENTRADA)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toUpperCase();
  const cortado = limpo.slice(0, LIMITE_DO_NOME_NA_FATURA).trim();
  return cortado === "" ? undefined : cortado;
}

/** O que se usa do cliente Supabase: so' `.from(...)` e a cadeia de leitura. */
// deno-lint-ignore no-explicit-any
type ClienteDeLeitura = { from: (tabela: string) => any };

/**
 * Le o nome da loja (`store_config.store_name`, a MESMA leitura do comprovante
 * por e-mail) e devolve ja normalizado. MELHOR ESFORCO: erro de banco, excecao,
 * linha ausente, nome imprestavel ou demora acima de `prazoMs` -> `undefined`.
 * Nunca lanca, nunca loga.
 */
export async function lerNomeNaFatura(
  banco: unknown,
  prazoMs: number = PRAZO_DA_LEITURA_MS,
): Promise<string | undefined> {
  if (!banco || typeof (banco as ClienteDeLeitura).from !== "function") return undefined;
  const nome = await comPrazo(async () => {
    const resposta = await (banco as ClienteDeLeitura).from("store_config").select("store_name").limit(1)
      .maybeSingle();
    if (!resposta || resposta.error) return undefined;
    return nomeNaFatura(resposta.data?.store_name);
  }, prazoMs);
  return nome ?? undefined;
}
