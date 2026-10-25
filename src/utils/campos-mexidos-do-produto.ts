/**
 * Editar um produto manda SÓ o que a lojista mudou.
 *
 * O formulário de edição mandava o produto inteiro com os valores de quando a
 * tela abriu. Com duas pessoas (ou dois aparelhos) no mesmo produto, quem
 * salvava por último desfazia em silêncio o preço, o "ativo" e as fotos do
 * outro — e a tela dizia "Produto atualizado!". A regra aqui é a que a tela já
 * tinha com estoque e medidas: campo que ela não tocou não viaja.
 *
 * As duas funções comparam contra o que a tela LEU ao abrir (nunca contra o
 * banco de agora): o objetivo não é saber o que mudou no banco, é saber o que
 * a lojista decidiu mudar.
 *
 * Contrato de "limpar" (que não pode mudar): `null` é "limpei de verdade" e vai;
 * `undefined` é "não mexi" e a guarda `updates.X !== undefined` do useProducts
 * descarta a chave. Por isso:
 *  - o que mudou para vazio (`null`) continua indo como `null`;
 *  - o que não mudou sai do remendo (ausente);
 *  - `undefined` do lado de cá (as medidas, com entrega local) segue sendo
 *    "não mexi" e também sai.
 */

function valoresIguais(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => valoresIguais(item, b.at(i)))
    );
  }
  return Object.is(a, b);
}

/**
 * Do remendo montado a partir do formulário (`atual`) e do mesmo remendo
 * montado a partir do que a tela leu ao abrir (`base`), só as chaves cujo
 * valor mudou. Os dois têm de ter sido montados pela MESMA função (mesma
 * normalização de número, código e foto), senão "50" e "50,00" pareceriam
 * diferentes — o que só mandaria um campo a mais, nunca a menos.
 */
export function camposQueMudaram<T extends Record<string, unknown>>(
  atual: T,
  base: T,
): Partial<T> {
  const deAbertura = new Map(Object.entries(base));
  return Object.fromEntries(
    Object.entries(atual).filter(
      ([chave, valor]) =>
        valor !== undefined && !valoresIguais(valor, deAbertura.get(chave)),
    ),
  ) as Partial<T>;
}

/** O bastante de uma variação para saber se a lojista mexeu nela. */
export interface VariacaoComparavel {
  id: string;
  name: string;
  value: string;
  sku?: string | null;
  codigoBarras?: string | null;
  stockIncrement: number;
  priceOverride?: number | null;
  active: boolean;
  imageUrl?: string | null;
}

const vazioViraNulo = (valor: string | null | undefined) => valor || null;

function variacaoMudou(a: VariacaoComparavel, b: VariacaoComparavel): boolean {
  return (
    a.name !== b.name ||
    a.value !== b.value ||
    vazioViraNulo(a.sku) !== vazioViraNulo(b.sku) ||
    vazioViraNulo(a.codigoBarras) !== vazioViraNulo(b.codigoBarras) ||
    a.stockIncrement !== b.stockIncrement ||
    (a.priceOverride ?? null) !== (b.priceOverride ?? null) ||
    a.active !== b.active ||
    vazioViraNulo(a.imageUrl) !== vazioViraNulo(b.imageUrl)
  );
}

/**
 * As variações que vão no salvar: a nova (id `temp-`, ou que a tela não leu ao
 * abrir) e a que a lojista mexeu em qualquer campo. As outras ficam de fora.
 *
 * O banco regrava a linha da variação INTEIRA (nome, valor, código, preço
 * próprio, ligada, foto), então a única forma de não desfazer o preço próprio
 * que outra pessoa pôs numa variação é não mandá-la. A variação mexida vai
 * inteira, como sempre foi: não existe patch por campo dentro da linha.
 */
export function variacoesQueMudaram<V extends VariacaoComparavel>(
  atuais: V[],
  iniciais: VariacaoComparavel[],
): V[] {
  const deAbertura = new Map(iniciais.map((v) => [v.id, v]));
  return atuais.filter((v) => {
    if (v.id.startsWith("temp-")) return true;
    const inicial = deAbertura.get(v.id);
    if (!inicial) return true;
    return variacaoMudou(v, inicial);
  });
}
