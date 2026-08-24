/**
 * Um produto só pode ter UM grupo de variação ("Cor", OU "Tamanho", nunca os
 * dois). A trava vive aqui, fora do componente, para poder ser testada sem
 * montar a tela inteira.
 *
 * POR QUE ELA EXISTE (medido em 24/08/2026)
 *
 * `product_variants` é uma LISTA PLANA de pares `{name, value}`: existem as
 * linhas "Cor: Rosa" e "Tamanho: P", separadas, cada uma com o próprio
 * `stock_increment`. A variante combinada "Rosa tamanho P" não existe, e não há
 * onde ela existir. Com dois grupos no mesmo produto, quatro coisas passam a
 * mentir ao mesmo tempo:
 *
 *  - ESTOQUE: o estoque do produto é a SOMA das variantes ativas
 *    (AdminProductFormView, efeito de "Sync stock dynamically"). Rosa 3 +
 *    Azul 2 + P 3 + M 2 mostra 10 quando existem 5 peças.
 *  - CARRINHO: o item leva UM `variantId` só, o da primeira variação clicada
 *    (ProductView, `selectedVariantObjects[0]?.id`), e a fusão de itens é por
 *    `productId + variantId` (CartContext) — "Rosa+P" e "Rosa+M" viram uma
 *    linha de quantidade 2.
 *  - BANCO: `cart_items` tem `UNIQUE (user_id, product_id, variant_id)`, então
 *    duas combinações do mesmo produto nem cabem na tabela.
 *  - PEDIDO: grava só `variant_id`; a combinação inteira vira texto solto na
 *    observação, sem quantidade.
 *
 * O efeito para quem compra: pede um P e um M, recebe dois P — e o lojista não
 * tem como perceber.
 *
 * A REGRA, e por que ela não é só "no máximo um grupo"
 *
 * Produto legado que já esteja com dois grupos não pode ficar trancado: seria
 * impossível editá-lo para consertar. Então a regra é NÃO PIORAR:
 *
 *  - ao ADICIONAR variante, o resultado precisa ter no máximo um grupo. Quem
 *    está com dois conserta primeiro, e só depois volta a acrescentar peças —
 *    caso contrário engorda um estoque que já está somado errado;
 *  - ao EDITAR variante existente, basta o resultado não ter MAIS grupos do
 *    que já tinha. Isso deixa renomear, deixa salvar sem mexer no grupo, e
 *    deixa juntar tudo num grupo só.
 */

/** O bastante para decidir a trava — o resto de `ProductVariant` não importa. */
export interface VarianteParaTrava {
  id: string;
  name: string;
}

/** "  cor " e "Cor" são o MESMO grupo: sem isso a trava cai na primeira letra maiúscula. */
const chaveDoGrupo = (name: string): string => name.trim().toLocaleLowerCase();

/**
 * Os grupos distintos de uma lista de variantes, na ordem em que aparecem e
 * com a grafia da primeira ocorrência.
 */
export function gruposDeVariacao(variantes: VarianteParaTrava[]): string[] {
  const vistos = new Map<string, string>();
  for (const variante of variantes) {
    const chave = chaveDoGrupo(variante.name);
    if (!chave || vistos.has(chave)) continue;
    vistos.set(chave, variante.name.trim());
  }
  return [...vistos.values()];
}

/** O produto já está no estado que mente. A tela usa isto para avisar. */
export function temGrupoDemais(variantes: VarianteParaTrava[]): boolean {
  return gruposDeVariacao(variantes).length > 1;
}

export interface VeredictoDaTrava {
  bloqueia: boolean;
  /** Os grupos que o produto já usa, prontos para entrar na mensagem. */
  grupoEmUso: string;
}

/**
 * Decide se uma submissão do formulário de variação pode passar.
 *
 * @param variantesAtuais o que o produto tem agora
 * @param idEmEdicao      o id da variante sendo editada, ou `null` ao adicionar
 * @param nomeSubmetido   o grupo digitado no formulário
 */
export function travaDeUmGrupoSo(
  variantesAtuais: VarianteParaTrava[],
  idEmEdicao: string | null,
  nomeSubmetido: string,
): VeredictoDaTrava {
  const gruposAntes = gruposDeVariacao(variantesAtuais);
  const grupoEmUso = gruposAntes.join(" e ");

  const restantes =
    idEmEdicao === null
      ? variantesAtuais
      : variantesAtuais.filter((v) => v.id !== idEmEdicao);

  const gruposDepois = gruposDeVariacao([
    ...restantes,
    { id: idEmEdicao ?? "", name: nomeSubmetido },
  ]);

  // Adicionar: o resultado tem de caber em um grupo só.
  // Editar: basta não aumentar a contagem de grupos.
  const bloqueia =
    idEmEdicao === null
      ? gruposDepois.length > 1
      : gruposDepois.length > gruposAntes.length;

  return { bloqueia, grupoEmUso };
}
