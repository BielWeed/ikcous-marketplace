/**
 * Peças PURAS do PIX do balcão (edge `cobrar-pix-no-balcao`, frente A —
 * docs/superpowers/plans/2026-09-28-balcao-pix-no-balcao.md). Nada aqui fala
 * com rede nem banco: só decide.
 */
import { minutosDaExpiracaoPix } from "./mercadopago.ts";

/** Mesmo prazo do PIX do site ("PT30M" — mínimo do MP, casa com a reserva de
 * 30 min de `iniciar_venda_presencial_pix`). */
export const EXPIRACAO_PIX_DO_BALCAO = "PT30M";

/** Mesma margem de latência que `criar-pagamento` soma à janela sã. */
export const MARGEM_LATENCIA_MINUTOS_PIX = 5;

/**
 * CÓPIA de `expiracaoRealinhavel` (`criar-pagamento/index.ts`) — a regra que
 * decide se o vencimento que o Mercado Pago carimbou na order pode realinhar
 * `expires_at` do pedido (só no futuro e nunca além do prazo pedido + 5 min;
 * fora disso, `null` e o pedido fica com o prazo de 30 min que a RPC deu).
 * Cópia e não import porque importar `criar-pagamento/index.ts` carregaria o
 * handler inteiro do checkout do site nesta edge; a paridade das duas é
 * provada em `pix-do-balcao_test.ts`, caso a caso.
 */
export function expiracaoRealinhavel(
  dataExpiracaoBruta: string | null,
  agora: Date,
  expiracaoPix: string,
): Date | null {
  if (!dataExpiracaoBruta) return null;
  const data = new Date(dataExpiracaoBruta);
  if (Number.isNaN(data.getTime())) return null;
  const minutosPix = minutosDaExpiracaoPix(expiracaoPix);
  if (minutosPix === null) return null;
  const minimo = agora.getTime();
  const maximo = agora.getTime() + (minutosPix + MARGEM_LATENCIA_MINUTOS_PIX) * 60_000;
  if (data.getTime() <= minimo || data.getTime() > maximo) return null;
  return data;
}

/** O vocabulário que a tela Vender entende. */
export type SituacaoDoPixDoBalcao =
  | "aguardando"
  | "pago"
  | "pago_fora_do_prazo"
  | "expirado"
  | "cancelado";

/**
 * Traduz a linha do pedido (a verdade é o BANCO, nunca a resposta do MP) na
 * situação da venda. `aguardando` com o prazo vencido é `expirado` já — a
 * varredura (`expirar_pedidos_vencidos`, a cada 5 min) ainda vai devolver o
 * estoque, mas o QR não serve mais.
 */
export function situacaoDoPedido(
  pedido: {
    payment_status: string | null;
    status: string | null;
    expires_at: string | null;
  },
  agora: Date,
): SituacaoDoPixDoBalcao {
  if (pedido.payment_status === "pago") return "pago";
  if (pedido.payment_status === "pago_apos_expirar") return "pago_fora_do_prazo";
  if (pedido.payment_status === "expirado") return "expirado";
  if (pedido.payment_status === "aguardando" && pedido.status === "pending") {
    const vence = pedido.expires_at ? new Date(pedido.expires_at).getTime() : NaN;
    if (!Number.isFinite(vence) || vence <= agora.getTime()) return "expirado";
    return "aguardando";
  }
  return "cancelado";
}

/** O mesmo formato mínimo que `criar-pagamento` aceita (ponto no domínio). */
export function emailValido(email: unknown): email is string {
  return typeof email === "string" && /^\S+@\S+\.\S+$/.test(email.trim());
}

/** O fallback do checkout do site quando não há e-mail nenhum. */
export const EMAIL_PAGADOR_GENERICO = "sem-email@ikcous.com.br";

/**
 * Quem o Mercado Pago vê como pagador. NUNCA o e-mail de quem está logado no
 * painel: no balcão quem chama é o LOJISTA, e mandar o e-mail dele faria o
 * pagador ser o próprio recebedor (a conta Mercado Pago da loja costuma usar o
 * mesmo e-mail) — ordem: e-mail gravado no pedido → e-mail da conta do cliente
 * cadastrado → genérico.
 */
export function emailDoPagador(
  customerData: unknown,
  emailDaContaDoCliente: string | null,
): string {
  const doPedido = (customerData as Record<string, unknown> | null)?.email;
  if (emailValido(doPedido)) return doPedido.trim();
  if (emailValido(emailDaContaDoCliente)) return emailDaContaDoCliente.trim();
  return EMAIL_PAGADOR_GENERICO;
}
