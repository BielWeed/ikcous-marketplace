/**
 * Grade de combinações — o lojista escolhe os valores de cada atributo
 * (Cor: Amarela, Verde × Tamanho: PP, P, M, G, GG) e o app gera TODAS as
 * combinações de uma vez, criando SÓ as que ainda não existem no produto.
 *
 * Aprovação do dono (14/09/2026, peça 21): desenho A "grade de uma vez" com
 * reaproveitamento de valores, SEM migration — cada combinação vira uma linha
 * comum de `product_variants` (name="Cor / Tamanho", value="Amarela / PP"),
 * pelo mesmo caminho da peça 19 (`variante-composta.ts`). Teto aprovado:
 * 3 atributos e 60 linhas POR PRODUTO (os grandes limitam do mesmo jeito —
 * Shopify 3/100, Nuvemshop 3/1.000; algumas dezenas cobre roupa com folga).
 *
 * TUDO que decide identidade mora aqui, fora da tela, para poder ser testado
 * sem montar o modal. Duas regras do estudo (`criticas-grade-variantes.md`,
 * 1.2 e 1.4) comandam o desenho:
 *
 *  1. Comparar combinação POR PARES NORMALIZADOS (minúsculas, sem espaço das
 *     pontas), nunca pela string pronta — "azul / pp" e "Amarela / PP" são a
 *     mesma combinação, e o banco NÃO tem UNIQUE (product_id, name, value)
 *     para segurar a duplicata: a proteção inteira é esta função.
 *  2. O valor digitado não pode conter "/" — ele é o separador que o
 *     `dividirEmAtributos` usa para desmontar a linha na edição. Valor com
 *     "/" viraria linha que não desmonta.
 *
 * Linha DESATIVADA continua existindo: entra no conjunto de existentes e a
 * grade não a recria nem a reativa — quem quiser a combinação de volta usa
 * "Reativar" na linha (a grade nunca converte nada silenciosamente).
 */

import {
  SEPARADOR_DE_ATRIBUTOS,
  type IdentidadeDeVariante,
} from "@/utils/variante-composta";

/** Teto aprovado de dimensões da grade (Shopify e Nuvemshop: 3 também). */
export const MAX_ATRIBUTOS_DA_GRADE = 3;

/** Teto aprovado de linhas POR PRODUTO (existentes + novas da grade). */
export const MAX_LINHAS_DA_GRADE = 60;

/** Um atributo digitado no passo 1 do modal: "Tamanho" + ["PP","P","M"]. */
export interface AtributoDaGrade {
  name: string;
  valores: string[];
}

export interface GradeGerada {
  /** Só as combinações que AINDA NÃO EXISTEM no produto, na ordem em que
   *  aparecem na grade (primeiro atributo varia mais devagar). */
  linhas: IdentidadeDeVariante[];
  /** Mensagem pronta para o toast do primeiro problema, ou `null`. */
  erro: string | null;
}

/** "  Azul " e "azul" são o MESMO valor — comparação de combinação é por
 *  chave normalizada, não pela grafia (crítica 1.2 do estudo). */
const chaveMinuscula = (texto: string): string =>
  texto.trim().toLocaleLowerCase();

/** A identidade inteira da linha vira UMA chave: atributos e valores
 *  desmontados pelo separador e normalizados. Linha legada de um atributo
 *  ("Cor" / "Branca") e combinação de um par da grade caem na mesma chave. */
function chaveDaIdentidade(identidade: IdentidadeDeVariante): string {
  const nomes = identidade.name
    .split(SEPARADOR_DE_ATRIBUTOS)
    .map(chaveMinuscula)
    .join("|");
  const valores = identidade.value
    .split(SEPARADOR_DE_ATRIBUTOS)
    .map(chaveMinuscula)
    .join("|");
  return `${nomes}#${valores}`;
}

/**
 * O gerador: valida os atributos do passo 1, monta o produto cartesiano e
 * devolve SÓ as linhas faltantes. Devolve o primeiro erro válido como
 * mensagem pronta para o toast (mesma forma de `validarAtributos`).
 *
 * @param atributos  os grupos do passo 1, na ordem em que o lojista montou
 * @param existentes TODAS as linhas do produto — ativas e desativadas
 */
