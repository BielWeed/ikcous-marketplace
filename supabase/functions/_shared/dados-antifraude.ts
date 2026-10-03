/**
 * Dados do COMPRADOR e do PRODUTO que o cartão manda ao antifraude do
 * Mercado Pago (03/10/2026).
 *
 * POR QUE EXISTE. Duas compras reais de teste (crédito, 2x) foram recusadas
 * pelo motor de segurança do MP ("não passar nos controles de segurança") e
 * o painel mostrava a venda como "Produto sem nome": o corpo do cartão só
 * levava e-mail, nome e CPF. A doc oficial pede "o máximo de dados sobre o
 * comprador e o produto" para o motor decidir.
 *
 * FONTE (lida em 03/10/2026):
 *   - https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/create-order/post
 *     (versão em markdown: o mesmo caminho com `.md` no fim) — `items[]`
 *     (title ≤150, description ≤100, unit_price STRING ≤18, quantity
 *     inteiro, external_code, picture_url, category_id), `payer.phone`
 *     {area_code, number}, `payer.address` e `shipment.address` {zip_code,
 *     street_name, street_number, neighborhood, city, state (EXATAMENTE 2
 *     caracteres), complement}. Tudo opcional para cartão.
 *   - https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-management/improve-payment-approval/industry-data
 *     (seção Retail: items + payer.phone + payer.address).
 *
 * O QUE DE PROPÓSITO NÃO SE ENVIA:
 *   - `additional_info` — as páginas de recomendação e de dados de indústria
 *     o citam, mas o esquema de CREATE ORDER não o lista, e a mesma página
 *     documenta `400 unsupported_properties` para campo fora do esquema. Um
 *     400 derruba TODO pagamento de cartão; a falta de sinal só enfraquece o
 *     antifraude. Sem prova de aceitação, não vai.
 *   - `items[].category_id` (a doc exemplifica "MLB1055"/"travel", sem
 *     lista de valores aceitos; a categoria da loja é texto livre) e
 *     `items[].picture_url` (o RPC do pedido nem grava `image_url`).
 *
 * REGRA DE OURO: tudo aqui é OPCIONAL e DEFENSIVO. Dado ausente ou torto é
 * OMITIDO — nunca lança, nunca bloqueia o pagamento, nunca vira campo torto.
 * Nada é logado. A soma dos itens só vai quando FECHA, em centavos, com o
 * `total_amount` (ver `camposDoComprador`): a doc não afirma, para esta API,
 * que a soma precisa fechar — e um exemplo dela próprio não fecha —, então a
 * garantia de "nunca rejeitado por soma" é não mandar quando não fecha.
 */

import { ehRetiradaNaLoja } from "./retirada-na-loja.ts";

/** Teto de linhas em `items` (produtos + frete). A doc cita `maximum_items`
 * sem dizer o número; 20 cobre qualquer carrinho desta loja com folga. */
const LIMITE_DE_LINHAS = 20;
/** Quantidade por linha: acima disto o dado é lixo, não compra. */
const TETO_DA_QUANTIDADE = 9999;
/** Teto de preço unitário em centavos (R$ 999.999.999,99 — bem abaixo dos
 * 18 caracteres que a doc permite). */
const TETO_EM_CENTAVOS = 99_999_999_999;

export type ItemDaOrder = {
  title: string;
  unit_price: string;
  quantity: number;
  description: string;
  external_code?: string;
};

export type EnderecoDaOrder = {
  zip_code: string;
  street_name: string;
  street_number: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  complement?: string;
};

export type TelefoneDaOrder = { area_code: string; number: string };

export type DadosDoComprador = {
  items?: ItemDaOrder[];
  phone?: TelefoneDaOrder;
  address?: EnderecoDaOrder;
  shipmentAddress?: EnderecoDaOrder;
};

/** O que `montarCorpoCartaoOrders` junta ao corpo — já revalidado. */
export type CamposParaOCorpo = {
  phone?: TelefoneDaOrder;
  address?: EnderecoDaOrder;
  items?: ItemDaOrder[];
  shipment?: { address: EnderecoDaOrder };
};

function tentar<T>(fabrica: () => T): T | undefined {
  try {
    return fabrica();
  } catch {
    return undefined;
  }
}

function objetoSimples(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? valor as Record<string, unknown>
    : null;
}

/** Texto aparado, sem caractere de controle (vira espaço), espaços
 * colapsados e cortado em `max` caracteres. Vazio ou não-texto → undefined. */
