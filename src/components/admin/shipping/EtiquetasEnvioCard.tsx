import { Skeleton } from "@/components/ui/skeleton";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
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
} from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Card "Etiquetas de envio (Melhor Envio)" da tela de Frete — Onda 3
 * (rastreio automático; frente glm-onda3-rastreio-0309, 03/09/2026).
 *
 * O QUE FAZ: gera a etiqueta de envio de um pedido direto pela API do Melhor
 * Envio (1 clique com confirmação explícita) e mostra o código de rastreio +
 * o link de impressão. Até aqui o lojista comprava a etiqueta no site do ME
 * e digitava o código à mão na ficha do pedido.
 *
 * CONFIRMAÇÃO EXPLÍCITA OBRIGATÓRIA: a etiqueta usa o SALDO da conta do
 * lojista no Melhor Envio (checkout da API). Por isso o primeiro clique só
 * ABRE a confirmação; a geração só sai no segundo clique, com o pedido
 * nomeado. Nada gera etiqueta sem esse passo.
 *
 * IDEMPOTÊNCIA DE DINHEIRO (a function reforça, a tela repete): só pedido com
 * pagamento confirmado entra na lista, e pedido que já tem etiqueta devolve a
 * etiqueta existente (`already: true`) — re-clique ou aba lenta não compra
 * etiqueta duas vezes.
 *
 * Quem fala com a API é a edge function `melhor-envio-etiqueta` (admin-only);
 * este card NUNCA escreve no pedido direto — quem grava tracking_code e
 * etiqueta é a function, que também registra o evento no histórico de envio.
 */

type EtiquetaFase = "ocioso" | "confirmar" | "gerando" | "pronto";

interface EtiquetaResultado {
  tracking_code: string | null;
  label_url: string | null;
  label_id: string;
  already: boolean;
}

/**
 * Contrato do supabase-js v2 (mesmo padrão de src/hooks/useOrders.ts): quando
 * a edge function responde FORA de 2xx, `data` chega NULL e o corpo da
 * resposta fica em `error.context` (um Response). Ler o corpo e mostrar a
 * mensagem de negócio que a function escreveu (sem token, saldo, endereço,
 * pagamento não confirmado, geração em andamento...) — só sem corpo legível
 * cai na frase genérica de comunicação.
 */
async function mensagemDeErroInvocacao(
  err: unknown,
  opcoes: { mensagemGenerica: string },
): Promise<string> {
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
      return String((corpo as { error: unknown }).error);
    }
  } catch {
    // Corpo ilegível: segue para a mensagem genérica.
  }
  return mensagemAmigavelErroEdgeFunction(err as Error, opcoes);
}

