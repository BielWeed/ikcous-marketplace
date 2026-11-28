import {
  type FormaDePagamentoNaEntrega,
  formasPagamentoNaEntregaValidas,
} from "@/lib/formas-de-pagamento-na-entrega";
import { limparTelefoneBrasileiro } from "@/lib/telefone-br";

// A LOJA NOVA SÓ VENDE O QUE CONFIRMOU (28/11/2026, migration 20261655000000).
// Enquanto a lojista não toca "Está certo" no cartão "Loja pronta" (datas da
// 20261652000000), o SERVIDOR recusa a entrega na cidade e o pagamento NA
// ENTREGA da loja nova. Esta é a mesma regra do lado da tela, para ela não
// oferecer o que o pedido recusaria. Pagamento pelo app, retirada e
// transportadora nunca são travados por isto.
//
// De onde vem: a vitrine lê dois BOOLEANOS da leitura pública
// (`v_store_config.entrega_local_liberada` / `pagamento_na_entrega_liberado`,
// nunca as datas); o painel lê a ficha (`store_config`), que tem as DATAS.
// Ausente nos dois (banco antes da migration) = liberado: a tela nova num banco
// velho não trava nada.

export interface LiberacoesDaLoja {
  readonly entregaLocalLiberada?: boolean;
  readonly pagamentoNaEntregaLiberado?: boolean;
}

function liberacao(
  booleano: unknown,
  carimbo: unknown,
  jaLido: unknown,
): boolean | undefined {
  if (typeof booleano === "boolean") return booleano;
  if (carimbo !== undefined) return carimbo !== null;
  if (typeof jaLido === "boolean") return jaLido;
  return undefined;
}

/**
 * A linha crua (leitura pública, ficha do painel, realtime ou o cache offline
 * já em camelCase) → as duas liberações. Campo que não dá para saber NÃO entra
 * (ausência = liberado; o merge do realtime não sobrescreve com ausência).
 */
export function liberacoesDaLinha(
  linha: Record<string, unknown>,
): LiberacoesDaLoja {
  const entrega = liberacao(
    linha.entrega_local_liberada,
    linha.entrega_confirmada_em,
    linha.entregaLocalLiberada,
  );
  const pagamento = liberacao(
    linha.pagamento_na_entrega_liberado,
    linha.pagamento_confirmado_em,
    linha.pagamentoNaEntregaLiberado,
  );
  return {
    ...(entrega !== undefined && { entregaLocalLiberada: entrega }),
    ...(pagamento !== undefined && { pagamentoNaEntregaLiberado: pagamento }),
  };
}

/**
 * As formas de pagar NA ENTREGA que a loja oferece AGORA: nenhuma enquanto o
 * pagamento na entrega não foi confirmado (a loja fica como a que só vende pelo
 * app, estado que o checkout já conhece); senão, as formas da loja com a
 * normalização de sempre.
 */
export function formasNaEntregaOferecidas(config: {
  readonly formasPagamentoEntrega?: unknown;
  readonly pagamentoNaEntregaLiberado?: boolean;
}): FormaDePagamentoNaEntrega[] {
  if (config.pagamentoNaEntregaLiberado === false) return [];
  return formasPagamentoNaEntregaValidas(config.formasPagamentoEntrega);
}

export interface FatosDoPedidoPossivel {
  readonly pagamentoPeloApp: boolean;
  readonly pagamentoNaEntregaLiberado: boolean;
  readonly entregaLocalLiberada: boolean;
  /** A retirada na loja está ligada (chave `store-pickup` e endereço da loja). */
  readonly retiradaLigada: boolean;
  /** Cobertura "só na cidade": não há transportadora. */
  readonly soEntregaNaCidade: boolean;
}

/**
 * A loja ainda não consegue receber pedido NENHUM pelo site: (a) não tem como
 * pagar (sem pagamento pelo app e com o pagamento na entrega pendente), ou (b)
 * não tem como entregar por causa da pendência (entrega na cidade pendente, sem
 * retirada e sem transportadora possível — transportadora só com pagamento pelo
 * app e cobertura além da cidade). Só afirma o que se prova daqui: transportadora
 * "possível" pode ainda não ter conta conectada, e aí quem avisa é o frete.
 */
export function lojaAindaNaoRecebePedido(f: FatosDoPedidoPossivel): boolean {
  const semComoPagar = !f.pagamentoPeloApp && !f.pagamentoNaEntregaLiberado;
  const transportadoraPossivel = f.pagamentoPeloApp && !f.soEntregaNaCidade;
  const semComoEntregar =
    !f.entregaLocalLiberada && !f.retiradaLigada && !transportadoraPossivel;
  return semComoPagar || semComoEntregar;
}

/** Os fatos acima a partir da config da loja e do pagamento pelo app. */
export function fatosDoPedidoPossivel(
  config: {
    readonly entregaLocalLiberada?: boolean;
    readonly pagamentoNaEntregaLiberado?: boolean;
    readonly enabledShippingMethods?: readonly string[] | null;
    readonly storeAddress?: string | null;
    readonly shippingCoverage?: string | null;
  },
  pagamentoPeloApp: boolean,
): FatosDoPedidoPossivel {
  return {
    pagamentoPeloApp,
    pagamentoNaEntregaLiberado: config.pagamentoNaEntregaLiberado !== false,
    entregaLocalLiberada: config.entregaLocalLiberada !== false,
    retiradaLigada:
      (config.enabledShippingMethods ?? []).includes("store-pickup") &&
      (config.storeAddress ?? "").trim() !== "",
    soEntregaNaCidade: config.shippingCoverage === "local",
  };
}

export interface ItemDoPedidoPeloWhatsapp {
  readonly nome: string;
  readonly variacao?: string;
  readonly quantidade: number;
}

/** A mensagem com os itens do carrinho já escritos (a cliente só manda). */
export function mensagemDoCarrinhoNoWhatsapp(
  itens: readonly ItemDoPedidoPeloWhatsapp[],
): string {
  if (itens.length === 0) return "Olá! Quero fazer um pedido.";
  const linhas = itens.map(
    (i) =>
      `- ${i.quantidade}x ${i.nome}${i.variacao ? ` (${i.variacao})` : ""}`,
  );
  return `Olá! Quero fazer um pedido:\n${linhas.join("\n")}`;
}

/**
 * O link `wa.me` da loja com a mensagem: o número como os outros pontos do app
 * o normalizam (`limparTelefoneBrasileiro`, DDI 55 para 10 ou 11 dígitos).
 * Quem abre é `abrirWhatsapp` (aba isolada); quem decide se a loja TEM WhatsApp
 * é `lojaTemWhatsapp`.
 */
export function linkDoPedidoPeloWhatsapp(
  numeroDaLoja: string | null | undefined,
  itens: readonly ItemDoPedidoPeloWhatsapp[],
): string {
  let fone = limparTelefoneBrasileiro(numeroDaLoja);
  if (fone.length === 11 || fone.length === 10) fone = `55${fone}`;
  return `https://wa.me/${fone}?text=${encodeURIComponent(mensagemDoCarrinhoNoWhatsapp(itens))}`;
}