function textoLimpo(valor: unknown, max: number): string | undefined {
  if (typeof valor !== "string") return undefined;
  let saida = "";
  for (const caractere of valor) {
    const codigo = caractere.codePointAt(0) ?? 0;
    saida += codigo <= 0x1f || codigo === 0x7f ? " " : caractere;
  }
  const limpo = saida.trim().replace(/\s+/g, " ");
  if (limpo === "") return undefined;
  return Array.from(limpo).slice(0, max).join("").trim() || undefined;
}

/** Dinheiro → centavos INTEIROS e exatos, ou undefined (≤ 0, não numérico,
 * mais de duas casas, absurdo). Aceita número ou texto "12.50". */
function emCentavos(valor: unknown): number | undefined {
  let numero = NaN;
  if (typeof valor === "number") numero = valor;
  else if (typeof valor === "string") {
    // Texto "12" ou "12.5" ou "12.50" — separado à mão, sem regex aninhada.
    const texto = valor.trim();
    const partes = texto.split(".");
    if (
      partes.length <= 2 && /^\d+$/.test(partes[0]) &&
      (partes.length === 1 || /^\d{1,2}$/.test(partes[1]))
    ) numero = Number(texto);
  }
  if (!Number.isFinite(numero) || numero <= 0) return undefined;
  const centavos = Math.round(numero * 100);
  if (Math.abs(numero * 100 - centavos) > 1e-6) return undefined;
  if (centavos > TETO_EM_CENTAVOS) return undefined;
  return centavos;
}

const comoDinheiro = (centavos: number): string => (centavos / 100).toFixed(2);

// ─── telefone ────────────────────────────────────────────────────────────────

/**
 * Telefone brasileiro → `payer.phone` {area_code, number}, só dígitos.
 * Aceita máscara e DDI 55; exige DDD válido e 8 dígitos (fixo) ou 9 (celular,
 * começa em 9). Número de um dígito repetido é lixo. Qualquer outra coisa →
 * undefined.
 */
export function telefoneDoPagador(bruto: unknown): TelefoneDaOrder | undefined {
  if (typeof bruto !== "string") return undefined;
  let digitos = bruto.replace(/\D/g, "");
  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) {
    digitos = digitos.slice(2);
  }
  if (digitos.length !== 10 && digitos.length !== 11) return undefined;
  const area_code = digitos.slice(0, 2);
  const number = digitos.slice(2);
  if (!/^[1-9][1-9]$/.test(area_code)) return undefined;
  const formatoOk = digitos.length === 11 ? /^9\d{8}$/.test(number) : /^[2-9]\d{7}$/.test(number);
  if (!formatoOk) return undefined;
  if (/^(\d)\1+$/.test(number)) return undefined;
  return { area_code, number };
}

// ─── endereço ────────────────────────────────────────────────────────────────

/**
 * Endereço (`{cep, street, number, neighborhood, city, state, complement}` —
 * o formato do snapshot do pedido E da linha de `user_addresses`) → campos da
 * Orders API. A unidade mínima é CEP de 8 dígitos + rua + número; sem isso,
 * undefined. Campo opcional torto (UF que não tem 2 letras, texto vazio, tipo
 * errado) sai SOZINHO, sem derrubar o resto. Só as sete chaves da lista — o
 * CPF, que já esteve neste objeto, nunca passa.
 */
export function enderecoDaOrder(bruto: unknown): EnderecoDaOrder | undefined {
  const origem = objetoSimples(bruto);
  if (!origem) return undefined;
  const { cep, street, number, neighborhood, city, state, complement } = origem;

  const zip_code = typeof cep === "string" ? cep.replace(/\D/g, "") : "";
  if (!/^\d{8}$/.test(zip_code)) return undefined;
  const street_name = textoLimpo(street, 100);
  if (!street_name) return undefined;
  const numeroBruto = typeof number === "number" && Number.isFinite(number) ? String(number) : number;
  const street_number = textoLimpo(numeroBruto, 20);
  if (!street_number) return undefined;

  const endereco: EnderecoDaOrder = { zip_code, street_name, street_number };
  const bairro = textoLimpo(neighborhood, 60);
  if (bairro) endereco.neighborhood = bairro;
  const cidade = textoLimpo(city, 60);
  if (cidade) endereco.city = cidade;
  const uf = textoLimpo(state, 10);
  if (uf && /^[A-Za-z]{2}$/.test(uf)) endereco.state = uf.toUpperCase();
  const complemento = textoLimpo(complement, 60);
  if (complemento) endereco.complement = complemento;
  return endereco;
}

