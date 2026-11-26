import type { LucideIcon } from "lucide-react";
import type { ReactNode, Ref } from "react";

/**
 * Lista de escolha do painel: o lugar dos `<select>` nativos. No celular abre
 * como folha de baixo; no computador, colada embaixo do campo. Mockup aprovado
 * pelo dono em 26/11/2026 (`equipe/design/lista-premium-26-11/`).
 *
 * Contrato dos testes (o helper `tests/front/helpers/lista-de-escolha.ts`):
 * o botão do campo leva `data-valor`; cada opção leva `data-valor` e
 * `data-rotulo`.
 */
export interface OpcaoDaLista<V extends string = string> {
  /** `""` é permitido ("Não informar" é uma opção de verdade). */
  readonly valor: V;
  readonly rotulo: string;
  /** Linha de baixo, só onde diz algo diferente ("à vista"). */
  readonly subinfo?: string;
  readonly desabilitada?: boolean;
  readonly icone?: LucideIcon;
  /** Selo curto antes do rótulo ("RJ"). A busca também acha por ele. */
  readonly sigla?: string;
  /** Texto extra que a busca acha, sem aparecer na tela. */
  readonly termos?: string;
}

interface Comum<V extends string> {
  /** Vai no botão do campo; o resto dos ids deriva dele. */
  readonly id: string;
  readonly rotulo: string;
  readonly opcoes: readonly OpcaoDaLista<V>[];
  /** Título da folha no celular. Padrão: o `rotulo`. */
  readonly tituloDaLista?: string;
  /** Padrão: liga com 10 opções ou mais. */
  readonly busca?: boolean;
  readonly desabilitado?: boolean;
}

/**
 * Dois modos:
 *  - `"valor"` (padrão): o campo mostra a escolhida; `valor` fora das opções
 *    mostra o `placeholder`.
 *  - `"acao"`: cada escolha dispara `aoEscolher` e o campo volta ao
 *    `placeholder` (ex.: "Escolha uma combinação" nos banners). Nada fica
 *    marcado.
 */
export type PropsDaEscolha<V extends string> = Comum<V> &
  (
    | {
        readonly modo?: "valor";
        readonly valor: V;
        readonly aoMudar: (valor: V) => void;
        readonly placeholder?: string;
      }
    | {
        readonly modo: "acao";
        readonly aoEscolher: (valor: V) => void;
        readonly placeholder: string;
      }
  );

/** O que o gatilho próprio (o chip do Extrato) recebe para desenhar o botão. */
export interface PropsDoGatilho {
  /** Espalhar no `<button>`: id, aria-*, `data-valor`, clique e ref. */
  readonly botao: {
    readonly ref: Ref<HTMLButtonElement>;
    readonly id: string;
    readonly type: "button";
    readonly "aria-haspopup": "listbox";
    readonly "aria-expanded": boolean;
    readonly "aria-controls": string | undefined;
    readonly "data-valor": string;
    readonly disabled: boolean | undefined;
    readonly onClick: () => void;
  };
  readonly aberta: boolean;
  /** A opção escolhida (nada no modo ação ou com valor fora da lista). */
  readonly escolhida: OpcaoDaLista | null;
  /** O texto que o gatilho mostra: o rótulo da escolhida ou o placeholder. */
  readonly textoMostrado: string;
}

export type PropsDoCampoDeEscolha<V extends string> = PropsDaEscolha<V> & {
  /** `true` → "Escolha uma opção"; texto → a mensagem da tela. */
  readonly erro?: string | boolean;
  readonly ajuda?: ReactNode;
  readonly className?: string;
};

export type PropsDaListaDeEscolha<V extends string> = PropsDaEscolha<V> & {
  readonly gatilho: (props: PropsDoGatilho) => ReactNode;
};
