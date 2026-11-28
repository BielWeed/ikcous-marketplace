import { trocasJaGravadasNoBanco } from "./troca-de-valor-da-variacao";

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

export function variacaoMudou(
  a: VariacaoComparavel,
  b: VariacaoComparavel,
): boolean {
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

// Só na tela: o marcador acompanha a variação provisória sem ir para o JSON.
export const ESTOQUE_HERDADO = Symbol("estoque herdado");

export interface ComEstoqueHerdado {
  [ESTOQUE_HERDADO]?: boolean;
}

export function estoqueFoiHerdado({
  [ESTOQUE_HERDADO]: herdado,
}: ComEstoqueHerdado): boolean {
  return herdado === true;
}

/**
 * Depois de uma recusa, campo que a lojista não tocou acompanha o banco;
 * campo que ela editou fica. Comparar com a abertura ANTES de trocar a base
 * impede que o segundo salvar trate o preço velho da tela como edição dela.
 * Estoque existente vem do banco; a nova só é atualizada se ainda herda o
 * saldo do produto. Zero também vale (a última peça pode ter sido vendida).
 */
export function variacoesAposConflito<
  V extends VariacaoComparavel & ComEstoqueHerdado & { stock?: number },
>(tela: V[], abertura: V[], banco: V[], saldoHerdavel?: number): V[] {
  const antesPorId = new Map(abertura.map((v) => [v.id, v]));
  const hojePorId = new Map(banco.map((v) => [v.id, v]));
  // Troca de valor que o salvar anterior já gravou (ver
  // `trocasJaGravadasNoBanco`): a linha da tela é a antiga, que o banco
  // guardou desligada com o valor de abertura. Ela deixa de ser edição — o
  // que ela digitou foi para a opção nova, que entra pelo banco.
  const jaTrocadas = new Set(
    trocasJaGravadasNoBanco(tela, abertura, banco).map((t) => t.idAntigo),
  );
  const mescladas = tela.flatMap((v): V[] => {
    if (v.id.startsWith("temp-")) {
      return estoqueFoiHerdado(v) && saldoHerdavel !== undefined
        ? [{ ...v, stockIncrement: saldoHerdavel }]
        : [v];
    }
    const antes = antesPorId.get(v.id);
    const hoje = hojePorId.get(v.id);
    // Apagada em outro aparelho: sai da grade, editada ou não. Mantê-la
    // somaria o estoque velho dela ao do produto no segundo salvar, e a RPC
    // ignoraria a linha inexistente (estoque fantasma). Igual ao rascunho.
    if (!hoje) return [];
    const { stock: _estoqueAntigo, ...resto } = v;
    const comEstoqueAtual = {
      ...resto,
      stockIncrement: hoje.stockIncrement,
      ...(hoje.stock !== undefined ? { stock: hoje.stock } : {}),
    } as V;
    if (!antes) return [comEstoqueAtual];
    const daTela = jaTrocadas.has(v.id) ? antes : v;
    return [
      {
        ...comEstoqueAtual,
        name: daTela.name === antes.name ? hoje.name : daTela.name,
        value: daTela.value === antes.value ? hoje.value : daTela.value,
        sku:
          vazioViraNulo(daTela.sku) === vazioViraNulo(antes.sku)
            ? hoje.sku
            : daTela.sku,
        codigoBarras:
          vazioViraNulo(daTela.codigoBarras) ===
          vazioViraNulo(antes.codigoBarras)
            ? hoje.codigoBarras
            : daTela.codigoBarras,
        priceOverride:
          (daTela.priceOverride ?? null) === (antes.priceOverride ?? null)
            ? hoje.priceOverride
            : daTela.priceOverride,
        active: daTela.active === antes.active ? hoje.active : daTela.active,
        imageUrl:
          vazioViraNulo(daTela.imageUrl) === vazioViraNulo(antes.imageUrl)
            ? hoje.imageUrl
            : daTela.imageUrl,
      },
    ];
  });
  // Não ressuscita a que ela excluiu aqui: só acrescenta a que nunca viu.
  const idsConhecidos = new Set([...tela, ...abertura].map((v) => v.id));
  return [...mescladas, ...banco.filter((v) => !idsConhecidos.has(v.id))];
}

/**
 * As fotos que o formulário passa a mostrar depois de o salvar ser recusado
 * porque OUTRO aparelho mexeu no produto (a versão lida na abertura ficou
 * velha). `formulario` é o que a lojista tem na tela, `abertura` o que a tela
 * leu ao abrir e `doBanco` o que o banco tem agora.
 *
 * - Ela não mexeu nas fotos: vale o banco (inclusive a ordem, que o outro
 *   aparelho pode ter trocado para mudar a principal).
 * - Ela mexeu: a lista dela fica, sem as fotos que o outro aparelho tirou
 *   (o arquivo delas já foi para o backup, o endereço não abre mais) e com as
 *   que o outro aparelho pôs. Assim o salvar seguinte não apaga nem ressuscita
 *   foto de ninguém.
 */
export function fotosAposConflito(
  formulario: string[],
  abertura: string[],
  doBanco: string[],
): string[] {
  if (valoresIguais(formulario, abertura)) return doBanco;
  const naAbertura = new Set(abertura);
  const noBanco = new Set(doBanco);
  const tiradasPeloOutro = new Set(
    abertura.filter((foto) => !noBanco.has(foto)),
  );
  const postasPeloOutro = doBanco.filter((foto) => !naAbertura.has(foto));
  return [
    ...formulario.filter((foto) => !tiradasPeloOutro.has(foto)),
    ...postasPeloOutro.filter((foto) => !formulario.includes(foto)),
  ];
}
