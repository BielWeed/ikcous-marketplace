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
 * O MP recusa `date_of_expiration` terminado em 'Z' — exige offset explícito.
 * A loja é de Monte Carmelo/MG, então o offset é o de São Paulo (-03:00), que
 * não tem horário de verão desde 2019.
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
}): Record<string, unknown> {
  return {
    transaction_amount: args.valor,
    description: args.descricao,
    payment_method_id: "pix",
    date_of_expiration: args.expiraEm,
    payer: { email: args.email },
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
  };
  if (args.emissor) corpo.issuer_id = args.emissor;
  return corpo;
}

export async function criarPagamento(args: {
  token: string;
  corpo: Record<string, unknown>;
  chaveIdempotencia: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): Promise<
  | {
      ok: true;
      id: string;
      status: string;
      qrCode?: string;
      qrCodeBase64?: string;
      ticketUrl?: string;
    }
  | { ok: false; erro: string; status: number }
> {
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

  if (!resposta.ok) {
    // O corpo do erro do MP vai para o log da função, NUNCA para o cliente:
    // ele carrega detalhe de credencial e de conta.
    const detalhe = await resposta.text().catch(() => "");
    console.error("mercadopago: recusou", resposta.status, detalhe);
    return {
      ok: false,
      erro: "Não foi possível gerar a cobrança.",
      status: resposta.status,
    };
  }

  const json = await resposta.json();
  const dados = json?.point_of_interaction?.transaction_data ?? {};

  return {
    ok: true,
    // A coluna gateway_payment_id é text e o MP devolve número.
    id: String(json.id),
    status: String(json.status),
    qrCode: dados.qr_code,
    qrCodeBase64: dados.qr_code_base64,
    ticketUrl: dados.ticket_url,
  };
}
