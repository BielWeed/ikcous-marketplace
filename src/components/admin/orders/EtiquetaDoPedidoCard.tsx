import { Skeleton } from "@/components/ui/skeleton";
import {
  cpfValido,
  formatarCpfEnquantoDigita,
  mascararCpf,
  somenteDigitos,
} from "@/lib/cpf-do-destinatario";
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
  /**
   * Leva o `orderId` da resposta JUNTO com o código — 2ª rodada da revisão
   * Opus sobre aadbf4c: com `key={order.id}` no card (OrderDetail.tsx), a
   * instância de A é DESMONTADA ao trocar para B, e uma resposta atrasada de
   * A ainda chama este callback (a função em si sobrevive na closure do
   * `fetch` em voo, mesmo com o componente que a criou já desmontado). Quem
   * CONSOME o callback (OrderDetail, que não desmonta ao trocar de pedido)
   * tem que validar o `orderId` recebido contra o pedido que está mostrando
   * AGORA — o card não pode garantir isso sozinho depois de desmontado.
   */
  onTrackingAtualizado?: (orderId: string, codigo: string) => void;
}

// ── Travas de reentrada em escopo de MÓDULO (não de instância/useRef) ──────
// Precisam sobreviver ao desmonte/remonte do card via `key={order.id}`
// (OrderDetail.tsx): sem isso, o caso A→B→A com a compra de A ainda em voo
// ganha uma instância NOVA (Set vazio) ao voltar para A, e um segundo
// "Confirmar e gerar" para A passaria despercebido — comprando a etiqueta
// DUAS vezes. Isolado por `orderId` (não um `boolean` único): o voo de A
// nunca trava o primeiro clique genuíno em B, nem a conclusão de A libera um
// voo de B que ainda está rodando. Cada `add` no clique é desfeito no
// `finally` da PRÓPRIA invocação — nunca fica preso em erro/exceção.
const geracaoDaEtiquetaEmVoo = new Set<string>();
const cpfEmVoo = new Set<string>();
const rastreioEmVoo = new Set<string>();

/**
 * SÓ PARA TESTE: o módulo é importado uma vez e as travas acima persistem
 * entre `it()` do mesmo arquivo (o dynamic import do componente é cacheado).
 * Chamar no `afterEach`/`beforeEach` da suíte — nunca em código de produção.
 */
