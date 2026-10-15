import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { numeroDoPedido } from "@/lib/numero-do-pedido";
import {
  AVISO_DE_DOBRO,
  type LinhaDoSaldo,
  RPC_DO_REEMBOLSO_R1,
  type ReembolsosESaldo,
  avisoDaSaidaParcial,
  chamarRpcDoR1,
  lerReembolsosESaldo,
  lerSaidaAposEspera,
  linhaViva,
  parametrosPorForaAposEspera,
} from "@/lib/reembolso-em-duvida";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";

/** Status possíveis de uma linha de `order_refunds` (Task 1 do plano-mãe de
 * estorno, `20260907-plano-estorno-pelo-app.md`). */
export type StatusEstorno =
  | "solicitado"
  | "em_processamento"
  | "concluido"
  | "falhou"
  | "recusado";

export interface LinhaEstornoDoPedido {
  id: string;
  amount: number;
  status: StatusEstorno;
  solicitado_por: string;
  mp_status: string | null;
  mp_status_detail: string | null;
  tentativas: number;
  ultimo_erro: string | null;
  motivo: string | null;
  created_at: string;
  concluido_em: string | null;
  /** Veredito do SERVIDOR (lote R1): o envio pode ter chegado ao MP. */
  pode_ter_saido: boolean;
  /** Marca do servidor: a saída dos 7 dias JÁ foi usada nesta linha. */
  por_fora_liberado_em: string | null;
  /** Servidor: a espera dos 7 dias passou (a porta ainda decide). */
  por_fora_apos_espera_liberado: boolean;
  /** Servidor: o reembolso manual tomou o lugar desta linha. */
  substituida_por_manual: boolean;
  eh_pix: boolean;
}

/** Colunas de exibição lidas de `order_refunds` (texto da linha). */
type DetalheDaLinha = Omit<
  LinhaEstornoDoPedido,
  | "pode_ter_saido"
  | "por_fora_liberado_em"
  | "por_fora_apos_espera_liberado"
  | "substituida_por_manual"
  | "eh_pix"
>;

// Não exportada de propósito: nada fora deste arquivo importa o TIPO do
// retorno por nome (quem consome o hook, ex. `EstornoCard`, só desestrutura
// os campos) — exportá-la só criaria um export órfão para o `knip`.
interface EstornosDoPedido {
  linhas: LinhaEstornoDoPedido[];
  /** = `total` do servidor. */
  pago: number;
  /** = `valor_estornado` do servidor. */
  devolvido: number;
  /** = `em_voo` do servidor (linhas `solicitado`/`em_processamento`). */
  emCurso: number;
  /** = `em_duvida` do servidor: parou e PODE ter saído — o saldo prende. */
  emDuvida: number;
  /** = `disponivel` do servidor. A tela NUNCA recalcula (lote R1). */
  disponivel: number;
  /** = `reservado_por_fora` do servidor: linha já resolvida por fora que o
   * Mercado Pago ainda não respondeu (fica fora do saldo até ele responder). */
  reservadoPorFora: number;
  carregando: boolean;
  /** O pedido já foi lido pelo menos uma vez. Distingue "ainda não sei o
   * saldo" (primeira carga, `false`) de "o saldo é zero" (`true` com
   * `disponivel === 0`) — BLOQUEIA 2 do laudo 08/09. */
  pedidoCarregado: boolean;
  /** A leitura falhou; `pago`/`devolvido`/`disponivel` não são confiáveis. */
  erro: boolean;
  recarregar: () => void;
  solicitarEstorno: (args: {
    amount: number;
    motivo: string;
  }) => Promise<void>;
  /** Saída dos 7 dias da linha `refundId` (frase já conferida na tela). */
  registrarPorForaAposEspera: (refundId: string) => Promise<boolean>;
  /** Uma ação (`solicitarEstorno` ou a saída dos 7 dias) está em voo. */
  enviando: boolean;
}

const ESTADOS_EM_CURSO: readonly StatusEstorno[] = [
  "solicitado",
  "em_processamento",
];

const INTERVALO_DE_RECARGA_MS = 15_000;

/** Os avisos de `solicitarEstorno` são toasts GLOBAIS: se o lojista trocar de
 *  ficha antes da resposta, o aviso do pedido anterior apareceria sobre o
 *  aberto sem dizer de quem é. Por isso todos levam o número do pedido. */
const textoRegistradoCron = (numero: string) =>
  `Devolução do pedido #${numero} registrada; o Mercado Pago é acionado em até 10 minutos.`;

