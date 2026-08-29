import type { CartItem } from "@/types";

/**
 * Relê o catálogo e diz, numa passada só, o que mudou desde que a pessoa pôs
 * no carrinho E se o banco recusaria o pedido com o que mudou.
 *
 * ESTA É A AÇÃO QUE A MENSAGEM DO BANCO MANDA EXECUTAR e que o app não tinha:
 * "Os valores do pedido mudaram. Atualize o carrinho e tente novamente." —
 * medido em 28/08/2026, `grep -rn "refreshCart" src/` voltava vazio.
 *
 * Serve VISITANTE e logado igual. Hoje `CartContext.tsx:190` sai antes de
 * revalidar quando não há usuário, e é por isso que a recusa acerta
 * principalmente quem ainda não tem conta.
 *
 * ------------------------------------------------------------------
 * DUAS PERGUNTAS, UMA PASSADA — e por que elas não podem ser duas funções
 * compostas pelo chamador.
 *
 * São duas perguntas com respostas opostas:
 *
 *   "o que mudou no meu carrinho?"   -> o CartProvider (Task 6) quer TUDO,
 *                                        sem faixa de aceitação nenhuma.
 *   "o banco recusaria este pedido?" -> o painel (Task 5) quer a conta do
 *                                        banco, com sinal e com tolerância.
 *
 * Até a rodada 5, cada pergunta era uma função: `reconferirCarrinho` listava
 * `MudancaNoCarrinho[]`, e `oBancoRecusaria(itens, mudancas)` recebia essa
 * lista de volta e precisava CASAR cada mudança com a linha do carrinho para
 * saber a quantidade. Essa casada é que produziu dois defeitos seguidos:
 *
 *   Rodada 4: a chave era só `productId`   -> camiseta P e camiseta M (mesmo
 *                                             produto, variações diferentes)
 *                                             colapsavam na mesma entrada do
 *                                             Map, e a conta usava a
 *                                             quantidade da ÚLTIMA linha.
 *   Rodada 5: a chave passou a incluir a   -> as mudanças NUNCA carregam
 *             variação, só de um lado         `variantId` (quem preenche é a
 *                                             Task 3b); a busca errava a
 *                                             chave, e o `?? 0` transformava
 *                                             "não achei esta linha" em "esta
 *                                             mudança não pesa nada" — medido
 *                                             com as duas funções reais: R$
 *                                             5,00 de diferença virava
 *                                             `false`, e o banco recusa.
 *
 * A causa raiz não era a chave — era TER duas listas para casar. Se ninguém
 * precisa casar nada, não há chave para errar. Por isso a conta agora é feita
 * NA MESMA passada que monta a lista de mudanças, com a quantidade da própria
 * linha do carrinho na mão — sem Map, sem chave, sem `?? 0`. E o chamador não
 * tem mais como passar uma lista de mudanças que não corresponde aos itens
 * (a "lista filtrada" que a Task 5 e o refresh depois de remover item
 * produziriam), porque não existe mais parâmetro de lista nenhum.
 *
 * 🔴 `mudancas: []` NUNCA quer dizer "o pedido vai passar". Quer dizer "nada
 * mudou nos ITENS", e o que esta função enxerga de "item" já está incompleto
 * até a Task 3b — e essa lacuna é ESTRUTURALMENTE diferente das outras duas,
 * porque é a única das três que muda o preço por LINHA do carrinho (qual das
 * três pesa MAIS depende da loja, e ninguém mediu isso: numa loja sem produto
 * com variação, esta vale zero enquanto o frete muda todo dia). O banco
 * calcula com `COALESCE(v.price_override, p.preco_venda)` e
 * `v.stock_increment`, mas `lerProdutos` (a interface abaixo) só lê o
 * produto, nunca a variação. A lojista que mexe SÓ no `price_override` de
 * uma variação faz o banco levantar a mensagem #9, e esta função responde
 * `{mudancas: [], oBancoRecusaria: false}`. Task 3c, 28/08/2026.
 *
 * O total do banco também leva frete e desconto, e o campo `frete_gratis` do
 * produto pode mudar sozinho a conta inteira — medido pela revisão de
 * 28/08/2026: produto com frete grátis desligado pela lojista faz o banco
 * recalcular com R$ 15 de frete e recusar, com preço, estoque e `ativo`
 * idênticos. Quem renderizar isto (Task 4) **não pode** transformar
 * `mudancas: []` em "conferimos, está tudo certo" — só `oBancoRecusaria`
 * julga, e mesmo ela é incompleta por construção (não vê variação, frete nem
 * desconto).
 *
 * ------------------------------------------------------------------
 * O QUE `oBancoRecusaria` COPIA DO BANCO, e por que na unidade certa:
 *
 * A trava do banco é `ABS(v_calculated_total - p_total_amount) > 0.05`, e
 * `v_calculated_total` é `Σ(preço × QUANTIDADE) + frete − desconto`. A
 * quantidade MULTIPLICA a diferença.
 *
 *   Rodada 1: tolerância POR ITEM       -> ESCONDIA. 10 unidades subindo 4
 *                                          centavos davam "nada mudou", e o
 *                                          banco recusava por 40 centavos.
 *   Rodada 2: soma dos MÓDULOS          -> ASSUSTAVA. Um item sobe R$ 3 e
 *                                          outro desce R$ 3: o banco fecha o
 *                                          pedido, e a tela avisava mesmo
 *                                          assim.
 *
 * 🔴 Por isso a soma é COM SINAL, módulo só no fim, e por isso `mudancas`
 * (a lista) segue sem tolerância nenhuma: ela só RELATA, quem julga é
 * `oBancoRecusaria`. Ter essa régua em dois lugares foi o que produziu os
 * dois defeitos acima.
 */
