import { branding } from "@/config/branding";
import type { Order } from "@/types";
import { memo } from "react";

interface OrderReceiptProps {
  order: Order;
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

export const OrderReceipt = memo(function OrderReceipt({
  order,
}: OrderReceiptProps) {
  // Nome da loja no papel: branding do build. Aqui NÃO se lê config.storeName
  // do banco: importar o StoreContext puxa @/lib/supabase na carga do módulo
  // (createClient roda no top-level), e o recibo é montado isolado em teste
  // (jsdom sem Web Worker) -- quebrava a suíte só de importar. Quando o teste
  // puder prover/mocar o provider, trocar por config.storeName ?? branding.appName.
  const storeName = branding.appName;
  return (
    <>
      <div className="mx-auto hidden max-w-[80mm] border border-gray-200 bg-white p-8 font-mono text-sm text-black print:block">
        <div className="mb-4 border-b border-dashed border-black pb-4 text-center">
          <h2 className="text-xl font-bold uppercase">{storeName}</h2>
          <p className="text-xs">Pedido #{order.id.slice(-6)}</p>
          <p className="text-xs">
            {order?.createdAt
              ? new Date(order.createdAt).toLocaleString("pt-BR")
              : "Data Indisponível"}
          </p>
        </div>

        <div className="mb-4">
          <p className="mb-1 border-b border-black font-bold">CLIENTE:</p>
          <p>{order.customer.name}</p>
          <p>{order.customer.whatsapp}</p>
          <p className="text-xs">
            {order.customer.address}, {order.customer.number}
          </p>
          <p className="text-xs">{order.customer.neighborhood}</p>
        </div>

        <div className="mb-4">
          <p className="mb-1 border-b border-black font-bold">ITENS:</p>
          <div className="space-y-1">
            {order.items.map((item, i) => (
              <div key={i} className="flex justify-between">
                <span className="flex-1">
                  {item.quantity}x {item.name}
                </span>
                <span>
                  R$ {reais((item.price || 0) * (item.quantity || 0))}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-4 border-t border-dashed border-black pt-4">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>R$ {reais(order?.subtotal || 0)}</span>
          </div>
          <div className="flex justify-between">
            <span>Frete</span>
            <span>R$ {reais(order?.shipping || 0)}</span>
          </div>
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
        </div>

        <div className="mt-8 border-t border-dashed border-black pt-4 text-center">
          <p className="text-xs">Obrigado pela preferência!</p>
          <p className="mt-2 text-[10px] text-gray-400">
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
                            position: absolute; 
                            left: 0; 
                            top: 0; 
                            width: 100% !important; 
                            padding: 20px !important;
                            margin: 0 !important;
                            display: block !important;
                            background: white !important;
                        }
                        nav, footer, button, .sticky, header, [role="banner"] { display: none !important; }
                    }
                `}
      </style>
    </>
  );
});
