// "Anular venda do balcão" (frente A, fase 5 — resposta do dono de 28/09:
// só no mesmo dia e com motivo obrigatório). Quem decide de verdade é a RPC
// `anular_venda_presencial` (migration 20261185000000): esta peça só pede o
// motivo, chama `aoAnular` e mostra o que aconteceu. Usada no recibo da tela
// Vender e na ficha do pedido.

import { Button } from "@/components/ui/button";
import { Ban, CheckCircle2 } from "lucide-react";
import { type ReactElement, useId, useState } from "react";

export interface PropsDoAnularVendaDoBalcao {
  readonly total: number;
  readonly formaEmDinheiro: boolean;
  /** Chama a RPC; lança com a frase do banco em caso de recusa. */
  readonly aoAnular: (motivo: string) => Promise<void>;
  readonly aoConcluir?: () => void;
}

function reais(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function frase(erro: unknown): string {
  const mensagem =
    typeof erro === "object" && erro !== null && "message" in erro
      ? (erro as { message: unknown }).message
      : null;
  return typeof mensagem === "string" && mensagem.trim() !== ""
    ? mensagem
    : "Não consegui anular agora. Tente de novo.";
}

export function AnularVendaDoBalcao({
  total,
  formaEmDinheiro,
  aoAnular,
  aoConcluir,
}: PropsDoAnularVendaDoBalcao): ReactElement {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [anulada, setAnulada] = useState(false);
  const idMotivo = useId();

  if (anulada) {
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-xl border border-emerald-800/50 bg-emerald-950/30 p-3 text-sm text-emerald-200"
      >
        <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        Venda anulada: o estoque voltou e o Financeiro já descontou.{" "}
        {formaEmDinheiro
          ? `Devolva R$ ${reais(total)} ao cliente.`
          : `Devolva R$ ${reais(total)} ao cliente pela mesma forma em que ele pagou.`}
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
    if (motivo.trim() === "" || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await aoAnular(motivo.trim());
      setAnulada(true);
      aoConcluir?.();
    } catch (e) {
      setErro(frase(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-red-900/60 bg-red-950/20 p-3">
      <p className="text-sm font-semibold text-red-200">
        Anular esta venda de R$ {reais(total)}?
      </p>
      <p className="text-xs text-zinc-400">
        Só no mesmo dia. O estoque volta, e o Financeiro e o caixa descontam o
        valor. Use para engano no caixa ou desistência na hora.
      </p>
      <label htmlFor={idMotivo} className="text-xs font-semibold text-zinc-400">
        Motivo (obrigatório)
      </label>
      <textarea
        id={idMotivo}
        value={motivo}
        maxLength={500}
        rows={2}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Ex.: forma de pagamento errada, cliente desistiu"
        className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-zinc-500"
      />
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
          onClick={() => setAberto(false)}
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