export interface MudancaNoCarrinho {
  productId: string;
  /**
   * Ainda NÃO preenchido — fica sempre `undefined` até a Task 3b, que passa a
   * ler `product_variants` e sabe de qual variação a mudança veio. Não
   * precisa dele para a conta: cada linha do carrinho já carrega a própria
   * quantidade, então o total de `oBancoRecusaria` não depende de casar esta
   * mudança de volta com o item — é por isso que colapsar duas variações do
   * mesmo produto (a chave da rodada 4/5) deixou de ser possível.
   */
  variantId?: string;
  nome: string;
  tipo: "preco" | "estoque" | "sumiu";
  de?: number;
  para?: number;
}

export interface LeitorDeCatalogo {
  /**
   * Lê o estado ATUAL de cada id pedido.
   *
   * CONTRATO — leitura que falha tem de LANÇAR (throw), nunca devolver
   * `data ?? []`. Um adaptador que engula o erro do Supabase e devolva `[]`
   * no lugar do erro faz um carrinho de 3 itens válidos virar 3 mudanças
   * `"sumiu"`, e o painel oferece remover produto que existe e está à
   * venda. `[]` só quer dizer "nenhum destes produtos está à venda" — nunca
   * "não consegui ler o catálogo".
   *
   * CONTRATO — uma linha por id, nunca mais de uma. Hoje isso é garantido
   * de graça (`produtos.id` é chave primária). Quando a Task 3b juntar
   * `product_variants`, um produto com três variações NÃO pode voltar em
   * três linhas com o mesmo id aqui — variação é responsabilidade de
   * `lerVariacoes` (Task 3b), separado. `new Map(vivos.map((p) => [p.id,
   * p]))`, logo abaixo, fica com a ÚLTIMA linha de cada id: duplicar id
   * aqui reabre o colapso da rodada 4, só que pelo lado do leitor em vez do
   * lado das mudanças.
   */
  lerProdutos(ids: string[]): Promise<
    Array<{
      id: string;
      nome: string;
      preco: number;
      estoque: number;
      ativo: boolean;
    }>
  >;
}

export interface ResultadoDaReconferencia {
  /** O que mudou, sem faixa de aceitação nenhuma. É o que a tela LISTA. */
  mudancas: MudancaNoCarrinho[];
  /**
   * A conta do banco: `Σ(Δpreço × quantidade)` com SINAL, em centavos
   * inteiros, contra a tolerância de 5 — mais estoque e item sumido, que
   * recusam sozinhos, sem faixa de aceitação.
   *
   * ⚠️ `false` significa **"os ITENS não explicam uma recusa"**, nunca "o
   * pedido vai passar": o total do banco também leva variação (até a Task
   * 3b — `price_override`/`stock_increment` da variação não são lidos
   * aqui, só o produto), frete e desconto.
   *
   * ⚠️ `true` significa **"os itens sozinhos passariam do teto"**, nunca "o
   * banco vai recusar": o banco aplica o cupom depois do subtotal e LIMITA
   * o desconto ao subtotal — um cupom fixo de R$ 50 num carrinho de R$ 40
   * absorve uma alta de R$ 5 que aqui já contou como recusa. Esta função
   * não conhece cupom; julgar isso é de quem tem o cupom na mão, não daqui.
   */
  oBancoRecusaria: boolean;
}

