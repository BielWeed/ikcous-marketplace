/**
 * O estoque do produto quando ele tem variações.
 *
 * A regra da casa (efeito "Sync stock dynamically" do formulário): com ao
 * menos UMA variação ligada, o estoque do produto é a SOMA das ligadas e o
 * campo do produto fica travado. O buraco que esta função fecha: ao desligar
 * a última variação ligada o campo destrava, mas continuava mostrando a soma
 * de antes — o lojista via "5 unidades" num produto em que nada mais está à
 * venda, e salvava esse 5.
 *
 * Por isso a decisão olha a TRANSIÇÃO (lista de antes × lista de depois), não
 * só o estado de agora:
 *
 *  - depois tem ligada → a soma das ligadas (como já era);
 *  - antes tinha ligada, depois tem variações mas NENHUMA ligada → "0", uma
 *    única vez (o campo destravado é do lojista dali em diante: a transição
 *    seguinte já parte de "nenhuma ligada" e devolve `null`);
 *  - qualquer outro caso → `null`, o número não é tocado. Em especial o
 *    produto antigo que já abre sem nenhuma variação ligada (a lista de antes
 *    é vazia na abertura), e a lista que esvazia por inteiro (o lojista
 *    apagou as variações e continua dono do número que estava lá).
 *
 * Fica fora do componente para ser testada sem montar a tela.
 */

/** O bastante para decidir o estoque — o resto de `ProductVariant` não importa. */
export interface VariacaoParaEstoque {
  active: boolean;
  stockIncrement: number;
}

/**
 * @param antes        as variações do formulário antes da mudança
 * @param depois       as variações do formulário agora
 * @param estoqueAtual o estoque do produto como está no formulário (texto)
 * @returns o novo estoque (texto) ou `null` se não há nada a mudar
 */
export function estoqueDoProdutoPelasVariacoes(
  antes: VariacaoParaEstoque[],
  depois: VariacaoParaEstoque[],
  estoqueAtual: string,
): string | null {
  const ligadasDepois = depois.filter((v) => v.active);

  let novo: string | null = null;
  if (ligadasDepois.length > 0) {
    novo = ligadasDepois
      .reduce((soma, v) => soma + (v.stockIncrement || 0), 0)
      .toString();
  } else if (depois.length > 0 && antes.some((v) => v.active)) {
    novo = "0";
  }

  return novo !== null && novo !== estoqueAtual ? novo : null;
}

/**
 * O formulário com a lista de variações trocada e o estoque do produto já
 * acertado pela transição. É por aqui que TODA mudança feita pelo lojista na
 * lista passa (modal, desligar/religar, grade) — e não por um efeito que
 * olha a lista a cada render — para que restaurar rascunho ou abrir produto
 * não pareçam "desligar a última" e não sobrescrevam o número guardado.
 */
export function formComVariacoes<
  F extends { stock: string; variants: VariacaoParaEstoque[] },
  V extends VariacaoParaEstoque,
>(anterior: F, variants: V[]): F & { variants: V[] } {
  const estoque = estoqueDoProdutoPelasVariacoes(
    anterior.variants,
    variants,
    anterior.stock,
  );
  return {
    ...anterior,
    variants,
    stock: estoque ?? anterior.stock,
  };
}

/**
 * O que o formulário de EDIÇÃO manda ao salvar, para o estoque só ir quando a
 * lojista mexeu nele.
 *
 * Estoque é dinheiro e o número que a tela leu ao abrir fica velho no instante
 * em que uma venda o desconta no banco. Mandar esse número de volta num salvar
 * em que ela só trocou o preço devolvia a peça vendida à prateleira (e a
 * reserva que vence depois a devolvia DE NOVO). A regra é a mesma que a tela já
 * tinha com peso e medidas: campo que ela não tocou não viaja.
 *
 * Sempre contra o que a tela LEU ao abrir (`inicial`), nunca contra o banco.
 */

/** O bastante para comparar uma variação com a que a tela leu ao abrir. */
export interface VariacaoComIdParaEstoque extends VariacaoParaEstoque {
  id: string;
}

/** As variações ligadas e o estoque de cada uma, numa chave comparável. */
function composicaoDasLigadas(variants: VariacaoComIdParaEstoque[]): string {
  return variants
    .filter((v) => v.active)
    .map((v) => `${v.id}:${v.stockIncrement || 0}`)
    .sort()
    .join("|");
}

/**
 * A lojista mexeu no estoque do PRODUTO?
 *
 * Com variação ligada (antes ou agora) o número do produto é a SOMA delas, que
 * a tela calcula sozinha e trava o campo: mexer é mudar QUAIS variações estão
 * ligadas ou o estoque de alguma. Comparar o texto do campo aí acusaria "mexeu"
 * sempre que o produto guardado no banco divergir da soma — sem ninguém ter
 * tocado em nada. Sem variação ligada, o campo é dela e vale o texto.
 */
export function estoqueDoProdutoFoiMexido(
  atual: { stock: string; variants: VariacaoComIdParaEstoque[] },
  inicial: { stock: string; variants: VariacaoComIdParaEstoque[] },
): boolean {
  const temLigadaAgora = atual.variants.some((v) => v.active);
  const tinhaLigada = inicial.variants.some((v) => v.active);
  if (temLigadaAgora || tinhaLigada) {
    return (
      composicaoDasLigadas(atual.variants) !==
      composicaoDasLigadas(inicial.variants)
    );
  }
  return atual.stock !== inicial.stock;
}

/**
 * As variações a gravar: a que já existe no banco e cujo estoque a lojista NÃO
 * mexeu perde a chave `stockIncrement` (o hook então não manda a coluna). A
 * nova (id `temp-`, sem linha no banco) leva sempre o número digitado; a que
 * não estava na lista de abertura também.
 */
export function variacoesSoComEstoqueMexido<V extends VariacaoComIdParaEstoque>(
  atuais: V[],
  iniciais: VariacaoComIdParaEstoque[],
): Array<V | Omit<V, "stockIncrement">> {
  const estoqueDeAbertura = new Map(
    iniciais.map((v) => [v.id, v.stockIncrement]),
  );
  return atuais.map((v) => {
    if (v.id.startsWith("temp-") || !estoqueDeAbertura.has(v.id)) return v;
    if (estoqueDeAbertura.get(v.id) !== v.stockIncrement) return v;
    return Object.fromEntries(
      Object.entries(v).filter(([chave]) => chave !== "stockIncrement"),
    ) as Omit<V, "stockIncrement">;
  });
}
