import { useState } from "react";

import { PoliticaEmFolhaSobDemanda } from "@/components/politicas/PoliticaEmFolhaSobDemanda";
import { type TipoDePolitica, nomeDaPolitica } from "@/lib/nomes-das-politicas";
import { cn } from "@/lib/utils";
import { haptic } from "@/utils/haptic";

// Link no meio de uma frase: o texto fica pequeno, mas a CAIXA do botão tem
// 44px de altura de verdade (`min-h-11`), sem margem negativa e sem padding que
// vaze para fora dela. Foi assim de propósito: a versão anterior esticava a
// área de toque ~14px para cima e para baixo (`-my-3.5` + `py-3.5`), e a barra
// do checkout tem o botão Finalizar a 6px de distância — um toque na beirada de
// baixo do Finalizar podia abrir os Termos. Os links ficam sozinhos numa
// segunda linha da frase (`<br />`), então a altura extra é da frase, não
// invade o vizinho.
//
// CORES: estes dois componentes moram sobre superfícies BRANCAS fixas (a barra
// do Finalizar, o cartão do cadastro, a página do produto — todas `bg-white`
// mesmo com o tema escuro ligado). Por isso zinc fixo e não o token do tema:
// `text-muted-foreground` no tema escuro vira cinza-claro sobre branco, abaixo
// de 3:1. zinc-500 sobre branco dá 4,8:1 e zinc-900 dá 17:1.
const LINK_NA_FRASE =
  "inline-flex min-h-11 cursor-pointer items-center rounded-sm font-semibold text-zinc-900 underline underline-offset-2";

/**
 * "Ao finalizar você concorda com os Termos de uso e a Política de
 * Privacidade." — a frase que fica ao lado do botão que fecha o pedido ou o
 * cadastro. NÃO é caixa de marcar: não trava nada, só deixa as regras à mão.
 * Os dois links abrem a política numa folha por cima da tela (a compra e o
 * formulário seguem intactos por baixo).
 */
export function FraseDeAceite({
  acao,
  className,
}: {
  /** O que a cliente está prestes a fazer: "finalizar", "entrar", "criar sua conta". */
  readonly acao: string;
  readonly className?: string;
}) {
  const [aberta, setAberta] = useState<TipoDePolitica | null>(null);

  function abrir(tipo: TipoDePolitica) {
    haptic.light();
    setAberta(tipo);
  }

  return (
    <>
      <p
        data-testid="frase-de-aceite"
        className={cn("text-[11px] leading-snug text-zinc-500", className)}
      >
        Ao {acao} você concorda com os <br />
        <button
          type="button"
          onClick={() => abrir("termos")}
          className={LINK_NA_FRASE}
        >
          {nomeDaPolitica("termos")}
        </button>{" "}
        e a{" "}
        <button
          type="button"
          onClick={() => abrir("privacidade")}
          className={LINK_NA_FRASE}
        >
          {nomeDaPolitica("privacidade")}
        </button>
        .
      </p>
      <PoliticaEmFolhaSobDemanda
        tipo={aberta}
        onFechar={() => setAberta(null)}
      />
    </>
  );
}

/**
 * "Trocas e devoluções", discreto, perto do botão de comprar. Abre a mesma
 * folha (a escolha de tamanho e cor da cliente continua na tela).
 */
export function LinkDeTrocas({ className }: { readonly className?: string }) {
  const [aberta, setAberta] = useState(false);

  return (
    <>
      <button
        type="button"
        data-testid="link-trocas-e-devolucoes"
        onClick={() => {
          haptic.light();
          setAberta(true);
        }}
        className={cn(
          "flex min-h-11 w-full items-center justify-center text-xs font-semibold text-zinc-500 underline underline-offset-2",
          className,
        )}
      >
        {nomeDaPolitica("trocas")}
      </button>
      <PoliticaEmFolhaSobDemanda
        tipo={aberta ? "trocas" : null}
        onFechar={() => setAberta(false)}
      />
    </>
  );
}
