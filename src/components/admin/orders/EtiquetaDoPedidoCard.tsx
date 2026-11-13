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
  compraIndeterminadaPeloHistorico,
  elegibilidadeDaEtiqueta,
  freteEfetivoDoPedido,
  motivoDoStatusSemEtiqueta,
} from "@/lib/elegibilidade-da-etiqueta";
import { mensagemAmigavelErroEdgeFunction } from "@/lib/mensagens-erro";
import {
  MENSAGEM_COMPRA_DA_ETIQUETA_SEM_RESPOSTA,
  PRAZO_DA_COMPRA_DA_ETIQUETA_MS,
  PRAZO_DA_CONSULTA_DO_RASTREIO_MS,
  aguardarComPrazo,
  ehConsultaSemResposta,
  erroDeConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { haptic } from "@/utils/haptic";
import {
  AlertCircle,
  Barcode,
  CheckCircle2,
  ExternalLink,
  PackageCheck,
  RefreshCw,
} from "lucide-react";
import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
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
  // `sem_resposta`: a rede não respondeu à compra dentro do prazo. NÃO é erro e
  // NÃO é sucesso: a etiqueta pode ter sido comprada (ver handleGerarEtiqueta).
  tipo: "sucesso" | "already" | "erro" | "sem_resposta";
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
  /**
   * O código de rastreio que a LINHA da ficha (OrderDetail) mostra agora.
   * `onTrackingAtualizado` só leva o código do cartão para a ficha; sem esta
   * via de volta, quem corrige o código na linha seguia vendo o antigo aqui.
   * Só uma MUDANÇA dele é aplicada (a leitura do pedido ao abrir continua
   * sendo a verdade do primeiro desenho).
   */
  trackingCodeDaFicha?: string;
  /**
   * Status e pagamento do pedido que a FICHA mostra agora. O cartão lê o
   * pedido uma vez por `orderId`; sem isto, cancelar ou concluir o pedido na
   * própria ficha deixava o cartão oferecendo "Gerar etiqueta". Só uma
   * MUDANÇA deles refaz a leitura (em silêncio, sem remontar: o CPF digitado,
   * a confirmação aberta e a compra em voo ficam como estão). Ausentes (quem
   * monta o cartão sem a ficha): nunca relê por conta própria.
   */
  status?: string | null;
  paymentStatus?: string | null;
  /**
   * Vínculo da etiqueta que a FICHA mostra agora (`Order.shippingLabelId`/
   * `shippingLabelUrl`, vindos da lista ao vivo). A edge grava o id e depois a
   * url sem mexer em status nem pagamento: com a ficha do mesmo pedido aberta
   * em dois aparelhos, o que não gerou seguia oferecendo "Gerar etiqueta".
   * Uma MUDANÇA deles relê o pedido em silêncio, como a de status/pagamento.
   * `undefined` e `null` valem "sem etiqueta"; ausentes: nunca relê.
   */
  shippingLabelIdDaFicha?: string | null;
  shippingLabelUrlDaFicha?: string | null;
}

/**
 * `silencioso`: releitura por mudança de status na ficha -- o cartão não pisca
 * em "carregando" nem troca o que está na tela por um erro; só aplica o pedido
 * novo. Sem a opção (ou com o evento do clique em "Tentar de novo") é a
 * leitura de sempre.
 */
interface OpcoesDeLeitura {
  silencioso?: boolean;
}

/**
 * A edge recusa pedido cancelado/entregue/devolvido com o status CRU em
 * inglês (`erroDePedidoParaEtiqueta`: Pedido com status "cancelled" não gera
 * etiqueta de envio.). Devolve o texto em português da elegibilidade, ou
 * `null` se a mensagem for outra (aí vale a frase do servidor).
 */