/**
 * A tolerância da trava do banco, em CENTAVOS INTEIROS.
 *
 * Por que centavos e não `0.05`: medido pela revisão de 28/08/2026, uma
 * diferença de exatamente 5 centavos em ponto flutuante dá
 * `0.050000000000000710` e **passa** de `> 0.05`, enquanto o `numeric` do
 * Postgres calcula 0,05 exato e **não** passa. Ou seja: a mesma conta, escrita
 * do mesmo jeito, dá respostas diferentes dos dois lados — e o lado errado é o
 * nosso, avisando à toa. Fazendo a conta em inteiro (centavos), some.
 */
const TOLERANCIA_EM_CENTAVOS = 5;

const emCentavos = (reais: number) => Math.round(reais * 100);

export const reconferirCarrinho = async (
  itens: CartItem[],
  db: LeitorDeCatalogo,
): Promise<ResultadoDaReconferencia> => {
  if (itens.length === 0) return { mudancas: [], oBancoRecusaria: false };

  // Dedup só para a CONSULTA ao catálogo: o mesmo produto pode aparecer em
  // duas linhas do carrinho (duas variações), e pedir o id duas vezes ao
  // banco é desperdício. O loop abaixo continua correndo por LINHA (`itens`,
  // não `ids`), então cada linha usa a própria quantidade — é isso que evita
  // a chave composta das rodadas 4/5.
  const ids = [...new Set(itens.map((i) => i.product.id))];
  const vivos = await db.lerProdutos(ids);
  const porId = new Map(vivos.map((p) => [p.id, p]));

  const sumiram: MudancaNoCarrinho[] = [];
  const deEstoque: MudancaNoCarrinho[] = [];
  const dePreco: MudancaNoCarrinho[] = [];
  let diferencaEmCentavos = 0;

  for (const item of itens) {
    const id = item.product.id;
    const vivo = porId.get(id);
    // `name`/`price`, nao `nome`/`preco`: sao os nomes do tipo `Product` de
    // `@/types`. A primeira versao deste plano errou isso e o typecheck pegou.
    const nome = vivo?.nome ?? item.product.name;

    if (!vivo || !vivo.ativo) {
      sumiram.push({ productId: id, nome, tipo: "sumiu" });
      continue;
    }

    // SEM `continue` entre preço e estoque: o mesmo item pode ter mudado nos
    // dois, e reportar só o primeiro devolve a pessoa ao mesmo beco uma rodada
    // depois — ela aceita o preço novo, clica, e leva recusa por estoque.
    // Achado da revisão de contexto limpo, 28/08/2026.
    if (vivo.estoque < item.quantity) {
      deEstoque.push({
        productId: id,
        nome,
        tipo: "estoque",
        de: item.quantity,
        para: vivo.estoque,
      });
    }

    // A conta do banco, feita AQUI, com a quantidade DESTA linha na mão. Não
    // há Map nem chave para errar — foi a causa dos defeitos das rodadas 4 e
    // 5. Soma COM SINAL: dois itens que se cancelam somam zero, igual ao
    // banco.
    const deltaEmCentavos =
      emCentavos(vivo.preco) - emCentavos(item.product.price);
    if (deltaEmCentavos !== 0) {
      diferencaEmCentavos += deltaEmCentavos * item.quantity;
      // SEM tolerância aqui: esta lista só RELATA. Julgar se a diferença é
      // suficiente para o banco recusar é o que `oBancoRecusaria`, abaixo,
      // decide — ter essa régua em dois lugares foi o que produziu os
      // defeitos das rodadas 1 e 2.
      dePreco.push({
        productId: id,
        nome,
        tipo: "preco",
        de: item.product.price,
        para: vivo.preco,
      });
    }
  }

  const mudancas = [...sumiram, ...deEstoque, ...dePreco];

  return {
    mudancas,
    // Sumido e estoque curto recusam sozinhos: o banco não tem faixa de
    // aceitação para eles.
    //
    // 🔴 `!Number.isFinite(diferencaEmCentavos)`: item sem `preco` no
    // catálogo faz `emCentavos` devolver `NaN`, e `NaN` contamina a soma
    // inteira -- `diferencaEmCentavos` vira `NaN` e FICA `NaN` pelo resto do
    // laço, mesmo com outros itens somando diferenças reais. Sem esta
    // guarda, `Math.abs(NaN) > 5` é `false`: a diferença de TODOS os outros
    // itens some junto, e uma alta de R$ 5,00 num item B vira "o banco
    // aceita" só porque o item A veio sem preço. Falha ABERTA no caminho do
    // dinheiro -- a mesma assinatura dos cinco defeitos anteriores. Task 3c,
    // 28/08/2026.
    oBancoRecusaria:
      sumiram.length > 0 ||
      deEstoque.length > 0 ||
      !Number.isFinite(diferencaEmCentavos) ||
      Math.abs(diferencaEmCentavos) > TOLERANCIA_EM_CENTAVOS,
  };
};
