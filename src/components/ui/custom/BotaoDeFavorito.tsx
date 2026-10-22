import { rotuloDeFavoritar } from "@/lib/rotulo-favoritar";
import { cn } from "@/lib/utils";
import { Heart } from "lucide-react";
import type { MouseEvent } from "react";

// Botão do coração, um só para a loja inteira (card, ofertas, produto).
//
// Antes cada tela tinha o seu, com padding e fundo translúcido (`glass`):
// o coração saía do centro do círculo e, sobre foto clara, o círculo
// parecia ter borda e transparência estranhas. Aqui o centro vem da
// ESTRUTURA, não de conta de padding: grade `place-items-center` de 44px
// (alvo de toque), sem padding nem margem, ícone único de tamanho fixo.
// O fundo é OPACO e a borda é de cor firme, então o círculo fica igual
// sobre foto clara, escura ou transparente.
//
// `data-botao-favorito` serve para folhas de estilo de tela (Favoritos)
// não tratarem este botão como botão genérico.

interface BotaoDeFavoritoProps {
  nome: string;
  /** Rótulo próprio, para telas que já mostram o nome do produto. */
  rotulo?: string;
  favorito: boolean;
  onClick: (evento: MouseEvent<HTMLButtonElement>) => void;
  /** Só posição (absolute/right/top). Nunca padding, margem ou translate. */
  className?: string;
}

export function BotaoDeFavorito({
  nome,
  rotulo: rotuloProprio,
  favorito,
  onClick,
  className,
}: BotaoDeFavoritoProps) {
  const rotulo = rotuloProprio ?? rotuloDeFavoritar(nome, favorito);
  return (
    <button
      type="button"
      data-botao-favorito=""
      onClick={(evento) => {
        // O card inteiro é clicável: favoritar não pode abrir o produto.
        evento.stopPropagation();
        onClick(evento);
      }}
      aria-label={rotulo}
      title={rotulo}
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-full border border-zinc-200 bg-white shadow-sm outline-none transition-transform active:scale-90 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-visible:ring-white",
        // Marca neutra: o estado vem do PREENCHIMENTO do coração, não de cor.
        "text-zinc-950 dark:text-white",
        className,
      )}
    >
      <Heart
        aria-hidden="true"
        className={cn(
          "size-5 block",
          favorito && "fill-current animate-heart-pop",
        )}
      />
    </button>
  );
}
