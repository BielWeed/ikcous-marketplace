import { AvisoDeCaixaFechado } from "@/components/admin/pdv/AvisoDeCaixaFechado";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useVoltarFechaAFolha } from "@/hooks/useVoltarFechaAFolha";
import { momentoDoPagamentoNaMao } from "@/lib/forma-de-pagamento";
import type { SituacaoDoCaixa } from "@/types/financeiro";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const FOCO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300";
// A cor do texto fica FORA da base: o tema remapeia `.text-zinc-100` e esse remapeado
// ganharia do texto escuro do dourado, que o botão principal não pode herdar.
const BASE_DO_BOTAO = `relative z-10 flex min-h-11 items-center justify-center gap-2 whitespace-normal rounded-2xl border border-admin-border bg-admin-raised px-3 py-2 text-sm font-semibold hover:bg-admin-hover disabled:cursor-not-allowed disabled:text-zinc-400 ${FOCO}`;
const SECUNDARIO = `${BASE_DO_BOTAO} text-zinc-100`;
const PRINCIPAL = `${BASE_DO_BOTAO} min-h-14 border-[#F6D365]/50 bg-gradient-to-b from-[#F6D365] to-[#E4AD18] text-[#211A05] hover:brightness-105`;

interface PerguntaProps {
  total: number;
  disabled?: boolean;
  /** Retirada na loja: a pergunta fala em "retirada", não em "entrega". */
  retiradaNaLoja?: boolean | null;
  aoCancelar: () => void;
  aoConfirmar: () => void;
}

/** A lista e a ficha fazem a mesma pergunta antes de registrar dinheiro. */
export function PerguntaDoRecebimento({
  total,
  disabled,
  retiradaNaLoja,
  aoCancelar,
  aoConfirmar,
}: Readonly<PerguntaProps>) {
  return (
    <>
      <h3 className="text-lg font-bold">
        Recebeu os R${" "}
        {total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} deste
        pedido?
      </h3>
      <p className="rounded-2xl border border-emerald-300/15 bg-emerald-300/10 p-4 text-sm leading-relaxed text-emerald-200">
        Pedido de pagamento na {momentoDoPagamentoNaMao(retiradaNaLoja)}. Se
        você já recebeu o dinheiro na mão, confirme abaixo — o registro fica
        salvo no pedido.
      </p>
      <div className="flex flex-col gap-3">
        <button type="button" onClick={aoCancelar} className={SECUNDARIO}>
          Ainda não
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={aoConfirmar}
          className={PRINCIPAL}
        >
          <Check aria-hidden="true" className="size-5" />
          Recebi
        </button>
      </div>
    </>
  );
}

/** Montado só enquanto a confirmação de recebimento em dinheiro está aberta. */
export function AvisoDeCaixaNoRecebimento({
  consultarCaixa,
  desabilitado = false,
}: Readonly<{
  consultarCaixa: () => Promise<SituacaoDoCaixa>;
  desabilitado?: boolean;
}>) {
  const [caixaFechado, setCaixaFechado] = useState(false);
  useEffect(() => {
    let valendo = true;
    consultarCaixa().then(
      (situacao) => {
        if (valendo) setCaixaFechado(situacao === "fechado");
      },
      () => {}, // Como no balcão: sem certeza, não avisa nem bloqueia.
    );
    return () => {
      valendo = false;
    };
  }, [consultarCaixa]);

  return caixaFechado ? (
    <AvisoDeCaixaFechado desabilitado={desabilitado} />
  ) : null;
}

export function ConfirmarRecebimento({
  total,
  disabled,
  retiradaNaLoja,
  consultarCaixa,
  aoConfirmar,
}: Readonly<{
  total: number;
  disabled?: boolean;
  retiradaNaLoja?: boolean | null;
  consultarCaixa?: () => Promise<SituacaoDoCaixa>;
  aoConfirmar: () => Promise<void>;
}>) {
  const [aberto, setAberto] = useState(false);
  // O Voltar do aparelho fecha só a pergunta: a ficha do pedido fica.
  useVoltarFechaAFolha(aberto, () => setAberto(false));
  const emVoo = useRef(false);
  const confirmar = async () => {
    if (disabled || emVoo.current) return;
    emVoo.current = true;
    setAberto(false);
    try {
      await aoConfirmar();
    } finally {
      emVoo.current = false;
    }
  };
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="h-11 w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-400 transition-colors hover:bg-emerald-500 hover:text-black disabled:opacity-50"
        >
          {disabled ? "Registrando..." : "Marcar como recebido"}
        </button>
      </DialogTrigger>
      <DialogContent
        className="z-[80] border-admin-border-strong bg-admin-raised text-zinc-100"
        aria-describedby={undefined}
      >
        <DialogTitle>Registrar recebimento</DialogTitle>
        {aberto && consultarCaixa && (
          <AvisoDeCaixaNoRecebimento
            consultarCaixa={consultarCaixa}
            desabilitado={disabled}
          />
        )}
        <PerguntaDoRecebimento
          total={total}
          disabled={disabled}
          retiradaNaLoja={retiradaNaLoja}
          aoCancelar={() => setAberto(false)}
          aoConfirmar={() => void confirmar()}
        />
      </DialogContent>
    </Dialog>
  );
}