/**
 * Junta o texto de `order_refunds` ao veredito do servidor. Linha que o
 * servidor não julgou (leituras em instantes diferentes) fica com o lado
 * SEGURO: "pode ter saído" — nenhuma tela oferece repetir sem o veredito.
 */
function juntar(
  detalhes: DetalheDaLinha[],
  julgadas: readonly LinhaDoSaldo[],
): LinhaEstornoDoPedido[] {
  const porId = new Map(julgadas.map((l) => [l.id, l]));
  return detalhes.map((d) => {
    const j = porId.get(d.id);
    return {
      ...d,
      pode_ter_saido: j ? j.pode_ter_saido : true,
      por_fora_liberado_em: j ? j.por_fora_liberado_em : null,
      por_fora_apos_espera_liberado: j
        ? j.por_fora_apos_espera_liberado
        : false,
      substituida_por_manual: j ? j.substituida_por_manual : false,
      eh_pix: j ? j.eh_pix : false,
    };
  });
}

/**
 * Lê o saldo e o histórico de devoluções de UM pedido e expõe
 * `solicitarEstorno`, que grava o pedido no ledger (RPC `solicitar_estorno`)
 * e SÓ DEPOIS aciona o Mercado Pago (edge `estornar-pagamento`) — nessa
 * ordem, sempre (arquitetura de "ledger primeiro, execução depois").
 *
 * Lote R1 (15/10/2026): o saldo vem PRONTO do servidor
 * (`pedido_reembolsos_e_saldo`), com o "em dúvida" já descontado e o
 * veredito `pode_ter_saido` por linha. Antes, esta tela copiava a conta
 * (pago − devolvido − em curso − manual) e a cópia divergia do servidor.
 * `order_refunds` continua lido só para o TEXTO da linha (erro, tentativas,
 * contestação).
 *
 * SEM REALTIME, de propósito: `order_refunds` não está na publication
 * `supabase_realtime`. Recarrega ao montar, depois de cada ação, e — ENQUANTO
 * existir linha em `solicitado`/`em_processamento` — a cada 15s.
 */
