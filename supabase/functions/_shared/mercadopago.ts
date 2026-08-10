// @ts-nocheck
/**
 * Cliente da API do Mercado Pago, compartilhado entre as edge functions.
 *
 * POR QUE ELE EXISTE SEPARADO DA FUNCTION
 *
 * A `criar-pagamento` (Fase 2) e a `webhook-mercadopago` (Fase 3) falam com a
 * mesma API e precisam do MESMO mapa de status. Duplicar esse mapa é como este
 * repositório chegou a ter a regra de frete grátis escrita em sete lugares
 * (#53) — e aqui a divergência silenciosa marcaria pedido como pago quando o
 * MP disse outra coisa. Mesmo motivo do `_shared/webpush.ts`.
 *
 * `fetch` entra por parâmetro para o teste não tocar rede.
 */

const BASE_URL_PADRAO = "https://api.mercadopago.com";

/**
 * Traduz o status do MP para o `payment_status` deste banco.
 *
 * Devolve `null` para o que não conhece, DE PROPÓSITO: um status novo do MP
 * não pode virar 'pago' por default otimista. Quem chama decide — e o que a
 * `criar-pagamento` faz é registrar e deixar o pedido em 'aguardando', que é o
 * estado que a expiração já sabe tratar.
 */
export function mapearStatus(status: string): string | null {
  switch (status) {
    case "approved":
      return "pago";
    case "rejected":
    case "cancelled":
      return "recusado";
    case "pending":
    case "in_process":
    case "authorized":
      return "aguardando";
    case "refunded":
    case "charged_back":
      return "estornado";
    default:
      return null;
  }
}

/**
 * Esta função não converte fuso horário — ela normaliza o offset que o MP
 * exige. `date_of_expiration` terminado em 'Z' é recusado; qualquer offset
 * explícito serve, desde que denote o mesmo instante. Por isso o
 * deslocamento (-3h) e o rótulo (-03:00) SEMPRE mudam juntos: trocar só um
 * dos dois desloca a expiração real sem que nenhum teste de formato acuse.
 */
export function formatarExpiracao(iso: string): string {
  const d = new Date(iso);
  const deslocado = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return `${deslocado.toISOString().replace("Z", "")}-03:00`;
}

export function montarCorpoPix(args: {
  valor: number;
  descricao: string;
  email: string;
  expiraEm: string;
  orderId: string;
  documento?: { type: string; number: string };
  notificationUrl?: string;
}): Record<string, unknown> {
  const payer: Record<string, unknown> = { email: args.email };
  // A-2 da revisão final: sem isso o documento entrava pelo front e sumia
  // aqui — montarCorpoCartao já aceitava o mesmo parâmetro; a documentação
  // de PIX do MP monta o payer com identification igual à de cartão.
  if (args.documento) payer.identification = args.documento;

  return {
    transaction_amount: args.valor,
    description: args.descricao,
    payment_method_id: "pix",
    date_of_expiration: args.expiraEm,
    payer,
    // Sem isso o MP não guarda ponteiro de volta para o pedido, e a
    // reconciliação da Fase 3 teria que casar valor + e-mail + horário na
    // mão. Com isso vira GET /v1/payments/search?external_reference=<id>.
    external_reference: args.orderId,
    // Sem isto o webhook depende de configuracao no painel do MP — que ninguem
    // percebe quando some, e nenhum teste pega. Herança nº 4 da Fase 2.
    ...(args.notificationUrl ? { notification_url: args.notificationUrl } : {}),
  };
}

export function montarCorpoCartao(args: {
  valor: number;
  descricao: string;
  email: string;
  token: string;
  parcelas: number;
  metodo: string;
  emissor?: string;
  documento?: { type: string; number: string };
  orderId: string;
}): Record<string, unknown> {
  const payer: Record<string, unknown> = { email: args.email };
  if (args.documento) payer.identification = args.documento;

  const corpo: Record<string, unknown> = {
    transaction_amount: args.valor,
    description: args.descricao,
    token: args.token,
    installments: args.parcelas,
    payment_method_id: args.metodo,
    payer,
    // Mesmo motivo do PIX: é o que permite achar o pedido a partir do
    // pagamento na reconciliação da Fase 3.
    external_reference: args.orderId,
  };
  if (args.emissor) corpo.issuer_id = args.emissor;
  return corpo;
}

