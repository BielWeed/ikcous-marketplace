import type { ModeloDeBanner } from "@/lib/banner-modelos";
import { PREFIXO_DO_MODELO } from "@/lib/prefixo-do-banner";

export function templateTypeDoModelo(modelo: ModeloDeBanner): string {
  return PREFIXO_DO_MODELO + modelo;
}

// Dados do editor: importados diretamente pelo painel para não embarcar na loja.
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
