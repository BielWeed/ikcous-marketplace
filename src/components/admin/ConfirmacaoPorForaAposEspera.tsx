import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AVISO_DE_DOBRO,
  FRASE_DE_CONFIRMACAO_POR_FORA,
} from "@/lib/reembolso-em-duvida";

/**
 * "Já devolvi por fora (depois de 7 dias)" — a saída do lote R1 para a linha
 * de reembolso que PODE ter chegado ao Mercado Pago e não se resolveu. Usada
 * no cartão do pedido cancelado (`EstornoCard`) e no da devolução
 * (`ReembolsoDaDevolucao`), com a MESMA confirmação forte: o lojista lê o
 * risco de pagar em dobro e digita a frase fixa. A frase é só um freio de
 * tela; quem decide se a saída vale é o servidor.
 */
export function ConfirmacaoPorForaAposEspera({
  idBase,
  enviando,
  onConfirmar,
}: Readonly<{
  idBase: string;
  enviando: boolean;
  onConfirmar: () => Promise<boolean>;
}>) {
  const [aberto, setAberto] = useState(false);
  const [digitado, setDigitado] = useState("");
  const campoRef = useRef<HTMLInputElement>(null);

  // Foco no campo ao abrir (o eslint de acessibilidade reprova `autoFocus`).
  useEffect(() => {
    if (aberto) campoRef.current?.focus();
  }, [aberto]);

  if (!aberto) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={enviando}
        onClick={() => setAberto(true)}
      >
        Já devolvi por fora (depois de 7 dias)
      </Button>
    );
  }

  const confere = digitado.trim() === FRASE_DE_CONFIRMACAO_POR_FORA;
  const idCampo = `${idBase}-frase`;
  const idAviso = `${idBase}-aviso`;

  async function confirmar() {
    if (!confere || enviando) return;
    const ok = await onConfirmar();
    if (ok) {
      setAberto(false);
      setDigitado("");
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
      <p id={idAviso} className="text-xs font-bold text-red-300">
        {AVISO_DE_DOBRO} Só confirme se você já devolveu o dinheiro ao cliente
        por outro meio (PIX, dinheiro) e conferiu no painel do Mercado Pago que
        esta devolução não saiu.
      </p>
      <label htmlFor={idCampo} className="block text-xs text-zinc-300">
        Para confirmar, digite {FRASE_DE_CONFIRMACAO_POR_FORA}
      </label>
      <Input
        id={idCampo}
        ref={campoRef}
        value={digitado}
        autoComplete="off"
        aria-describedby={idAviso}
        onChange={(e) => setDigitado(e.target.value)}
        className="h-9 rounded-lg border-white/10 bg-zinc-950 text-xs text-white"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={!confere || enviando}
          aria-disabled={!confere || enviando}
          onClick={() => void confirmar()}
        >
          {enviando ? "Registrando…" : "Confirmar que devolvi por fora"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={enviando}
          onClick={() => {
            setAberto(false);
            setDigitado("");
          }}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