function traducaoDaRecusaPorStatus(mensagem: string): string | null {
  const casou =
    /^Pedido com status "([^"]*)" não (?:gera etiqueta|recebe alteração de CPF)/.exec(
      mensagem,
    );
  return casou ? motivoDoStatusSemEtiqueta(casou[1]) : null;
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
  trackingCodeDaFicha,
  status,
  paymentStatus,
  shippingLabelIdDaFicha,
  shippingLabelUrlDaFicha,
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

  // Teclado e leitor de tela: o botão "Gerar etiqueta" SAI da tela quando a
  // confirmação abre (e a confirmação sai quando se cancela), então o foco
  // precisava ser mandado de propósito -- sem isso ele caía no corpo da
  // página e o aviso de custo não era lido. Só um CLIQUE da pessoa move o
  // foco (o ref abaixo guarda para onde): carregar o card, reler o pedido ou
  // a compra terminar nunca tiram o foco de onde ela estava. O foco vai para
  // "Cancelar" (o lado seguro), NUNCA para "Confirmar e gerar" (gasta saldo).
  const focoPendenteRef = useRef<"cancelar" | "gerar" | null>(null);
  const cancelarBtnRef = useRef<HTMLButtonElement>(null);
  const gerarBtnRef = useRef<HTMLButtonElement>(null);
  const tituloDaConfirmacaoId = useId();
  const detalhesDaConfirmacaoId = useId();

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

  const fetchPedido = useCallback(
    async (opcoes?: OpcoesDeLeitura) => {
      const silencioso = opcoes?.silencioso === true;
      const minhaGeracao = ++geracaoRef.current;
      if (!silencioso) setCargaFase("carregando");
      // Falha da releitura silenciosa: mantém a tela, a não ser que ainda não
      // houvesse nada para mostrar (a 1ª leitura foi atropelada por esta).
      const falhou = () =>
        silencioso
          ? setCargaFase((atual) => (atual === "carregando" ? "erro" : atual))
          : setCargaFase("erro");
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
          falhou();
          return;
        }
        if (!data) {
          setCargaFase("vazio");
          return;
        }
        const linha = data as unknown as PedidoParaEtiqueta;
        // A compra ficou INDETERMINADA? Só vale perguntar quando já existe
        // vínculo com uma etiqueta, e é uma leitura À PARTE de propósito: se o
        // histórico não puder ser lido, o card degrada para o que sempre
        // mostrou ("Etiqueta emitida") em vez de sumir com a etiqueta.
        let compraIndeterminada = false;
        if (linha.shipping_label_id) {
          try {
            const { data: eventos, error: eventosError } = await supabase
              .from("order_shipping_events")
              .select("event_type, payload, error_message, created_at")
              .eq("order_id", orderId);
            if (geracaoRef.current !== minhaGeracao) return;
            if (eventosError) {
              console.error(
                "[EtiquetaDoPedido] Erro ao ler o histórico de envio:",
                eventosError,
              );
            } else {
              compraIndeterminada = compraIndeterminadaPeloHistorico(eventos);
            }
          } catch (errEventos) {
            if (geracaoRef.current !== minhaGeracao) return;
            console.error(
              "[EtiquetaDoPedido] Exceção ao ler o histórico de envio:",
              errEventos,
            );
          }
        }
        setPedido({ ...linha, compra_indeterminada: compraIndeterminada });
        setCargaFase("ok");
      } catch (err) {
        if (geracaoRef.current !== minhaGeracao) return;
        console.error("[EtiquetaDoPedido] Exceção ao carregar o pedido:", err);
        falhou();
      }
    },
    [orderId],
  );

  // Troca de pedido: zera a fase de compra e a mensagem persistente ANTES de
  // buscar — o pedido antigo não pode continuar na tela com o rótulo do
  // pedido novo por um instante.
  useEffect(() => {
    focoPendenteRef.current = null;
    setCompraFase("ocioso");
    setMensagemResultado(null);
    setPedido(null);
    setCpfInput("");
    setCpfErro(null);
    setCpfSalvando(false);
    setConsultandoRastreio(false);
    fetchPedido();
  }, [fetchPedido]);

  // Cancelar/concluir o pedido na ficha (ou o pagamento mudar), ou a etiqueta
  // sair em OUTRO aparelho (id/url novos na lista ao vivo): relê, para o cartão
  // parar de oferecer a etiqueta que a edge vai recusar -- ou o botão de
  // compra de uma etiqueta que já existe. A 1ª leitura (e a troca de pedido)
  // já é feita pelo efeito acima -- aqui só entra uma MUDANÇA do MESMO pedido.
  //
  // COMPRA DESTE APARELHO EM VOO: a edge grava o id na reivindicação (antes de
  // pagar) e a url só no fim, então o id chega pela lista ao vivo no meio da
  // compra. Reler aí derrubava o quadro "Gerando…" (o pedido já parece
  // "emitido") e a leitura antiga podia terminar depois do resultado da compra
  // e apagar a url/o rastreio. Durante o voo o id/url NÃO avançam no
  // "último visto": quando a compra termina (`emVoo` muda, o efeito reavalia) a
  // diferença ainda está lá e a releitura sai uma vez, sem perder a mudança.
  // Status/pagamento seguem relendo em voo (a resposta da compra não se perde).
  const etiquetaId = shippingLabelIdDaFicha ?? null;
  const etiquetaUrl = shippingLabelUrlDaFicha ?? null;
  const emVoo = compraFase === "gerando";
  const ultimaLeituraDaFichaRef = useRef({
    orderId,
    status,
    paymentStatus,
    etiquetaId,
    etiquetaUrl,
  });
  useEffect(() => {
    const anterior = ultimaLeituraDaFichaRef.current;
    const mesmoPedido = anterior.orderId === orderId;
    ultimaLeituraDaFichaRef.current = {
      orderId,
      status,
      paymentStatus,
      etiquetaId: emVoo && mesmoPedido ? anterior.etiquetaId : etiquetaId,
      etiquetaUrl: emVoo && mesmoPedido ? anterior.etiquetaUrl : etiquetaUrl,
    };
    if (!mesmoPedido) return;
    const mudouStatus =
      anterior.status !== status || anterior.paymentStatus !== paymentStatus;
    const mudouEtiqueta =
      anterior.etiquetaId !== etiquetaId ||
      anterior.etiquetaUrl !== etiquetaUrl;
    if (!mudouStatus && !(mudouEtiqueta && !emVoo)) return;
    void fetchPedido({ silencioso: true });
  }, [
    orderId,
    status,
    paymentStatus,
    etiquetaId,
    etiquetaUrl,
    emVoo,
    fetchPedido,
  ]);

  // O código salvo/apagado na linha da ficha chega aqui. Pedido ainda não lido
  // (`null`): nada a aplicar, a leitura que vem já traz o código gravado.
  useEffect(() => {
    if (trackingCodeDaFicha === undefined) return;
    setPedido((prev) =>
      prev && (prev.tracking_code ?? "") !== trackingCodeDaFicha
        ? { ...prev, tracking_code: trackingCodeDaFicha || null }
        : prev,
    );
  }, [trackingCodeDaFicha]);

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
    // A chamada de compra, guardada fora do `try` para o `catch` do estouro
    // poder ouvir a resposta TARDIA dela (só para reler, nunca para aplicar).
    let invocacao: Promise<unknown> | undefined;
    try {
      // PRAZO DA ESPERA DA TELA (não da compra): rede que conecta e não
      // responde deixava "Gerando…" para sempre, com a trava do pedido presa.
      const pedidoDeCompra = supabase.functions.invoke(
        "melhor-envio-etiqueta",
        {
          body: { action: "gerar_etiqueta", orderId: orderIdDoClique },
        },
      );
      invocacao = pedidoDeCompra;
      const { data, error } = await aguardarComPrazo(
        pedidoDeCompra,
        PRAZO_DA_COMPRA_DA_ETIQUETA_MS,
        () =>
          erroDeConsultaSemResposta(MENSAGEM_COMPRA_DA_ETIQUETA_SEM_RESPOSTA),
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
      if (ehConsultaSemResposta(err)) {
        // REGRA DE OURO DA COMPRA: estourou o prazo, a etiqueta PODE ter sido
        // comprada (e o saldo gasto). A tela NÃO diz que deu certo nem que
        // falhou. Solta o que era só da tela (a confirmação e a trava, no
        // `finally`) e relê o pedido no servidor: se a etiqueta existe, o card
        // cai em "emitida"/"conferindo"; se não, a lojista pode tentar de novo
        // -- sem compra dupla, porque a edge reivindica o pedido
        // (`shipping_label_id` NULL -> id, uma linha só vence) e a 2ª chamada
        // devolve `already: true`.
        // A resposta TARDIA da chamada abandonada nunca é aplicada (nem
        // "gerada!", nem rastreio, nem erro): ela só dispara outra releitura,
        // e quem mostra o estado é o servidor.
        console.error("[EtiquetaDoPedido] Compra sem resposta no prazo:", err);
        setMensagemResultado({
          tipo: "sem_resposta",
          texto: MENSAGEM_COMPRA_DA_ETIQUETA_SEM_RESPOSTA,
        });
        setCompraFase("ocioso");
        haptic.error();
        toast.warning(MENSAGEM_COMPRA_DA_ETIQUETA_SEM_RESPOSTA, {
          duration: 15_000,
        });
        void fetchPedido({ silencioso: true });
        const reler = () => {
          if (orderIdAtualRef.current === orderIdDoClique) {
            void fetchPedido({ silencioso: true });
          }
        };
        void invocacao?.then(reler, reler);
        return;
      }
      console.error("[EtiquetaDoPedido] Erro na geração:", err);
      const {
        mensagem: mensagemDoServidor,
        resgate,
        precisaCpf,
      } = await mensagemDeErroInvocacao(err, {
        mensagemGenerica:
          "Não foi possível falar com o servidor de etiquetas. Tente de novo.",
      });
      // Recusa por status (pedido cancelado/entregue/devolvido depois que a
      // tela leu o pedido): o servidor diz o status cru em inglês -- a
      // lojista lê o mesmo motivo que o cartão mostraria com a tela em dia.
      const motivoPorStatus = traducaoDaRecusaPorStatus(mensagemDoServidor);
      const detalhe = motivoPorStatus ?? mensagemDoServidor;
      // `mensagemDeErroInvocacao` também tem `await` (lê o corpo da
      // resposta) — checa de novo antes de qualquer efeito visível.
      if (orderIdAtualRef.current !== orderIdDoClique) return;
      setMensagemResultado({ tipo: "erro", texto: detalhe });
      if (resgate || precisaCpf || motivoPorStatus) {
        // A etiqueta já existe/está paga (ou o estado é indeterminado): a
        // releitura do pedido traz o `shipping_label_id` de verdade e a UI
        // cai em "emitida" sozinha — nunca reapresenta o botão de compra.
        // `precisaCpf`: a edge recusou por falta/invalidez de CPF (tela
        // desatualizada) — a releitura cai sozinha no estado `precisa_cpf`.
        // `motivoPorStatus`: pedido que deixou de ser elegível -- a releitura
        // cai em "indisponível" e o botão de compra some.
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
          "Não foi possível falar com o servidor de etiquetas. Tente de novo.",
      });
      if (orderIdAtualRef.current !== orderIdDoClique) return;
      const motivoPorStatus = traducaoDaRecusaPorStatus(mensagem);
      const detalhe = motivoPorStatus ?? mensagem;
      setCpfErro(detalhe);
      if (motivoPorStatus) {
        // Pedido mudou em outro aparelho: relê para sair de "precisa_cpf".
        await fetchPedido();
        if (orderIdAtualRef.current !== orderIdDoClique) return;
      }
      haptic.error();
      toast.error(detalhe);
    } finally {
      cpfEmVoo.delete(orderIdDoClique);
      // `cpfSalvando` é um `boolean` ÚNICO (não isolado por pedido, como o
      // `Set` acima) — só zera se ainda for o pedido que estava salvando;
      // senão apagaria o `true` de um salvamento genuíno de OUTRO pedido
      // que começou depois da troca.
      if (orderIdAtualRef.current === orderIdDoClique) setCpfSalvando(false);
    }
  }, [isOffline, pedido, cpfInput, orderId, fetchPedido]);

  const handleConsultarRastreio = useCallback(
    async (modo: "rastreio" | "conferencia" = "rastreio") => {
      const orderIdDoClique = orderId;
      if (isOffline || rastreioEmVoo.has(orderIdDoClique)) return;
      rastreioEmVoo.add(orderIdDoClique);
      setConsultandoRastreio(true);
      try {
        // Leitura: com a rede pendurada o botão nunca soltava. Estourou, a resposta
        // tardia é descartada (o servidor pode até ter gravado o código; o
        // próximo toque ou a próxima leitura do pedido o traz).
        const { data, error } = await aguardarComPrazo(
          supabase.functions.invoke("melhor-envio-etiqueta", {
            body: { action: "consultar_rastreio", orderId: orderIdDoClique },
          }),
          PRAZO_DA_CONSULTA_DO_RASTREIO_MS,
          () => erroDeConsultaSemResposta(),
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
          // O código de rastreio só nasce depois que a etiqueta foi paga: é a
          // confirmação que tira o card do "conferindo" (a edge já gravou o
          // código no pedido; a próxima leitura traz o mesmo).
          setPedido((prev) =>
            prev ? { ...prev, tracking_code: codigo } : prev,
          );
          onTrackingAtualizado?.(orderIdDoClique, codigo);
          toast.success(
            modo === "conferencia"
              ? "Etiqueta confirmada no Melhor Envio!"
              : "Rastreio atualizado!",
          );
        } else if (modo === "conferencia") {
          // Sem código NÃO é prova de que não foi paga: só diz a verdade e
          // deixa o vínculo como está (soltar abriria a compra dupla).
          toast.info(
            "O Melhor Envio ainda não confirmou esta etiqueta. Confira em Meus envios, na sua conta do Melhor Envio, ou toque em Conferir de novo daqui a pouco.",
          );
        } else {
          toast.info(
            "A transportadora ainda não publicou o código. Tente novamente mais tarde.",
          );
        }
      } catch (err) {
        if (orderIdAtualRef.current !== orderIdDoClique) return;
        if (ehConsultaSemResposta(err)) {
          toast.error(
            modo === "conferencia"
              ? "Não deu para conferir a etiqueta agora: a rede não respondeu. Toque em Conferir de novo daqui a pouco."
              : "Não deu para atualizar o rastreio: a rede não respondeu. Tente de novo em instantes.",
          );
          return;
        }
        console.error("[EtiquetaDoPedido] Erro ao consultar rastreio:", err);
        const { mensagem } = await mensagemDeErroInvocacao(err, {
          mensagemGenerica:
            "Não foi possível falar com o servidor de etiquetas. Tente de novo.",
        });
        if (orderIdAtualRef.current !== orderIdDoClique) return;
        toast.error(mensagem);
      } finally {
        rastreioEmVoo.delete(orderIdDoClique);
        if (orderIdAtualRef.current === orderIdDoClique) {
          setConsultandoRastreio(false);
        }
      }
    },
    [isOffline, orderId, onTrackingAtualizado],
  );

  const abrirConfirmacao = useCallback(() => {
    setMensagemResultado(null);
    focoPendenteRef.current = "cancelar";
    setCompraFase("confirmar");
  }, []);

  const cancelarConfirmacao = useCallback(() => {
    focoPendenteRef.current = "gerar";
    setCompraFase("ocioso");
  }, []);

  // Roda depois do desenho: o botão novo já existe quando o foco é pedido.
  useEffect(() => {
    const destino = focoPendenteRef.current;
    if (destino === "cancelar" && compraFase === "confirmar") {
      focoPendenteRef.current = null;
      cancelarBtnRef.current?.focus();
    } else if (destino === "gerar" && compraFase === "ocioso") {
      focoPendenteRef.current = null;
      gerarBtnRef.current?.focus();
    }
  }, [compraFase]);

  // Redesenho da ficha (08/10/2026): o card vira UMA LINHA da lista de envio
  // (a casca com borda mora em OrderDetail; aqui só o conteúdo da linha). A
  // lógica, os botões e os estados são os mesmos — só a casca, a tipografia
  // (nada abaixo de 12px, sem caixa alta espaçada) e o estado "indisponível"
  // mudaram: o aviso âmbar grande virou rótulo + motivo cinza na mesma linha.
  const indisponivel =
    cargaFase === "ok" && pedido && elegibilidade?.estado === "indisponivel"
      ? elegibilidade
      : null;

  return (
    <div id="etiqueta-do-pedido" className="space-y-3 px-4 py-3.5">
      {/* O motivo é o que o SISTEMA devolveu (instruções como "confirme o
          pagamento" ou "gere no site da SuperFrete"): aparece INTEIRO, quebrando
          linha — nunca cortado, porque toque no celular não mostra `title`.
          O rótulo "Etiqueta de envio" substitui o antigo prefixo "Etiqueta pelo
          app indisponível —". */}
      <div
        data-testid={indisponivel ? "etiqueta-indisponivel" : undefined}
        className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
      >
        <h3 className="shrink-0 text-sm font-medium text-zinc-200">
          Etiqueta de envio
        </h3>
        {indisponivel && (
          <p className="min-w-0 flex-1 basis-48 text-xs leading-relaxed text-zinc-400">
            {indisponivel.motivo}
          </p>
        )}
      </div>

      {cargaFase === "carregando" && (
        <Skeleton className="h-10 w-full rounded-xl bg-white/5" />
      )}

      {cargaFase === "erro" && (
        <div className="rounded-xl border border-admin-border bg-admin-surface p-3 text-center text-sm font-medium text-red-400">
          Não foi possível carregar os dados da etiqueta.{" "}
          <button
            type="button"
            onClick={() => void fetchPedido()}
            className="font-semibold underline hover:no-underline"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {cargaFase === "vazio" && (
        <p className="text-sm text-zinc-400">Pedido não encontrado.</p>
      )}

      {cargaFase === "ok" && pedido && elegibilidade && (
        <div className="space-y-2.5">
          {mensagemResultado?.tipo === "erro" && (
            <p
              data-testid="erro-etiqueta"
              className="rounded-xl border border-admin-border bg-admin-surface px-3 py-2 text-sm font-medium leading-snug text-red-400 duration-200 animate-in fade-in"
            >
              {mensagemResultado.texto}
            </p>
          )}

          {mensagemResultado?.tipo === "sem_resposta" &&
            elegibilidade.estado === "disponivel" && (
              <p
                data-testid="etiqueta-sem-resposta"
                role="status"
                className="rounded-xl border border-admin-border bg-admin-surface px-3 py-2 text-sm font-medium leading-snug text-amber-400 duration-200 animate-in fade-in"
              >
                {mensagemResultado.texto}
              </p>
            )}

          {elegibilidade.estado === "emitida" && (
            <div className="space-y-3 rounded-xl border border-admin-border bg-admin-surface p-3 duration-200 animate-in fade-in">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
                <CheckCircle2 className="size-4 shrink-0" />
                <span>
                  {mensagemResultado?.tipo === "sucesso"
                    ? "Etiqueta gerada e vinculada ao pedido!"
                    : mensagemResultado?.tipo === "already"
                      ? "Este pedido já tinha etiqueta — nada foi comprado de novo."
                      : "Etiqueta emitida"}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl border border-admin-border bg-black/40 px-3 py-2">
                <div className="min-w-0">
                  <span className="block text-xs text-zinc-400">
                    Código de rastreio
                  </span>
                  <span
                    className="block break-all font-mono text-sm font-medium text-white"
                    data-testid="codigo-rastreio"
                  >
                    {pedido.tracking_code ||
                      "Ainda sem código — atualize depois da postagem"}
                  </span>
                </div>
                <Barcode className="size-4 shrink-0 text-zinc-400" />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {pedido.shipping_label_url && (
                  <a
                    href={pedido.shipping_label_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-10 items-center gap-1.5 rounded-xl border border-solid border-admin-border-strong bg-admin-raised px-3 text-sm font-medium text-foreground transition-colors hover:bg-admin-hover active:scale-95"
                  >
                    <ExternalLink className="size-4" />
                    <span>Abrir etiqueta</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => handleConsultarRastreio()}
                  disabled={consultandoRastreio || isOffline}
                  className="flex h-10 items-center gap-1.5 rounded-xl border border-admin-border bg-white/5 px-3 text-sm font-medium text-zinc-300 transition-colors hover:text-white active:scale-95 disabled:opacity-40"
                >
                  <RefreshCw
                    className={`size-4 ${consultandoRastreio ? "animate-spin" : ""}`}
                  />
                  <span>Atualizar rastreio</span>
                </button>
              </div>

              <p className="text-xs leading-snug text-zinc-400">
                Reimpressão ou cancelamento: pela sua conta no Melhor Envio.
              </p>
            </div>
          )}

          {elegibilidade.estado === "conferindo" && (
            <div
              data-testid="etiqueta-conferindo"
              className="space-y-3 rounded-xl border border-admin-border bg-admin-surface p-3 duration-200 animate-in fade-in"
            >
              <p className="flex items-start gap-2 text-sm font-medium leading-snug text-amber-400">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-400" />
                <span>
                  Conferindo a etiqueta no Melhor Envio
                  <span className="mt-1 block font-normal text-zinc-300">
                    O pagamento da etiqueta não teve resposta clara do Melhor
                    Envio: ela pode ter sido paga ou não. Este pedido continua
                    ligado à etiqueta {pedido.shipping_label_id} para não
                    comprar duas vezes.
                  </span>
                </span>
              </p>
              <button
                type="button"
                onClick={() => handleConsultarRastreio("conferencia")}
                disabled={consultandoRastreio || isOffline}
                className="flex h-11 items-center gap-1.5 rounded-xl border border-admin-border bg-white/5 px-4 text-sm font-medium text-zinc-300 transition-colors hover:text-white active:scale-95 disabled:opacity-40"
              >
                <RefreshCw
                  className={`size-4 ${consultandoRastreio ? "animate-spin" : ""}`}
                />
                <span>Conferir de novo</span>
              </button>
              <p className="text-xs leading-snug text-zinc-400">
                Confira também em Meus envios, na sua conta do Melhor Envio.
              </p>
            </div>
          )}

          {elegibilidade.estado === "precisa_cpf" && (
            <div
              data-testid="precisa-cpf"
              className="space-y-3 rounded-xl border border-admin-border bg-admin-surface p-3 duration-200 animate-in fade-in"
            >
              <p className="flex items-start gap-2 text-sm font-medium leading-snug text-amber-400">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-400" />
                <span>
                  O Melhor Envio exige o CPF do destinatário para emitir a
                  etiqueta.
                  {elegibilidade.cpfInvalido && (
                    <span className="mt-1 block font-normal text-zinc-300">
                      O CPF salvo neste pedido é inválido — corrija abaixo.
                    </span>
                  )}
                </span>
              </p>
              <div className="space-y-2">
                <label
                  htmlFor="cpf-destinatario"
                  className="block text-xs text-zinc-300"
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
                  className="h-11 w-full rounded-xl border border-admin-border bg-black/40 px-3 font-mono text-sm font-medium text-white outline-none focus:border-admin-gold/50 disabled:opacity-40"
                />
                {cpfErro && (
                  <p
                    data-testid="erro-cpf"
                    className="text-sm font-medium leading-snug text-red-400"
                  >
                    {cpfErro}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleSalvarCpf}
                  disabled={cpfSalvando || isOffline}
                  className="flex h-11 items-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-all hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                >
                  {cpfSalvando ? (
                    <RefreshCw className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}
                  <span>{cpfSalvando ? "Salvando…" : "Salvar CPF"}</span>
                </button>
              </div>
            </div>
          )}

          {elegibilidade.estado === "disponivel" && compraFase === "ocioso" && (
            <button
              ref={gerarBtnRef}
              type="button"
              onClick={abrirConfirmacao}
              disabled={isOffline}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-all hover:opacity-90 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            >
              <PackageCheck className="size-4" />
              <span>Gerar etiqueta</span>
            </button>
          )}

          {elegibilidade.estado === "disponivel" && compraFase !== "ocioso" && (
            <div
              role="alertdialog"
              aria-labelledby={tituloDaConfirmacaoId}
              aria-describedby={detalhesDaConfirmacaoId}
              className="space-y-3 rounded-xl border border-admin-border bg-admin-surface p-3 duration-200 animate-in fade-in"
            >
              <p className="flex items-start gap-2 text-sm font-medium leading-snug text-amber-400">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-400" />
                <span>
                  <span id={tituloDaConfirmacaoId}>
                    A etiqueta é comprada com o saldo da SUA conta no Melhor
                    Envio.
                  </span>
                  <span id={detalhesDaConfirmacaoId} className="block">
                    <span className="mt-1 block font-normal text-zinc-300">
                      Serviço: {elegibilidade.servico}
                    </span>
                    <span className="mt-1 block font-normal text-zinc-300">
                      Frete pago pelo cliente:{" "}
                      {formatCurrency(freteEfetivoDoPedido(pedido))}
                    </span>
                    <span
                      data-testid="cpf-mascarado"
                      className="mt-1 block font-normal text-zinc-300"
                    >
                      CPF do destinatário: {mascararCpf(pedido.cpf)}
                    </span>
                  </span>
                </span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleGerarEtiqueta}
                  disabled={compraFase === "gerando" || isOffline}
                  className="flex h-11 items-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-all hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                >
                  {compraFase === "gerando" ? (
                    <RefreshCw className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}
                  <span>
                    {compraFase === "gerando"
                      ? "Gerando…"
                      : "Confirmar e gerar"}
                  </span>
                </button>
                <button
                  ref={cancelarBtnRef}
                  type="button"
                  onClick={cancelarConfirmacao}
                  disabled={compraFase === "gerando"}
                  className="h-11 rounded-xl px-3 text-sm font-medium text-zinc-300 transition-colors hover:text-white disabled:opacity-40"
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
