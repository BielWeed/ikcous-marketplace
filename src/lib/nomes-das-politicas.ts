import type { View } from "@/types";

// Nomes e telas das três políticas da loja, num arquivo PEQUENO de propósito.
//
// Quem só precisa do rótulo de um link (o rodapé da vitrine, a frase do
// checkout e do cadastro, o link do produto) importa DAQUI, e não de
// `textos-das-politicas.ts`: aquele arquivo carrega todo o texto jurídico e só
// deve ser baixado quando a cliente abre uma política (folha ou página).
// `tests/front/politicas-peso-do-rodape.test.ts` trava essa fronteira.

/** As três páginas, na ordem em que aparecem nos links. */
export const TIPOS_DE_POLITICA = ["termos", "privacidade", "trocas"] as const;
export type TipoDePolitica = (typeof TIPOS_DE_POLITICA)[number];

/** Nome que a pessoa lê no link e no título de cada página. */
export function nomeDaPolitica(tipo: TipoDePolitica): string {
  switch (tipo) {
    case "termos":
      return "Termos de uso";
    case "privacidade":
      return "Política de Privacidade";
    case "trocas":
      return "Trocas e devoluções";
  }
}

/** A tela (`View`) de cada página: é por ela que o rodapé da vitrine navega. */
export function viewDaPolitica(tipo: TipoDePolitica): View {
  switch (tipo) {
    case "termos":
      return "terms";
    case "privacidade":
      return "privacy";
    case "trocas":
      return "returns-policy";
  }
}
