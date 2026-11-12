// Régua de contraste WCAG 2.x para testes que leem as CLASSES reais que um
// componente renderiza (em vez de prender uma lista de classes, que
// concordaria com qualquer escolha). Mesma conta de saida-da-recusa-contraste
// .test.tsx, aqui com `zinc`, `amber`, `white`/`black` e `primary` -- este
// último é a cor DA LOJA (variável CSS `--primary`), que a loja pode escolher
// branca: por isso o teste a recebe de fora e a varia.
//
// As paletas são escritas à mão (Tailwind 3.4): derivá-las do build faria o
// teste concordar consigo mesmo.
import { expect } from "vitest";

export type Rgb = [number, number, number];

const ZINC: Record<string, string> = {
  "50": "#fafafa",
  "100": "#f4f4f5",
  "200": "#e4e4e7",
  "300": "#d4d4d8",
  "400": "#a1a1aa",
  "500": "#71717a",
  "600": "#52525b",
  "700": "#3f3f46",
  "800": "#27272a",
  "900": "#18181b",
};

const AMBER: Record<string, string> = {
  "50": "#fffbeb",
  "100": "#fef3c7",
  "200": "#fde68a",
  "300": "#fcd34d",
  "400": "#fbbf24",
  "500": "#f59e0b",
  "600": "#d97706",
  "700": "#b45309",
  "800": "#92400e",
  "900": "#78350f",
};

export const BRANCO: Rgb = [255, 255, 255];
export const PRETO: Rgb = [0, 0, 0];

export const hexParaRgb = (hex: string): Rgb => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

export const ZINC_50 = hexParaRgb(ZINC["50"] as string);

/** Cores da loja que o painel permite escolher; a branca é o caso do defeito. */
export const CORES_DA_LOJA: ReadonlyArray<readonly [string, Rgb]> = [
  ["branca", BRANCO],
  ["preta", PRETO],
  ["amarela", hexParaRgb("#facc15")],
  ["azul escura", hexParaRgb("#1d4ed8")],
  ["rosa", hexParaRgb("#ec4899")],
];

// Cor com opacidade (`/10`) composta sobre o que está atrás dela.
export const compor = (frente: Rgb, alfa: number, atras: Rgb): Rgb => [
  Math.round(frente[0] * alfa + atras[0] * (1 - alfa)),
  Math.round(frente[1] * alfa + atras[1] * (1 - alfa)),
  Math.round(frente[2] * alfa + atras[2] * (1 - alfa)),
];

const luminancia = ([r, g, b]: Rgb): number => {
  const canal = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
};

export const razao = (a: Rgb, b: Rgb): number => {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return ((claro ?? 0) + 0.05) / ((escuro ?? 0) + 0.05);
};

/**
 * Lê `<prefixo>-<cor>` (com `/NN` opcional) das classes e devolve a cor já
 * composta sobre `atras`. `prefixo` é "text", "bg" ou "placeholder:text".
 * Classes com outra variante (`hover:`) ou de tamanho (`text-sm`,
 * `text-[11px]`) não casam. Sem a classe, o teste falha em vez de supor uma
 * cor. `primaria` é o valor de `--primary` da loja naquele cenário.
 */
export function corDaClasse(
  classes: string,
  prefixo: "text" | "bg" | "placeholder:text",
  atras: Rgb,
  primaria: Rgb = BRANCO,
): Rgb {
  // Só casa a classe de cor pura do prefixo pedido (`text-zinc-900`,
  // `bg-primary/10`); `hover:...` e `text-[11px]` ficam de fora.
  let nome = "";
  let opacidade: string | undefined;
  for (const classe of classes.split(/\s+/)) {
    if (!classe.startsWith(`${prefixo}-`)) continue;
    const [cor, op] = classe.slice(prefixo.length + 1).split("/");
    if (!/^(white|black|primary|(zinc|amber)-\d+)$/.test(cor ?? "")) continue;
    nome = cor as string;
    opacidade = op;
    break;
  }
  expect(nome, `sem ${prefixo}-<cor> em "${classes}"`).not.toBe("");
  let cor: Rgb;
  if (nome === "white") cor = BRANCO;
  else if (nome === "black") cor = PRETO;
  else if (nome === "primary") cor = primaria;
  else {
    const [familia, tom] = nome.split("-");
    const hex = (familia === "zinc" ? ZINC : AMBER)[tom ?? ""];
    expect(hex, `tom ${nome} fora da tabela do teste`).toBeDefined();
    cor = hexParaRgb(hex as string);
  }
  const alfa = opacidade ? Number(opacidade) / 100 : 1;
  return compor(cor, alfa, atras);
}
