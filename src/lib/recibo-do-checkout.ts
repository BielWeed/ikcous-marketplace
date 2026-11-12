// O RECIBO DO CHECKOUT — o F5 depois do pedido diz "seu pedido já foi feito"
// (12/11/2026).
//
// O DEFEITO MEDIDO: a cliente fazia o pedido (Pix confirmado, ou pago na
// entrega), apertava F5 na tela de "Pedido recebido!" e caía em "Seu carrinho
// está vazio". O carrinho está mesmo vazio (o pedido o esvaziou) e o registro do
// pagamento pendente é apagado DE PROPÓSITO quando o pagamento confirma
// (pedido-pendente-do-checkout.ts) — sem nada na aba, a tela não tinha como
// saber que o pedido existia, e a cliente podia comprar de novo.
//
// POR QUE UM ARQUIVO À PARTE, e não reaproveitar o pendente: o registro do
// pagamento pendente significa "há um pagamento EM ANDAMENTO" para o veto de
// recarga, o instalador, o momento seguro e o carrinho. Um recibo guardado ali
// seria lido por eles como pagamento em curso. Aqui a chave é outra, e o
// significado é só "este pedido já foi feito".
//
// O QUE MORA AQUI: SÓ o id do pedido, o dono (id da conta; null = visitante)
// e a hora. Nada de valor, forma de pagamento, CPF ou e-mail. O texto da tela
// diz "recebido", nunca "pago": o recibo não sabe (nem precisa saber) se o
// dinheiro entrou.
//
// sessionStorage, como o arquivo irmão: é coisa da ABA. Vale 2 horas; vencido,
// a leitura o apaga. Um recibo por aba (o pedido novo substitui o anterior).
// O recibo só aparece para quem o gravou: conta diferente, ou conta no lugar de
// visitante (e o inverso), lê "nada guardado" — sem apagar, porque a sessão do
// dono pode ainda estar a caminho (rede lenta).
//
// Best-effort, como o irmão: storage cheio, modo privado ou SecurityError (até o
// ACESSO a `globalThis.sessionStorage` pode lançar) nunca derrubam o checkout.
// Quem apaga: o AuthContext (logout), e a leitura do que venceu. NINGUÉM apaga
// por AUSÊNCIA de usuário.

const CHAVE_DO_RECIBO = "ikcous:checkout-recibo";

/** Quanto tempo o recibo vale na aba. */
export const VALIDADE_DO_RECIBO_MS = 2 * 60 * 60 * 1000;

// Mesmo formato do arquivo irmão: o id de `marketplace_orders` é uuid.
// Qualquer outra coisa (adulterada, de versão velha, vazia) é "nada guardado".
const FORMATO_DO_ID_DO_PEDIDO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Recibo {
  readonly pedidoId: string;
  readonly userId: string | null;
  readonly gravadoEm: number;
}

function armazem(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function donoNormalizado(userId: string | null | undefined): string | null {
  return userId ? userId : null;
}

function apagar(): void {
  try {
    armazem()?.removeItem(CHAVE_DO_RECIBO);
  } catch {
    // Nada a fazer: o recibo, se ficou, vence sozinho.
  }
}

// Lê e valida o registro. Vencido (ou com hora no futuro, relógio mexido) e
// adulterado somem; o que está bom volta, SEM conferir o dono.
function lerRegistro(agora: number): Recibo | null {
  try {
    const bruto = armazem()?.getItem(CHAVE_DO_RECIBO);
    if (typeof bruto !== "string") return null;
    const dado: unknown = JSON.parse(bruto);
    if (typeof dado !== "object" || dado === null || Array.isArray(dado)) {
      apagar();
      return null;
    }
    const { pedidoId, userId, gravadoEm } = dado as Record<string, unknown>;
    if (
      typeof pedidoId !== "string" ||
      !FORMATO_DO_ID_DO_PEDIDO.test(pedidoId) ||
      !(userId === null || typeof userId === "string") ||
      typeof gravadoEm !== "number" ||
      !Number.isFinite(gravadoEm)
    ) {
      apagar();
      return null;
    }
    const idade = agora - gravadoEm;
    if (idade < 0 || idade >= VALIDADE_DO_RECIBO_MS) {
      apagar();
      return null;
    }
    return { pedidoId, userId, gravadoEm };
  } catch {
    // JSON quebrado ou storage que lança: "nada guardado".
    apagar();
    return null;
  }
}

export function guardarReciboDoCheckout(
  userId: string | null | undefined,
  pedidoId: string,
  agora: number = Date.now(),
): void {
  if (!FORMATO_DO_ID_DO_PEDIDO.test(pedidoId)) return;
  const recibo: Recibo = {
    pedidoId,
    userId: donoNormalizado(userId),
    gravadoEm: agora,
  };
  try {
    armazem()?.setItem(CHAVE_DO_RECIBO, JSON.stringify(recibo));
  } catch {
    // Sem recibo, o F5 cai na tela de sempre ("Seu carrinho está vazio").
    // Nunca impede o pedido.
  }
}

/** O pedido do recibo, se for DESTE usuário (visitante = os dois lados vazios) e estiver na validade. */
export function lerReciboDoCheckout(
  userId: string | null | undefined,
  agora: number = Date.now(),
): string | null {
  const recibo = lerRegistro(agora);
  if (!recibo) return null;
  return recibo.userId === donoNormalizado(userId) ? recibo.pedidoId : null;
}

/** Apaga o recibo (logout). */
export function esquecerReciboDoCheckout(): void {
  apagar();
}
