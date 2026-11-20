import {
  paymentStatusConfig,
  rotuloDoPagamento,
} from "@/components/admin/orders/OrderStatusBadge";
import { branding } from "@/config/branding";
import { rotuloDaFormaDoPedido } from "@/lib/forma-de-pagamento";
import { linhasDoEndereco } from "@/lib/linhas-do-endereco-do-pedido";
import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { observacaoDaClienteNoRecibo } from "@/lib/observacao-da-cliente-no-recibo";
import { quemVaiReceberSeForOutro } from "@/lib/quem-vai-receber";
import { rotuloDaVariacaoGuardada } from "@/lib/rotulo-da-variacao";
import { situacaoDoPagamentoNaEntrega } from "@/lib/situacao-do-pagamento-na-entrega";
import type { Order } from "@/types";
import { memo } from "react";
import { createPortal } from "react-dom";

interface OrderReceiptProps {
  order: Order;
  /**
   * A-3 (laudo varredura 01/09): o nome da LOJA no papel impresso.
   *
   * O recibo é o único documento que sai impresso e vai para a mão da
   * cliente — ele tem de dizer o nome DELA ("Ateliê da Maria"), não o do
   * molde do build. A prop vem de cima (AdminOrdersView, que lê
   * `config.storeName` via useStore, e passa por OrderDetail), porque ler o
   * StoreContext AQUI quebraria a montagem isolada em teste (importar o
   * contexto puxa `@/lib/supabase` na carga do módulo — createClient roda no
   * top-level, e jsdom sem Web Worker explode; ver o teste
   * recibo-impresso-nome-da-loja.test.tsx, que monta o recibo sozinho).
   *
   * Fallback preservado: quem montar sem a prop (os testes antigos) segue
   * vendo o branding do build.
   */
  storeName?: string;
  /**
   * Rótulo da variação de cada item ("Cor Azul · Tamanho M"), por
   * `variantId`. O pedido só guarda o id; quem lê o catálogo é a ficha
   * (OrderDetail), e este recibo só imprime o que recebe. Sem a prop, ou sem
   * entrada para o item, a linha sai como sempre (o recibo do balcão, por
   * exemplo, já leva a variação dentro do nome).
   */
  variacoes?: Record<string, string>;
  /** Valor do estorno já confirmado pelo Mercado Pago, em reais. */
  valorEstornado?: number;
  /** Reembolso manual conferido, em reais; null se não pôde ser conferido. */
  valorReembolsadoManual?: number | null;
}

