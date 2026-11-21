import {
  mensagemMototaxi,
  normalizarNumeroMototaxi,
} from "@/components/admin/minha-loja/contato";
import { IconeWhatsapp } from "@/components/icons/IconeWhatsapp";
import { lerContatoMototaxi, useMototaxi } from "@/hooks/useMototaxi";
import { ID_ENTREGA_LOCAL } from "@/lib/guarda-de-frete";
import { linkWhatsappDoCliente } from "@/lib/whatsapp-do-cliente";
import type { Order } from "@/types";
import { useEffect, useRef, useState } from "react";

export function EnviarAoMototaxi({
  order,
  loja,
}: { order: Order; loja: string }) {
  const { config, erro, recarregar } = useMototaxi();
  const abaPendente = useRef<Window | null>(null);
  const [consultando, setConsultando] = useState(false);
  const [falhaDoEnvio, setFalhaDoEnvio] = useState<string | null>(null);

  // Entregue também encerra o despacho: devoluções só existem depois da entrega.
  // A lista positiva recusa inclusive status desconhecido vindo de cache antigo.
  const podeEnviar = !(
    order.shippingOptionId !== ID_ENTREGA_LOCAL ||
    !["pending", "processing", "shipping"].includes(order.status) ||
    order.paymentStatus === "estornado" ||
    (order.paymentMethod === "online" &&
      order.paymentStatus !== "pago" &&
      order.paymentStatus !== "pago_apos_expirar")
  );
  useEffect(() => {
    if (order.id && podeEnviar) {
      setConsultando(false);
      setFalhaDoEnvio(null);
    }
    return () => {
      abaPendente.current?.close();
      abaPendente.current = null;
    };
  }, [order.id, podeEnviar]);

  const enviar = async () => {
    if (abaPendente.current) return;
    setFalhaDoEnvio(null);
    // Reserva a aba no clique para o bloqueador de pop-ups não barrá-la
    // depois da consulta. Até confirmar o número a aba não recebe dados.
    const aba = globalThis.open("about:blank", "_blank");
    if (!aba) {
      setFalhaDoEnvio("Permita abrir uma nova aba para enviar ao mototáxi.");
      return;
    }
    aba.opener = null;
    abaPendente.current = aba;
    setConsultando(true);
    try {
      const contato = await lerContatoMototaxi();
      if (abaPendente.current !== aba || aba.closed) return;
      const numeroAtual = normalizarNumeroMototaxi(contato?.whatsapp);
      if (!numeroAtual) {
        aba.close();
        setFalhaDoEnvio("O mototáxi está sem um número cadastrado.");
        return;
      }
      const mensagem = encodeURIComponent(mensagemMototaxi(order, loja));
      const link = aba.document.createElement("a");
      link.href = `${linkWhatsappDoCliente(numeroAtual)}?text=${mensagem}`;
      link.rel = "noreferrer";
      aba.document.body.append(link);
      link.click();
    } catch {
      if (abaPendente.current !== aba) return;
      aba.close();
      setFalhaDoEnvio(
        "Não consegui consultar o número do mototáxi. Tente de novo.",
      );
    } finally {
      if (abaPendente.current === aba) {
        abaPendente.current = null;
        setConsultando(false);
      }
    }
  };

  if (!podeEnviar) return null;
  if (erro)
    return (
      <div className="border-t border-admin-border pt-4">
        <div role="alert" className="text-xs text-amber-300">
          Não consegui ler o número do mototáxi agora.{" "}
          <button
            type="button"
            onClick={recarregar}
            className="min-h-11 min-w-11 underline"
          >
            Tentar de novo
          </button>
        </div>
      </div>
    );
  // Se não havia número ao abrir, reabra a ficha para reler o contato.
  if (!config) return null;
  if (!normalizarNumeroMototaxi(config.whatsapp))
    return (
      <div className="border-t border-admin-border pt-4">
        <p className="text-center text-xs text-zinc-500">
          Cadastre o WhatsApp do mototáxi em Entrega e frete para enviar este
          pedido.
        </p>
      </div>
    );
  return (
    <div className="space-y-2 border-t border-admin-border pt-4">
      <button
        type="button"
        aria-label="Enviar ao mototáxi"
        onClick={() => void enviar()}
        disabled={consultando}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-admin-border bg-zinc-900 px-4 text-sm font-bold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
      >
        <IconeWhatsapp className="size-5 shrink-0 text-emerald-400" />
        {consultando ? "Conferindo o número…" : "Enviar ao mototáxi"}
      </button>
      <p className="text-center text-xs text-zinc-500">
        Abre o WhatsApp do mototáxi com a mensagem pronta
      </p>
      {falhaDoEnvio && (
        <p role="alert" className="text-xs text-amber-300">
          {falhaDoEnvio}
        </p>
      )}
    </div>
  );
}