export function gerarGrade(
  atributos: AtributoDaGrade[],
  existentes: IdentidadeDeVariante[],
): GradeGerada {
  if (atributos.length === 0) {
    return {
      linhas: [],
      erro:
        "Escolha os atributos da grade (ex: Cor e Tamanho) e os valores de cada um.",
    };
  }
  if (atributos.length > MAX_ATRIBUTOS_DA_GRADE) {
    return {
      linhas: [],
      erro: `A grade aceita no máximo ${MAX_ATRIBUTOS_DA_GRADE} atributos (ex: Cor, Tamanho e Estampa).`,
    };
  }

  const limpos: { name: string; valores: string[] }[] = [];
  const nomesVistos = new Set<string>();
  for (const atributo of atributos) {
    const nome = atributo.name.trim();
    if (nome === "") {
      return {
        linhas: [],
        erro: "O nome do atributo (ex: Cor, Tamanho) é obrigatório.",
      };
    }
    if (nome.includes("/")) {
      return {
        linhas: [],
        erro: `O atributo "${nome}" não pode conter "/" — ele é o separador entre atributos.`,
      };
    }
    const chaveDoNome = chaveMinuscula(nome);
    if (nomesVistos.has(chaveDoNome)) {
      return {
        linhas: [],
        erro: `O atributo "${nome}" está repetido — use atributos diferentes (ex: Cor e Tamanho).`,
      };
    }
    nomesVistos.add(chaveDoNome);

    // Vazio é ignorado (sobra de digitação não bloqueia a grade), duplicado
    // é fundido na primeira grafia, "/" é recusado — é o separador da casa.
    const valores: string[] = [];
    const valoresVistos = new Set<string>();
    for (const valorBruto of atributo.valores) {
      const valor = valorBruto.trim();
      if (valor === "") continue;
      if (valor.includes("/")) {
        return {
          linhas: [],
          erro: `O valor "${valor}" (em ${nome}) não pode conter "/" — ele é o separador entre atributos.`,
        };
      }
      const chaveDoValor = chaveMinuscula(valor);
      if (valoresVistos.has(chaveDoValor)) continue;
      valoresVistos.add(chaveDoValor);
      valores.push(valor);
    }
    if (valores.length === 0) {
      return {
        linhas: [],
        erro: `Escolha ao menos um valor para "${nome}" (ex: Azul).`,
      };
    }
    limpos.push({ name: nome, valores });
  }

  const existentesVistos = new Set(existentes.map(chaveDaIdentidade));

  // Cartesiano por acumulação: o primeiro atributo varia mais devagar —
  // [Amarela, Verde] × [PP, P] sai Amarela/PP, Amarela/P, Verde/PP, Verde/P,
  // a mesma ordem em que a grade é exibida no passo 2 do modal.
  let combos: string[][] = limpos[0].valores.map((valor) => [valor]);
  for (const seguinte of limpos.slice(1)) {
    const acumulado: string[][] = [];
    for (const combo of combos) {
      for (const valor of seguinte.valores) {
        acumulado.push([...combo, valor]);
      }
    }
    combos = acumulado;
  }

  const linhas: IdentidadeDeVariante[] = [];
  const novasVistas = new Set<string>();
  for (const combo of combos) {
    const identidade: IdentidadeDeVariante = {
      // Um atributo só sai CRU ("Cor" / "Azul"), igual ao caso simples da
      // peça 19 — a grade de uma dimensão não inventa separador.
      name: limpos.map((atributo) => atributo.name).join(SEPARADOR_DE_ATRIBUTOS),
      value: combo.join(SEPARADOR_DE_ATRIBUTOS),
    };
    const chave = chaveDaIdentidade(identidade);
    if (existentesVistos.has(chave) || novasVistas.has(chave)) continue;
    novasVistas.add(chave);
    linhas.push(identidade);

    // Teto POR PRODUTO (proposta aprovada): o que já existe + o que a grade
    // cria não pode passar de 60 — aborta no excedente, sem cortar silencioso.
    if (existentes.length + linhas.length > MAX_LINHAS_DA_GRADE) {
      return {
        linhas: [],
        erro: `A grade passaria de ${MAX_LINHAS_DA_GRADE} variantes neste produto (ele já tem ${existentes.length}). Escolha menos valores — ou desative combinações que não vende mais.`,
      };
    }
  }

  return { linhas, erro: null };
}

/** Mesma limpeza do SKU do modal unitário: caixa alta e espaço vira hífen. */
const sanitizarSku = (texto: string): string =>
  texto.trim().toUpperCase().replace(/\s+/g, "-");

/**
 * O SKU de cada linha da grade: base do lojista + sufixo curto por valor
 * ("BLU" + Amarela + P → "BLU-AMA-P"), no padrão do protótipo aprovado.
 * Base vazia = linha sem SKU (o `upsertVariants` grava NULL, igual ao fluxo
 * unitário). Repetido DENTRO do lote ganha sufixo numérico ("-2", "-3"…):
 * um SKU repetido derruba O LOTE INTEIRO no banco (`product_variants_sku_key`
 * é UNIQUE) — crítica 1.4 do estudo. A colisão com SKU de FORA do lote é
 * `primeiroSkuEmColisao`, logo abaixo.
 */
export function skusDaGrade(
  base: string,
  linhas: IdentidadeDeVariante[],
): string[] {
  const baseLimpa = sanitizarSku(base);
  if (baseLimpa === "") {
    return linhas.map(() => "");
  }
  const usados = new Set<string>();
  return linhas.map((linha) => {
    const sufixos = linha.value
      .split(SEPARADOR_DE_ATRIBUTOS)
      .map((valor) => sanitizarSku(valor).slice(0, 3))
      .filter((pedaco) => pedaco !== "");
    const sugerido = [baseLimpa, ...sufixos].join("-");
    let candidato = sugerido;
    let ordinal = 2;
    while (usados.has(candidato)) {
      candidato = `${sugerido}-${ordinal}`;
      ordinal += 1;
    }
    usados.add(candidato);
    return candidato;
  });
}

/** O primeiro SKU do lote que já pertence a outro produto/linha — o modal
 *  recusa o efetivar mostrando ELE, em vez de deixar o banco derrubar o lote
 *  com toast genérico ("Erro ao salvar as variantes" sem dizer qual linha). */
export function primeiroSkuEmColisao(
  skus: string[],
  ocupados: string[],
): string | null {
  const ocupadas = new Set(
    ocupados.map((sku) => sku.trim().toUpperCase()).filter(Boolean),
  );
  for (const sku of skus) {
    if (sku !== "" && ocupadas.has(sku.trim().toUpperCase())) {
      return sku;
    }
  }
  return null;
}
