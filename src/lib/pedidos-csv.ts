import {
  rotuloDoPagamento,
  rotuloDoStatus,
} from "@/components/admin/orders/OrderStatusBadge";
import { dataLocal } from "@/lib/data-local-csv";
import {
  type FormaDoPedido,
  ROTULO_SEM_VALOR_A_PAGAR,
  pedidoSemValorAPagar,
  rotuloDaFormaDoPedido,
} from "@/lib/forma-de-pagamento";
import { rotuloDaVariacaoGuardada } from "@/lib/rotulo-da-variacao";
import {
  type TipoDeEntregaDoPedido,
  tipoDeEntregaDoPedido,
} from "@/lib/tipo-de-entrega-do-pedido";
import type { Order as Pedido } from "@/types";

/** A forma do pedido na lista e na planilha — o MESMO rótulo para as duas
 * (`rotuloDaFormaDoPedido`, achado D4 de 28/09). Recebe o pedido, e não só o
 * `paymentMethod`, porque "cartão" quer dizer coisa diferente no site e no
 * balcão. */
export function rotuloDaFormaDePagamento(pedido: FormaDoPedido): string {
  return rotuloDaFormaDoPedido(pedido);
}

// Colunas novas entram NO FIM, nunca no meio: quem já tem planilha
// salva com fórmula por posição de coluna perde tudo se as colunas antigas
// andarem de lugar (lote C4, item 15).
const CABECALHO =
  "Número do pedido;Data;Cliente;Telefone;Status;Forma de pagamento;Status do pagamento;Total;Cidade;UF;Itens;Subtotal;Frete;Desconto;Canal;Entrega";
const CABECALHO_COM_ESTORNO = `${CABECALHO};Estorno pelo Mercado Pago;Total menos estorno do Mercado Pago`;

// Mesma classificação da ficha do pedido (`tipoDeEntregaDoPedido`), em
// português para quem abre a planilha. Balcão repete "Balcão": a venda
// presencial não tem entrega, e célula vazia pareceria dado perdido.
const ROTULO_DA_ENTREGA: Record<TipoDeEntregaDoPedido, string> = {
  balcao: "Balcão",
  retirada: "Retirada na loja",
  "entrega-local": "Entrega própria",
  envio: "Envio",
};

export function escaparCampo(valor: string): string {
  // Aspas CSV não impedem fórmulas: texto vindo do cliente precisa continuar texto.
  const seguro =
    /^[\t\r\n]/.test(valor) || /^[\s]*[=+@-]/.test(valor) ? `'${valor}` : valor;
  return /[;"\r\n]/.test(seguro) ? `"${seguro.replaceAll('"', '""')}"` : seguro;
}

function colunasDeEstorno({
  total,
  valorEstornado,
  paymentStatus,
}: Pedido): [string, string] {
  // Um pagamento estornado pode ter acumulado zero (ex.: cartão financiado).
  // O recibo diz "Estornado", mas não imprime um valor de reembolso nesse caso.
  if (
    typeof valorEstornado !== "number" ||
    !Number.isFinite(valorEstornado) ||
    valorEstornado < 0 ||
    (paymentStatus === "estornado" && valorEstornado === 0)
  ) {
    return ["", ""];
  }

  // Como no recibo, limita o valor exibido ao total e faz a conta em centavos.
  const totalEmCentavos = Math.max(0, Math.round(total * 100));
  const estornoEmCentavos = Math.min(
    Math.round(valorEstornado * 100),
    totalEmCentavos,
  );
  const restanteEmCentavos = totalEmCentavos - estornoEmCentavos;
  return [
    (estornoEmCentavos / 100).toFixed(2).replace(".", ","),
    (restanteEmCentavos / 100).toFixed(2).replace(".", ","),
  ];
}

/** Exporta somente os pedidos recebidos, na mesma ordem, sem alterar a lista.
 * O retrato da linha vence. `rotulos` (variantId -> "Tamanho M") é a reserva
 * para as compras que ainda não viram uma troca de nome ou de valor. */
export function pedidosParaCsv(
  pedidos: Pedido[],
  rotulos: Readonly<Record<string, string>> = {},
): string {
  const linhas = pedidos.map((pedido) =>
    [
      escaparCampo(`#${pedido.id.slice(-6).toUpperCase()}`),
      dataLocal(pedido.createdAt),
      escaparCampo(pedido.customer?.name || "Cliente"),
      escaparCampo(pedido.customer?.whatsapp ?? ""),
      // Mesmo rótulo das telas: retirada na loja pronta é "Pronto para
      // retirar", não "Em Trânsito" (achado b13).
      escaparCampo(rotuloDoStatus(pedido.status, pedido.retiradaNaLoja)),
      escaparCampo(rotuloDaFormaDePagamento(pedido)),
      escaparCampo(
        pedidoSemValorAPagar(pedido)
          ? ROTULO_SEM_VALOR_A_PAGAR
          : rotuloDoPagamento(
              pedido.paymentStatus,
              pedido.status,
              pedido.canal,
              false,
              pedido.retiradaNaLoja,
            ),
      ),
      pedido.total.toFixed(2).replace(".", ","),
      escaparCampo(pedido.customer?.city ?? ""),
      escaparCampo(pedido.customer?.state ?? ""),
      escaparCampo(
        pedido.items
          .map((item) => {
            const rotulo =
              rotuloDaVariacaoGuardada(item) ||
              (item.variantId ? rotulos[item.variantId] : "");
            return `${item.name}${rotulo ? ` - ${rotulo}` : ""} (${item.quantity} x ${item.price.toFixed(2).replace(".", ",")})`;
          })
          .join(" | "),
      ),
      pedido.subtotal.toFixed(2).replace(".", ","),
      pedido.shipping.toFixed(2).replace(".", ","),
      pedido.discount.toFixed(2).replace(".", ","),
      // Rótulo em português para humano — quem abre o CSV é o lojista, não
      // um parser. "Site" (não "Online") porque é a palavra que o resto do
      // painel usa para o mesmo canal (OrderDetail.tsx, "Pago no site").
      escaparCampo(pedido.canal === "presencial" ? "Balcão" : "Site"),
      escaparCampo(ROTULO_DA_ENTREGA[tipoDeEntregaDoPedido(pedido)]),
      ...colunasDeEstorno(pedido),
    ].join(";"),
  );
  return `\uFEFF${[CABECALHO_COM_ESTORNO, ...linhas].join("\r\n")}`;
}