/** O pedido é RETIRADA na loja? (`shipping_option_id` "store-pickup" — o
 * contrato único de `retirada-na-loja.ts` —, ou o retrato do endereço da loja que a RPC grava só nesse caso.) Retirada não
 * tem endereço de entrega. */
export function retiradaNaLoja(pedido: unknown): boolean {
  return tentar(() => {
    const dados = objetoSimples(objetoSimples(pedido)?.customer_data);
    if (!dados) return false;
    if (ehRetiradaNaLoja(dados.shipping_option_id)) return true;
    return typeof dados.pickup_address === "string" && dados.pickup_address.trim() !== "";
  }) ?? false;
}

// ─── itens ───────────────────────────────────────────────────────────────────

/**
 * Linhas de `marketplace_order_items` (+ o frete do pedido) → `items` da
 * Orders API. O frete maior que zero entra como a linha "Frete", para a soma
 * poder fechar com o total do pedido. Desconto NÃO tem linha (valor negativo
 * não está provado): pedido com desconto não fecha a soma e `camposDoComprador`
 * descarta os itens.
 *
 * TUDO OU NADA: uma linha imprestável (quantidade que não é inteiro de 1 a
 * 9999, preço ≤ 0 ou com mais de duas casas, não-objeto) devolve undefined —
 * mandar só parte dos itens deixaria a soma errada. Título ausente ganha
 * "Produto" (a soma não depende dele).
 */
export function itensDaOrder(linhas: unknown, frete: unknown): ItemDaOrder[] | undefined {
  if (!Array.isArray(linhas) || linhas.length === 0) return undefined;
  const freteEmCentavos = emCentavos(frete) ?? 0;
  if (linhas.length + (freteEmCentavos > 0 ? 1 : 0) > LIMITE_DE_LINHAS) return undefined;

  const itens: ItemDaOrder[] = [];
  for (const linha of linhas) {
    const l = objetoSimples(linha);
    if (!l) return undefined;
    const { product_id, product_name, quantity, price } = l;
    if (
      typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 ||
      quantity > TETO_DA_QUANTIDADE
    ) return undefined;
    const centavos = emCentavos(price);
    if (centavos === undefined) return undefined;
    const title = textoLimpo(product_name, 150) ?? "Produto";
    const item: ItemDaOrder = {
      title,
      unit_price: comoDinheiro(centavos),
      quantity,
      description: textoLimpo(title, 100) ?? title,
    };
    if (typeof product_id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(product_id)) {
      item.external_code = product_id;
    }
    itens.push(item);
  }
  if (freteEmCentavos > 0) {
    itens.push({ title: "Frete", unit_price: comoDinheiro(freteEmCentavos), quantity: 1, description: "Frete" });
  }
  return itens;
}

/**
 * A soma de `unit_price × quantity` dos itens é EXATAMENTE o `total_amount`
 * (texto de duas casas), em centavos? Lista vazia, item fora de forma ou total
 * ilegível → false. É a trava que impede o pedido com desconto, o frete
 * divergente ou o dado legado de produzir um corpo cuja soma não fecha.
 */
export function itensFechamComOTotal(itens: unknown, totalFormatado: unknown): boolean {
  if (!Array.isArray(itens) || itens.length === 0) return false;
  if (typeof totalFormatado !== "string" || !/^\d+\.\d{2}$/.test(totalFormatado)) return false;
  const total = Number(totalFormatado.replace(".", ""));
  let soma = 0;
  for (const item of itens) {
    const i = objetoSimples(item);
    if (!i) return false;
    const { unit_price, quantity } = i;
    if (typeof unit_price !== "string" || !/^\d+\.\d{2}$/.test(unit_price)) return false;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) return false;
    soma += Number(unit_price.replace(".", "")) * quantity;
  }
  return soma === total;
}

// ─── o conjunto ──────────────────────────────────────────────────────────────

/**
 * Tudo que o pedido sabe sobre o comprador e o produto, no formato da Orders
 * API. Entradas: a linha do pedido (`customer_data`, `customer_phone`,
 * `shipping`), as linhas de `marketplace_order_items` e, para quem tem conta,
 * a linha de `user_addresses` apontada por `address_id`.
 *
 * Cada peça é independente: uma que falha (ou lança, num objeto hostil) some
 * sozinha. Nunca lança. Quando nada presta, devolve `{}` — e o corpo do cartão
 * fica exatamente como era antes.
 */
