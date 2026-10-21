import type { ProductVariant } from "@/types";
import {
  MAX_ATRIBUTOS_DA_GRADE,
  dividirEmAtributos,
} from "./atributos-da-variacao";

export interface FileiraDeVariacao {
  nome: string;
  valores: { valor: string; disponivel: boolean; estoque: number }[];
}

/** A seleção só entrega o id da LINHA completa: carrinho e estoque não mudam de contrato. */
export function fileirasDeVariacao(
  variantes: ProductVariant[] = [],
  escolha: Record<string, string> = {},
): { fileiras: FileiraDeVariacao[]; variante?: ProductVariant } {
  const selecionadas = new Map(Object.entries(escolha));
  const ativas = variantes.filter((v) => v.active);
  const pares = ativas.map((v) => dividirEmAtributos(v.name, v.value));
  const primeiro = pares[0] ?? [];
  // Qualquer linha legada impede desmontar parcialmente a mesma grade.
  const composta =
    primeiro.length > 1 &&
    primeiro.length <= MAX_ATRIBUTOS_DA_GRADE &&
    pares.every(
      (linha) =>
        linha.length === primeiro.length &&
        linha.every((par, i) => par.name === primeiro.at(i)?.name),
    );
  const linhas = ativas.map((variante, i) => ({
    variante,
    atributos: composta
      ? (pares.at(i) ?? [])
      : [{ name: variante.name, value: variante.value }],
  }));
  const grupos = new Map<string, Set<string>>();
  for (const { atributos } of linhas) {
    for (const { name, value } of atributos) {
      if (!grupos.has(name)) grupos.set(name, new Set());
      grupos.get(name)?.add(value);
    }
  }
  const fileiras = Array.from(grupos, ([nome, valores]) => ({
    nome,
    valores: Array.from(valores, (valor) => {
      const estoque = linhas.reduce((soma, { variante, atributos }) => {
        const corresponde =
          atributos.some((par) => par.name === nome && par.value === valor) &&
          (/^(cor|cores|color)$/i.test(nome.trim()) ||
            atributos.every(
              (par) =>
                par.name === nome ||
                !selecionadas.get(par.name) ||
                selecionadas.get(par.name) === par.value,
            ));
        return soma + (corresponde ? Math.max(0, variante.stockIncrement) : 0);
      }, 0);
      return { valor, estoque, disponivel: estoque > 0 };
    }),
  }));
  const completa =
    fileiras.length > 0 && fileiras.every((f) => !!selecionadas.get(f.nome));
  const variante = completa
    ? linhas.find(
        ({ variante, atributos }) =>
          variante.stockIncrement > 0 &&
          atributos.every((par) => selecionadas.get(par.name) === par.value),
      )?.variante
    : undefined;
  return { fileiras, variante };
}
