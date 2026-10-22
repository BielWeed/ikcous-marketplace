import { useState } from "react";

import { PoliticaEmFolhaSobDemanda } from "@/components/politicas/PoliticaEmFolhaSobDemanda";
import { type TipoDePolitica, nomeDaPolitica } from "@/lib/nomes-das-politicas";
import { cn } from "@/lib/utils";
import { haptic } from "@/utils/haptic";

// A linha acompanha só o texto: o alvo de 44px fica no pseudo-elemento
// absoluto, centralizado verticalmente. Sem expansão horizontal, para não
// sobrepor os alvos dos dois links quando estiverem na mesma linha.
// A quebra após "com os" é fixa: os dois links ficam JUNTOS na 2ª linha
// ("Termos de uso e a Política de Privacidade."), então a extensão vertical de
// um alvo nunca cobre o texto do outro (se os links ficassem em linhas
// seguidas de 15px, o alvo de 44px de um taparia o do vizinho).
//
// CORES: estes dois componentes moram sobre superfícies BRANCAS fixas (a barra
// do Finalizar, o cartão do cadastro, a página do produto — todas `bg-white`
// mesmo com o tema escuro ligado). Por isso zinc fixo e não o token do tema:
// `text-muted-foreground` no tema escuro vira cinza-claro sobre branco, abaixo
// de 3:1. zinc-500 sobre branco dá 4,8:1 e zinc-900 dá 17:1.
const LINK_NA_FRASE =
  "relative inline-block cursor-pointer rounded-sm p-0 align-baseline font-semibold text-zinc-900 underline underline-offset-2 after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2";

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
  /** Compatibilidade: a frase agora sempre quebra naturalmente. */
  readonly emLinha?: boolean;
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
        {/* A 2ª linha nunca quebra: a 320px o ponto final caía sozinho numa 3ª
            linha (e o alvo de 44px de um link cobriria o outro). */}
        <span className="whitespace-nowrap max-[340px]:tracking-tight">
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
        </span>
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
