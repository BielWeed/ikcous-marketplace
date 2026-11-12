import type { ProductVariant } from "@/types";
import {
  MAX_ATRIBUTOS_DA_GRADE,
  dividirEmAtributos,
  dobrar,
  posicaoDoAtributo,
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

/** A escada de tamanhos que a loja conhece, do menor ao maior (a brasileira e a
 *  internacional; quem usa uma só não vê a outra). Empate de posição cai no texto. */
const ESCADA_DE_TAMANHOS = new Map<string, number>([
  ["xxs", 0],
  ["xs", 1],
  ["pp", 1],
  ["s", 2],
  ["p", 2],
  ["m", 3],
  ["l", 4],
  ["g", 4],
  ["gg", 5],
  ["xl", 6],
  ["xg", 6],
  ["xxl", 7],
  ["xgg", 7],
  ["exg", 7],
  ["xxg", 7],
  ["xxxl", 8],
  ["exgg", 8],
  ["xxxg", 8],
]);

/** Onde o valor cai: 0 = escada de tamanhos, 1 = número (36, 110V), 2 = o resto
 *  (cores, materiais), 3 = "Único", sempre por último. `posicao` desempata
 *  dentro do grupo. */
function chaveDoValor(valor: string): { grupo: number; posicao: number } {
  const chave = dobrar(valor);
  const naEscada = ESCADA_DE_TAMANHOS.get(chave);
  if (naEscada !== undefined) return { grupo: 0, posicao: naEscada };
  if (/^(unico|u|tamanho unico)$/.test(chave)) return { grupo: 3, posicao: 0 };
  // `parseFloat` lê o número da frente ("110V" = 110, "2,5 L" = 2.5); sem regex.
  const numero = Number.parseFloat(chave.replace(",", "."));
  if (/^\d/.test(chave) && Number.isFinite(numero))
    return { grupo: 1, posicao: numero };
  return { grupo: 2, posicao: 0 };
}

/** Ordem DETERMINÍSTICA dos valores de uma fileira. O banco devolve as variações
 *  sem ORDER BY e a linha vendida pode ir para o fim: a ordem dos chips não pode
 *  depender disso. Desempate: português, e por fim o texto cru (ordem total). */
export function compararValores(a: string, b: string): number {
  const x = chaveDoValor(a);
  const y = chaveDoValor(b);
  if (x.grupo !== y.grupo) return x.grupo - y.grupo;
  if (x.posicao !== y.posicao) return x.posicao - y.posicao;
  const texto = a.localeCompare(b, "pt-BR", {
    sensitivity: "base",
    numeric: true,
  });
  if (texto !== 0) return texto;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** As linhas de Variações do PAINEL na mesma ordem dos chips da loja (P-M-G,
 *  números, o resto, "Único"): o banco as devolve sem ORDER BY e a linha vendida
 *  ou editada pulava para o fim. Grade composta ("Tamanho / Cor") ordena pelo
 *  atributo que a loja mostra primeiro e desempata nos seguintes. Não altera a
 *  lista recebida; empate total mantém a ordem de chegada (sort estável). */
export function ordenarVariantesDoPainel(
  variantes: ProductVariant[],
): ProductVariant[] {
  const chaves = new Map(
    variantes.map((variante) => [
      variante,
      dividirEmAtributos(variante.name, variante.value)
        .map((par, i) => ({ ...par, i }))
        .sort(
          (a, b) =>
            posicaoDoAtributo(a.name) - posicaoDoAtributo(b.name) || a.i - b.i,
        ),
    ]),
  );
  return [...variantes].sort((a, b) => {
    const x = chaves.get(a) ?? [];
    const y = chaves.get(b) ?? [];
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const parX = x.at(i);
      const parY = y.at(i);
      if (!parX || !parY) break;
      const nomes =
        posicaoDoAtributo(parX.name) - posicaoDoAtributo(parY.name) ||
        parX.name.localeCompare(parY.name, "pt-BR");
      if (nomes !== 0) return nomes;
      const valores = compararValores(parX.value, parY.value);
      if (valores !== 0) return valores;
    }
    return 0;
  });
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
    valores: Array.from(valores)
      .sort(compararValores)
      .map((valor) => {
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
          return (
            soma + (corresponde ? Math.max(0, variante.stockIncrement) : 0)
          );
        }, 0);
        const existe = linhas.some(
          ({ variante, atributos }) =>
            variante.stockIncrement > 0 &&
            atributos.some((par) => par.name === nome && par.value === valor),
        );
        return { valor, estoque, disponivel: estoque > 0, existe };
      }),
  }));
  fileiras.sort(
    (a, b) => posicaoDoAtributo(a.nome) - posicaoDoAtributo(b.nome),
  );
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
 * A escolha que a tela já abre marcada: fileira com UM valor só, esse valor com
 * estoque (mesma conta de `disponivel`, olhando o que já ficou marcado nas
 * fileiras de antes). Fileira com 2+ valores fica de fora -- ali a escolha é da
 * cliente --, e valor único esgotado também. Só decide o que a TELA mostra
 * marcado: a linha que vai ao carrinho continua saindo de `fileirasDeVariacao`
 * com esta mesma escolha, a que o toque no chip montaria.
 */
export function escolhaDasOpcoesUnicas(
  variantes: ProductVariant[] = [],
): Record<string, string> {
  const escolha = new Map<string, string>();
  for (const { nome } of fileirasDeVariacao(variantes, {}).fileiras) {
    const valores =
      fileirasDeVariacao(variantes, Object.fromEntries(escolha)).fileiras.find(
        (f) => f.nome === nome,
      )?.valores ?? [];
    const unico = valores.length === 1 ? valores[0] : undefined;
    if (unico?.disponivel) escolha.set(nome, unico.valor);
  }
  return Object.fromEntries(escolha);
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