type ResultadoPagamento =
  | {
      ok: true;
      id: string;
      status: string;
      // Adicionado na Task 4 (Fase 3): a webhook-mercadopago precisa saber A
      // QUAL PEDIDO a confirmação pertence, e o corpo do webhook não serve
      // para isso — qualquer um pode forjar um POST. A resposta do MP, do
      // outro lado, veio autenticada pelo token do gateway. `criarPagamento`
      // grava este mesmo valor (montarCorpoPix/montarCorpoCartao, acima) na
      // criação; aqui é onde ele volta.
      externalReference?: string;
      qrCode?: string;
      qrCodeBase64?: string;
      ticketUrl?: string;
    }
  | { ok: false; erro: string; status: number };

export async function criarPagamento(args: {
  token: string;
  corpo: Record<string, unknown>;
  chaveIdempotencia: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): Promise<ResultadoPagamento> {
  const f = args.fetchImpl ?? fetch;
  const base = args.baseUrl ?? BASE_URL_PADRAO;

  let resposta: Response;
  try {
    resposta = await f(`${base}/v1/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.token}`,
        "Content-Type": "application/json",
        // Sem isso, um retry do nosso lado cobra o cliente duas vezes.
        "X-Idempotency-Key": args.chaveIdempotencia,
      },
      body: JSON.stringify(args.corpo),
    });
  } catch (_err) {
    // status 0 = nem chegou a haver resposta HTTP.
    return { ok: false, erro: "Falha ao falar com o gateway.", status: 0 };
  }

  return interpretarRespostaDePagamento(resposta, "Não foi possível gerar a cobrança.");
}

/**
 * `consultarPagamento` — reconsulta uma cobrança JÁ criada (CHECKOUT-050).
 *
 * O QR do PIX só existe na resposta da CRIAÇÃO. O navegador mobile descarta a
 * aba enquanto o cliente vai ao app do banco pagar; ao voltar, a tela remonta
 * e precisa do MESMO QR — sem criar uma segunda cobrança. Por isso é GET,
 * sem corpo e SEM `X-Idempotency-Key`: não é escrita, então não tem o que
 * proteger de duplicar.
 *
 * Devolve a MESMA união de `criarPagamento`, e obedece às mesmas regras:
 * nunca rejeita, a leitura do corpo fica dentro do try, e o corpo do erro do
 * MP vai só para o log.
 */
export async function consultarPagamento(args: {
  token: string;
  paymentId: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): Promise<ResultadoPagamento> {
  const f = args.fetchImpl ?? fetch;
  const base = args.baseUrl ?? BASE_URL_PADRAO;

  let resposta: Response;
  try {
    resposta = await f(`${base}/v1/payments/${args.paymentId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${args.token}` },
    });
  } catch (_err) {
    return { ok: false, erro: "Falha ao falar com o gateway.", status: 0 };
  }

  return interpretarRespostaDePagamento(resposta, "Não foi possível consultar a cobrança.");
}

/**
 * Miolo comum entre `criarPagamento` e `consultarPagamento`: as duas mandam
 * a requisição de um jeito diferente (POST com corpo e idempotência vs. GET
 * puro), mas leem a resposta do MESMO jeito. Duplicar essa leitura é como
 * este repositório chegou a ter a regra de frete grátis em sete lugares
 * (#53) — aqui a divergência marcaria uma reconsulta como bem-sucedida
 * quando a criação teria recusado o mesmo corpo, ou vice-versa.
 */
async function interpretarRespostaDePagamento(
  resposta: Response,
  mensagemDeFalha: string,
): Promise<ResultadoPagamento> {
  if (!resposta.ok) {
    // O corpo do erro do MP vai para o log da função, NUNCA para o cliente:
    // ele carrega detalhe de credencial e de conta.
    const detalhe = await resposta.text().catch(() => "");
    console.error("mercadopago: recusou", resposta.status, detalhe);
    return { ok: false, erro: mensagemDeFalha, status: resposta.status };
  }

  // A leitura do corpo mora no MESMO try que trata resposta ilegível: um
  // 2xx com corpo HTML, vazio ou "null" faria json() rejeitar, e a rejeição
  // escaparia esta função inteira. A Task 2 não tem try/catch externo em
  // volta de criarPagamento/consultarPagamento — nenhum caminho aqui pode
  // rejeitar.
  let json: Record<string, unknown> | null;
  try {
    json = await resposta.json();
  } catch (_err) {
    console.error("mercadopago: resposta 2xx com corpo ilegível", resposta.status);
    return { ok: false, erro: "Resposta inválida do gateway.", status: resposta.status };
  }

  if (json?.id === undefined || json?.id === null) {
    // "undefined" nunca pode virar gateway_payment_id: a coluna tem índice
    // UNIQUE parcial, e a segunda ocorrência estoura 23505.
    console.error("mercadopago: resposta 2xx sem id", resposta.status, JSON.stringify(json));
    return { ok: false, erro: "Resposta inválida do gateway.", status: resposta.status };
  }

  const dados =
    (json.point_of_interaction as Record<string, unknown> | undefined)
      ?.transaction_data as Record<string, unknown> | undefined ?? {};

  return {
    ok: true,
    // A coluna gateway_payment_id é text e o MP devolve número.
    id: String(json.id),
    status: String(json.status),
    externalReference:
      typeof json.external_reference === "string" ? json.external_reference : undefined,
    qrCode: dados.qr_code as string | undefined,
    qrCodeBase64: dados.qr_code_base64 as string | undefined,
    ticketUrl: dados.ticket_url as string | undefined,
  };
}

