// O rascunho do formulário de produto (o que a lojista digitou e não salvou).
//
// Duas regras vivem aqui, fora da tela, para serem provadas sem montá-la:
//
// 1. ESTOQUE NÃO SE RESTAURA. O número de estoque que estava no formulário no
//    dia em que o rascunho nasceu fica velho no instante em que uma venda o
//    desconta no banco. Restaurar o rascunho e salvar devolvia a peça vendida
//    à prateleira (5 no rascunho, 2 vendidas, 3 no banco: depois de
//    "Restaurar" + "Salvar" o banco voltava a 5 e a loja vendia peça que não
//    existe). O resto do rascunho (nome, descrição, preço, fotos...) é
//    trabalho da lojista e volta inteiro; o estoque vem SEMPRE do banco de hoje.
//    Variação NOVA (id provisório `temp-…`, ainda sem linha no banco) mantém o
//    número digitado: não há estoque de banco para ela.
//
// 2. O RASCUNHO VENCE. Passados 7 dias o rascunho é descartado ao abrir. Um
//    rascunho de semanas atrás não é "onde ela parou", é um formulário de outra
//    época (preço, fotos e grade já podem ter mudado por outro caminho).
import { chaveDoUsuario } from "@/lib/fila-offline-por-usuario";
import type { ProductVariant } from "@/types";

/**
 * Validade do rascunho: 7 dias, contados do ÚLTIMO salvamento automático (a
 * cada edição o carimbo se renova, então quem está trabalhando no produto não
 * perde nada). Ajustável: é a única constante do prazo.
 */
export const PRAZO_DO_RASCUNHO_DO_PRODUTO_MS = 7 * 24 * 60 * 60 * 1000;

/** O recado que a lojista lê quando um rascunho com outro estoque é restaurado. */
export const AVISO_ESTOQUE_NAO_RESTAURADO =
  "O estoque não foi restaurado: ele continua como está hoje na loja.";

/** Chave no `localStorage` do rascunho DO USUÁRIO (`null` sem uid). */
export function chaveDoRascunhoDoProduto(
  userId: string | undefined,
  productId?: string,
): string | null {
  if (!userId) return null;
  return chaveDoUsuario(
    productId
      ? `ikcous_product_form_draft_edit_${productId}`
      : "ikcous_product_form_draft",
    userId,
  );
}

/** Apaga o rascunho (o do produto novo, se `productId` não vier). */
export function descartarRascunhoDoProduto(
  userId: string | undefined,
  productId?: string,
): void {
  const chave = chaveDoRascunhoDoProduto(userId, productId);
  if (!chave) return;
  try {
    localStorage.removeItem(chave);
  } catch (erro) {
    console.warn("[rascunho-do-produto] Não consegui apagar o rascunho:", erro);
  }
}

/**
 * O texto que vai para o `localStorage`: os campos do formulário mais o
 * carimbo de quando foram guardados (`salvoEm`, em milissegundos).
 */
export function serializarRascunhoDoProduto(
  campos: object,
  agora: number = Date.now(),
): string {
  return JSON.stringify({ ...campos, salvoEm: agora });
}

/**
 * O rascunho passou do prazo? Sem carimbo (rascunho gravado antes desta
 * regra) conta como vigente: o estoque dele já não é restaurado, então o pior
 * que ele faz é trazer de volta texto velho — e o próximo salvamento
 * automático põe o carimbo.
 */
export function rascunhoVenceu(
  rascunho: { salvoEm?: unknown } | null | undefined,
  agora: number = Date.now(),
): boolean {
  const salvoEm = rascunho?.salvoEm;
  if (typeof salvoEm !== "number" || !Number.isFinite(salvoEm)) return false;
  return agora - salvoEm > PRAZO_DO_RASCUNHO_DO_PRODUTO_MS;
}

/**
 * Lê o rascunho guardado, já descartando o vencido: devolve o texto bruto
 * (quem chama faz o `JSON.parse` dentro do próprio try/catch, como sempre) ou
 * `null` se não há rascunho ou ele venceu — e neste caso a chave sai do
 * `localStorage`. Texto que não é JSON volta como está: o erro é de quem lê.
 */
export function lerRascunhoVigenteDoProduto(
  chave: string,
  agora: number = Date.now(),
): string | null {
  const bruto = localStorage.getItem(chave);
  if (!bruto) return null;
  try {
    if (rascunhoVenceu(JSON.parse(bruto), agora)) {
      localStorage.removeItem(chave);
      return null;
    }
  } catch {
    // Não é JSON: segue para o parse de quem chama, que registra o erro.
  }
  return bruto;
}

const ehVariacaoNova = (v: { id?: unknown }) =>
  typeof v.id === "string" && v.id.startsWith("temp-");

/**
 * As variações do rascunho com o estoque do BANCO de hoje.
 *
 *  - já existe no banco: tudo o que a lojista editou no rascunho (nome, valor,
 *    ligada, preço, foto, códigos) fica; o estoque (`stockIncrement`/`stock`)
 *    é o do banco;
 *  - nova (`temp-…`): fica como digitada, estoque incluso;
 *  - tem id de verdade mas já não existe no banco (saiu desde o rascunho):
 *    não volta — restaurá-la recriaria, pelo upsert, uma variação apagada com
 *    o estoque de antes.
 */
export function variacoesDoRascunhoComEstoqueDoBanco(
  doRascunho: ProductVariant[],
  doBanco: ProductVariant[],
): ProductVariant[] {
  const bancoPorId = new Map(doBanco.map((v) => [v.id, v]));
  return doRascunho.flatMap((v) => {
    if (ehVariacaoNova(v)) return [v];
    const noBanco = bancoPorId.get(v.id);
    if (!noBanco) return [];
    const { stock: _estoqueDoRascunho, ...resto } = v;
    return [
      {
        ...resto,
        stockIncrement: noBanco.stockIncrement,
        ...(noBanco.stock !== undefined ? { stock: noBanco.stock } : {}),
      },
    ];
  });
}

/**
 * O rascunho trazia um estoque DIFERENTE do que está no banco hoje? É o que
 * decide se a lojista recebe o aviso "o estoque não foi restaurado" — avisar
 * quando os números batem seria ruído.
 *
 * Com variação ligada o estoque do produto é a soma delas (a tela calcula e
 * trava o campo), então só o número de cada variação conta; sem nenhuma
 * ligada, vale o campo do produto.
 */
export function estoqueDoRascunhoDifereDoBanco(
  rascunho: { stock?: unknown; variants?: unknown },
  banco: { stock: string; variants: ProductVariant[] },
): boolean {
  const variantesDoRascunho = Array.isArray(rascunho.variants)
    ? (rascunho.variants as ProductVariant[])
    : banco.variants;
  const bancoPorId = new Map(banco.variants.map((v) => [v.id, v]));
  for (const v of variantesDoRascunho) {
    const noBanco = bancoPorId.get(v.id);
    if (noBanco && noBanco.stockIncrement !== v.stockIncrement) return true;
  }
  const temLigada =
    banco.variants.some((v) => v.active) ||
    variantesDoRascunho.some((v) => v.active);
  if (temLigada) return false;
  return rascunho.stock != null && String(rascunho.stock) !== banco.stock;
}
