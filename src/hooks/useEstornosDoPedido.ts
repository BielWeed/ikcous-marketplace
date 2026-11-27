import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  chaveDaDevolucao,
  encerrarChaveDaDevolucao,
} from "@/lib/chave-da-devolucao";
import { mensagemDoErro } from "@/lib/devolucao";
import { numeroDoPedido } from "@/lib/numero-do-pedido";
import {
  PRAZO_DAS_ACOES_DO_PEDIDO_MS,
  aguardarComPrazo,
  ehConsultaSemResposta,
  erroDeConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
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
  /** A chave da intenção com que a linha nasceu (`solicitar_estorno_com_chave`,
   * 20261640000000); `null` nas das outras portas e nas de antes. Opcional só
   * para quem monta a linha à mão (o hook sempre a lê). */
  chave_da_solicitacao?: string | null;
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
  /** = `manual` do servidor: devolvido por FORA do Mercado Pago (reembolso
   * manual, saída dos 7 dias). `devolvido` NÃO o inclui. */
  manual: number;
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
    /** Id da linha falhada que este toque REPETE ("Tentar de novo"): o servidor
     * repete ESSA linha uma vez só e quem chega depois recebe a mesma repetição. */
    repetindo?: string;
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

/** Quanto a tela espera a leitura do saldo e do histórico antes de dizer que
 * não conseguiu ler (mesmo prazo da cotação do frete, 15 s). */
const PRAZO_DA_LEITURA_DO_ESTORNO_MS = 15_000;

/** Quanto a tela espera a edge `estornar-pagamento` (Mercado Pago por trás):
 * 30 s, o mesmo da devolução (`ReembolsoDaDevolucao`, `useDevolucoesAdmin`).
 * A RPC que cria a linha espera `PRAZO_DAS_ACOES_DO_PEDIDO_MS` (20 s). Os dois
 * só encerram a ESPERA DA TELA: o servidor pode ter gravado depois. */
const PRAZO_DA_EDGE_DO_ESTORNO_MS = 30_000;

/** Quantas releituras seguidas a tela tenta depois de uma ação antes de
 * desistir (cada uma tem o prazo de leitura). */
const RELEITURAS_ATE_VALER = 3;

const ERRO_GENERICO = "Não foi possível concluir agora. Tente de novo.";

/** Os avisos de `solicitarEstorno` são toasts GLOBAIS: se o lojista trocar de
 *  ficha antes da resposta, o aviso do pedido anterior apareceria sobre o
 *  aberto sem dizer de quem é. Por isso todos levam o número do pedido. */
const textoRegistradoCron = (numero: string) =>
  `Devolução do pedido #${numero} registrada; o Mercado Pago é acionado em até 10 minutos.`;
// A RPC que cria a linha não respondeu no prazo: ela PODE ter criado a linha
// (que o cron executa sozinho), então a frase não diz que falhou. O aviso sai
// ANTES de a lista ser relida: ele não afirma que ela já foi atualizada.
const textoSemResposta = (numero: string) =>
  `Devolução do pedido #${numero}: sem resposta da rede. Não dá para saber se a devolução foi registrada. Confira a lista de devoluções antes de tentar de novo.`;
// A mesma intenção chegou de novo e o servidor já a tinha registrado (a
// primeira tentativa chegou, a resposta é que se perdeu): nada novo foi pedido.
const textoJaRegistrada = (numero: string) =>
  `Pedido #${numero}: esta devolução já estava registrada (o primeiro envio chegou). Acompanhe a linha na lista.`;

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
 * `solicitarEstorno`, que grava o pedido no ledger (RPC
 * `solicitar_estorno_com_chave`, com a chave da intenção)
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
export function useEstornosDoPedido(
  orderId: string,
  status?: string,
  paymentStatus?: string | null,
): EstornosDoPedido {
  // "Foto" do pedido que importa para o saldo. Cancelar um pedido PAGO grava a
  // devolução total no banco na hora, com a ficha aberta: se o saldo só fosse
  // lido ao abrir, o cartão seguiria dizendo "Disponível R$ X" com o botão
  // ligado. Mudou o status ou o pagamento -> lê de novo.
  const fotoDoPedido = `${status ?? ""}|${paymentStatus ?? ""}`;
  const fotoDoPedidoRef = useRef(fotoDoPedido);
  fotoDoPedidoRef.current = fotoDoPedido;
  // Em que foto o saldo em tela foi pedido. Se a foto do pedido já é outra, o
  // saldo está velho: o cartão volta a "Carregando…" até a nova leitura.
  const [fotoDoSaldo, setFotoDoSaldo] = useState<string | null>(null);
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

  // Devolve se ESTA leitura chegou à tela (saldo novo ou o erro de leitura);
  // `false` = outra leitura passou na frente (ou a tela saiu) e esta foi
  // descartada.
  const carregar = useCallback(async (): Promise<boolean> => {
    const rodada = ++rodadaRef.current;
    const valeAinda = () => ativoRef.current && rodada === rodadaRef.current;
    const fotoDaLeitura = fotoDoPedidoRef.current;
    setCarregando(true);
    try {
      // Prazo: rede "pendurada" conecta e nao responde. Sem ele a leitura
      // nunca termina e o cartao fica em "Carregando…" sem erro e sem botao.
      // Estourou = erro de leitura (cai no `catch`: "Não consegui carregar" +
      // Tentar carregar de novo), NUNCA "sem devolucao" — sobre dinheiro,
      // "nao sei" nao vira zero.
      const [respostaLinhas, respostaSaldo] = await aguardarComPrazo(
        Promise.all([
          supabase
            .from("order_refunds")
            .select(
              "id, amount, status, solicitado_por, mp_status, mp_status_detail, tentativas, ultimo_erro, motivo, created_at, concluido_em, chave_da_solicitacao",
            )
            .eq("order_id", orderId)
            .order("created_at", { ascending: true }),
          chamarRpcDoR1(supabase, RPC_DO_REEMBOLSO_R1.saldo, {
            p_order_id: orderId,
          }),
        ]),
        PRAZO_DA_LEITURA_DO_ESTORNO_MS,
        () => erroDeConsultaSemResposta(),
      );

      if (!valeAinda()) return false;

      // Saldo ilegível é erro de leitura: um número de dinheiro de forma
      // inesperada não vai para a tela.
      const lido = respostaSaldo.error
        ? null
        : lerReembolsosESaldo(respostaSaldo.data);
      if (respostaLinhas.error || !lido) {
        setErro(true);
        return true;
      }

      setDetalhes((respostaLinhas.data ?? []) as unknown as DetalheDaLinha[]);
      setSaldo(lido);
      setFotoDoSaldo(fotoDaLeitura);
      setErro(false);
      return true;
    } catch {
      if (!valeAinda()) return false;
      setErro(true);
      return true;
    } finally {
      if (valeAinda()) setCarregando(false);
    }
  }, [orderId]);

  // Depois de uma ação de dinheiro, o botão só volta a valer com o estado REAL
  // na tela. Se outra leitura passa na frente (o relógio de 15 s, a volta da
  // aba), a desta é descartada e a tela seguiria com o saldo de ANTES do toque:
  // relê de novo. Nenhuma valeu: fica o erro de leitura, que esconde o botão
  // de devolver (uma leitura que chegue depois o troca pelo estado real).
  const relerAteValer = useCallback(async () => {
    for (let vez = 0; vez < RELEITURAS_ATE_VALER; vez++) {
      if (!ativoRef.current) return;
      if (await carregar()) return;
    }
    if (ativoRef.current) setErro(true);
  }, [carregar]);

  useEffect(() => {
    ativoRef.current = true;
    void carregar();
    return () => {
      ativoRef.current = false;
    };
  }, [carregar, fotoDoPedido]);

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
    const aoVoltarAba = () => {
      if (document.visibilityState === "visible") void carregar();
    };
    const id = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void carregar();
    }, INTERVALO_DE_RECARGA_MS);
    document.addEventListener("visibilitychange", aoVoltarAba);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", aoVoltarAba);
    };
  }, [temLinhaAtiva, carregar]);

  const solicitarEstorno = useCallback(
    async ({
      amount,
      motivo,
      repetindo,
    }: {
      amount: number;
      motivo: string;
      repetindo?: string;
    }) => {
      if (enviandoRef.current) return;
      enviandoRef.current = true;
      setEnviando(true);
      const numero = numeroDoPedido(orderId);
      // A chave da INTENÇÃO (pedido + valor), a mesma em toda retentativa dela — inclusive depois do
      // "não dá para saber", de reabrir a ficha ou de recarregar a página (20261640000000). O servidor
      // devolve a linha que já tem a chave em vez de criar outra. O "Tentar de novo" não leva chave: o
      // servidor já reconhece a linha falhada que se repete. Se a lista em tela JÁ mostra a linha da chave
      // guardada, a intenção chegou (a resposta é que se perdeu) e a lojista a vê: este toque é uma devolução
      // A MAIS e leva chave nova — repetir a velha faria o servidor responder "já registrada" e o cliente
      // deixaria de receber. Lista que ainda não a mostra = retentativa: repete a chave.
      const confirmadas = new Set<string>();
      for (const linha of linhasRef.current) {
        if (linha.chave_da_solicitacao) {
          confirmadas.add(linha.chave_da_solicitacao);
        }
      }
      const chave = repetindo
        ? null
        : chaveDaDevolucao(orderId, amount, Date.now(), confirmadas);
      // O servidor confirmou a intenção (linha criada ou já registrada): a próxima é intenção nova.
      const encerrarIntencao = (dados: unknown) => {
        if (
          chave &&
          (dados as { refund_id?: string } | null | undefined)?.refund_id
        ) {
          encerrarChaveDaDevolucao(orderId, amount, chave);
        }
      };
      try {
        // "Tentar de novo" manda o id da linha falhada: o servidor repete ESSA linha uma vez só (o valor sai
        // dela) e a segunda chamada (outra aba, outra pessoa da loja, o botão que sobrou depois do sucesso)
        // volta com `ja_repetida` e a MESMA repetição. A devolução nova vai com a chave da intenção: sem ela,
        // o servidor não sabe que o segundo toque de R$ 50 é o mesmo do primeiro e cria a segunda linha.
        const pedidoAoServidor = Promise.resolve(
          repetindo
            ? supabase.rpc("solicitar_estorno_repetindo", {
                p_refund_id: repetindo,
                p_motivo: motivo,
              })
            : supabase.rpc("solicitar_estorno_com_chave", {
                p_order_id: orderId,
                p_amount: amount,
                p_motivo: motivo,
                // Sem `repetindo`, a chave foi gerada acima.
                p_chave: chave as string,
              }),
        );
        let resposta: Awaited<typeof pedidoAoServidor>;
        try {
          resposta = await aguardarComPrazo(
            pedidoAoServidor,
            PRAZO_DAS_ACOES_DO_PEDIDO_MS,
            () => erroDeConsultaSemResposta(),
          );
        } catch (erroDaEspera) {
          if (!ehConsultaSemResposta(erroDaEspera)) throw erroDaEspera;
          // Estourou: a RPC PODE ter criado a linha (o cron
          // `reconciliar-pagamentos` a executa em até 10 minutos, com a mesma
          // chave de idempotência). A tela NÃO aciona o Mercado Pago (nem sabe
          // o id da linha) e nunca aplica a resposta tardia: avisa que não dá
          // para saber, relê, e só então o `finally` solta o botão — que volta
          // valendo o estado real, com a linha do estorno se ela existir.
          toast.warning(textoSemResposta(numero), { duration: 15_000 });
          await relerAteValer();
          // A resposta tardia só relê (registrada DEPOIS da releitura acima,
          // para nunca descartá-la e soltar o botão sobre o saldo antigo). Se
          // ela confirmar a linha, a intenção acabou: a próxima é nova. Sem
          // ela, a chave fica e o próximo toque de igual valor a repete.
          const reler = () => {
            if (ativoRef.current) void carregar();
          };
          void pedidoAoServidor.then((tardia) => {
            if (!tardia.error) encerrarIntencao(tardia.data);
            reler();
          }, reler);
          return;
        }
        const { data, error } = resposta;

        // A RPC já devolve mensagem leiga e ela passa como veio; só a falha de
        // rede, que o navegador entrega em inglês ("Failed to fetch"), vira frase.
        // A chave da intenção FICA: a recusa não gravou nada, e a falha de rede
        // pode ter gravado — o próximo toque de igual valor a repete.
        if (error) {
          toast.error(
            `Devolução do pedido #${numero}: ${mensagemDoErro(error, ERRO_GENERICO)}`,
          );
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

        // Já repetida por outra aba (ou outra pessoa): quem criou a repetição é quem aciona o Mercado Pago.
        // Aqui não há nada a enviar, só a lista a mostrar.
        const jaRepetida =
          (data as unknown as { ja_repetida?: boolean } | null)?.ja_repetida ===
          true;
        if (jaRepetida) {
          toast.info(
            `Pedido #${numero}: esta devolução já foi repetida (por outra aba ou por outra pessoa da loja). Acompanhe a linha mais nova.`,
          );
          await carregar();
          return;
        }

        encerrarIntencao(data);

        // A MESMA intenção já tinha chegado ao servidor (a tela desistiu de esperar e a lojista tocou de
        // novo): a linha é a da primeira, que o cron executa. Aqui não há nada a enviar, só a lista a mostrar.
        const jaRegistrada =
          (data as unknown as { ja_registrada?: boolean } | null)
            ?.ja_registrada === true;
        if (jaRegistrada) {
          toast.info(textoJaRegistrada(numero));
          await carregar();
          return;
        }

        // A linha já existe como `solicitado`. Se o `invoke` falhar agora,
        // NÃO é falha do pedido — o cron `reconciliar-pagamentos` (≤ 10 min)
        // a executa depois, com a mesma chave de idempotência.
        // Sem resposta no prazo é o mesmo caso: a linha existe e o cron a
        // executa (se a edge já a executou, a chave de idempotência segura).
        try {
          const { error: erroDoInvoke } = await aguardarComPrazo(
            Promise.resolve(
              supabase.functions.invoke("estornar-pagamento", {
                body: { refund_id: refundId },
              }),
            ),
            PRAZO_DA_EDGE_DO_ESTORNO_MS,
            () => erroDeConsultaSemResposta(),
          );
          if (erroDoInvoke) toast.info(textoRegistradoCron(numero));
        } catch {
          toast.info(textoRegistradoCron(numero));
        }

        await relerAteValer();
      } finally {
        enviandoRef.current = false;
        setEnviando(false);
      }
    },
    [orderId, carregar, relerAteValer],
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
          // A RPC fala com o leigo (mensagem da migration); rede vira frase.
          toast.error(
            `Devolução do pedido #${numero}: ${mensagemDoErro(error, ERRO_GENERICO)}`,
          );
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
    manual: saldo?.manual ?? 0,
    emCurso: saldo?.em_voo ?? 0,
    emDuvida: saldo?.em_duvida ?? 0,
    disponivel: saldo?.disponivel ?? 0,
    reservadoPorFora: saldo?.reservado_por_fora ?? 0,
    carregando,
    pedidoCarregado: saldo !== null && fotoDoSaldo === fotoDoPedido,
    erro,
    recarregar: () => void carregar(),
    solicitarEstorno,
    registrarPorForaAposEspera,
    enviando,
  };
}
