import { useState } from "react";

import { PoliticaEmFolha } from "@/components/politicas/PoliticaEmFolha";
import {
  NOME_DA_POLITICA,
  TIPOS_DE_POLITICA,
  type TipoDePolitica,
  VIEW_DA_POLITICA,
} from "@/lib/textos-das-politicas";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import { haptic } from "@/utils/haptic";

// Link no meio de uma frase: o texto fica pequeno, mas a área de toque chega
// aos 44px (py-3.5 de cima e de baixo) sem aumentar a altura da linha —
// `-my-3.5` devolve o espaço que o padding tomaria.
const LINK_NA_FRASE =
  "-my-3.5 inline cursor-pointer rounded-sm py-3.5 font-semibold text-foreground underline underline-offset-2";

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
        className={cn(
          "text-[11px] leading-snug text-muted-foreground",
          className,
        )}
      >
        Ao {acao} você concorda com os{" "}
        <button
          type="button"
          onClick={() => abrir("termos")}
          className={LINK_NA_FRASE}
        >
          {NOME_DA_POLITICA.termos}
        </button>{" "}
        e a{" "}
        <button
          type="button"
          onClick={() => abrir("privacidade")}
          className={LINK_NA_FRASE}
        >
          {NOME_DA_POLITICA.privacidade}
        </button>
        .
      </p>
      <PoliticaEmFolha tipo={aberta} onFechar={() => setAberta(null)} />
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
          "flex min-h-11 w-full items-center justify-center text-xs font-semibold text-muted-foreground underline underline-offset-2",
          className,
        )}
      >
        {NOME_DA_POLITICA.trocas}
      </button>
      <PoliticaEmFolha
        tipo={aberta ? "trocas" : null}
        onFechar={() => setAberta(false)}
      />
    </>
  );
}

/**
 * Os três links no fim da vitrine. Aqui é navegação mesmo (a cliente não
 * está no meio de nada): leva à página, e o voltar do app traz de volta.
 */
export function RodapeDasPoliticas({
  onNavigate,
}: {
  readonly onNavigate: (view: View) => void;
}) {
  return (
    <nav
      aria-label="Políticas da loja"
      data-testid="rodape-das-politicas"
      className="relative z-10 mt-8 flex flex-wrap items-center justify-center gap-x-1 border-t border-border pt-2"
    >
      {TIPOS_DE_POLITICA.map((tipo) => (
        <button
          key={tipo}
          type="button"
          onClick={() => {
            haptic.light();
            onNavigate(VIEW_DA_POLITICA[tipo]);
          }}
          className="flex min-h-11 items-center px-2 text-xs font-semibold text-muted-foreground underline underline-offset-2"
        >
          {NOME_DA_POLITICA[tipo]}
        </button>
      ))}
    </nav>
  );
}