export function _resetTravasDeReentranciaParaTeste(): void {
  geracaoDaEtiquetaEmVoo.clear();
  cpfEmVoo.clear();
  rastreioEmVoo.clear();
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
): Promise<{ mensagem: string; resgate: boolean; precisaCpf: boolean }> {
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
        // A edge respondeu 400 com `precisa_cpf: true` (tela desatualizada —
        // o pedido perdeu o CPF entre a leitura e o clique, ou é uma aba
        // velha): recarregar o pedido cai sozinho no estado `precisa_cpf`.
        precisaCpf: (corpo as { precisa_cpf?: unknown }).precisa_cpf === true,
      };
    }
  } catch {
    // Corpo ilegível: segue para a mensagem genérica.
  }
  return {
    mensagem: mensagemAmigavelErroEdgeFunction(err as Error, opcoes),
    resgate: false,
    precisaCpf: false,
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
  // Campo de CPF do destinatário (estado "precisa_cpf") — texto DIGITADO
  // (com máscara), erro persistente da validação/salvamento, e trava de
  // clique duplo separada da de "Confirmar e gerar".
  const [cpfInput, setCpfInput] = useState("");
  const [cpfErro, setCpfErro] = useState<string | null>(null);
  const [cpfSalvando, setCpfSalvando] = useState(false);

  // Guarda de geração (mesmo padrão do card antigo, src/hooks/useOnlineStatus.ts):
  // descarta a resposta de uma consulta em voo se o `orderId` mudou antes
  // dela resolver — sem isso, uma resposta lenta do pedido ANTERIOR podia
  // sobrescrever o pedido NOVO já na tela. Isto protege só o `fetchPedido`.
  const geracaoRef = useRef(0);

  // Espelho SEMPRE atual do `orderId` — mas escrito num `useEffect` COM
  // CLEANUP, não no corpo do render. 2ª rodada da revisão Opus sobre
  // aadbf4c: com `key={order.id}` (OrderDetail.tsx), trocar de A para B
  // DESMONTA a instância de A — ela nunca mais renderiza, então uma escrita
  // no corpo do render (`orderIdAtualRef.current = orderId`) NUNCA rodaria
  // de novo para marcá-la como obsoleta, e `orderIdAtualRef.current` desta
  // instância ficaria PARADO em "A" para sempre. A resposta atrasada de A
  // bateria `orderIdAtualRef.current !== orderIdDoClique` como FALSO (A ===
  // A) e passaria pela guarda — exatamente o vazamento que o comentário
  // anterior (errado) dizia que não acontecia. O cleanup do efeito É o único
  // gancho que roda no desmonte: zera para `null`, e `null !== "A"` volta a
  // ser verdadeiro. Compatível com StrictMode (que desmonta/remonta uma vez
  // a mais em dev): o efeito reescreve o valor certo ao remontar.
  const orderIdAtualRef = useRef<string | null>(orderId);
  useEffect(() => {
    orderIdAtualRef.current = orderId;
    return () => {
      orderIdAtualRef.current = null;
    };
  }, [orderId]);

  const fetchPedido = useCallback(async () => {
    const minhaGeracao = ++geracaoRef.current;
    setCargaFase("carregando");
    try {
      const { data, error } = await supabase
        .from("marketplace_orders")
        .select(
          "id, status, payment_status, shipping, shipping_cost, tracking_code, shipping_label_id, shipping_label_url, notes, customer_data->>shipping_option_id, customer_data->>cpf",
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
    setCpfInput("");
    setCpfErro(null);
    setCpfSalvando(false);
    setConsultandoRastreio(false);
    fetchPedido();
  }, [fetchPedido]);

  const elegibilidade: ElegibilidadeDaEtiqueta | null = pedido
    ? elegibilidadeDaEtiqueta(pedido)
    : null;

  const handleGerarEtiqueta = useCallback(async () => {
    const orderIdDoClique = orderId;
    if (isOffline || !pedido) return;
    // Compra deste pedido ainda em voo (ex.: lojista saiu e voltou para a
    // ficha no meio da geração): não invoca de novo e AVISA — o clique mudo
    // deixava o lojista sem saber se algo aconteceu (ressalva da revisão).
    if (geracaoDaEtiquetaEmVoo.has(orderIdDoClique)) {
      toast.info(
        "A compra da etiqueta deste pedido ainda está em andamento — aguarde alguns segundos e reabra o pedido.",
      );
      return;
    }
    geracaoDaEtiquetaEmVoo.add(orderIdDoClique);
    setCompraFase("gerando");
    setMensagemResultado(null);
    haptic.medium();
    try {
      const { data, error } = await supabase.functions.invoke(
        "melhor-envio-etiqueta",
        { body: { action: "gerar_etiqueta", orderId: orderIdDoClique } },
      );
      // A ficha pode ter trocado de pedido enquanto a compra estava em voo
      // (5-20 s) — a resposta de A não pode aparecer sobre B, nem sucesso
      // nem erro: nenhum `setState`, nenhum toast, nenhum callback daqui
      // pra baixo.
      if (orderIdAtualRef.current !== orderIdDoClique) return;
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
        onTrackingAtualizado?.(orderIdDoClique, String(data.tracking_code));
      }
    } catch (err) {
      if (orderIdAtualRef.current !== orderIdDoClique) return;
      console.error("[EtiquetaDoPedido] Erro na geração:", err);
      const {
        mensagem: detalhe,
        resgate,
        precisaCpf,
      } = await mensagemDeErroInvocacao(err, {
        mensagemGenerica:
          "Erro de comunicação com a Edge Function. Tente novamente em instantes.",
      });
      // `mensagemDeErroInvocacao` também tem `await` (lê o corpo da
      // resposta) — checa de novo antes de qualquer efeito visível.
      if (orderIdAtualRef.current !== orderIdDoClique) return;
      setMensagemResultado({ tipo: "erro", texto: detalhe });
      if (resgate || precisaCpf) {
        // A etiqueta já existe/está paga (ou o estado é indeterminado): a
        // releitura do pedido traz o `shipping_label_id` de verdade e a UI
        // cai em "emitida" sozinha — nunca reapresenta o botão de compra.
        // `precisaCpf`: a edge recusou por falta/invalidez de CPF (tela
        // desatualizada) — a releitura cai sozinha no estado `precisa_cpf`.
        // `fetchPedido` aqui é o da MESMA renderização deste handler — ligado
        // ao `orderIdDoClique` (a checagem acima já provou que ele ainda é o
        // pedido atual); chamar sem essa checagem buscaria o pedido ERRADO
        // se a ficha já tivesse trocado.
        await fetchPedido();
        if (orderIdAtualRef.current !== orderIdDoClique) return;
        setCompraFase("ocioso");
      } else {
        setCompraFase("confirmar");
      }
      haptic.error();
      toast.error(detalhe);
    } finally {
      geracaoDaEtiquetaEmVoo.delete(orderIdDoClique);
    }
  }, [isOffline, pedido, orderId, onTrackingAtualizado, fetchPedido]);

  const handleSalvarCpf = useCallback(async () => {
    const orderIdDoClique = orderId;
    if (isOffline || !pedido || cpfEmVoo.has(orderIdDoClique)) {
      return;
    }
    const digitos = somenteDigitos(cpfInput);
    if (!cpfValido(digitos)) {
      setCpfErro("CPF inválido — confira os números e tente de novo.");
      return;
    }
    cpfEmVoo.add(orderIdDoClique);
    setCpfSalvando(true);
    setCpfErro(null);
    haptic.medium();
    try {
      const { error } = await supabase.functions.invoke(
        "melhor-envio-etiqueta",
        {
          body: {
            action: "definir_cpf_destinatario",
            orderId: orderIdDoClique,
            cpf: digitos,
          },
        },
      );
      // Ficha trocou de pedido enquanto salvava — a resposta de A não pode
      // mexer no CPF/estado que a tela está mostrando de B.
      if (orderIdAtualRef.current !== orderIdDoClique) return;
      if (error) throw error;
      setCpfInput("");
      haptic.success();
      toast.success("CPF salvo!");
      // Relê o pedido: com o CPF gravado, a elegibilidade sai sozinha de
      // "precisa_cpf" e vira "disponivel" (ou o que já era antes, se algo
      // mudou no meio tempo) — sem gambiarra de estado local otimista.
      // O `fetchPedido` chamado aqui é o da MESMA renderização (ligado ao
      // `orderIdDoClique`) — a checagem acima já provou que ainda é o
      // pedido atual.
      await fetchPedido();
    } catch (err) {
      if (orderIdAtualRef.current !== orderIdDoClique) return;
      console.error("[EtiquetaDoPedido] Erro ao salvar CPF:", err);
      const { mensagem } = await mensagemDeErroInvocacao(err, {
        mensagemGenerica:
          "Erro de comunicação com a Edge Function. Tente novamente em instantes.",
      });
      if (orderIdAtualRef.current !== orderIdDoClique) return;
      setCpfErro(mensagem);
      haptic.error();
      toast.error(mensagem);
    } finally {
      cpfEmVoo.delete(orderIdDoClique);
      // `cpfSalvando` é um `boolean` ÚNICO (não isolado por pedido, como o
      // `Set` acima) — só zera se ainda for o pedido que estava salvando;
      // senão apagaria o `true` de um salvamento genuíno de OUTRO pedido
      // que começou depois da troca.
      if (orderIdAtualRef.current === orderIdDoClique) setCpfSalvando(false);
    }
  }, [isOffline, pedido, cpfInput, orderId, fetchPedido]);

  const handleConsultarRastreio = useCallback(async () => {
    const orderIdDoClique = orderId;
    if (isOffline || rastreioEmVoo.has(orderIdDoClique)) return;
    rastreioEmVoo.add(orderIdDoClique);
    setConsultandoRastreio(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "melhor-envio-etiqueta",
        { body: { action: "consultar_rastreio", orderId: orderIdDoClique } },
      );
      // Ficha trocou de pedido durante a consulta — o rastreio de A não
      // pode pintar B. `onTrackingAtualizado` agora leva o `orderIdDoClique`
      // junto: mesmo que esta checagem falhe por algum caminho não previsto,
      // o consumidor (OrderDetail) valida de novo, sozinho, contra o pedido
      // que está mostrando — defesa nas DUAS pontas.
      if (orderIdAtualRef.current !== orderIdDoClique) return;
      if (error) throw error;
      if (data?.tracking_code) {
        const codigo = String(data.tracking_code);
        setPedido((prev) => (prev ? { ...prev, tracking_code: codigo } : prev));
        onTrackingAtualizado?.(orderIdDoClique, codigo);
        toast.success("Rastreio atualizado!");
      } else {
        toast.info(
          "A transportadora ainda não publicou o código. Tente novamente mais tarde.",
        );
      }
    } catch (err) {
      if (orderIdAtualRef.current !== orderIdDoClique) return;
      console.error("[EtiquetaDoPedido] Erro ao consultar rastreio:", err);
      const { mensagem } = await mensagemDeErroInvocacao(err, {
        mensagemGenerica:
          "Erro de comunicação com a Edge Function. Tente novamente em instantes.",
      });
      if (orderIdAtualRef.current !== orderIdDoClique) return;
      toast.error(mensagem);
    } finally {
      rastreioEmVoo.delete(orderIdDoClique);
      if (orderIdAtualRef.current === orderIdDoClique) {
        setConsultandoRastreio(false);
      }
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

          {elegibilidade.estado === "precisa_cpf" && (
            <div
              data-testid="precisa-cpf"
              className="space-y-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 duration-200 animate-in fade-in"
            >
              <p className="flex items-start gap-1.5 text-[10.5px] font-bold leading-snug text-amber-200">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                <span>
                  O Melhor Envio exige o CPF do destinatário para emitir a
                  etiqueta.
                  {elegibilidade.cpfInvalido && (
                    <span className="mt-1 block font-semibold text-amber-100/90">
                      O CPF salvo neste pedido é inválido — corrija abaixo.
                    </span>
                  )}
                </span>
              </p>
              <div className="space-y-1.5">
                <label
                  htmlFor="cpf-destinatario"
                  className="block text-[9px] font-bold uppercase tracking-widest text-zinc-500"
                >
                  CPF do destinatário
                </label>
                <input
                  id="cpf-destinatario"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="000.000.000-00"
                  value={cpfInput}
                  disabled={cpfSalvando || isOffline}
                  onChange={(e) => {
                    setCpfInput(formatarCpfEnquantoDigita(e.target.value));
                    setCpfErro(null);
                  }}
                  className="w-full rounded-lg border border-white/10 bg-black/60 px-2.5 py-2 font-mono text-xs font-bold text-white outline-none focus:border-admin-gold/50 disabled:opacity-40"
                />
                {cpfErro && (
                  <p
                    data-testid="erro-cpf"
                    className="text-[10.5px] font-semibold leading-snug text-red-300"
                  >
                    {cpfErro}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleSalvarCpf}
                  disabled={cpfSalvando || isOffline}
                  className="flex items-center gap-1.5 rounded-lg border border-admin-gold/30 bg-admin-gold px-3.5 py-2 text-[10px] font-black uppercase tracking-widest text-black transition-all hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                >
                  {cpfSalvando ? (
                    <RefreshCw className="size-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-3" />
                  )}
                  <span>{cpfSalvando ? "Salvando…" : "Salvar CPF"}</span>
                </button>
              </div>
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
                  <span
                    data-testid="cpf-mascarado"
                    className="mt-1 block font-semibold text-amber-100/90"
                  >
                    CPF do destinatário: {mascararCpf(pedido.cpf)}
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
