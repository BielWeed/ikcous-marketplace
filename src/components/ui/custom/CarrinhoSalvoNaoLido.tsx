import { ShoppingBag } from "lucide-react";
import { useState } from "react";

interface CarrinhoSalvoNaoLidoProps {
  /** Relê o carrinho salvo da conta (`relerCarrinhoSalvo` do CartContext). */
  onTentarDeNovo: () => Promise<void> | void;
  /** O caminho para fora da tela (loja, ou carrinho) -- nunca um beco. */
  onSair: () => void;
  rotuloDoSair: string;
}

/**
 * O carrinho salvo na conta não carregou (sem internet, erro do banco ou
 * demora). Lista vazia aqui NÃO é carrinho vazio: dizer "vazio" fazia a cliente
 * achar que perdeu o carrinho. A tela cai sozinha quando a leitura dá certo
 * (`carrinhoSalvoNaoLido` do CartContext volta a falso).
 */
export function CarrinhoSalvoNaoLido({
  onTentarDeNovo,
  onSair,
  rotuloDoSair,
}: CarrinhoSalvoNaoLidoProps) {
  const [tentando, setTentando] = useState(false);
  const tentar = async () => {
    setTentando(true);
    try {
      await onTentarDeNovo();
    } finally {
      setTentando(false);
    }
  };
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-8 py-10 text-center">
      <div className="flex size-16 items-center justify-center rounded-[20px] bg-muted/60 text-muted-foreground">
        <ShoppingBag className="size-8" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <p
        role="status"
        className="mx-auto max-w-[280px] text-[15px] leading-snug text-foreground"
      >
        Não conseguimos carregar seu carrinho salvo agora. Estamos tentando de
        novo.
      </p>
      <button
        type="button"
        onClick={tentar}
        disabled={tentando}
        className="flex min-h-11 items-center justify-center rounded-2xl bg-foreground px-8 text-[15px] font-semibold text-background transition-colors hover:bg-foreground/90 active:scale-[0.98] disabled:opacity-60"
      >
        {tentando ? "Tentando…" : "Tentar de novo"}
      </button>
      <button
        type="button"
        onClick={onSair}
        className="min-h-11 px-4 text-[15px] font-semibold text-foreground underline underline-offset-4"
      >
        {rotuloDoSair}
      </button>
    </div>
  );
}