// O recibo e o unico documento desta tela que sai IMPRESSO e vai para a mao
// da cliente. Ate aqui ele misturava duas notacoes -- `R$ 100.00` com ponto
// nas linhas antigas e `R$ 10,00` com virgula na linha de desconto -- e duas
// notacoes na mesma folha parecem erro para quem le. Um formatador so, em
// pt-BR, para todas as linhas.
function reais(valor: number): string {
  return (valor || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// O literal que o banco grava em `customer_name` numa venda de balcão sem
// cliente (migration do balcão, COALESCE final) — o mesmo de `ReciboDaVenda`.
const NOME_DE_VENDA_SEM_CLIENTE = "Venda no balcão";

export const OrderReceipt = memo(function OrderReceipt({
  order,
  storeName: storeNameProp,
  variacoes,
  valorEstornado = 0,
  valorReembolsadoManual,
}: OrderReceiptProps) {
  const storeName = storeNameProp ?? branding.appName;
  const totalEmCentavos = Math.max(0, Math.round(order.total * 100));
  const reembolsadoEmCentavos = Math.min(
    Math.round(valorEstornado * 100),
    totalEmCentavos,
  );
  const manualEmCentavos =
    order.status === "cancelled"
      ? 0
      : Math.round((valorReembolsadoManual ?? 0) * 100);
  const reembolsoIntegralComManual =
    manualEmCentavos > 0 &&
    totalEmCentavos > 0 &&
    manualEmCentavos + reembolsadoEmCentavos >= totalEmCentavos;
  const { situacao, valor } = situacaoDoPagamentoNaEntrega(order);
  const situacaoNoPapel =
    situacao === "estornado" || reembolsoIntegralComManual
      ? "Estornado"
      : order.status === "cancelled"
        ? "Cancelado · nada a receber"
        : situacao === "sem_valor"
          ? "Sem valor a cobrar"
          : situacao === "pago"
            ? "Pago"
            : situacao === "cobrar"
              ? `Cobrar na ${order.canal === "presencial" ? "loja" : order.retiradaNaLoja ? "retirada" : "entrega"}: R$ ${valor} (${rotuloDaFormaDoPedido(order)})`
              : order.paymentMethod === "online" &&
                  rotuloDoPagamento(order.paymentStatus, order.status) ===
                    paymentStatusConfig.recusado.label
                ? "Pagamento recusado"
                : "Pagamento pendente";
  // Venda de balcão: não tem frete, e o papel diz como a cliente pagou.
  const presencial = order.canal === "presencial";
  const observacao = observacaoDaClienteNoRecibo(
    order.notes,
    order.retiradaNaLoja ? (order.enderecoDeRetirada ?? "") : undefined,
  );
  // O banco grava este texto em `customer_name` quando a venda de balcão nasce
  // sem cliente (e quando a cliente cadastrada não tem nome no perfil). Ele não
  // é nome de gente: sem conta vinculada o papel não leva o bloco CLIENTE; com
  // conta diz "Cliente" — o mesmo que o recibo da tela Vender (ReciboDaVenda).
  const nomeNoPapel =
    presencial && order.customer.name?.trim() === NOME_DE_VENDA_SEM_CLIENTE
      ? order.userId
        ? "Cliente"
        : ""
      : order.customer.name;
  // Compra para presente ou entrega na portaria: a ficha mostra "Recebe: X" e o
  // papel que vai com o entregador tambem precisa do nome de quem esta na porta.
  const quemRecebe = presencial
    ? ""
    : quemVaiReceberSeForOutro(
        order.customer.name,
        order.customer.recipientName,
      );
  const papel = (
    <>
      <div
        data-tema-fixo=""
        className="mx-auto hidden max-w-[80mm] border border-gray-200 bg-white p-8 font-mono text-sm text-black [overflow-wrap:anywhere] print:block"
      >
        <div className="mb-4 border-b border-dashed border-black pb-4 text-center">
          <h2 className="break-words text-xl font-bold uppercase">
            {storeName}
          </h2>
          <p className="text-xs">Pedido #{numeroDoPedido(order.id)}</p>
          <p className="text-xs">
            {order?.createdAt
              ? new Date(order.createdAt).toLocaleString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                })
              : "Data Indisponível"}
          </p>
        </div>

        {/* Venda de balcão sem cliente chega aqui com o nome vazio: o papel
            não imprime o título "CLIENTE:" sozinho. */}
        {(!presencial || nomeNoPapel) && (
          <div className="mb-4">
            <p className="mb-1 border-b border-black font-bold">CLIENTE:</p>
            <p className="break-words">{nomeNoPapel}</p>
            {quemRecebe && (
              <p className="break-words text-xs">Recebe: {quemRecebe}</p>
            )}
            {order.customer.whatsapp && (
              <p className="break-words">{order.customer.whatsapp}</p>
            )}
            {linhasDoEndereco(order.customer).map((linha) => (
              <p key={linha} className="break-words text-xs">
                {linha}
              </p>
            ))}
          </div>
        )}

        {order.retiradaNaLoja && (
          <div className="mb-4">
            <p className="mb-1 border-b border-black font-bold">
              RETIRADA NA LOJA:
            </p>
            <p className="break-words text-xs">{order.enderecoDeRetirada}</p>
          </div>
        )}

        {!presencial && order.notes?.trim() && observacao && (
          <div className="mb-4">
            <p className="mb-1 border-b border-black font-bold">OBSERVAÇÃO:</p>
            <p className="whitespace-pre-line break-words text-xs">
              {observacao}
            </p>
          </div>
        )}

        <div className="mb-4">
          <p className="mb-1 border-b border-black font-bold">ITENS:</p>
          <div className="space-y-1">
            {order.items.map((item, i) => {
              const rotulo =
                rotuloDaVariacaoGuardada(item) ||
                (item.variantId ? variacoes?.[item.variantId] : "");
              return (
                <div
                  key={i}
                  className="flex justify-between print:break-inside-avoid"
                >
                  <span className="min-w-0 flex-1 break-words">
                    {item.quantity}x {item.name}
                    {rotulo && (
                      <span className="block break-words pl-4 text-xs">
                        {rotulo}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 whitespace-nowrap">
                    R$ {reais((item.price || 0) * (item.quantity || 0))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mb-4 border-t border-dashed border-black pt-4 print:break-inside-avoid">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>R$ {reais(order?.subtotal || 0)}</span>
          </div>
          {!presencial && (
            <div className="flex justify-between">
              <span>Frete</span>
              {/* Entrega com frete zero diz "Grátis", igual à tela da cliente
                  (OrderDetailsView); a retirada na loja segue com o valor. */}
              <span>
                {(order?.shipping || 0) <= 0 && !order.retiradaNaLoja
                  ? "Grátis"
                  : `R$ ${reais(order?.shipping || 0)}`}
              </span>
            </div>
          )}
          {(order?.discount || 0) > 0 && (
            // Achado 1 do lote 1 (caça-defeitos): sem esta linha, a conta do
            // papel não fechava — subtotal + frete não batia com o TOTAL, e
            // quem responde "por que não bate?" para a cliente é a lojista.
            // Mesma condição e mesmo rótulo da ficha na tela
            // (OrderDetail.tsx:530-547), formatação de dinheiro igual à dela
            // (toLocaleString pt-BR com 2 casas).
            <div className="flex justify-between">
              <span>Desconto</span>
              <span>- R$ {reais(order.discount || 0)}</span>
            </div>
          )}
          <div className="mt-2 flex justify-between border-t border-black pt-2 text-lg font-bold">
            <span>TOTAL</span>
            <span>R$ {reais(order?.total || 0)}</span>
          </div>
          {valorEstornado > 0 && order.status !== "cancelled" ? (
            <>
              <div className="flex justify-between gap-2 text-xs">
                <span>Reembolsado pelo Mercado Pago:</span>
                <span className="shrink-0 whitespace-nowrap">
                  R$ {reais(reembolsadoEmCentavos / 100)}
                </span>
              </div>
              <div className="flex justify-between gap-2 text-xs">
                <span>Total menos reembolso do Mercado Pago:</span>
                <span className="shrink-0 whitespace-nowrap">
                  R$ {reais((totalEmCentavos - reembolsadoEmCentavos) / 100)}
                </span>
              </div>
            </>
          ) : null}
          {manualEmCentavos > 0 && (
            <div className="flex justify-between gap-2 text-xs">
              <span>Devolvido ao cliente (manual):</span>
              <span className="shrink-0 whitespace-nowrap">
                R$ {reais(manualEmCentavos / 100)}
              </span>
            </div>
          )}
          <p className="mt-2 text-xs">
            Pagamento: {rotuloDaFormaDoPedido(order)}
          </p>
          <p className="text-xs">
            {situacaoNoPapel}
            {valorReembolsadoManual === null &&
              " · Reembolsos manuais não conferidos"}
          </p>
        </div>

        <div className="mt-8 border-t border-dashed border-black pt-4 text-center">
          <p className="text-xs">Obrigado pela preferência!</p>
          <p className="mt-2 text-[11px] text-gray-400">
            {typeof window !== "undefined" ? window.location.hostname : ""}
          </p>
        </div>
      </div>

      <style>
        {`
                    @media print {
                        body * { visibility: hidden; }
                        .print\\:block, .print\\:block * { visibility: visible; }
                        .print\\:block {
                            position: static; 
                            width: 100% !important; 
                            padding: 20px !important;
                            margin: 0 !important;
                            display: block !important;
                            background: white !important;
                        }
                        nav, footer, button, .sticky, header, [role="banner"] { display: none !important; }
                        /* O painel inteiro (#root) sai da impressão: ele rola por
                           dentro (altura fixa e overflow cortado) e, só escondido,
                           ainda ocupava páginas em branco. O papel mora fora do
                           #root (portal no body) e é o único que sobra; html e body
                           soltam a altura para o recibo comprido paginar. */
                        #root { display: none !important; }
                        html, body {
                            height: auto !important;
                            overflow: visible !important;
                        }
                    }
                `}
      </style>
    </>
  );
  // Fora do #root: na impressão o painel inteiro é escondido de verdade
  // (`display: none`), e o papel, que não depende de nenhum ancestral do painel,
  // sai completo, de cima, com a tela rolada ou não e com qualquer nº de itens.
  return typeof document === "undefined"
    ? papel
    : createPortal(papel, document.body);
});
