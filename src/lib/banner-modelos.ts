export const MODELOS_DE_BANNER = [
  "destaque",
  "claro",
  "vitrine",
  "promocao",
  "lancamento",
  "foto",
] as const;

export type ModeloDeBanner = (typeof MODELOS_DE_BANNER)[number];
export const PREFIXO_DO_MODELO = "pronto_";

export function modeloDoBanner(
  templateType?: string | null,
): ModeloDeBanner | null {
  return (
    MODELOS_DE_BANNER.find(
      (modelo) => templateType === PREFIXO_DO_MODELO + modelo,
    ) ?? null
  );
}

export function templateTypeDoModelo(modelo: ModeloDeBanner): string {
  return PREFIXO_DO_MODELO + modelo;
}

export interface CorDoModelo {
  id: string;
  rotulo: string;
  hex: string;
}

// "Loja" usa o hex do StoreContext no editor; não tem uma cor fixa no catálogo.
export const CORES_DO_MODELO: readonly CorDoModelo[] = [
  { id: "grafite", rotulo: "Grafite", hex: "#2A2A31" },
  { id: "preto", rotulo: "Preto", hex: "#0E0E11" },
  { id: "cinza", rotulo: "Cinza", hex: "#8E8E98" },
  { id: "claro", rotulo: "Claro", hex: "#EDEDF0" },
];

export const INFO_DOS_MODELOS: readonly {
  id: ModeloDeBanner;
  nome: string;
  descricao: string;
  grupo: "promocao" | "lancamento" | "simples";
}[] = [
  {
    id: "destaque",
    nome: "Destaque",
    descricao: "Produto à direita",
    grupo: "simples",
  },
  {
    id: "claro",
    nome: "Claro",
    descricao: "Produto à esquerda",
    grupo: "simples",
  },
  {
    id: "vitrine",
    nome: "Vitrine",
    descricao: "Produto no centro",
    grupo: "simples",
  },
  {
    id: "promocao",
    nome: "Promoção",
    descricao: "Desconto em letras grandes",
    grupo: "promocao",
  },
  {
    id: "lancamento",
    nome: "Lançamento",
    descricao: "Foco no produto novo",
    grupo: "lancamento",
  },
  {
    id: "foto",
    nome: "Foto",
    descricao: "Imagem de fundo com texto",
    grupo: "simples",
  },
];

export function tintaSobre(hex: string): "claro" | "escuro" {
  const cor = /^#([\da-f]{3}|[\da-f]{6})$/i.test(hex) ? hex.slice(1) : "2A2A31";
  const completa = cor.length === 3 ? cor.replace(/./g, "$&$&") : cor;
  const [r, g, b] = [0, 2, 4].map((inicio) => {
    const canal = Number.parseInt(completa.slice(inicio, inicio + 2), 16) / 255;
    return canal <= 0.04045 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4;
  });
  // Limiar entre preto e branco (WCAG): escolhe o maior contraste, sempre ≥ 4,5:1.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "escuro" : "claro";
}

export function dividirTitulo(titulo: string): [string, string] {
  const palavras = titulo.trim().split(/\s+/);
  const meio = Math.ceil(palavras.length / 2);
  return [palavras.slice(0, meio).join(" "), palavras.slice(meio).join(" ")];
}
