import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  corpoDoErroDaEdge,
  formatarReais,
  mensagemDoErro,
} from "@/lib/devolucao";
import {
  AVISO_DE_DOBRO,
  BOTAO_POR_FORA_APOS_ESPERA,
  type LinhaDoSaldo,
  RPC_DO_REEMBOLSO_R1,
  TEXTO_CONFIRMANDO,
  TEXTO_JA_POR_FORA,
  acoesDaLinha,
  chamarRpcDoR1,
  confirmouPorForaAposEspera,
  lerReembolsosESaldo,
  lerSaidaAposEspera,
  linhaViva,
  parametrosPorForaAposEspera,
  textoReservado,
} from "@/lib/reembolso-em-duvida";
import { supabase } from "@/lib/supabase";
import type { DevolucaoDetalhe } from "@/types/devolucao";

import { BOTAO_SECUNDARIO } from "./AcoesDaDevolucao";

const ERRO = "Não foi possível concluir agora. Tente de novo.";
const MUDOU = "A devolução mudou. Os dados foram atualizados.";

/**
 * Aviso de cada `resultado` da reemissão (edge `estornar-pagamento`, ação
 * `reemitir`) e do "por fora" (RPC `admin_devolucao_reembolso_por_fora`) —
 * contrato da migration 20261226. `ja_existia`, `ja_concluido`,
 * `em_andamento` e `reembolso_mudou` = a devolução mudou; a ficha relê.
 * Sem `resultado` = erro (mensagem da edge, ou a genérica).
 */
const AVISOS = new Map<string, () => unknown>([
  [
    "reemitido",
    () => toast.success("Reembolso pedido de novo ao Mercado Pago."),
  ],
  [
    "use_por_fora",
    () =>
      toast.warning(
        "O Mercado Pago não aceita refazer. Devolva por PIX ou dinheiro e toque em “Já devolvi por fora”.",
      ),
  ],
  [
    "sem_saldo_para_reemitir",
    () => toast.error("O pedido não tem saldo para refazer."),
  ],
  [
    "indeterminado",
    () =>
      toast.warning(
        "O Mercado Pago não confirmou. Nada foi feito; tente mais tarde.",
      ),
  ],
  [
    "combinado",
    () =>
      toast.success(
        "Registrado como devolvido por fora. O cliente foi avisado.",
      ),
  ],
]);

/** Avisa o resultado; devolve o corpo quando ele é um objeto. */
function avisar(corpo: unknown): Record<string, unknown> {
  const c =
    typeof corpo === "object" && corpo !== null
      ? (corpo as Record<string, unknown>)
      : {};
  const aviso = AVISOS.get(String(c.resultado));
  if (aviso) aviso();
  else if (typeof c.resultado === "string") toast.info(MUDOU);
  else toast.error(typeof c.erro === "string" ? c.erro : ERRO);
  if (c.risco_de_dobro === true) toast.warning(AVISO_DE_DOBRO);
  return c;
}

/**
 * Lote R1 (15/10/2026): o reembolso de uma devolução concluída que NÃO se
 * resolveu sozinho. Antes não existia botão nenhum aqui — o servidor já
 * sabia reemitir e registrar "devolvido por fora", mas a tela não chamava.
 *
 * Os botões seguem o veredito do SERVIDOR (`pedido_reembolsos_e_saldo`):
 * linha parada em que nada saiu → "Tentar de novo" e "Já devolvi por fora";
 * linha que PODE ter saído → só "não repita"; e, quando o servidor libera,
 * a saída dos 7 dias com confirmação forte.
 */
