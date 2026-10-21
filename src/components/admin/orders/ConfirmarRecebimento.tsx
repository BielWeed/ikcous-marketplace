import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Check } from "lucide-react";
import { useRef, useState } from "react";

interface PerguntaProps {
  total: number;
  disabled?: boolean;
  aoCancelar: () => void;
  aoConfirmar: () => void;
}

/** A lista e a ficha fazem a mesma pergunta antes de registrar dinheiro. */
export function PerguntaDoRecebimento({
  total,
  disabled,
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
        Pedido de pagamento na entrega. Se você já recebeu o dinheiro na mão,
        confirme abaixo — o registro fica salvo no pedido.
      </p>
      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={aoCancelar}
          className="min-h-11 rounded-2xl border border-admin-border bg-admin-raised px-3 py-2 text-sm font-semibold text-zinc-100 hover:bg-admin-hover disabled:opacity-50"
        >
          Ainda não
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={aoConfirmar}
          className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-[#F6D365]/50 bg-gradient-to-b from-[#F6D365] to-[#E4AD18] px-3 py-2 text-sm font-semibold text-[#211A05] hover:brightness-105 disabled:opacity-50"
        >
          <Check aria-hidden="true" className="size-5" />
          Recebi
        </button>
      </div>
    </>
  );
}

export function ConfirmarRecebimento({
  total,
  disabled,
  aoConfirmar,
}: Readonly<{
  total: number;
  disabled?: boolean;
  aoConfirmar: () => Promise<void>;
}>) {
  const [aberto, setAberto] = useState(false);
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
        <PerguntaDoRecebimento
          total={total}
          disabled={disabled}
          aoCancelar={() => setAberto(false)}
          aoConfirmar={() => void confirmar()}
        />
      </DialogContent>
    </Dialog>
  );
}
