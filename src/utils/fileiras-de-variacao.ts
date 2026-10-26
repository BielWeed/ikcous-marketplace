import type { ProductVariant } from "@/types";
import {
  MAX_ATRIBUTOS_DA_GRADE,
  dividirEmAtributos,
  dobrar,
  tipoDoNome,
} from "./atributos-da-variacao";

export interface FileiraDeVariacao {
  nome: string;
  valores: {
    valor: string;
    /** Há estoque COM o que já foi escolhido nas outras fileiras. */
    disponivel: boolean;
    estoque: number;
    /** Há estoque em ALGUMA combinação (ignora a escolha atual). Falso =
     *  esgotado de vez: a tela o trava. Verdadeiro e `disponivel` falso = apagado
     *  só pela combinação: a tela o apaga mas deixa tocar. Ausente = `disponivel`. */
    existe?: boolean;
  }[];
}

/** Quem escolhe o tamanho vê as cores que existem nele: Tamanho (e Voltagem)
 *  vêm antes, a Cor depois e qualquer outro atributo por último. A ordem em que
 *  o produto foi gravado ("Cor / Tamanho") não decide nada aqui; entre iguais
 *  vale a gravação (o sort do JS é estável). */
function posicaoDaFileira(nome: string): number {
  const tipo = tipoDoNome(nome);
  if (tipo === "Tamanho" || tipo === "Voltagem") return 0;
  if (tipo === "Cor" || /^(cores|color)$/.test(dobrar(nome))) return 1;
  return 2;
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
        // Todo valor, a cor inclusive, só conta o estoque das linhas que
        // combinam com o que já foi escolhido nas OUTRAS fileiras.
        const corresponde =
          atributos.some((par) => par.name === nome && par.value === valor) &&
          atributos.every(
            (par) =>
              par.name === nome ||
              !selecionadas.get(par.name) ||
              selecionadas.get(par.name) === par.value,
          );
        return soma + (corresponde ? Math.max(0, variante.stockIncrement) : 0);
      }, 0);
      const existe = linhas.some(
        ({ variante, atributos }) =>
          variante.stockIncrement > 0 &&
          atributos.some((par) => par.name === nome && par.value === valor),
      );
      return { valor, estoque, disponivel: estoque > 0, existe };
    }),
  }));
  fileiras.sort((a, b) => posicaoDaFileira(a.nome) - posicaoDaFileira(b.nome));
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

/**
 * A escolha que sai de TOCAR num valor (a cliente nunca fica com seleção
 * incoerente). Devolve `null` se o valor não tem estoque em combinação
 * nenhuma (esgotado de vez, desligado ou inexistente): a tela não muda.
 * Valor só apagado pela combinação atual vale: ele entra e as escolhas dos
 * outros lados são guardadas na ordem das fileiras (Tamanho, Cor, Outro), cada
 * uma só se ainda combina com tudo que já ficou. Nunca escolhe outra
 * combinação pela cliente.
 */
export function aplicarEscolhaDeVariacao(
  variantes: ProductVariant[],
  escolha: Record<string, string>,
  grupo: string,
  valor: string,
): Record<string, string> | null {
  const { fileiras } = fileirasDeVariacao(variantes, {});
  const existe = fileiras
    .find((f) => f.nome === grupo)
    ?.valores.some((v) => v.valor === valor && (v.existe ?? v.disponivel));
  if (!existe) return null;
  const coerente = (candidata: Map<string, string>) =>
    fileirasDeVariacao(variantes, Object.fromEntries(candidata)).fileiras.every(
      (f) => {
        const marcado = candidata.get(f.nome);
        return (
          !marcado || f.valores.some((v) => v.valor === marcado && v.disponivel)
        );
      },
    );
  const anteriores = new Map(Object.entries(escolha));
  let escolhida = new Map([[grupo, valor]]);
  for (const { nome } of fileiras) {
    const anterior = anteriores.get(nome);
    if (nome === grupo || !anterior) continue;
    const candidata = new Map(escolhida).set(nome, anterior);
    if (coerente(candidata)) escolhida = candidata;
  }
  return Object.fromEntries(escolhida);
}
