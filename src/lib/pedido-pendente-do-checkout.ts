// O PEDIDO PENDENTE DO CHECKOUT — o PIX na tela sobrevive ao recarregar
// (04/10/2026).
//
// O DEFEITO MEDIDO: cliente com PIX pendente (QR na tela) que recarregava a
// página caía num checkout VAZIO (R$ 0, sem QR, sem aviso) — o pedido que
// estava sendo pago vivia só na memória do CheckoutView e do App. Só voltava
// ao pagamento por Perfil → pedido → "Retomar pagamento"; nada era cobrado de
// novo, mas o cliente achava que tinha perdido o pedido.
//
// O QUE MORA AQUI: SÓ o id do pedido. Nada de valor, QR, código copia e cola,
// CPF ou e-mail — na recarga, tudo isso volta do SERVIDOR (a leitura da
// retomada, sob RLS, e a reconsulta do PIX que o PagamentoOnline já faz).
// O id sozinho não autoriza nada: quem decide se o pedido é do usuário e se
// ainda espera pagamento é a leitura no banco.
//
// POR QUE sessionStorage: é coisa da ABA — fechar a aba é largar a tela, e o
// registro morre junto. A chave inclui o id do usuário logado: o pedido de
// uma conta nunca é lido para outra na mesma aba.
//
// Best-effort, como o rascunho do checkout: storage cheio, modo privado ou
// SecurityError (até o ACESSO a `globalThis.sessionStorage` pode lançar)
// nunca derrubam o checkout — leitura que falha é "não há pedido guardado".
//
// Quem limpa: o CheckoutView (pedido saiu de pendente; nada em pagamento na
// tela), o App (o cliente saiu do checkout ou entrou num checkout novo; a
// carga da página fora do checkout) e o AuthContext (logout).

const PREFIXO_DA_CHAVE = "ikcous:checkout-pedido-pendente:";

// O id de `marketplace_orders` é uuid. Qualquer outra coisa na chave
// (adulterada, de uma versão velha, vazia) é tratada como "nada guardado".
const FORMATO_DO_ID_DO_PEDIDO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function armazem(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function chaveDoPedidoPendenteDoCheckout(userId: string): string {
  return `${PREFIXO_DA_CHAVE}${userId}`;
}

export function guardarPedidoPendenteDoCheckout(
  userId: string,
  pedidoId: string,
): void {
  if (!userId || !FORMATO_DO_ID_DO_PEDIDO.test(pedidoId)) return;
  try {
    armazem()?.setItem(chaveDoPedidoPendenteDoCheckout(userId), pedidoId);
  } catch {
    // Sem registro, a recarga cai no fluxo de antes (Perfil → pedido →
    // "Retomar pagamento"). Nunca impede o pagamento.
  }
}

export function lerPedidoPendenteDoCheckout(userId: string): string | null {
  if (!userId) return null;
  try {
    const valor = armazem()?.getItem(chaveDoPedidoPendenteDoCheckout(userId));
    return typeof valor === "string" && FORMATO_DO_ID_DO_PEDIDO.test(valor)
      ? valor
      : null;
  } catch {
    return null;
  }
}

export function esquecerPedidoPendenteDoCheckout(userId: string): void {
  if (!userId) return;
  try {
    armazem()?.removeItem(chaveDoPedidoPendenteDoCheckout(userId));
  } catch {
    // Nada a fazer: o registro, se ficou, ainda passa pela leitura do banco.
  }
}

/** Apaga o registro de QUALQUER usuário desta aba (logout, carga fora do checkout). */
export function esquecerTodosOsPedidosPendentesDoCheckout(): void {
  try {
    const store = armazem();
    if (!store) return;
    // De trás para a frente: o índice se desloca ao remover.
    for (let i = store.length - 1; i >= 0; i--) {
      const chave = store.key(i);
      if (chave?.startsWith(PREFIXO_DA_CHAVE)) store.removeItem(chave);
    }
  } catch {
    // Idem.
  }
}
