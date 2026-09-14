/**
 * Variante composta — uma COMBINAÇÃO de atributos por linha de variante.
 *
 * O pedido do dono (14/09, ditado por voz): o lojista de roupa precisa de
 * "variante em cima de variante" — a blusa branca tamanho PP com o estoque
 * dela (3), a branca P com o dela (10). Hoje o modal aceita UM atributo por
 * vez, e a trava de `um-grupo-de-variacao.ts` impede dois grupos no mesmo
 * produto PORQUE grupos independentes mentem: o estoque vira soma de peras
 * com maçãs, o carrinho funde combinações e o pedido guarda metade da escolha.
 *
 * O DESENHO ESCOLHIDO (e por que não outro)
 *
 * `product_variants` é uma lista plana de pares `{name, value}` com estoque,
 * preço, SKU e imagem POR LINHA — e tudo que consome variante no caminho do
 * dinheiro (RPCs de pedido v23/v24, carrinho, `cart_items`) só enxerga o `id`
 * da linha. Então a combinação é uma linha: `name` = os atributos juntos
 * ("Cor / Tamanho"), `value` = os valores juntos ("Branca / PP"). A folha do
 * cliente agrupa por `name` e mostra um botão por `value` — o lojista vê
 * "COR / TAMANHO" com um botão por combinação, cada um com o estoque certo,
 * SEM UMA VIRGULA de mudança na tela do cliente (território da peça 18).
 * A trava de um grupo segue valendo intacta: toda linha composta do produto
 * tem o mesmo `name`, logo um grupo só.
 *
 * A alternativa — tabela nova de pares (variante_id, atributo, valor) —
 * exigiria migration em produção e mudança em TODA a cadeia que hoje lê
 * `name`/`value` direto. Menor invasão venceu com esse dado, não com gosto.
 *
 * O separador vive aqui e em nenhum outro lugar. Na EDIÇÃO, `name` e `value`
 * são reabertos em pares conferindo as contagens dos dois lados: se não
 * fecham (o lojista digitou " / " dentro de um valor, por exemplo), a
 * variante abre como UM par com o texto bruto — nada se perde, e salvar de
 * novo sem mexer reproduz exatamente as mesmas strings.
 */

/** Um atributo digitado no modal: "Cor" + "Branca", "Tamanho" + "PP". */
export interface ParDeAtributo {
  name: string;
  value: string;
}

/** O que uma linha de `product_variants` guarda: `name` e `value` NOT NULL. */
export interface IdentidadeDeVariante {
  name: string;
  value: string;
}

/**
 * Espaços em volta importam (" / " com espaços é legível na folha do
 * cliente: "Branca / PP"); dentro do campo, espaços das pontas são cortados
 * antes de juntar, para " PP" não virar parte do valor gravado.
 */
export const SEPARADOR_DE_ATRIBUTOS = " / ";

/**
 * N pares digitados → a identidade da linha. Um par só sai CRU (o caso
 * simples de hoje, "Cor" / "Branca", sem separador nenhum — o produto de um
 * atributo não pode mudar de forma porque o modal agora aceita dois).
 */
export function juntarAtributos(pares: ParDeAtributo[]): IdentidadeDeVariante {
  const validos = pares
    .map((par) => ({ name: par.name.trim(), value: par.value.trim() }))
    .filter((par) => par.name !== "" && par.value !== "");
  return {
    name: validos.map((par) => par.name).join(SEPARADOR_DE_ATRIBUTOS),
    value: validos.map((par) => par.value).join(SEPARADOR_DE_ATRIBUTOS),
  };
}

/**
 * O caminho de volta: a linha gravada → os pares que o modal mostra.
 * Só desmonta quando `name` e `value` têm a MESMA contagem de partes —
 * é a prova de que a linha nasceu de `juntarAtributos`. Qualquer outra
 * coisa (linha legada, valor com " / " digitado à mão) volta como um par
 * com o texto bruto, que round-tripa idêntico.
 */
export function dividirEmAtributos(
  name: string,
  value: string,
): ParDeAtributo[] {
  const nomes = name.split(SEPARADOR_DE_ATRIBUTOS);
  const valores = value.split(SEPARADOR_DE_ATRIBUTOS);
  if (nomes.length === valores.length) {
    return nomes.map((nome, i) => ({ name: nome, value: valores.at(i) ?? "" }));
  }
  return [{ name: name, value: value }];
}

/**
 * A última trava antes de juntar: devolve a mensagem de erro do primeiro
 * problema, ou `null` se pode efetivar. Pares VAZIOS dos dois lados são
 * ignorados (o modal nasce com um par pronto; sobras de cliques em
 * "+ Atributo" não devem obrigar apagamento), mas PAR-METADE (só atributo,
 * só valor) é erro — linha pela metade é exatamente o que esta peça acaba.
 */
export function validarAtributos(pares: ParDeAtributo[]): string | null {
  const preenchidos = pares.filter(
    (par) => par.name.trim() !== "" || par.value.trim() !== "",
  );

  if (preenchidos.length === 0) {
    return "Preencha o atributo (ex: Cor) e o valor (ex: Espacial Grey).";
  }

  for (const par of preenchidos) {
    if (par.name.trim() === "") {
      return "O nome do atributo (ex: Cor, Tamanho) é obrigatório.";
    }
    if (par.value.trim() === "") {
      return "O valor do atributo (ex: Espacial Grey) é obrigatório.";
    }
  }

  const vistos = new Set<string>();
  for (const par of preenchidos) {
    const chave = par.name.trim().toLocaleLowerCase();
    if (vistos.has(chave)) {
      return `O atributo "${par.name.trim()}" está repetido — nesta variante use atributos diferentes (ex: Cor e Tamanho).`;
    }
    vistos.add(chave);
  }

  return null;
}
