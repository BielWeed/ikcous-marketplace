import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmacaoPorForaAposEspera } from "@/components/admin/ConfirmacaoPorForaAposEspera";
import {
  corpoDoErroDaEdge,
  formatarReais,
  mensagemDoErro,
} from "@/lib/devolucao";
import {
  AVISO_DE_DOBRO,
  type LinhaDoSaldo,
  RPC_DO_REEMBOLSO_R1,
  TEXTO_CONFIRMANDO,
  acoesDaLinha,
  chamarRpcDoR1,
  lerReembolsosESaldo,
  parametrosPorForaAposEspera,
} from "@/lib/reembolso-em-duvida";
import { supabase } from "@/lib/supabase";
import type { DevolucaoDetalhe } from "@/types/devolucao";

import { BOTAO_SECUNDARIO } from "./AcoesDaDevolucao";

const SECAO =
  "admin-glass space-y-3 rounded-2xl border border-white/5 p-4 shadow-2xl sm:p-6";

const ERRO_GENERICO = "Não foi possível concluir agora. Tente de novo.";

type Acao = "reemitir" | "por_fora" | "por_fora_apos_espera";

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Aviso de cada `resultado` da reemissão/"por fora" (contrato da 20261226). */
function avisarResultado(resultado: string, corpo: Record<string, unknown>) {
  switch (resultado) {
    case "ja_existia":
      toast.success(
        "O Mercado Pago já tinha feito esta devolução: ela ficou registrada como paga.",
      );
      return;
    case "ja_concluido":
      toast.info("Esta devolução já estava resolvida.");
      return;
    case "em_andamento":
      toast.info(
        "Já existe uma devolução em andamento no Mercado Pago. Aguarde a resposta.",
      );
      return;
    case "reembolso_mudou":
      toast.info(
        "Esta devolução mudou enquanto a tela estava aberta. Os dados foram atualizados.",
      );
      return;
    case "use_por_fora":
      toast.warning(
        "O Mercado Pago não aceita refazer esta devolução pelo app. Devolva ao cliente por PIX ou em dinheiro e toque em “Já devolvi por fora”.",
        { duration: 12_000 },
      );
      return;
    case "sem_saldo_para_reemitir":
      toast.error("O pedido não tem saldo para refazer esta devolução.");
      return;
    case "indeterminado":
      toast.warning(
        "Não deu para confirmar com o Mercado Pago agora. Nada foi feito; tente de novo mais tarde.",
        { duration: 12_000 },
      );
      return;
    case "combinado":
      toast.success(
        "Registrado: o reembolso foi devolvido por fora. O cliente foi avisado.",
      );
      if (corpo.risco_de_dobro === true) {
        toast.warning(AVISO_DE_DOBRO, { duration: 15_000 });
      }
      return;
    default:
      toast.error(ERRO_GENERICO);
  }
}

/**
 * Lote R1 (15/10/2026): o reembolso de uma devolução concluída que NÃO se
 * resolveu sozinho. Antes não existia botão nenhum aqui — o servidor já
 * sabia reemitir e registrar "devolvido por fora", mas a tela não chamava.
 *
 * Os botões seguem o veredito do SERVIDOR (`pedido_reembolsos_e_saldo`):
 * linha parada que nada saiu → "Tentar de novo" e "Já devolvi por fora";
 * linha que PODE ter saído → só "não repita"; e, quando o servidor libera,
 * a saída dos 7 dias com confirmação forte.
 */
