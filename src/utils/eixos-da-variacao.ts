import type { ProductVariant } from "@/types";
import { dividirEmAtributos } from "./variante-composta";

export interface EixoDaVariacao {
  chave: string;
  nome: string;
  grupo: string;
  indice: number;
  valores: string[];
}
interface GrupoDeEixos {
  nome: string;
  eixos: EixoDaVariacao[];
  linhas: { variante: ProductVariant; valores: string[] }[];
}
export interface ModeloDeEixos {
  eixos: EixoDaVariacao[];
  grupos: GrupoDeEixos[];
}

// A decomposição é só da TELA. Identidade, preço e estoque continuam na linha
// original; uma linha malformada faz o grupo inteiro voltar ao formato bruto.
export function criarEixosDaVariacao(
  variantes: ProductVariant[],
): ModeloDeEixos {
  const porNome = new Map<string, ProductVariant[]>();
  for (const v of variantes) {
    if (v.active) porNome.set(v.name, [...(porNome.get(v.name) ?? []), v]);
  }
  const grupos = Array.from(porNome, ([nome, linhas], grupoIndice) => {
    const pares = linhas.map((v) => dividirEmAtributos(v.name, v.value));
    const primeiro = pares[0]!;
    const decompor =
      porNome.size === 1 &&
      pares.every(
        (ps) =>
          ps.length === primeiro.length &&
          ps.every((p, i) => p.name === primeiro.at(i)?.name),
      );
    const eixos = (decompor ? primeiro.map((p) => p.name) : [nome]).map(
      (n, indice) => ({
        chave: `${grupoIndice}:${indice}`,
        nome: n,
        grupo: nome,
        indice,
        valores: [
          ...new Set(
            linhas.map((v, i) =>
              decompor ? pares.at(i)!.at(indice)!.value : v.value,
            ),
          ),
        ],
      }),
    );
    return {
      nome,
      eixos,
      linhas: linhas.map((variante, i) => ({
        variante,
        valores: decompor ? pares.at(i)!.map((p) => p.value) : [variante.value],
      })),
    };
  });
  return { grupos, eixos: grupos.flatMap((g) => g.eixos) };
}
export function disponibilidadeDoValor(
  modelo: ModeloDeEixos,
  escolhas: Map<string, string>,
  chave: string,
  valor: string,
) {
  const grupo = modelo.grupos.find((g) =>
    g.eixos.some((e) => e.chave === chave),
  );
  const linhas =
    grupo?.linhas.filter((l) =>
      grupo.eixos.every((e) => {
        const escolhido = e.chave === chave ? valor : escolhas.get(e.chave);
        return escolhido === undefined || l.valores.at(e.indice) === escolhido;
      }),
    ) ?? [];
  const disponivel = linhas.some((l) => l.variante.stockIncrement > 0);
  return {
    existe: linhas.length > 0,
    disponivel,
    ultima:
      disponivel &&
      linhas.length === 1 &&
      linhas[0]?.variante.stockIncrement === 1 &&
      !!grupo?.eixos.every((e) => e.chave === chave || escolhas.has(e.chave)),
  };
}

export function eixoEhCor(eixo: EixoDaVariacao) {
  return /^(cor|cores|color|estampa)$/i.test(eixo.nome);
}

export function preselecionarCor(
  modelo: ModeloDeEixos,
  escolhas: Map<string, string>,
) {
  const depois = new Map(escolhas);
  for (const e of modelo.eixos) {
    if (!eixoEhCor(e) || depois.has(e.chave)) continue;
    const valor = e.valores.find(
      (v) => disponibilidadeDoValor(modelo, depois, e.chave, v).disponivel,
    );
    if (valor !== undefined) depois.set(e.chave, valor);
  }
  return depois;
}

// Mantém a ordem de inserção dos grupos já escolhidos (caso legado): o primeiro
// continua decidindo o variantId, como no card anterior. Nunca fabrica strings.
export function resolverSelecaoDosEixos(
  modelo: ModeloDeEixos,
  escolhas: Map<string, string>,
  anterior = new Map<string, string>(),
) {
  const resolvidas = new Map<string, string>();
  if (modelo.eixos.some((e) => !escolhas.has(e.chave))) return resolvidas;
  for (const grupo of modelo.grupos) {
    const linha = grupo.linhas.find(
      (l) =>
        l.variante.stockIncrement > 0 &&
        grupo.eixos.every(
          (e) => escolhas.get(e.chave) === l.valores.at(e.indice),
        ),
    );
    if (linha) resolvidas.set(grupo.nome, linha.variante.value);
  }
  if (resolvidas.size !== modelo.grupos.length)
    return new Map<string, string>();
  const depois = new Map<string, string>();
  for (const nome of anterior.keys()) {
    const valor = resolvidas.get(nome);
    if (valor !== undefined) depois.set(nome, valor);
  }
  for (const [nome, valor] of resolvidas) depois.set(nome, valor);
  return depois;
}

// A escolha explícita vence. Revalida os demais valores sem escolher outro por
// conta própria: trocar a cor pode limpar o tamanho, mas jamais comprar outro.
export function escolherValorDoEixo(
  modelo: ModeloDeEixos,
  escolhas: Map<string, string>,
  chave?: string,
  valor?: string,
) {
  const depois = new Map<string, string>();
  if (
    chave !== undefined &&
    valor !== undefined &&
    disponibilidadeDoValor(modelo, depois, chave, valor).disponivel
  )
    depois.set(chave, valor);
  for (const e of modelo.eixos) {
    if (e.chave === chave) continue;
    const v = escolhas.get(e.chave);
    if (
      v !== undefined &&
      disponibilidadeDoValor(modelo, depois, e.chave, v).disponivel
    )
      depois.set(e.chave, v);
  }
  return depois;
}