export function dadosDoCompradorParaOrder(
  entrada: { pedido: unknown; itens: unknown; enderecoSalvo: unknown },
): DadosDoComprador {
  const saida: DadosDoComprador = {};
  const dadosDeEntrada = objetoSimples(entrada) ?? {};
  const pedido = objetoSimples(dadosDeEntrada.pedido);
  const customerData = tentar(() => objetoSimples(pedido?.customer_data));

  const items = tentar(() => itensDaOrder(dadosDeEntrada.itens, pedido?.shipping));
  if (items) saida.items = items;

  const phone = tentar(() =>
    [customerData?.whatsapp, customerData?.phone, pedido?.customer_phone]
      .map(telefoneDoPagador)
      .find((telefone) => telefone !== undefined)
  );
  if (phone) saida.phone = phone;

  const address = tentar(() =>
    enderecoDaOrder(customerData?.address) ??
      enderecoDaOrder(customerData?.addressData) ??
      enderecoDaOrder(dadosDeEntrada.enderecoSalvo)
  );
  if (address) {
    saida.address = address;
    if (!retiradaNaLoja(pedido)) saida.shipmentAddress = address;
  }
  return saida;
}

// ─── o que entra no corpo — revalidado ───────────────────────────────────────

function telefoneRevalidado(bruto: unknown): TelefoneDaOrder | undefined {
  const t = objetoSimples(bruto);
  if (!t) return undefined;
  const { area_code, number } = t;
  if (typeof area_code !== "string" || !/^[1-9][1-9]$/.test(area_code)) return undefined;
  if (typeof number !== "string" || !/^\d{8,9}$/.test(number)) return undefined;
  return { area_code, number };
}

function enderecoRevalidado(bruto: unknown): EnderecoDaOrder | undefined {
  const e = objetoSimples(bruto);
  if (!e) return undefined;
  const { zip_code, street_name, street_number, neighborhood, city, state, complement } = e;
  if (typeof zip_code !== "string" || !/^\d{8}$/.test(zip_code)) return undefined;
  const rua = textoLimpo(street_name, 100);
  const numero = textoLimpo(street_number, 20);
  if (!rua || !numero) return undefined;
  const endereco: EnderecoDaOrder = { zip_code, street_name: rua, street_number: numero };
  const bairro = textoLimpo(neighborhood, 60);
  if (bairro) endereco.neighborhood = bairro;
  const cidade = textoLimpo(city, 60);
  if (cidade) endereco.city = cidade;
  if (typeof state === "string" && /^[A-Z]{2}$/.test(state)) endereco.state = state;
  const complemento = textoLimpo(complement, 60);
  if (complemento) endereco.complement = complemento;
  return endereco;
}

/**
 * A última porta antes do corpo de `POST /v1/orders`: pega o que
 * `dadosDoCompradorParaOrder` produziu (ou o que um chamador futuro passar) e
 * devolve SÓ o que passa de novo pelas regras de formato — copiando chave por
 * chave, nunca espalhando objeto alheio — e, para `items`, só quando a soma
 * fecha com `totalFormatado` ao centavo. Nunca lança.
 */
export function camposDoComprador(comprador: unknown, totalFormatado: string): CamposParaOCorpo {
  const saida: CamposParaOCorpo = {};
  const c = objetoSimples(comprador);
  if (!c) return saida;

  const phone = tentar(() => telefoneRevalidado(c.phone));
  if (phone) saida.phone = phone;
  const address = tentar(() => enderecoRevalidado(c.address));
  if (address) saida.address = address;
  const entrega = tentar(() => enderecoRevalidado(c.shipmentAddress));
  if (entrega) saida.shipment = { address: entrega };

  const items = tentar(() => {
    if (!itensFechamComOTotal(c.items, totalFormatado)) return undefined;
    // Re-passa cada linha pelo formato fechado: copia só as chaves conhecidas.
    return (c.items as unknown[]).map((bruto) => {
      const i = bruto as Record<string, unknown>;
      const item: ItemDaOrder = {
        title: textoLimpo(i.title, 150) ?? "Produto",
        unit_price: String(i.unit_price),
        quantity: Number(i.quantity),
        description: textoLimpo(i.description, 100) ?? "Produto",
      };
      if (typeof i.external_code === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(i.external_code)) {
        item.external_code = i.external_code;
      }
      return item;
    });
  });
  if (items) saida.items = items;
  return saida;
}

// ─── a leitura no banco — melhor esforço ─────────────────────────────────────

/** Tempo máximo, no total, que a leitura pode segurar a cobrança. */
export const PRAZO_DA_LEITURA_MS = 3000;

