import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FUSO_DA_LOJA } from "@/lib/data-da-loja";
import { formatarReais, mensagemDoErro } from "@/lib/devolucao";
import {
  PRAZO_DAS_ACOES_DO_PEDIDO_MS,
  aguardarComPrazo,
  ehConexaoCaiuSemResposta,
  ehConsultaSemResposta,
  erroDeConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
import type { PossivelReembolsoEmDobro } from "@/lib/reembolso-em-duvida";

const diaMes = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: FUSO_DA_LOJA,
});

const ORIENTACAO = "Fale com o cliente para combinar a devolução da diferença.";
const ERRO = "Não foi possível registrar a conferência do reembolso.";

export function AvisoDeReembolsoEmDobro({
  aviso,
  pedidoId,
  aoMudar,
  isOffline = false,
}: Readonly<{
  aviso: PossivelReembolsoEmDobro;
  pedidoId: string;
  aoMudar: () => void;
  isOffline?: boolean;
}>) {
  const [escolha, setEscolha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [conferido, setConferido] = useState(false);
  const aguardando = useRef(false);
  const porFora =
    aviso.candidatos.length === 1
      ? aviso.candidatos[0]
      : aviso.candidatos.find((d) => d.id === escolha);
  const ehB = aviso.caminho === "B";
  const data = aviso.por_fora_em ?? porFora?.registrado_em;
  const dia = data ? diaMes.format(new Date(data)) : null;
  const valorMp = formatarReais(aviso.valor_mp);
  const valorManual = porFora ? formatarReais(porFora.valor) : null;
  const titulo = ehB
    ? "O reembolso pelo Mercado Pago foi concluído depois do seu PIX"
    : "O Mercado Pago avisou um reembolso depois do seu PIX";

  async function conferir(mesmo: boolean) {
    if (aguardando.current || conferido || isOffline || (mesmo && !porFora))
      return;
    aguardando.current = true;
    setEnviando(true);
    try {
      const { supabase } = await import("@/lib/supabase");
      const operacao =
        mesmo && porFora
          ? supabase.rpc("admin_devolucao_confirmar_mesmo_dinheiro", {
              p_devolucao_id: porFora.id,
              p_refund_id: aviso.refund_id,
            })
          : supabase.rpc("admin_devolucao_confirmar_dois_reembolsos", {
              p_order_id: pedidoId,
              p_refund_id: aviso.refund_id,
            });
      const { data, error } = await aguardarComPrazo(
        Promise.resolve(operacao),
        PRAZO_DAS_ACOES_DO_PEDIDO_MS,
        () => erroDeConsultaSemResposta(),
      );
      if (error) throw error;
      if (
        !data ||
        typeof data !== "object" ||
        !("resultado" in data) ||
        data.resultado !== "confirmado"
      )
        throw new Error(ERRO);
      setConferido(true);
      if (mesmo) toast.success("Conferência registrada: foi o mesmo dinheiro.");
      else toast.info(ORIENTACAO);
    } catch (erro) {
      if (ehConsultaSemResposta(erro) || ehConexaoCaiuSemResposta(erro)) {
        toast.warning(
          "Sem resposta da rede. Confira se o aviso ainda aparece antes de tentar de novo.",
        );
      } else {
        toast.error(mensagemDoErro(erro, ERRO));
      }
    } finally {
      aguardando.current = false;
      setEnviando(false);
      aoMudar();
    }
  }

  if (conferido) return null;

  const mesmos = ehB
    ? "Foi o mesmo dinheiro (eu devolvi pelo Mercado Pago, não por PIX)"
    : "Sim, foi o mesmo dinheiro";
  const dois = ehB
    ? "O cliente recebeu duas vezes"
    : "Não, o cliente recebeu duas vezes";
  const respostas = ehB ? [false, true] : [true, false];

  return (
    <div className="space-y-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
      <p className="font-bold">{titulo}</p>
      {ehB ? (
        <p>
          {dia ? `Em ${dia} você registrou` : "Você registrou"}{" "}
          {valorManual
            ? `${valorManual} devolvido por fora (PIX ou dinheiro)`
            : "um reembolso por fora (PIX ou dinheiro)"}
          , porque o Mercado Pago não respondia.
          {` Depois disso, o Mercado Pago concluiu o reembolso de ${valorMp} que o app tinha pedido. O cliente provavelmente recebeu duas vezes.`}
        </p>
      ) : (
        <p>
          {dia && valorManual
            ? `Você registrou ${valorManual} devolvido por fora (PIX ou dinheiro) em ${dia}. `
            : "Você registrou um reembolso por fora (PIX ou dinheiro). "}
          {`Depois disso, o Mercado Pago avisou um reembolso de ${valorMp} neste pedido. Foi o mesmo dinheiro?`}
        </p>
      )}
      {aviso.candidatos.length > 1 && (
        <label className="block">
          Devolução registrada por fora
          <select
            value={escolha}
            onChange={(e) => setEscolha(e.currentTarget.value)}
            disabled={enviando || isOffline}
            className="mt-1 block min-h-10 w-full rounded-md border border-admin-border bg-admin-surface px-2 text-white"
          >
            <option value="">Escolha a devolução</option>
            {aviso.candidatos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.protocolo} · {formatarReais(d.valor)} ·{" "}
                {diaMes.format(new Date(d.registrado_em))}
              </option>
            ))}
          </select>
        </label>
      )}
      {aviso.candidatos.length === 0 && (
        <p>
          Não dá para ligar este reembolso a uma devolução específica com
          segurança.
        </p>
      )}
      {porFora && porFora.valor !== aviso.valor_mp && (
        <p>
          Os valores são diferentes. Confirme como o mesmo dinheiro só se um
          valor já estiver incluído no outro.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {respostas.map((mesmo, i) => (
          <Button
            key={mesmo ? "mesmo" : "dois"}
            type="button"
            size="sm"
            variant={i === 0 ? "default" : "outline"}
            className="h-auto min-h-10 whitespace-normal"
            disabled={enviando || isOffline || (mesmo && !porFora)}
            onClick={() => void conferir(mesmo)}
          >
            {mesmo ? mesmos : dois}
          </Button>
        ))}
      </div>
    </div>
  );
}
