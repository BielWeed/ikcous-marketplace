// "Anular venda do balcão" — só no mesmo dia e com motivo obrigatório (decisão
// do dono, 08/10/2026). Quem decide de verdade é a RPC `anular_venda_presencial`
// (migration 20261204000000): esta peça só pergunta, pede o motivo, chama
// `aoAnular` e conta o que aconteceu. Usada no recibo da tela Vender e na
// ficha do pedido.
//
// Não chama Supabase: o chamador entrega `aoAnular` (hook
// `useAnularVendaDoBalcao`). A confirmação é um passo à parte: o primeiro
// botão só ABRE a pergunta ("Anular esta venda de R$ X?" com o que acontece);
// a venda só é anulada no segundo, "Confirmar anulação", com o motivo escrito.

import { Button } from "@/components/ui/button";
import type { ResultadoDaAnulacao } from "@/hooks/useAnularVendaDoBalcao";
import {
  MOTIVO_MAXIMO_DA_ANULACAO,
  mensagemDaFalhaDaAnulacao,
  orientacaoDeDevolucao,
} from "@/lib/anulacao-do-balcao";
import { formatCurrency } from "@/lib/utils";
import { Ban, CheckCircle2 } from "lucide-react";
import { type ReactElement, useId, useRef, useState } from "react";

interface PropsDoAnularVendaDoBalcao {
  readonly total: number;
  /** `cash` | `pix` | `card`: decide a frase de "como devolver". */
  readonly forma: string;
  /** Venda ligada a uma conta de cliente: ela pode ver o motivo no app. */
  readonly clienteComConta?: boolean;
  /** Chama a RPC; lança o erro CRU em caso de recusa (a tela traduz). */
  readonly aoAnular: (motivo: string) => Promise<ResultadoDaAnulacao>;
  readonly aoConcluir?: (resultado: ResultadoDaAnulacao) => void;
}

export function AnularVendaDoBalcao({
  total,
  forma,
  clienteComConta = false,
  aoAnular,
  aoConcluir,
}: PropsDoAnularVendaDoBalcao): ReactElement {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoDaAnulacao | null>(null);
  // O estado `enviando` só vale no próximo render: dois cliques rápidos
  // passariam os dois. O ref fecha a porta no mesmo instante.
  const emVoo = useRef(false);
  const idMotivo = useId();

  if (resultado) {
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-xl border border-emerald-800/50 bg-emerald-950/30 p-3 text-sm text-emerald-200"
      >
        <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {resultado.jaAnulada ? (
          <span>Esta venda já estava anulada. Nada foi mexido de novo.</span>
        ) : (
          <span>
            Venda anulada: o estoque voltou e o Financeiro já descontou. O app
            não devolve o dinheiro. {orientacaoDeDevolucao(forma, total)}
          </span>
        )}
      </p>
    );
  }

  if (!aberto) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setAberto(true)}
        className="border-red-900/60 text-red-300 hover:bg-red-950/40"
      >
        <Ban aria-hidden="true" className="mr-1.5 size-4" />
        Anular venda
      </Button>
    );
  }

  async function confirmar(): Promise<void> {
    const texto = motivo.trim();
    if (texto === "" || emVoo.current) return;
    emVoo.current = true;
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await aoAnular(texto);
      setResultado(resposta);
      aoConcluir?.(resposta);
    } catch (e) {
      setErro(mensagemDaFalhaDaAnulacao(e));
    } finally {
      emVoo.current = false;
      setEnviando(false);
    }
  }

  return (
    <div
      role="group"
      aria-label="Anular venda"
      className="flex flex-col gap-2 rounded-xl border border-red-900/60 bg-red-950/20 p-3"
    >
      <p className="text-sm font-semibold text-red-200">
        Anular esta venda de {formatCurrency(total)}?
      </p>
      <p className="text-xs text-zinc-400">
        Só vale no mesmo dia. O estoque volta e o Financeiro e o caixa descontam
        o valor. O app não devolve o dinheiro ao cliente: isso você faz na mão.
        Use para engano no caixa ou desistência na hora.
      </p>
      <label htmlFor={idMotivo} className="text-xs font-semibold text-zinc-400">
        Motivo (obrigatório)
      </label>
      <textarea
        id={idMotivo}
        value={motivo}
        maxLength={MOTIVO_MAXIMO_DA_ANULACAO}
        rows={2}
        disabled={enviando}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Ex.: forma de pagamento errada, cliente desistiu"
        className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-zinc-500"
      />
      {clienteComConta && (
        <p className="text-xs text-amber-300">
          Esta venda está na conta de um cliente: ele pode ler o motivo no
          histórico do pedido. Escreva algo que possa ser lido por ele.
        </p>
      )}
      {erro && (
        <p role="alert" className="text-xs text-red-400">
          {erro}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={enviando}
          onClick={() => {
            setAberto(false);
            setErro(null);
          }}
        >
          Voltar
        </Button>
        <Button
          type="button"
          className="flex-1 bg-red-700 text-white hover:bg-red-600"
          disabled={motivo.trim() === "" || enviando}
          onClick={() => void confirmar()}
        >
          {enviando ? "Anulando…" : "Confirmar anulação"}
        </Button>
      </div>
    </div>
  );
}