export function ReembolsoDaDevolucao({
  detalhe,
  aoMudar,
}: Readonly<{ detalhe: DevolucaoDetalhe; aoMudar: () => void }>) {
  const { id, order_id, refund_id } = detalhe;
  const ativo =
    detalhe.status === "concluida" &&
    detalhe.resolucao_final === "reembolso" &&
    !detalhe.reembolso_manual &&
    refund_id !== null;

  const [linha, setLinha] = useState<LinhaDoSaldo | null>(null);
  const [erro, setErro] = useState(false);
  const [emVoo, setEmVoo] = useState(false);
  const emVooRef = useRef(false);
  const rodadaRef = useRef(0);

  const carregar = useCallback(async () => {
    if (!ativo) return;
    const rodada = ++rodadaRef.current;
    let desta: LinhaDoSaldo | null = null;
    try {
      const { data, error } = await chamarRpcDoR1(
        supabase,
        RPC_DO_REEMBOLSO_R1.saldo,
        { p_order_id: order_id },
      );
      if (!error) {
        desta =
          lerReembolsosESaldo(data)?.linhas.find((l) => l.id === refund_id) ??
          null;
      }
    } catch {
      // Sem leitura: erro honesto abaixo.
    }
    if (rodada !== rodadaRef.current) return;
    setLinha(desta);
    setErro(desta === null);
  }, [ativo, order_id, refund_id]);

  // Relê sempre que a ficha relê (objeto `detalhe` novo).
  useEffect(() => {
    void carregar();
  }, [carregar, detalhe]);

  if (!ativo) return null;

  async function executar(passo: () => Promise<unknown>): Promise<boolean> {
    if (emVooRef.current) return false;
    emVooRef.current = true;
    setEmVoo(true);
    try {
      return (await passo()) === true;
    } catch (e) {
      toast.error(mensagemDoErro(e, ERRO));
      return false;
    } finally {
      emVooRef.current = false;
      setEmVoo(false);
      // A ficha relê, e o `detalhe` novo relê este bloco.
      aoMudar();
    }
  }

  if (erro) {
    return (
      <p className="text-xs font-bold text-zinc-300">
        Não consegui ler o reembolso desta devolução. Toque em atualizar, no
        topo.
      </p>
    );
  }

  // Ainda lendo, ou dinheiro já confirmado: nada a decidir aqui.
  if (!linha || linha.status === "concluido") return null;

  const valor = formatarReais(linha.amount);
  const { podeRepetir, confirmando, porForaAposEspera, jaPorFora, reservada } =
    acoesDaLinha(linha);

  const tentarDeNovo = () =>
    globalThis.confirm(
      `Pedir de novo ao Mercado Pago o reembolso de ${valor}? O app confere antes se o anterior não saiu.`,
    ) &&
    executar(async () => {
      const { data, error } = await supabase.functions.invoke(
        "estornar-pagamento",
        {
          body: {
            acao: "reemitir",
            devolucao_id: id,
            refund_esperado: linha.id,
          },
        },
      );
      const c = avisar(error ? await corpoDoErroDaEdge(error) : data);
      if (c.resultado !== "reemitido") return false;
      // A tentativa nova nasce `solicitado`; o clique a executa (o mesmo
      // caminho do EstornoCard). Falhar aqui não é falha: o cron
      // `reconciliar-pagamentos` a executa em até 10 minutos.
      await supabase.functions
        .invoke("estornar-pagamento", { body: { refund_id: c.refund_id } })
        .catch(() => null);
      return true;
    });

  const porFora = () =>
    globalThis.confirm(
      `Registrar que você devolveu ${valor} por fora (PIX ou dinheiro)? O app não pede mais este reembolso ao Mercado Pago.`,
    ) &&
    executar(async () => {
      const { data, error } = await supabase.rpc(
        RPC_DO_REEMBOLSO_R1.porForaDaDevolucao,
        { p_devolucao_id: id, p_refund_esperado: linha.id },
      );
      if (error) throw error;
      return avisar(data).resultado === "combinado";
    });

  const porForaAposEspera7 = () =>
    confirmouPorForaAposEspera(valor) &&
    executar(async () => {
      const { data, error } = await chamarRpcDoR1(
        supabase,
        RPC_DO_REEMBOLSO_R1.porForaAposEsperaDaDevolucao,
        parametrosPorForaAposEspera.devolucao(id, linha.id),
      );
      if (error) throw error;
      // Recusa do servidor vem SEM erro (`resultado` no jsonb).
      const saida = lerSaidaAposEspera(data);
      if (!saida.gravou) {
        toast.info(saida.aviso);
        return false;
      }
      // Linha ainda viva no MP: o servidor passa a mantê-la reservada.
      const reserva = linhaViva(linha.status)
        ? ` O app mantém ${textoReservado(valor)}`
        : "";
      toast.warning(
        `Registrado como devolvido por fora.${reserva} ${AVISO_DE_DOBRO}`,
      );
      return true;
    });

  return (
    <section
      className="admin-glass space-y-3 rounded-2xl border border-white/5 p-4"
      data-testid="reembolso-da-devolucao"
    >
      <p className="text-xs font-bold text-zinc-200">
        {jaPorFora
          ? reservada
            ? `${TEXTO_JA_POR_FORA} ${textoReservado(valor)}`
            : TEXTO_JA_POR_FORA
          : podeRepetir
            ? `O reembolso de ${valor} não foi concluído pelo Mercado Pago.`
            : confirmando
              ? `O reembolso de ${valor} não teve resposta certa do Mercado Pago. ${TEXTO_CONFIRMANDO}`
              : `Reembolso de ${valor} em andamento no Mercado Pago.`}
      </p>
      {podeRepetir && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={emVoo}
            onClick={() => void tentarDeNovo()}
            className={BOTAO_SECUNDARIO}
          >
            Tentar de novo
          </button>
          <button
            type="button"
            disabled={emVoo}
            onClick={() => void porFora()}
            className={BOTAO_SECUNDARIO}
          >
            Já devolvi por fora
          </button>
        </div>
      )}
      {porForaAposEspera && (
        <button
          type="button"
          disabled={emVoo}
          onClick={() => void porForaAposEspera7()}
          className={BOTAO_SECUNDARIO}
        >
          {BOTAO_POR_FORA_APOS_ESPERA}
        </button>
      )}
    </section>
  );
}
