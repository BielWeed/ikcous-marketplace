import {
  mensagemMototaxi,
  normalizarNumeroMototaxi,
} from "@/components/admin/minha-loja/contato";
import { IconeWhatsapp } from "@/components/icons/IconeWhatsapp";
import { useMototaxi } from "@/hooks/useMototaxi";
import { ID_ENTREGA_LOCAL } from "@/lib/guarda-de-frete";
import type { Order } from "@/types";

export function EnviarAoMototaxi({
  order,
  loja,
}: { order: Order; loja: string }) {
  const { config } = useMototaxi();
  const numero = normalizarNumeroMototaxi(config?.whatsapp);
  if (order.shippingOptionId !== ID_ENTREGA_LOCAL || !numero) return null;
  return (
    <div className="space-y-2 border-t border-admin-border pt-4">
      <a
        aria-label="Enviar ao mototáxi"
        href={`https://wa.me/${numero}?text=${encodeURIComponent(mensagemMototaxi(order, loja))}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-12 items-center justify-center gap-2 rounded-full border border-admin-border bg-zinc-900 px-4 text-sm font-bold text-white transition-colors hover:bg-zinc-800"
      >
        <IconeWhatsapp className="size-5 shrink-0 text-emerald-400" />
        Enviar ao mototáxi
      </a>
      <p className="text-center text-xs text-zinc-500">
        Abre o WhatsApp do {config?.nome || "mototáxi"} com a mensagem pronta
      </p>
    </div>
  );
}