/**
 * Valida o x-signature do webhook do Mercado Pago.
 *
 * E' a UNICA autenticacao que a webhook-mercadopago tem: ela roda com
 * verify_jwt = false porque o MP nao manda JWT. Sem isto, quem descobrir a URL
 * forja um "aprovado" e leva produto de graca.
 *
 * Formato confirmado na documentacao do MP (context7, 09/08/2026): o header
 * vem como `ts=<epoch>,v1=<hex>`, o manifesto e
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` — com o segmento
 * request-id OMITIDO quando o header nao veio, igual ao SDK oficial — e o
 * hash e HMAC-SHA256 do manifesto, comparado ao `v1` em hex.
 *
 * Pura e com `agora` injetavel para o teste nao depender do relogio.
 */
export async function validarAssinatura(args: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string;
  segredo: string;
  agora?: number;
  toleranciaSegundos?: number;
}): Promise<boolean> {
  const { xSignature, xRequestId, dataId, segredo } = args;
  const agora = args.agora ?? Date.now();
  const tolerancia = args.toleranciaSegundos ?? 300;

  if (!xSignature || !segredo || !dataId) return false;

  let ts = "";
  let v1 = "";
  for (const parte of xSignature.split(",")) {
    const [chave, ...resto] = parte.split("=");
    const valor = resto.join("=").trim();
    if (chave?.trim() === "ts") ts = valor;
    if (chave?.trim() === "v1") v1 = valor;
  }
  if (!ts || !v1) return false;

  // `ts` fora da janela: header legitimo reaproveitado semanas depois nao vale.
  const tsNumero = Number(ts);
  if (!Number.isFinite(tsNumero)) return false;
  const idadeSegundos = Math.abs(agora / 1000 - tsNumero);
  if (idadeSegundos > tolerancia) return false;

  // O segmento de request-id so entra quando o header veio — igual ao
  // buildManifest do SDK oficial (`if (requestId) parts.push(...)`).
  //
  // `dataId` vai COM O CASING ORIGINAL. A documentacao do MP pede minusculas
  // ("ensuring data.id_url is in lowercase") e ESTA ERRADA: o SDK oficial
  // REMOVEU o .toLowerCase() de proposito (PR mercadopago/sdk-nodejs#439),
  // porque o MP assina com o casing original e qualquer id com maiuscula
  // falhava com SignatureMismatch. Medido em 09/08/2026: com .toLowerCase(),
  // um dataId "ABC12" assinado como o MP assina e' RECUSADO.
  //
  // Nao e' a unica coisa que essa pagina da doc erra: ela tambem diz que o
  // `ts` vem em milissegundos, e vem em SEGUNDOS (issue #458 do mesmo SDK).
  // Quando doc e SDK divergirem aqui, o SDK ganha — ele foi corrigido por
  // observacao de trafego real, a doc nao.
  const manifesto = xRequestId
    ? `id:${dataId};request-id:${xRequestId};ts:${ts};`
    : `id:${dataId};ts:${ts};`;

  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinado = await crypto.subtle.sign(
    "HMAC",
    chave,
    new TextEncoder().encode(manifesto),
  );
  const esperado = Array.from(new Uint8Array(assinado))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Comparacao de tempo constante: `===` em string vaza, pelo tempo de
  // resposta, quantos caracteres do prefixo o atacante ja acertou.
  if (esperado.length !== v1.length) return false;
  let diferenca = 0;
  for (let i = 0; i < esperado.length; i++) {
    diferenca |= esperado.charCodeAt(i) ^ v1.charCodeAt(i);
  }
  return diferenca === 0;
}
