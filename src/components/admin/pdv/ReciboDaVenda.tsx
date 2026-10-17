// Seção "recibo" do caixa (tarefa C3.2, plano §5.3). Recibo DE TELA — não
// confundir com `OrderReceipt` (src/components/admin/orders/OrderReceipt.tsx),
// que é `print:block` e só aparece no PAPEL (divergência registrada na
// tarefa: ele espera um `Order` completo, com endereço, que a venda de
// balcão não tem — os campos vazios simplesmente não imprimem nada).
//
// Este arquivo NÃO chama Supabase.

import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import { AnularVendaDoBalcao } from "@/components/admin/pdv/AnularVendaDoBalcao";
import { Button } from "@/components/ui/button";
import type { ResultadoDaAnulacao } from "@/hooks/useAnularVendaDoBalcao";
import type {
  AcaoDaVenda,
  ClienteDaVenda,
  ReciboDaVendaRegistrada,
} from "@/hooks/useVendaPresencial";
import { abrirWhatsapp } from "@/lib/abrir-whatsapp";
import { linkWhatsappDoCliente } from "@/lib/whatsapp-do-cliente";
import type { Order } from "@/types";
import {
  Ban,
  Banknote,
  CheckCircle2,
  CreditCard,
  MessageCircle,
  Plus,
  Printer,
  QrCode,
  RefreshCcw,
  UserRound,
} from "lucide-react";
import { type ReactElement, useState } from "react";
import "./pdv.css";

export interface PropsDoReciboDaVenda {
  readonly recibo: ReciboDaVendaRegistrada;
  readonly despachar: (acao: AcaoDaVenda) => void;
  /** `useVendaPresencial().limparCupom` — gira a chave de idempotência E
   * apaga o rascunho (o reducer sozinho não faz nenhuma das duas). */
  readonly limparCupom: () => void;
  readonly storeName?: string;
  /** Anula ESTA venda (a tela de cima amarra o `orderId`). Ausente = sem o
   * botão de anular (testes e telas que não oferecem a anulação). */
  readonly aoAnular?: (motivo: string) => Promise<ResultadoDaAnulacao>;
}

