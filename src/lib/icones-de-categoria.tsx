// Chaves persistidas em categorias.icone (CHECK da migration 20261300000000).
// Paths de linha 24×24, compartilhados pela vitrine e pelo seletor do painel.
// A categoria também pode guardar a FORMA do ícone escolhido no catálogo do painel
// (categorias.icone_forma, migration 20261351000000): ela ganha das chaves abaixo.
const ICONES = {
  todas: ["Todas", "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"],
  cuidado: [
    "Cuidado",
    "M12 2C8 7 5 11 5 15a7 7 0 0 0 14 0c0-4-3-8-7-13ZM8 15a4 4 0 0 0 4 4",
  ],
  brinquedo: ["Brinquedo", "M8 2h8v8H8zM2 14h8v8H2zM14 14h8v8h-8z"],
  calcados: [
    "Calçados",
    "m3 15 4-1 3-5 4 4 5 1q3 1 3 4v2H2v-3q0-2 1-2ZM10 13l2-2m1 4 2-2",
  ],
  moda: ["Moda", "m8 3-6 4 3 5 3-2v11h8V10l3 2 3-5-6-4a4 4 0 0 1-8 0Z"],
  casa: ["Casa", "m3 10 9-8 9 8M5 8v13h14V8M9 21v-8h6v8"],
  tecnologia: ["Tecnologia", "M3 3h18v13H3zM8 21h8m-4-5v5"],
  beleza: ["Beleza", "M8 10h8v12H8zM9 10V4l6-3v9M8 14h8"],
  esporte: ["Esporte", "m7 3 14 14-4 4L3 7Zm-5 7 8-8m4 20 8-8"],
  pet: [
    "Pet",
    "M8 14q4-6 8 0l3 4q1 5-7 2-8 3-7-2ZM5 6a2 3 0 1 0 0 .1M10 3a2 3 0 1 0 0 .1M16 4a2 3 0 1 0 0 .1M21 8a2 3 0 1 0 0 .1",
  ],
  alimento: [
    "Alimento",
    "M12 7q-8-6-9 3c-1 6 4 13 9 10 5 3 10-4 9-10q-1-9-9-3Zm0 0q-2-5 4-5",
  ],
  papelaria: ["Papelaria", "M4 2h12l4 4v16H4ZM16 2v5h4M8 12h8m-8 4h6"],
  ferramentas: [
    "Ferramentas",
    "M14 3a6 6 0 0 0-7 8l-5 6a3 3 0 0 0 4 4l6-6a6 6 0 0 0 8-8l-4 4-4-4Z",
  ],
  joias: ["Joias", "m3 8 4-5h10l4 5-9 13Zm0 0h18M7 3l5 18 5-18"],
} as const;
export type ChaveDeIcone = keyof typeof ICONES;

// Forma = UM path SVG (atributo d). MESMO alfabeto e limite da CHECK do banco: segunda barreira,
// o cliente nunca desenha texto que o banco recusaria. Só entra em <path d>, nunca vira HTML.
export const FORMA_DE_ICONE = /^[Mm][MmLlHhVvCcSsQqTtAaZz0-9 .,-]*$/;
export const TAMANHO_MAXIMO_DA_FORMA = 400;
export function formaDeIconeValida(forma: unknown): forma is string {
  return (
    typeof forma === "string" &&
    forma.length <= TAMANHO_MAXIMO_DA_FORMA &&
    FORMA_DE_ICONE.test(forma)
  );
}
export const CHAVES_DE_ICONES = Object.keys(ICONES) as ChaveDeIcone[];
export const nomeDoIcone = (chave: ChaveDeIcone) => ICONES[chave][0];

const REGRAS: ReadonlyArray<readonly [ChaveDeIcone, RegExp]> = [
  ["cuidado", /auto\s*cuidado|higiene|banho/],
  ["beleza", /beleza|perfume|cosmet|maquiagem/],
  ["brinquedo", /brinquedo|jogo/],
  ["calcados", /calcado|tenis|sapato|sandalia/],
  ["moda", /roupa|camiseta|moda|vestuario/],
  ["casa", /casa|decoracao|cozinha|cama|mesa/],
  ["tecnologia", /tecnologia|eletronic|celular|informatica/],
  ["esporte", /esport|fitness|academia/],
  ["pet", /\bpet\b|animal|cachorro|gato/],
  ["alimento", /alimento|comida|bebida|mercado/],
  ["papelaria", /papelaria|escolar|caderno/],
  ["ferramentas", /ferramenta|construcao/],
  ["joias", /joia|bijuteria|relogio/],
];

// A chave que a lojista escolheu (uma das 14), sem deduzir pelo nome; `null` se não escolheu.
export function iconeEscolhido(categoria: {
  icone?: string | null;
}): ChaveDeIcone | null {
  return categoria.icone && Object.hasOwn(ICONES, categoria.icone)
    ? (categoria.icone as ChaveDeIcone)
    : null;
}

export function iconeDaCategoria(categoria: {
  name: string;
  icone?: string | null;
}): ChaveDeIcone | "etiqueta" {
  const escolhido = iconeEscolhido(categoria);
  if (escolhido) return escolhido;
  const nome = categoria.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return REGRAS.find(([, palavras]) => palavras.test(nome))?.[0] ?? "etiqueta";
}

export function IconeDaCategoria({
  icone,
  forma,
  className,
}: {
  icone: ChaveDeIcone | "etiqueta";
  /** `categorias.icone_forma`: se vier e for válida, desenha ela no lugar da chave. */
  forma?: string | null;
  className?: string;
}) {
  const propria = formaDeIconeValida(forma) ? forma : null;
  return (
    <svg
      aria-hidden="true"
      data-icone={propria ? "forma" : icone}
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d={
          propria ??
          (icone === "etiqueta"
            ? "M3 3h8l10 10-8 8L3 11Zm4 4h.01"
            : ICONES[icone][1])
        }
      />
    </svg>
  );
}
