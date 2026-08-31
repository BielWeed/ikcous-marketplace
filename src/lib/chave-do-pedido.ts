// A CHAVE DA COMPRA — idempotência do lado do cliente (laudo caça-bugs
// 31/08, A1). A metade que DECIDE é o servidor (migration 20261038000000:
// `p_idempotency_key` na create_marketplace_order_v23/v24 + índice único);
// este arquivo só garante que a retentativa REPITA a chave em vez de
// inventar outra.
//
// POR QUE A CHAVE PERTENCE À COMPRA, NÃO AO CLIQUE: a trava síncrona do
// checkout (`travaDeEnvio`) já fecha o duplo toque no mesmo tique. O que
// ela não fecha é a retentativa DEPOIS: rede caiu com o pedido já gravado,
// o cliente viu o erro e aperta Finalizar de novo. Sem chave estável, o
// segundo pedido nasce inteiro — estoque e cupom debitados em dobro. Com
// ela, o servidor reconhece a compra e devolve o pedido original.
//
// POR QUE sessionStorage: o recarregar da página é outra retentativa real
// (pedido gravado, resposta perdida, F5). A chave precisa sobreviver ao
// remount do CheckoutView. Morar na SESSÃO (e não no localStorage) é o
// que impede uma compra de amanhã, num carrinho idêntico, herdar a chave
// de hoje: fechar a aba esquece tudo — e o sucesso esquece na hora.
//
// A impressão digital é CANÔNICA (itens ordenados, decimais fixados): a
// ordem em que o cliente pôs os itens no carrinho não é mudança de compra.

const CHAVE_DE_ARMAZENAMENTO = "ikcous-chave-do-pedido";

export interface CompraParaImpressao {
  items: ReadonlyArray<{
    product_id: string;
    variant_id?: string | null;
    quantity: number;
  }>;
  totalAmount: number;
  shippingCost: number;
  destinationCep?: string | null;
  shippingOptionId?: string | null;
  couponCode?: string | null;
  addressId?: string | null;
  /** CEP do endereço digitado (convidado) — entra na impressão porque mudar a entrega é mudar a compra. */
  cepDoEndereco?: string | null;
}

function texto(valor: string | number | null | undefined): string {
  return valor === null || valor === undefined ? "" : String(valor);
}

export function impressaoDaCompra(compra: CompraParaImpressao): string {
  const itens = [...compra.items]
    .map(
      (i) =>
        `${texto(i.product_id)}:${texto(i.variant_id ?? "")}:${texto(i.quantity)}`,
    )
    .sort()
    .join("|");

  return [
    itens,
    compra.totalAmount.toFixed(2),
    compra.shippingCost.toFixed(2),
    texto(compra.destinationCep ?? ""),
    texto(compra.shippingOptionId ?? ""),
    texto(compra.couponCode ?? ""),
    texto(compra.addressId ?? ""),
    texto(compra.cepDoEndereco ?? ""),
  ].join("~");
}

interface RegistroDaChave {
  impressao: string;
  chave: string;
}

export interface ArmazenamentoSimples {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
}

export interface GerenciadorDeChaveDaCompra {
  /** A chave desta compra: mesma impressão devolve a chave já dada; impressão nova gira outra. */
  chavePara(impressao: string): string;
  /** Chamado NO SUCESSO: a próxima compra, mesmo idêntica, tem de nascer com chave nova. */
  esquecer(): void;
}

export function criarGerenciadorDeChave(
  armazenamento: ArmazenamentoSimples,
  gerarChave: () => string = () => globalThis.crypto.randomUUID(),
): GerenciadorDeChaveDaCompra {
  let impressaoCorrente: string | null = null;

  function lerRegistro(): RegistroDaChave | null {
    const cru = armazenamento.getItem(CHAVE_DE_ARMAZENAMENTO);
    if (!cru) return null;
    try {
      const registro = JSON.parse(cru) as RegistroDaChave;
      if (
        typeof registro?.impressao !== "string" ||
        typeof registro?.chave !== "string"
      ) {
        return null;
      }
      return registro;
    } catch {
      return null;
    }
  }

  return {
    chavePara(impressao: string): string {
      // A impressão corrente da instância manda: dentro da mesma página, o
      // que o gerente acabou de decidir não é reaberto com o storage (duas
      // impressões alternando no mesmo storage trocaria de chave no ar).
      if (impressaoCorrente === impressao) {
        const registro = lerRegistro();
        if (registro?.impressao === impressao) return registro.chave;
      }

      const registro = lerRegistro();
      if (registro?.impressao === impressao) {
        impressaoCorrente = impressao;
        return registro.chave;
      }

      const chave = gerarChave();
      armazenamento.setItem(
        CHAVE_DE_ARMAZENAMENTO,
        JSON.stringify({ impressao, chave } satisfies RegistroDaChave),
      );
      impressaoCorrente = impressao;
      return chave;
    },

    esquecer(): void {
      armazenamento.removeItem(CHAVE_DE_ARMAZENAMENTO);
      impressaoCorrente = null;
    },
  };
}