function reais(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function nomeDoCliente(cliente: ClienteDaVenda): string {
  return cliente.tipo === "sem_cliente" ? "Venda no balcão" : cliente.nome;
}

function whatsappDoCliente(cliente: ClienteDaVenda): string | null {
  if (cliente.tipo === "avulso") return cliente.whatsapp;
  if (cliente.tipo === "cadastrado") return cliente.whatsapp;
  return null;
}

/** Monta um `Order` mínimo só para o `OrderReceipt` imprimir — os campos que
 * a venda de balcão não tem (endereço, bairro…) ficam vazios de propósito:
 * eles simplesmente não aparecem no papel (divergência da tarefa). */
function construirOrderParaImpressao(recibo: ReciboDaVendaRegistrada): Order {
  return {
    id: recibo.orderId,
    customer: {
      name: nomeDoCliente(recibo.cliente),
      whatsapp: whatsappDoCliente(recibo.cliente) ?? "",
    },
    items: recibo.itens.map((item) => ({
      productId: item.productId,
      variantId: item.variantId ?? undefined,
      name: item.variacao ? `${item.nome} - ${item.variacao}` : item.nome,
      price: item.preco,
      quantity: item.quantidade,
      image: item.imagem,
    })),
    subtotal: recibo.subtotal,
    shipping: 0,
    discount: recibo.desconto,
    total: recibo.total,
    paymentMethod: recibo.pagamento,
    status: "delivered",
    createdAt: recibo.criadoEm,
    updatedAt: recibo.criadoEm,
    cancelledAfterShipping: false,
    canal: "presencial",
  };
}

const ROTULO_DO_PAGAMENTO: Record<
  ReciboDaVendaRegistrada["pagamento"],
  string
> = {
  cash: "Dinheiro",
  pix: "PIX na hora",
  card: "Cartão na maquininha",
};

export function ReciboDaVenda({
  recibo,
  limparCupom,
  storeName,
  aoAnular,
}: PropsDoReciboDaVenda): ReactElement {
  // Depois de anular, este recibo deixa de ser comprovante de compra: nada de
  // mandar "sua compra" por WhatsApp nem de imprimir o papel da venda.
  const [anulada, setAnulada] = useState(false);
  const whatsapp = whatsappDoCliente(recibo.cliente);
  const linkWhatsapp = linkWhatsappDoCliente(whatsapp);

  function aoEnviarPorWhatsapp(): void {
    if (!linkWhatsapp) return;
    const texto = encodeURIComponent(
      `Aqui está o comprovante da sua compra na ${storeName ?? "loja"}! ` +
        `Pedido #${recibo.numero} — Total R$ ${reais(recibo.total)}. Obrigado pela preferência!`,
    );
    abrirWhatsapp(`${linkWhatsapp}?text=${texto}`);
  }

  return (
    <div className="pdv-receipt">
      <div className="pdv-layer-heading">
        <h2>{anulada ? "Venda anulada" : "Venda registrada"}</h2>
        <p className="pdv-muted">3 · Recibo</p>
      </div>
      <div className="pdv-card pdv-stack">
        <div className="pdv-heading">
          {anulada ? (
            <Ban aria-hidden="true" className="pdv-icon pdv-red" />
          ) : (
            <CheckCircle2 aria-hidden="true" className="pdv-icon pdv-green" />
          )}
          <div>
            <h3 className="text-lg font-bold">
              {anulada ? "Venda anulada" : "Compra na loja"}
            </h3>
            <p className="pdv-muted">
              Pedido #{recibo.numero} ·{" "}
              {new Date(recibo.criadoEm).toLocaleString("pt-BR")}
            </p>
          </div>
        </div>
        {recibo.jaExistia && (
          <p role="status" className="pdv-muted flex items-start gap-2">
            <RefreshCcw
              aria-hidden="true"
              className="pdv-orange size-4 shrink-0"
            />
            Esta venda já tinha sido registrada; confira o que saiu no recibo.
          </p>
        )}
        <div className="pdv-heading pdv-divider">
          <UserRound aria-hidden="true" className="pdv-icon pdv-blue" />
          <div>
            <p className="sr-only">Cliente</p>
            <p>
              {nomeDoCliente(recibo.cliente)}
              {recibo.cliente.tipo === "avulso" && " · cliente avulso"}
            </p>
            {whatsapp && <p className="pdv-muted">WhatsApp · {whatsapp}</p>}
          </div>
        </div>
        <ul className="pdv-receipt-lines pdv-divider">
          {recibo.itens.map((item) => (
            <li key={item.chave} className="pdv-receipt-line">
              <span>
                <span className="block">{item.nome}</span>
                <span className="pdv-muted">
                  {item.variacao ? `${item.variacao} · ` : ""}
                  {item.quantidade} un. × R$ {reais(item.preco)}
                </span>
              </span>
              <span>R$ {reais(item.preco * item.quantidade)}</span>
            </li>
          ))}
        </ul>
        <div className="pdv-stack pdv-divider">
          <div className="pdv-total pdv-muted">
            <span>Subtotal</span>
            <span>R$ {reais(recibo.subtotal)}</span>
          </div>
          {recibo.desconto > 0 && (
            <div className="pdv-total pdv-muted">
              <span>Desconto</span>
              <span>- R$ {reais(recibo.desconto)}</span>
            </div>
          )}
          <div className="pdv-total">
            <span>Total</span>
            <strong>R$ {reais(recibo.total)}</strong>
          </div>
        </div>
        <div className="pdv-heading pdv-divider">
          {recibo.pagamento === "cash" ? (
            <Banknote aria-hidden="true" className="pdv-icon pdv-green" />
          ) : recibo.pagamento === "pix" ? (
            <QrCode aria-hidden="true" className="pdv-icon pdv-teal" />
          ) : (
            <CreditCard aria-hidden="true" className="pdv-icon pdv-purple" />
          )}
          <div>
            <p className="sr-only">Pagamento</p>
            <p>{ROTULO_DO_PAGAMENTO[recibo.pagamento]}</p>
            <p className="pdv-muted">Pagamento conferido pelo lojista</p>
          </div>
        </div>
      </div>

      {!anulada && (
        <div className="pdv-stack">
          <div className="pdv-actions">
            <Button
              type="button"
              variant="outline"
              className="pdv-secondary"
              disabled={!linkWhatsapp}
              aria-describedby={
                !linkWhatsapp ? "whatsapp-recibo-indisponivel" : undefined
              }
              onClick={aoEnviarPorWhatsapp}
            >
              <MessageCircle aria-hidden="true" className="pdv-green size-5" />
              Enviar por WhatsApp
            </Button>
            <Button
              type="button"
              variant="outline"
              className="pdv-secondary"
              onClick={() => globalThis.print()}
            >
              <Printer aria-hidden="true" className="pdv-blue size-5" />
              Imprimir
            </Button>
          </div>
          {!linkWhatsapp && (
            <p
              id="whatsapp-recibo-indisponivel"
              className="pdv-muted text-center"
            >
              {whatsapp
                ? "Indisponível: WhatsApp do cliente inválido."
                : "Indisponível: cliente sem WhatsApp."}
            </p>
          )}
        </div>
      )}
      {aoAnular && (
        <AnularVendaDoBalcao
          total={recibo.total}
          forma={recibo.pagamento}
          clienteComConta={recibo.cliente.tipo === "cadastrado"}
          aoAnular={aoAnular}
          aoConcluir={() => setAnulada(true)}
        />
      )}
      <Button
        type="button"
        className="pdv-primary bg-admin-gold text-black"
        onClick={limparCupom}
      >
        <Plus aria-hidden="true" className="size-5" />
        Nova venda
      </Button>
      <OrderReceipt
        order={construirOrderParaImpressao(recibo)}
        storeName={storeName}
      />
    </div>
  );
}