export const COLUNAS_DO_PEDIDO_PARA_O_ANTIFRAUDE = "customer_phone, address_id, shipping";
const COLUNAS_DOS_ITENS = "product_id, product_name, quantity, price";
const COLUNAS_DO_ENDERECO_SALVO = "cep, street, number, complement, neighborhood, city, state";

/** O que se usa do cliente Supabase: só `.from(...)` e a cadeia de leitura. */
// deno-lint-ignore no-explicit-any
type ClienteDeLeitura = { from: (tabela: string) => any };

/** Resolve com o valor, ou com `undefined` se a promessa rejeitar ou passar do
 * prazo. O timer sempre é limpo — nunca fica pendurado. */
function comPrazo<T>(trabalho: () => Promise<T>, prazoMs: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const relogio = setTimeout(() => resolve(undefined), prazoMs);
    Promise.resolve()
      .then(trabalho)
      .then(
        (valor) => {
          clearTimeout(relogio);
          resolve(valor);
        },
        () => {
          clearTimeout(relogio);
          resolve(undefined);
        },
      );
  });
}

/** Uma leitura que nunca lança: erro de banco, coluna que não existe ou
 * exceção viram `null` — e NADA vai para log (a mensagem de um erro de banco
 * pode carregar o dado lido). */
async function lerOuNada(leitura: () => PromiseLike<unknown>): Promise<unknown> {
  try {
    const resposta = objetoSimples(await leitura());
    if (!resposta || resposta.error) return null;
    return resposta.data ?? null;
  } catch {
    return null;
  }
}

async function lerTudo(banco: ClienteDeLeitura, pedido: Record<string, unknown>): Promise<DadosDoComprador> {
  const orderId = pedido.id;
  if (typeof orderId !== "string" || orderId === "") return {};

  // Leituras SEPARADAS e à parte do SELECT do pedido que a cobrança já faz:
  // se uma coluna não existir num banco de loja, perde-se SÓ o enriquecimento
  // — a cobrança nunca vê o erro.
  const [extrasDoPedido, itens] = await Promise.all([
    lerOuNada(() =>
      banco.from("marketplace_orders").select(COLUNAS_DO_PEDIDO_PARA_O_ANTIFRAUDE).eq("id", orderId).maybeSingle()
    ),
    lerOuNada(() => banco.from("marketplace_order_items").select(COLUNAS_DOS_ITENS).eq("order_id", orderId)),
  ]);
  const extras = objetoSimples(extrasDoPedido) ?? {};
  const pedidoCompleto = { ...pedido, ...extras };

  // Endereço salvo (cliente com conta): só se o pedido não trouxe um snapshot
  // utilizável, e SEMPRE com o filtro do dono — nunca o endereço de outra
  // pessoa, nem sem dono.
  let enderecoSalvo: unknown = null;
  const snapshot = tentar(() => {
    const dados = objetoSimples(pedido.customer_data);
    return enderecoDaOrder(dados?.address) ?? enderecoDaOrder(dados?.addressData);
  });
  const enderecoId = extras.address_id;
  const donoId = pedido.user_id;
  if (!snapshot && typeof enderecoId === "string" && enderecoId !== "" && typeof donoId === "string" && donoId !== "") {
    enderecoSalvo = await lerOuNada(() =>
      banco.from("user_addresses").select(COLUNAS_DO_ENDERECO_SALVO).eq("id", enderecoId).eq("user_id", donoId)
        .maybeSingle()
    );
  }
  return dadosDoCompradorParaOrder({ pedido: pedidoCompleto, itens, enderecoSalvo });
}

/**
 * Lê no banco (com o mesmo cliente de serviço da função) o que falta ao pedido
 * para `dadosDoCompradorParaOrder`: itens, telefone/frete/endereço do pedido e
 * o endereço salvo de quem tem conta. MELHOR ESFORÇO: erro ou exceção numa
 * leitura perde SÓ a peça dela; demora acima de `prazoMs` devolve `{}` — a
 * cobrança segue como era. Nunca lança, nunca loga.
 */
export async function lerDadosDoComprador(
  banco: unknown,
  pedido: unknown,
  prazoMs: number = PRAZO_DA_LEITURA_MS,
): Promise<DadosDoComprador> {
  const p = objetoSimples(pedido);
  if (!p || !banco || typeof (banco as ClienteDeLeitura).from !== "function") return {};
  const lido = await comPrazo(() => lerTudo(banco as ClienteDeLeitura, p), prazoMs);
  return lido ?? {};
}