export const EtiquetasEnvioCard = memo(function EtiquetasEnvioCard() {
  const isOffline = useOnlineStatus();

  const [pedidos, setPedidos] = useState<any[]>([]);
  const [loadingPedidos, setLoadingPedidos] = useState(false);
  const [pedidosError, setPedidosError] = useState(false);
  const [pedidoSelecionado, setPedidoSelecionado] = useState("");
  const [fase, setFase] = useState<EtiquetaFase>("ocioso");
  const [resultado, setResultado] = useState<EtiquetaResultado | null>(null);
  const [erroMsg, setErroMsg] = useState<string | null>(null);
  const [consultandoRastreio, setConsultandoRastreio] = useState(false);

  const pedido = pedidos.find((p) => p.id === pedidoSelecionado) || null;

  const fetchPedidos = useCallback(async () => {
    setLoadingPedidos(true);
    // Limpa o erro da rodada anterior no início de CADA busca — mesmo padrão
    // do Histórico de cotações: um "Atualizar" que deu certo não deixa o
    // aviso vermelho velho na tela.
    setPedidosError(false);
    try {
      // Pedidos vivos para envio: cancelado e entregue não etiquetam, e só
      // pagamento CONFIRMADO etiqueta (`pago`, `pago_apos_expirar` e
      // `recebido_na_entrega` — os TRÊS valores de "dinheiro que entrou" do
      // CHECK, o MESMO critério de falha fechado que a function aplica; a
      // lista já nasce honesta e ninguém gasta saldo com pedido não pago).
      // `shipping` é o valor do frete que o cliente pagou — entra na
      // confirmação.
      const { data, error } = await supabase
        .from("marketplace_orders")
        .select(
          "id, customer_name, status, payment_status, shipping, tracking_code, created_at",
        )
        .in("status", ["new", "pending", "processing", "shipping"])
        .in("payment_status", [
          "pago",
          "pago_apos_expirar",
          "recebido_na_entrega",
        ])
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      setPedidos(data || []);
    } catch (err) {
      console.error("[EtiquetasEnvio] Erro ao carregar pedidos:", err);
      setPedidosError(true);
    } finally {
      setLoadingPedidos(false);
    }
  }, []);

  useEffect(() => {
    fetchPedidos();
  }, [fetchPedidos]);

  const handleGerarEtiqueta = useCallback(async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet");
      return;
    }
    if (!pedidoSelecionado) {
      toast.error("Selecione um pedido para gerar a etiqueta.");
      return;
    }

    setFase("gerando");
    setErroMsg(null);
    haptic.medium();
    try {
      const { data, error } = await supabase.functions.invoke(
        "melhor-envio-etiqueta",
        {
          body: { action: "gerar_etiqueta", orderId: pedidoSelecionado },
        },
      );
      // Contrato do supabase-js v2: resposta fora de 2xx vem em `error` com
      // `data` null — a mensagem de negócio da function está no corpo de
      // `error.context`. Ramo `data?.error` não existe para esta function.
      if (error || data?.error) {
        throw error ?? new Error(String(data?.error));
      }

      setResultado({
        tracking_code: data?.tracking_code ?? null,
        label_url: data?.label_url ?? null,
        label_id: String(data?.label_id || ""),
        already: !!data?.already,
      });
      setFase("pronto");
      haptic.success();
      toast.success(
        data?.already
          ? "Este pedido já tinha etiqueta gerada — nada foi comprado de novo."
          : "Etiqueta gerada com sucesso!",
      );
      fetchPedidos();
    } catch (err) {
      console.error("[EtiquetasEnvio] Erro na geração:", err);
      const detalhe = await mensagemDeErroInvocacao(err, {
        mensagemGenerica:
          "Erro de comunicação com a Edge Function. Tente novamente em instantes.",
      });
      setErroMsg(detalhe);
      // Em erro de RESGATE o botão de gasto não pode ficar ativo (revisor,
      // PR #423): recarrega a lista e, se a function respondeu 409 (corrida
      // perdida) ou 500 com etiqueta PAGA e VINCULADA, volta para a lista
      // (ocioso) em vez de reapresentar "Confirmar e gerar" — o re-clique
      // nesses casos só devolve `already` sem link. Para o detalhe de
      // negócio não se perder com a saída da confirmação, o toast carrega a
      // mensagem da function nesses casos.
      fetchPedidos();
      const statusHttp = (err as { context?: { status?: number } })?.context
        ?.status;
      const resgate =
        statusHttp === 409 ||
        (statusHttp === 500 && /vinculada|paga/i.test(detalhe));
      setFase(resgate ? "ocioso" : "confirmar");
      haptic.error();
      toast.error(resgate ? detalhe : "Erro ao gerar etiqueta");
    }
  }, [isOffline, pedidoSelecionado, fetchPedidos]);

  const handleConsultarRastreio = useCallback(async () => {
    if (isOffline || !pedidoSelecionado) return;
    setConsultandoRastreio(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "melhor-envio-etiqueta",
        {
          body: { action: "consultar_rastreio", orderId: pedidoSelecionado },
        },
      );
      // Mesmo contrato do gerar: erro de negócio vem em `error.context`.
      if (error || data?.error) {
        throw error ?? new Error(String(data?.error));
      }
      if (data?.tracking_code) {
        setResultado((prev) =>
          prev ? { ...prev, tracking_code: String(data.tracking_code) } : prev,
        );
        toast.success("Rastreio atualizado!");
      } else {
        toast.info(
          "A transportadora ainda não publicou o código. Tente novamente mais tarde.",
        );
      }
      fetchPedidos();
    } catch (err) {
      console.error("[EtiquetasEnvio] Erro ao consultar rastreio:", err);
      toast.error(
        await mensagemDeErroInvocacao(err, {
          mensagemGenerica:
            "Erro de comunicação com a Edge Function. Tente novamente em instantes.",
        }),
      );
    } finally {
      setConsultandoRastreio(false);
    }
  }, [isOffline, pedidoSelecionado, fetchPedidos]);

  const voltarParaLista = useCallback(() => {
    setFase("ocioso");
    setResultado(null);
    setErroMsg(null);
    setPedidoSelecionado("");
  }, []);

  // Espelho booleano para o render: `fase !== "confirmar" ? A : B` faria o
  // TypeScript acharem que dentro de B a fase só pode ser "confirmar" — e
  // recusar o `fase === "gerando"` do clique em andamento (que MUDA a fase
  // durante o await). A booleana derivada não estreita o tipo da fase.
  const confirmacaoAberta = fase === "confirmar" || fase === "gerando";

  // O lojista confirma o gasto vendo o que o cliente pagou de frete (revisor,
  // item 7): serviço Melhor Envio + valor do pedido selecionado, quando existe.
  const freteTexto =
    pedido?.shipping != null && Number(pedido.shipping) > 0
      ? `Melhor Envio — frete pago pelo cliente: R$ ${Number(pedido.shipping)
          .toFixed(2)
          .replace(".", ",")}`
      : null;

  return (
    <div
      id="etiquetas-envio-section"
      className="admin-glass border-y border-white/5 p-3.5 shadow-2xl sm:rounded-2xl sm:border-x sm:p-4"
    >
      <div className="space-y-3">
        <p className="flex items-start gap-2 text-left text-[9.5px] leading-snug text-zinc-400">
          <PackageCheck className="mt-0.5 size-3.5 shrink-0 text-admin-gold" />
          <span>
            Gere a etiqueta de envio de um pedido com um clique — o código de
            rastreio é salvo no pedido automaticamente. A etiqueta usa o saldo
            da sua conta no Melhor Envio; a chave fica em{" "}
            <span className="font-semibold text-zinc-300">
              Ajustes &gt; Transportadoras
            </span>
            .
          </span>
        </p>

        {fase === "pronto" && resultado ? (
          /* ── Resultado: a etiqueta existe ─────────────────────────────── */
          <div className="space-y-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 duration-200 animate-in fade-in">
            <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-300">
              <CheckCircle2 className="size-3.5 shrink-0" />
              <span>
                {resultado.already
                  ? "Este pedido já tinha etiqueta — nada foi comprado de novo."
                  : "Etiqueta gerada e vinculada ao pedido!"}
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
                  {resultado.tracking_code ||
                    "Ainda sem código — atualize depois da postagem"}
                </span>
              </div>
              <Barcode className="size-4 shrink-0 text-zinc-500" />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {resultado.label_url && (
                <a
                  href={resultado.label_url}
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
              <button
                type="button"
                onClick={voltarParaLista}
                className="ml-auto rounded-lg px-2 py-1.5 text-[10px] font-bold text-zinc-400 transition-colors hover:text-white"
              >
                Gerar para outro pedido
              </button>
            </div>
          </div>
        ) : (
          /* ── Lista de pedidos + confirmação ───────────────────────────── */
          <div className="space-y-2.5">
            {loadingPedidos ? (
              <div className="space-y-2">
                <Skeleton className="h-9 w-full rounded-lg bg-white/5" />
              </div>
            ) : pedidosError ? (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-center text-xs font-semibold text-red-300">
                Não foi possível carregar os pedidos.{" "}
                <button
                  type="button"
                  onClick={fetchPedidos}
                  className="font-black underline hover:no-underline"
                >
                  Tentar de novo
                </button>
              </div>
            ) : pedidos.length === 0 ? (
              <p className="py-2 text-center text-xs text-zinc-400">
                Nenhum pedido aberto para etiquetar — pedidos cancelados e
                entregues não aparecem aqui.
              </p>
            ) : (
              <div className="space-y-1.5">
                <label
                  htmlFor="pedido-etiqueta-select"
                  className="block text-[11px] font-semibold text-zinc-300"
                >
                  Pedido
                </label>
                <select
                  id="pedido-etiqueta-select"
                  value={pedidoSelecionado}
                  onChange={(e) => {
                    setPedidoSelecionado(e.target.value);
                    setFase("ocioso");
                    setErroMsg(null);
                  }}
                  className="h-9 w-full rounded-lg border border-white/10 bg-black/60 px-2.5 text-xs font-semibold text-white focus:border-admin-gold focus:outline-none"
                >
                  <option value="">Selecione o pedido…</option>
                  {pedidos.map((p) => (
                    <option key={p.id} value={p.id}>
                      #{String(p.id).slice(-6)} — {p.customer_name || "Cliente"}{" "}
                      ({p.tracking_code ? "com rastreio" : p.status || "aberto"}
                      )
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!confirmacaoAberta ? (
              <button
                type="button"
                onClick={() => {
                  if (!pedidoSelecionado) {
                    toast.error("Selecione um pedido para gerar a etiqueta.");
                    return;
                  }
                  setErroMsg(null);
                  setFase("confirmar");
                }}
                disabled={!pedidoSelecionado || isOffline || loadingPedidos}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-admin-gold/30 bg-admin-gold px-4 py-2.5 text-xs font-bold text-black shadow-lg shadow-amber-500/20 transition-all hover:opacity-90 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 sm:w-auto"
              >
                <PackageCheck className="size-3.5" />
                <span>Gerar etiqueta</span>
              </button>
            ) : (
              /* ── Confirmação explícita: o saldo é de verdade ─────────── */
              <div className="space-y-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 duration-200 animate-in fade-in">
                <p className="flex items-start gap-1.5 text-[10.5px] font-bold leading-snug text-amber-200">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                  <span>
                    A etiqueta é comprada com o saldo da SUA conta no Melhor
                    Envio. Confirmar a geração para{" "}
                    <span className="text-white">
                      {pedido?.customer_name || "o pedido selecionado"}
                    </span>
                    ?
                    {freteTexto && (
                      <span className="mt-1 block font-semibold text-amber-100/90">
                        Serviço: {freteTexto}
                      </span>
                    )}
                  </span>
                </p>
                {erroMsg && (
                  <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-[10.5px] font-semibold leading-snug text-red-300">
                    {erroMsg}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleGerarEtiqueta}
                    disabled={fase === "gerando" || isOffline}
                    className="flex items-center gap-1.5 rounded-lg border border-admin-gold/30 bg-admin-gold px-3.5 py-2 text-[10px] font-black uppercase tracking-widest text-black transition-all hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                  >
                    {fase === "gerando" ? (
                      <RefreshCw className="size-3 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-3" />
                    )}
                    <span>
                      {fase === "gerando" ? "Gerando…" : "Confirmar e gerar"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFase("ocioso")}
                    disabled={fase === "gerando"}
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
    </div>
  );
});