export function ReembolsoDaDevolucao({
  detalhe,
  aoMudar,
}: Readonly<{ detalhe: DevolucaoDetalhe; aoMudar: () => void }>) {
  const refundId = detalhe.refund_id;
  const deveMostrar =
    detalhe.status === "concluida" &&
    detalhe.resolucao_final === "reembolso" &&
    !detalhe.reembolso_manual &&
    refundId !== null;

  const [linha, setLinha] = useState<LinhaDoSaldo | null>(null);
  const [erro, setErro] = useState(false);
  const [emVoo, setEmVoo] = useState<Acao | null>(null);
  const emVooRef = useRef(false);
  const rodadaRef = useRef(0);

  const carregar = useCallback(async () => {
    if (!deveMostrar) return;
    const rodada = ++rodadaRef.current;
    try {
      const { data, error } = await chamarRpcDoR1(
        supabase,
        RPC_DO_REEMBOLSO_R1.saldo,
        { p_order_id: detalhe.order_id },
      );
      if (rodada !== rodadaRef.current) return;
      const lido = error ? null : lerReembolsosESaldo(data);
      const desta = lido?.linhas.find((l) => l.id === refundId) ?? null;
      setLinha(desta);
      setErro(desta === null);
    } catch {
      if (rodada === rodadaRef.current) setErro(true);
    }
  }, [deveMostrar, detalhe.order_id, refundId]);

  // Relê sempre que a ficha relê (objeto `detalhe` novo).
  useEffect(() => {
    void carregar();
  }, [carregar, detalhe]);

  if (!deveMostrar || refundId === null) return null;

  async function executar(qual: Acao, passo: () => Promise<boolean>) {
    if (emVooRef.current) return false;
    emVooRef.current = true;
    setEmVoo(qual);
    try {
      return await passo();
    } catch (e) {
      toast.error(mensagemDoErro(e, ERRO_GENERICO));
      return false;
    } finally {
      emVooRef.current = false;
      setEmVoo(null);
      await carregar();
      aoMudar();
    }
  }

  const valor = formatarReais(linha?.amount ?? detalhe.valor_reembolso ?? 0);

  async function tentarDeNovo(esperado: string) {
    const ok = globalThis.confirm(
      `Pedir de novo ao Mercado Pago o reembolso de ${valor}? O app confere antes se a devolução anterior não saiu.`,
    );
    if (!ok) return;
    await executar("reemitir", async () => {
      const { data, error } = await supabase.functions.invoke(
        "estornar-pagamento",
        {
          body: {
            acao: "reemitir",
            devolucao_id: detalhe.id,
            refund_esperado: esperado,
          },
        },
      );
      const corpo = error ? await corpoDoErroDaEdge(error) : data;
      const resultado =
        ehObjeto(corpo) && typeof corpo.resultado === "string"
          ? corpo.resultado
          : null;
      if (!ehObjeto(corpo) || resultado === null) {
        toast.error(
          ehObjeto(corpo) && typeof corpo.erro === "string"
            ? corpo.erro
            : ERRO_GENERICO,
        );
        return false;
      }
      if (resultado !== "reemitido") {
        avisarResultado(resultado, corpo);
        return false;
      }
      // A tentativa nova nasce `solicitado`: o clique a executa (a mesma
      // ação do EstornoCard). Falhar aqui não é falha: o cron a pega.
      const novo = typeof corpo.refund_id === "string" ? corpo.refund_id : "";
      try {
        const { error: erroDoEnvio } = novo
          ? await supabase.functions.invoke("estornar-pagamento", {
              body: { refund_id: novo },
            })
          : { error: true };
        if (erroDoEnvio) {
          toast.info(
            "Reembolso registrado de novo; o Mercado Pago é acionado em até 10 minutos.",
          );
        } else {
          toast.success(
            `Reembolso de ${valor} pedido de novo ao Mercado Pago.`,
          );
        }
      } catch {
        toast.info(
          "Reembolso registrado de novo; o Mercado Pago é acionado em até 10 minutos.",
        );
      }
      return true;
    });
  }

  async function porFora(esperado: string) {
    const ok = globalThis.confirm(
      `Registrar que você devolveu ${valor} ao cliente por fora (PIX ou dinheiro)? O app não vai mais pedir este reembolso ao Mercado Pago.`,
    );
    if (!ok) return;
    await executar("por_fora", async () => {
      const { data, error } = await supabase.rpc(
        RPC_DO_REEMBOLSO_R1.porForaDaDevolucao,
        { p_devolucao_id: detalhe.id, p_refund_esperado: esperado },
      );
      if (error) {
        toast.error(mensagemDoErro(error, ERRO_GENERICO));
        return false;
      }
      const corpo = ehObjeto(data) ? data : {};
      avisarResultado(
        typeof corpo.resultado === "string" ? corpo.resultado : "",
        corpo,
      );
      return corpo.resultado === "combinado";
    });
  }

  function porForaAposEspera(esperado: string) {
    return executar("por_fora_apos_espera", async () => {
      const { error } = await chamarRpcDoR1(
        supabase,
        RPC_DO_REEMBOLSO_R1.porForaAposEsperaDaDevolucao,
        parametrosPorForaAposEspera.devolucao(detalhe.id, esperado),
      );
      if (error) {
        toast.error(mensagemDoErro(error, ERRO_GENERICO));
        return false;
      }
      toast.warning(
        `Registrado que você devolveu ${valor} por fora. ${AVISO_DE_DOBRO} Confira no painel do Mercado Pago.`,
        { duration: 15_000 },
      );
      return true;
    });
  }

  if (erro) {
    return (
      <section className={SECAO} data-testid="reembolso-da-devolucao">
        <p className="text-xs font-bold text-zinc-300">
          Não consegui ler o reembolso desta devolução.
        </p>
        <button
          type="button"
          onClick={() => void carregar()}
          className={BOTAO_SECUNDARIO}
        >
          Atualizar
        </button>
      </section>
    );
  }

  // Ainda lendo, ou dinheiro já confirmado: nada a decidir aqui.
  if (!linha || linha.status === "concluido") return null;

  const {
    podeRepetir,
    confirmando,
    porForaAposEspera: liberado,
  } = acoesDaLinha(linha);
  const emAndamento =
    linha.status === "solicitado" || linha.status === "em_processamento";

  return (
    <section className={SECAO} data-testid="reembolso-da-devolucao">
      <p className="text-xs font-bold leading-relaxed text-zinc-200">
        {emAndamento && `Reembolso de ${valor} em andamento no Mercado Pago.`}
        {podeRepetir &&
          `O reembolso de ${valor} não foi concluído pelo Mercado Pago.`}
        {confirmando &&
          `O reembolso de ${valor} não teve resposta certa do Mercado Pago. ${TEXTO_CONFIRMANDO}`}
      </p>
      {podeRepetir && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={emVoo !== null}
            onClick={() => void tentarDeNovo(linha.id)}
            className={BOTAO_SECUNDARIO}
          >
            {emVoo === "reemitir" ? "Pedindo…" : "Tentar de novo"}
          </button>
          <button
            type="button"
            disabled={emVoo !== null}
            onClick={() => void porFora(linha.id)}
            className={BOTAO_SECUNDARIO}
          >
            Já devolvi por fora
          </button>
        </div>
      )}
      {liberado && (
        <ConfirmacaoPorForaAposEspera
          idBase={`por-fora-devolucao-${detalhe.id}`}
          enviando={emVoo !== null}
          onConfirmar={() => porForaAposEspera(linha.id)}
        />
      )}
    </section>
  );
}
