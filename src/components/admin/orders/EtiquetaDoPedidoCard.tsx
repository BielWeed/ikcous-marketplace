import { Skeleton } from "@/components/ui/skeleton";
import {
  type ElegibilidadeDaEtiqueta,
  type PedidoParaEtiqueta,
  elegibilidadeDaEtiqueta,
  freteEfetivoDoPedido,
} from "@/lib/elegibilidade-da-etiqueta";
import { mensagemAmigavelErroEdgeFunction } from "@/lib/mensagens-erro";
import { supabase } from "@/lib/supabase";
import { haptic } from "@/utils/haptic";
import {
  AlertCircle,
  Barcode,
  CheckCircle2,
  ExternalLink,
  PackageCheck,
  RefreshCw,
  Truck,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Card "Etiqueta de envio" da FICHA DO PEDIDO — migração de Admin > Frete
 * (onde morava o antigo `EtiquetasEnvioCard`, com busca global de pedido)
 * para dentro de `OrderDetail.tsx`: aqui o pedido já está escolhido (é o da
 * ficha aberta), então não existe busca nem `<select>` — só o pedido
 * corrente.
 *
 * A régua de "pode gerar etiqueta pelo app?" mora em
 * `src/lib/elegibilidade-da-etiqueta.ts` (função pura, testada à parte).
 * Este componente só busca o pedido, decide a fase da UI e fala com a edge
 * `melhor-envio-etiqueta` (admin-only) — que é quem grava
 * `shipping_label_id`/`shipping_label_url`/`tracking_code` no pedido de
 * verdade; este card NUNCA escreve direto na tabela.
 *
 * CONFIRMAÇÃO EXPLÍCITA OBRIGATÓRIA: a etiqueta usa o SALDO da conta do
 * lojista no Melhor Envio. O primeiro clique em "Gerar etiqueta" só ABRE a
 * confirmação; a geração só sai no clique em "Confirmar e gerar".
 */

type CargaFase = "carregando" | "erro" | "vazio" | "ok";
type CompraFase = "ocioso" | "confirmar" | "gerando";

interface MensagemResultado {
  tipo: "sucesso" | "already" | "erro";
  texto: string;
}

interface EtiquetaDoPedidoCardProps {
  orderId: string;
  isOffline: boolean;
  onTrackingAtualizado?: (codigo: string) => void;
}

/**
 * Contrato do supabase-js v2 (mesmo padrão do card que este substitui): erro
 * fora de 2xx chega com `data: null` e o corpo de verdade em
 * `error.context` (um Response). `resgate: true` = a etiqueta já
 * existe/está paga ou o estado é indeterminado — a tela NUNCA reapresenta o
 * botão de compra nesses casos, só refaz a leitura do pedido.
 */
async function mensagemDeErroInvocacao(
  err: unknown,
  opcoes: { mensagemGenerica: string },
): Promise<{ mensagem: string; resgate: boolean }> {
  try {
    const corpo = await (
      err as { context?: { json?: () => unknown } }
    )?.context?.json?.();
    if (
      corpo &&
      typeof corpo === "object" &&
      "error" in corpo &&
      (corpo as { error: unknown }).error
    ) {
      return {
        mensagem: String((corpo as { error: unknown }).error),
        resgate: (corpo as { resgate?: unknown }).resgate === true,
      };
    }
  } catch {
    // Corpo ilegível: segue para a mensagem genérica.
  }
  return {
    mensagem: mensagemAmigavelErroEdgeFunction(err as Error, opcoes),
    resgate: false,
  };
}

export const EtiquetaDoPedidoCard = memo(function EtiquetaDoPedidoCard({
  orderId,
  isOffline,
  onTrackingAtualizado,
}: Readonly<EtiquetaDoPedidoCardProps>) {
  const [cargaFase, setCargaFase] = useState<CargaFase>("carregando");
  const [pedido, setPedido] = useState<PedidoParaEtiqueta | null>(null);
  const [compraFase, setCompraFase] = useState<CompraFase>("ocioso");
  const [mensagemResultado, setMensagemResultado] =
    useState<MensagemResultado | null>(null);
  const [consultandoRastreio, setConsultandoRastreio] = useState(false);

  // Guarda de geração (mesmo padrão do card antigo, src/hooks/useOnlineStatus.ts):
  // descarta a resposta de uma consulta em voo se o `orderId` mudou antes
  // dela resolver — sem isso, uma resposta lenta do pedido ANTERIOR podia
  // sobrescrever o pedido NOVO já na tela.
  const geracaoRef = useRef(0);
  // Trava de clique duplo: dois cliques rápidos em "Confirmar e gerar" (antes
  // do primeiro `setState` propagar) não podem virar duas invocações.
  const cliqueEmVooRef = useRef(false);

  const fetchPedido = useCallback(async () => {
    const minhaGeracao = ++geracaoRef.current;
    setCargaFase("carregando");
    try {
      const { data, error } = await supabase
        .from("marketplace_orders")
        .select(
          "id, status, payment_status, shipping, shipping_cost, tracking_code, shipping_label_id, shipping_label_url, notes, customer_data->>shipping_option_id",
        )
        .eq("id", orderId)
        .maybeSingle();
      if (geracaoRef.current !== minhaGeracao) return;
      if (error) {
        console.error("[EtiquetaDoPedido] Erro ao carregar o pedido:", error);
        setCargaFase("erro");
        return;
      }
      if (!data) {
        setCargaFase("vazio");
        return;
      }
      setPedido(data as unknown as PedidoParaEtiqueta);
      setCargaFase("ok");
    } catch (err) {
      if (geracaoRef.current !== minhaGeracao) return;
      console.error("[EtiquetaDoPedido] Exceção ao carregar o pedido:", err);
      setCargaFase("erro");
    }
  }, [orderId]);

  // Troca de pedido: zera a fase de compra e a mensagem persistente ANTES de
  // buscar — o pedido antigo não pode continuar na tela com o rótulo do
  // pedido novo por um instante.
  useEffect(() => {
    setCompraFase("ocioso");
    setMensagemResultado(null);
    setPedido(null);
    fetchPedido();
  }, [fetchPedido]);

  const elegibilidade: ElegibilidadeDaEtiqueta | null = pedido
    ? elegibilidadeDaEtiqueta(pedido)
    : null;

  const handleGerarEtiqueta = useCallback(async () => {
    if (isOffline || !pedido || cliqueEmVooRef.current) return;
    cliqueEmVooRef.current = true;
    setCompraFase("gerando");
    setMensagemResultado(null);
    haptic.medium();
    try {
      const { data, error } = await supabase.functions.invoke(
        "melhor-envio-etiqueta",
        { body: { action: "gerar_etiqueta", orderId } },
      );
      if (error) throw error;

      setPedido((prev) =>
        prev
          ? {
              ...prev,
              shipping_label_id: String(
                data?.label_id || prev.shipping_label_id || "",
              ),
              shipping_label_url: data?.label_url ?? prev.shipping_label_url,
              tracking_code: data?.tracking_code ?? prev.tracking_code,
            }
          : prev,
      );
      setMensagemResultado({
        tipo: data?.already ? "already" : "sucesso",
        texto: data?.already
          ? "Este pedido já tinha etiqueta — nada foi comprado de novo."
          : "Etiqueta gerada e vinculada ao pedido!",
      });
      setCompraFase("ocioso");
      haptic.success();
      toast.success(
        data?.already
          ? "Este pedido já tinha etiqueta gerada — nada foi comprado de novo."
          : "Etiqueta gerada com sucesso!",
      );
      if (data?.tracking_code) {
        onTrackingAtualizado?.(String(data.tracking_code));
      }
    } catch (err) {
      console.error("[EtiquetaDoPedido] Erro na geração:", err);
      const { mensagem: detalhe, resgate } = await mensagemDeErroInvocacao(
        err,
        {
          mensagemGenerica:
            "Erro de comunicação com a Edge Function. Tente novamente em instantes.",
        },
      );
      setMensagemResultado({ tipo: "erro", texto: detalhe });
      if (resgate) {
        // A etiqueta já existe/está paga (ou o estado é indeterminado): a
        // releitura do pedido traz o `shipping_label_id` de verdade e a UI
        // cai em "emitida" sozinha — nunca reapresenta o botão de compra.
        await fetchPedido();
        setCompraFase("ocioso");
      } else {
        setCompraFase("confirmar");
      }
      haptic.error();
      toast.error(detalhe);
    } finally {
      cliqueEmVooRef.current = false;
    }
  }, [isOffline, pedido, orderId, onTrackingAtualizado, fetchPedido]);

  const handleConsultarRastreio = useCallback(async () => {
    if (isOffline) return;
    setConsultandoRastreio(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "melhor-envio-etiqueta",
        { body: { action: "consultar_rastreio", orderId } },
      );
      if (error) throw error;
      if (data?.tracking_code) {
        const codigo = String(data.tracking_code);
        setPedido((prev) => (prev ? { ...prev, tracking_code: codigo } : prev));
        onTrackingAtualizado?.(codigo);
        toast.success("Rastreio atualizado!");
      } else {
        toast.info(
          "A transportadora ainda não publicou o código. Tente novamente mais tarde.",
        );
      }
    } catch (err) {
      console.error("[EtiquetaDoPedido] Erro ao consultar rastreio:", err);
      const { mensagem } = await mensagemDeErroInvocacao(err, {
        mensagemGenerica:
          "Erro de comunicação com a Edge Function. Tente novamente em instantes.",
      });
      toast.error(mensagem);
    } finally {
      setConsultandoRastreio(false);
    }
  }, [isOffline, orderId, onTrackingAtualizado]);

  const abrirConfirmacao = useCallback(() => {
    setMensagemResultado(null);
    setCompraFase("confirmar");
  }, []);

  const cancelarConfirmacao = useCallback(() => {
    setCompraFase("ocioso");
  }, []);

  return (
    <div
      id="etiqueta-do-pedido"
      className="admin-glass space-y-4 rounded-[2rem] border border-white/5 p-5"
    >
      <div className="flex items-center justify-between border-b border-white/5 pb-3">
        <h3 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
          <Truck className="size-3.5 text-zinc-500" />
          Etiqueta de envio
        </h3>
      </div>

      {cargaFase === "carregando" && (
        <Skeleton className="h-16 w-full rounded-xl bg-white/5" />
      )}

      {cargaFase === "erro" && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-center text-xs font-semibold text-red-300">
          Não foi possível carregar os dados da etiqueta.{" "}
          <button
            type="button"
            onClick={fetchPedido}
            className="font-black underline hover:no-underline"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {cargaFase === "vazio" && (
        <p className="text-xs text-zinc-400">Pedido não encontrado.</p>
      )}

      {cargaFase === "ok" && pedido && elegibilidade && (
        <div className="space-y-2.5">
          {mensagemResultado?.tipo === "erro" && (
            <p
              data-testid="erro-etiqueta"
              className="rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-[10.5px] font-semibold leading-snug text-red-300 duration-200 animate-in fade-in"
            >
              {mensagemResultado.texto}
            </p>
          )}

          {elegibilidade.estado === "emitida" && (
            <div className="space-y-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 duration-200 animate-in fade-in">
              <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-300">
                <CheckCircle2 className="size-3.5 shrink-0" />
                <span>
                  {mensagemResultado?.tipo === "sucesso"
                    ? "Etiqueta gerada e vinculada ao pedido!"
                    : mensagemResultado?.tipo === "already"
                      ? "Este pedido já tinha etiqueta — nada foi comprado de novo."
                      : "Etiqueta emitida"}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/60 px-2.5 py-2">
                <div className="min-w-0">
                  <span className="block text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                    Código de rastreio
                  </span>
                  <span
                    className="block truncate font-mono text-xs font-bold text-white"
                    data-testid="codigo-rastreio"
                  >
                    {pedido.tracking_code ||
                      "Ainda sem código — atualize depois da postagem"}
                  </span>
                </div>
                <Barcode className="size-4 shrink-0 text-zinc-500" />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {pedido.shipping_label_url && (
                  <a
                    href={pedido.shipping_label_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-lg border border-admin-gold/30 bg-admin-gold/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-admin-gold transition-colors hover:bg-admin-gold/20 active:scale-95"
                  >
                    <ExternalLink className="size-3" />
                    <span>Abrir etiqueta</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={handleConsultarRastreio}
                  disabled={consultandoRastreio || isOffline}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-colors hover:text-white active:scale-95 disabled:opacity-40"
                >
                  <RefreshCw
                    className={`size-3 ${consultandoRastreio ? "animate-spin" : ""}`}
                  />
                  <span>Atualizar rastreio</span>
                </button>
              </div>

              <p className="text-[9.5px] leading-snug text-zinc-500">
                Reimpressão ou cancelamento: pela sua conta no Melhor Envio.
              </p>
            </div>
          )}

          {elegibilidade.estado === "indisponivel" && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
              <p className="flex items-start gap-1.5 text-[10.5px] font-bold leading-snug text-amber-200">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                <span>
                  Etiqueta pelo app indisponível — {elegibilidade.motivo}
                </span>
              </p>
            </div>
          )}

          {elegibilidade.estado === "disponivel" && compraFase === "ocioso" && (
            <button
              type="button"
              onClick={abrirConfirmacao}
              disabled={isOffline}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-admin-gold/30 bg-admin-gold px-4 py-2.5 text-xs font-bold text-black shadow-lg shadow-amber-500/20 transition-all hover:opacity-90 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            >
              <PackageCheck className="size-3.5" />
              <span>Gerar etiqueta</span>
            </button>
          )}

          {elegibilidade.estado === "disponivel" && compraFase !== "ocioso" && (
            <div className="space-y-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 duration-200 animate-in fade-in">
              <p className="flex items-start gap-1.5 text-[10.5px] font-bold leading-snug text-amber-200">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                <span>
                  A etiqueta é comprada com o saldo da SUA conta no Melhor
                  Envio.
                  <span className="mt-1 block font-semibold text-amber-100/90">
                    Serviço: {elegibilidade.servico}
                  </span>
                  <span className="mt-1 block font-semibold text-amber-100/90">
                    Frete pago pelo cliente: R${" "}
                    {freteEfetivoDoPedido(pedido).toFixed(2).replace(".", ",")}
                  </span>
                </span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleGerarEtiqueta}
                  disabled={compraFase === "gerando" || isOffline}
                  className="flex items-center gap-1.5 rounded-lg border border-admin-gold/30 bg-admin-gold px-3.5 py-2 text-[10px] font-black uppercase tracking-widest text-black transition-all hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                >
                  {compraFase === "gerando" ? (
                    <RefreshCw className="size-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-3" />
                  )}
                  <span>
                    {compraFase === "gerando"
                      ? "Gerando…"
                      : "Confirmar e gerar"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={cancelarConfirmacao}
                  disabled={compraFase === "gerando"}
                  className="rounded-lg px-2.5 py-2 text-[10px] font-bold text-zinc-400 transition-colors hover:text-white disabled:opacity-40"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
