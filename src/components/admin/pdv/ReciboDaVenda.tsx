// Seção "recibo" do caixa (tarefa C3.2, plano §5.3). Recibo DE TELA — não
// confundir com `OrderReceipt` (src/components/admin/orders/OrderReceipt.tsx),
// que é `print:block` e só aparece no PAPEL (divergência registrada na
// tarefa: ele espera um `Order` completo, com endereço, que a venda de
// balcão não tem — os campos vazios simplesmente não imprimem nada).
//
// Este arquivo NÃO chama Supabase.

import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import { Button } from "@/components/ui/button";
import type {
  AcaoDaVenda,
  ClienteDaVenda,
  ReciboDaVendaRegistrada,
} from "@/hooks/useVendaPresencial";
import { linkWhatsappDoCliente } from "@/lib/whatsapp-do-cliente";
import type { Order } from "@/types";
import {
  CheckCircle2,
  MessageCircle,
  Printer,
  RefreshCcw,
  ShoppingCart,
} from "lucide-react";
import type { ReactElement } from "react";

export interface PropsDoReciboDaVenda {
  readonly recibo: ReciboDaVendaRegistrada;
  readonly despachar: (acao: AcaoDaVenda) => void;
  /** `useVendaPresencial().limparCupom` — gira a chave de idempotência E
   * apaga o rascunho (o reducer sozinho não faz nenhuma das duas). */
  readonly limparCupom: () => void;
  readonly storeName?: string;
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
}: PropsDoReciboDaVenda): ReactElement {
  const whatsapp = whatsappDoCliente(recibo.cliente);
  const linkWhatsapp = linkWhatsappDoCliente(whatsapp);

  function aoEnviarPorWhatsapp(): void {
    if (!linkWhatsapp) return;
    const texto = encodeURIComponent(
      `Aqui está o comprovante da sua compra na ${storeName ?? "loja"}! ` +
        `Pedido #${recibo.numero} — Total R$ ${reais(recibo.total)}. Obrigado pela preferência!`,
    );
    globalThis.open(`${linkWhatsapp}?text=${texto}`, "_blank");
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex flex-col items-center gap-1 border-b border-dashed border-zinc-800 pb-4 text-center">
        <CheckCircle2 className="size-8 text-emerald-400" />
        <h3 className="text-lg font-bold text-white">Compra na loja</h3>
        <p className="text-xs text-zinc-500">
          Pedido #{recibo.numero} ·{" "}
          {new Date(recibo.criadoEm).toLocaleString("pt-BR")}
        </p>
      </div>

      {/* `recibo.jaExistia` (achado BLOQUEIA da revisão: o campo existia no
          tipo desde C3.1 mas nunca era lido em lugar nenhum — o duplo toque
          ficava silencioso). Não é erro: é o balconista clicando de novo
          porque a resposta da primeira vez se perdeu (pdv-c1.json) — o
          recibo é o MESMO pedido, e este aviso é só para ele conferir que
          bateu com o que já tinha cobrado antes. */}
      {recibo.jaExistia && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-xl border border-amber-800/50 bg-amber-950/30 p-3 text-xs text-amber-200"
        >
          <RefreshCcw className="size-4 shrink-0" />
          Esta venda já tinha sido registrada; confira o que saiu no recibo.
        </p>
      )}

      <div className="flex flex-col gap-1 text-sm">
        <p className="font-semibold text-zinc-300">Cliente</p>
        <p className="text-zinc-400">{nomeDoCliente(recibo.cliente)}</p>
        {whatsapp && <p className="text-zinc-500">{whatsapp}</p>}
      </div>

      <ul className="flex flex-col gap-1.5 text-sm">
        {recibo.itens.map((item) => (
          <li key={item.chave} className="flex justify-between text-zinc-300">
            <span>
              {item.quantidade}x {item.nome}
              {item.variacao ? ` (${item.variacao})` : ""}
            </span>
            <span>R$ {reais(item.preco * item.quantidade)}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-1 border-t border-zinc-800 pt-3 text-sm">
        <div className="flex justify-between text-zinc-400">
          <span>Subtotal</span>
          <span>R$ {reais(recibo.subtotal)}</span>
        </div>
        {recibo.desconto > 0 && (
          <div className="flex justify-between text-zinc-400">
            <span>Desconto</span>
            <span>- R$ {reais(recibo.desconto)}</span>
          </div>
        )}
        <div className="flex justify-between text-lg font-bold text-white">
          <span>Total</span>
          <span>R$ {reais(recibo.total)}</span>
        </div>
        <div className="flex justify-between text-zinc-500">
          <span>Pagamento</span>
          <span>{ROTULO_DO_PAGAMENTO[recibo.pagamento]}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        {linkWhatsapp && (
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={aoEnviarPorWhatsapp}
          >
            <MessageCircle className="mr-1.5 size-4" />
            Enviar por WhatsApp
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={() => globalThis.print()}
        >
          <Printer className="mr-1.5 size-4" />
          Imprimir
        </Button>
        <Button
          type="button"
          className="flex-1 bg-admin-gold text-black hover:bg-admin-gold/90"
          onClick={limparCupom}
        >
          <ShoppingCart className="mr-1.5 size-4" />
          Nova venda
        </Button>
      </div>

      {/* `OrderReceipt` é `hidden ... print:block` (contexto, fato 14): não
          aparece aqui na tela, só quando o botão "Imprimir" chama
          `window.print()`. */}
      <OrderReceipt
        order={construirOrderParaImpressao(recibo)}
        storeName={storeName}
      />
    </div>
  );
}