export function useEstornosDoPedido(orderId: string): EstornosDoPedido {
  const [detalhes, setDetalhes] = useState<DetalheDaLinha[]>([]);
  const [saldo, setSaldo] = useState<ReembolsosESaldo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const ativoRef = useRef(true);
  // Trava de clique duplo (ANOTADO do laudo 08/09): o ref é síncrono, a
  // segunda chamada no MESMO tick já encontra `true` antes de chamar a RPC.
  const enviandoRef = useRef(false);

  // Rodada da leitura: a resposta do orderId antigo que chega depois da nova
  // não pinta a tela (mesmo padrão de useDevolucaoCliente).
  const rodadaRef = useRef(0);

  const carregar = useCallback(async () => {
    const rodada = ++rodadaRef.current;
    const valeAinda = () => ativoRef.current && rodada === rodadaRef.current;
    setCarregando(true);
    try {
      const [respostaLinhas, respostaSaldo] = await Promise.all([
        supabase
          .from("order_refunds")
          .select(
            "id, amount, status, solicitado_por, mp_status, mp_status_detail, tentativas, ultimo_erro, motivo, created_at, concluido_em",
          )
          .eq("order_id", orderId)
          .order("created_at", { ascending: true }),
        chamarRpcDoR1(supabase, RPC_DO_REEMBOLSO_R1.saldo, {
          p_order_id: orderId,
        }),
      ]);

      if (!valeAinda()) return;

      // Saldo ilegível é erro de leitura: um número de dinheiro de forma
      // inesperada não vai para a tela.
      const lido = respostaSaldo.error
        ? null
        : lerReembolsosESaldo(respostaSaldo.data);
      if (respostaLinhas.error || !lido) {
        setErro(true);
        return;
      }

      setDetalhes((respostaLinhas.data ?? []) as unknown as DetalheDaLinha[]);
      setSaldo(lido);
      setErro(false);
    } catch {
      if (valeAinda()) setErro(true);
    } finally {
      if (valeAinda()) setCarregando(false);
    }
  }, [orderId]);

  useEffect(() => {
    ativoRef.current = true;
    void carregar();
    return () => {
      ativoRef.current = false;
    };
  }, [carregar]);

  const linhas = juntar(detalhes, saldo?.linhas ?? []);
  // O valor da linha no aviso da saída parcial (a mesma que a tela mostrava).
  const linhasRef = useRef(linhas);
  linhasRef.current = linhas;
  const temLinhaAtiva = linhas.some((linha) =>
    ESTADOS_EM_CURSO.includes(linha.status),
  );

  // O intervalo só existe enquanto houver linha ativa.
  useEffect(() => {
    if (!temLinhaAtiva) return;
    const id = setInterval(() => {
      void carregar();
    }, INTERVALO_DE_RECARGA_MS);
    return () => clearInterval(id);
  }, [temLinhaAtiva, carregar]);

  const solicitarEstorno = useCallback(
    async ({ amount, motivo }: { amount: number; motivo: string }) => {
      if (enviandoRef.current) return;
      enviandoRef.current = true;
      setEnviando(true);
      const numero = numeroDoPedido(orderId);
      try {
        const { data, error } = await supabase.rpc("solicitar_estorno", {
          p_order_id: orderId,
          p_amount: amount,
          p_motivo: motivo,
        });

        // A RPC já devolve mensagem leiga — não se traduz de novo aqui.
        if (error) {
          toast.error(`Devolução do pedido #${numero}: ${error.message}`);
          // AC 3 do laudo 08/09: a recusa prova que o snapshot em tela está
          // velho — recarrega mesmo no erro.
          await carregar();
          return;
        }

        const refundId = (data as unknown as { refund_id?: string } | null)
          ?.refund_id;
        if (!refundId) {
          toast.error(
            `Não consegui registrar a devolução do pedido #${numero}.`,
          );
          return;
        }

        // A linha já existe como `solicitado`. Se o `invoke` falhar agora,
        // NÃO é falha do pedido — o cron `reconciliar-pagamentos` (≤ 10 min)
        // a executa depois, com a mesma chave de idempotência.
        try {
          const { error: erroDoInvoke } = await supabase.functions.invoke(
            "estornar-pagamento",
            { body: { refund_id: refundId } },
          );
          if (erroDoInvoke) toast.info(textoRegistradoCron(numero));
        } catch {
          toast.info(textoRegistradoCron(numero));
        }

        await carregar();
      } finally {
        enviandoRef.current = false;
        setEnviando(false);
      }
    },
    [orderId, carregar],
  );

  const registrarPorForaAposEspera = useCallback(
    async (refundId: string) => {
      if (enviandoRef.current) return false;
      enviandoRef.current = true;
      setEnviando(true);
      const numero = numeroDoPedido(orderId);
      try {
        const { data, error } = await chamarRpcDoR1(
          supabase,
          RPC_DO_REEMBOLSO_R1.porForaAposEsperaDoPedido,
          parametrosPorForaAposEspera.pedido(orderId, refundId),
        );
        if (error) {
          // A RPC fala com o leigo (mensagem da migration).
          toast.error(`Devolução do pedido #${numero}: ${error.message}`);
          await carregar();
          return false;
        }
        // Recusa do servidor vem SEM erro (`resultado` no jsonb).
        const saida = lerSaidaAposEspera(data);
        if (!saida.gravou) {
          toast.info(`Pedido #${numero}: ${saida.aviso}`);
          await carregar();
          return false;
        }
        const linha = linhasRef.current.find((l) => l.id === refundId);
        toast.warning(
          saida.aindaADevolver !== undefined && linha
            ? `Pedido #${numero}: ${avisoDaSaidaParcial(formatCurrency(linha.amount), formatCurrency(saida.aindaADevolver), linhaViva(linha.status))} ${AVISO_DE_DOBRO}`
            : `Pedido #${numero}: registrado como devolvido por fora. ${AVISO_DE_DOBRO}`,
        );
        await carregar();
        return true;
      } catch {
        toast.error(
          `Não consegui registrar a devolução do pedido #${numero}. Tente de novo.`,
        );
        return false;
      } finally {
        enviandoRef.current = false;
        setEnviando(false);
      }
    },
    [orderId, carregar],
  );

  return {
    linhas,
    pago: saldo?.total ?? 0,
    devolvido: saldo?.valor_estornado ?? 0,
    emCurso: saldo?.em_voo ?? 0,
    emDuvida: saldo?.em_duvida ?? 0,
    disponivel: saldo?.disponivel ?? 0,
    reservadoPorFora: saldo?.reservado_por_fora ?? 0,
    carregando,
    pedidoCarregado: saldo !== null,
    erro,
    recarregar: () => void carregar(),
    solicitarEstorno,
    registrarPorForaAposEspera,
    enviando,
  };
}
