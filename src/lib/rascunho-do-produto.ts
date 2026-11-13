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
import { rotuloDaVariacao } from "@/lib/rotulo-da-variacao";
import type { ProductVariant } from "@/types";
import {
  type VariacaoComparavel,
  variacaoMudou,
} from "@/utils/campos-mexidos-do-produto";

/**
 * Validade do rascunho: 7 dias, contados do ÚLTIMO salvamento automático (a
 * cada edição o carimbo se renova, então quem está trabalhando no produto não
 * perde nada). Ajustável: é a única constante do prazo.
 */
export const PRAZO_DO_RASCUNHO_DO_PRODUTO_MS = 7 * 24 * 60 * 60 * 1000;

/** O recado que a lojista lê quando um rascunho com outro estoque é restaurado. */
export const AVISO_ESTOQUE_NAO_RESTAURADO =
  "O estoque não foi restaurado: ele continua como está hoje na loja.";

/** O recado quando o banco mudou depois do rascunho e parte dele não foi usada. */
export const AVISO_PRODUTO_ALTERADO_DEPOIS =
  "Este produto foi alterado depois deste rascunho: o que você não editou ficou como está hoje na loja.";

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
 * A grade do rascunho contra o banco de hoje: o que a lojista EXCLUIU, o que
 * ela nunca viu e o que ela excluiu mas outro aparelho mexeu depois.
 *
 * A lista de exclusões da tela é só memória e não entra no rascunho. Rascunho
 * [A, B] com o banco ainda em [A, B, C], restaurado e salvo, não apagava a C:
 * ela seguia à venda e o estoque gravado era a soma SEM ela. Quem diz que a
 * ausência é exclusão dela, e não coisa de outro aparelho, é o produto-base
 * que o próprio rascunho guarda (`baseDoRascunho`):
 *
 *  - `apagar`: id de verdade que estava na base, NÃO está no rascunho, AINDA
 *    existe no banco e continua IGUAL ao que a base tinha — ela a excluiu
 *    antes de sair e ninguém mexeu nela desde então. Vai para a lista de
 *    exclusões ao restaurar, e só sai do banco quando ela apertar Salvar com a
 *    variação já fora da tela;
 *  - `alteradas`: a mesma exclusão, mas a linha do banco já não é a da base
 *    (outro aparelho a ligou, mexeu no estoque, no preço...). NÃO se apaga: a
 *    versão conferida no salvar é a da abertura, que já inclui a mudança, e a
 *    exclusão passaria sem conflito levando junto o que ela nunca viu. Volta
 *    ao formulário (com a linha do banco) e a tela avisa. Linha da base sem os
 *    campos de comparação (rascunho antigo) cai aqui: na dúvida, não apaga;
 *  - `manter`: tudo o que volta ao formulário vindo do banco, a saber as
 *    `alteradas` mais a variação que nunca esteve na base nem no rascunho
 *    (criada em outro aparelho depois dele). Ela nunca a viu: volta ao
 *    formulário em vez de ser apagada em silêncio nem ficar fora da soma.
 *
 * Sem base, ou sem lista de variações num dos lados (rascunho antigo), não
 * deriva nada: a ausência não prova exclusão. Variação nova (`temp-…`) e a que
 * já sumiu do banco nunca entram em `apagar`. Jamais se deriva a exclusão só
 * de "banco menos formulário" no salvar: a D de outro aparelho seria apagada.
 */
export function variacoesExcluidasNoRascunho(
  rascunho: { variants?: unknown; baseDoRascunho?: unknown },
  bancoDeHoje: ProductVariant[],
): {
  apagar: string[];
  manter: ProductVariant[];
  alteradas: ProductVariant[];
} {
  const nada = { apagar: [], manter: [], alteradas: [] };
  const base = rascunho.baseDoRascunho;
  if (!base || typeof base !== "object") return nada;
  const daBase = new Map(Object.entries(base)).get("variants");
  if (!Array.isArray(daBase) || !Array.isArray(rascunho.variants)) return nada;
  const linhasDaBase = new Map<unknown, VariacaoComparavel>(
    daBase
      .filter((v: { id?: unknown } | null) => v?.id != null)
      .map((v: VariacaoComparavel) => [v.id, v]),
  );
  const idsDoRascunho = new Set(
    rascunho.variants.map((v: { id?: unknown }) => v?.id),
  );
  const bancoPorId = new Map(bancoDeHoje.map((v) => [v.id, v]));
  const apagar: string[] = [];
  const alteradas: ProductVariant[] = [];
  for (const [id, linhaDaBase] of linhasDaBase) {
    if (
      typeof id !== "string" ||
      id.startsWith("temp-") ||
      idsDoRascunho.has(id)
    ) {
      continue;
    }
    const noBanco = bancoPorId.get(id);
    if (!noBanco) continue;
    if (variacaoMudou(linhaDaBase, noBanco)) alteradas.push(noBanco);
    else apagar.push(id);
  }
  const idsAlteradas = new Set(alteradas.map((v) => v.id));
  const manter = bancoDeHoje.filter(
    (v) =>
      idsAlteradas.has(v.id) ||
      (!linhasDaBase.has(v.id) && !idsDoRascunho.has(v.id)),
  );
  return { apagar, manter, alteradas };
}

/**
 * O recado de que variação que ela excluiu foi mexida em outro aparelho e, por
 * isso, voltou para a lista em vez de ir para a exclusão. `null` sem nenhuma.
 */
export function avisoDeVariacoesAlteradasEmOutroAparelho(
  alteradas: Array<Pick<ProductVariant, "name" | "value">>,
): string | null {
  if (alteradas.length === 0) return null;
  const nomes = alteradas.map(
    (v) => rotuloDaVariacao(v.name, v.value) || `${v.name} ${v.value}`.trim(),
  );
  if (nomes.length === 1) {
    return `A variação ${nomes[0]} foi alterada em outro aparelho e voltou para a lista; revise antes de excluir.`;
  }
  const lista = `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  return `As variações ${lista} foram alteradas em outro aparelho e voltaram para a lista; revise antes de excluir.`;
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

const CAMPOS_DO_RASCUNHO = [
  "name",
  "description",
  "price",
  "costPrice",
  "originalPrice",
  "estoqueMinimo",
  "category",
  "images",
  "freeShipping",
  "isBestseller",
  "isActive",
  "metaTitle",
  "metaDescription",
  "sku",
  "codigoBarras",
  "weightKg",
  "widthCm",
  "heightCm",
  "lengthCm",
] as const;

const igual = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const semEstoque = ({
  stock: _a,
  stockIncrement: _b,
  ...resto
}: ProductVariant) => resto;

/**
 * O rascunho de EDIÇÃO por cima do produto como está no banco HOJE.
 *
 * O rascunho guarda o produto-base da época (`baseDoRascunho`). Campo que o
 * rascunho tem IGUAL a essa base é campo que a lojista não editou: nele vale o
 * banco de hoje (outra pessoa pode ter desativado o produto ou baixado o preço
 * depois). Campo que ela editou volta como está. O mesmo vale para cada
 * variação (o estoque não entra na conta: já vem sempre do banco). Rascunho sem
 * base (anterior a esta regra) volta inteiro, como sempre foi.
 * `bancoMudou` diz se algum campo não editado já era outro no banco.
 */
export function rascunhoSobreOBancoDeHoje<R extends Record<string, any>>(
  rascunho: R,
  banco: Record<string, any>,
): { campos: R; bancoMudou: boolean } {
  const base = rascunho.baseDoRascunho;
  if (!base || typeof base !== "object") {
    return { campos: rascunho, bancoMudou: false };
  }
  // Mapas em vez de acesso por chave variável: a lista de campos é fixa.
  const doRascunho = new Map(Object.entries(rascunho));
  const daBase = new Map(Object.entries(base));
  const doBanco = new Map(Object.entries(banco));
  const campos = new Map(doRascunho);
  let bancoMudou = false;
  for (const campo of CAMPOS_DO_RASCUNHO) {
    if (
      !daBase.has(campo) ||
      !igual(doRascunho.get(campo), daBase.get(campo))
    ) {
      const fotosDoRascunho = doRascunho.get(campo);
      const fotosDaBase = daBase.get(campo);
      const fotosDoBanco = doBanco.get(campo);
      if (
        campo === "images" &&
        Array.isArray(fotosDoRascunho) &&
        Array.isArray(fotosDaBase) &&
        Array.isArray(fotosDoBanco) &&
        !igual(fotosDoBanco, fotosDaBase)
      ) {
        // Preserva a ordem dela (inclusive a capa cortada ou escolhida),
        // tira o que o outro aparelho apagou e acrescenta as fotos novas dele.
        campos.set(campo, [
          ...fotosDoRascunho.filter(
            (foto) =>
              !(fotosDaBase.includes(foto) && !fotosDoBanco.includes(foto)),
          ),
          ...fotosDoBanco.filter(
            (foto) =>
              !fotosDaBase.includes(foto) && !fotosDoRascunho.includes(foto),
          ),
        ]);
        bancoMudou = true;
      }
      continue;
    }
    campos.set(campo, doBanco.get(campo));
    if (!igual(doBanco.get(campo), daBase.get(campo))) bancoMudou = true;
  }
  const variacoes = doRascunho.get("variants");
  const variacoesDaBase = daBase.get("variants");
  if (Array.isArray(variacoes) && Array.isArray(variacoesDaBase)) {
    const antesPorId = new Map<string, ProductVariant>(
      variacoesDaBase.map((v: ProductVariant) => [v.id, v]),
    );
    const hojePorId = new Map<string, ProductVariant>(
      (doBanco.get("variants") ?? []).map((v: ProductVariant) => [v.id, v]),
    );
    campos.set(
      "variants",
      variacoes.flatMap((v: ProductVariant) => {
        const antes = antesPorId.get(v.id);
        const hoje = hojePorId.get(v.id);
        const elaEditou = !antes || !igual(semEstoque(v), semEstoque(antes));
        // Existia na base do rascunho, já não existe no banco e ela não mexeu
        // nela: outra pessoa a apagou depois. Não volta (restaurá-la a
        // ressuscitaria) e o aviso de "produto alterado" tem de aparecer. Se
        // ela a editou, a decisão é dela e a do rascunho fica.
        if (antes && !hoje && !elaEditou) {
          bancoMudou = true;
          return [];
        }
        if (!antes || !hoje || elaEditou) return [v];
        if (!igual(semEstoque(hoje), semEstoque(antes))) bancoMudou = true;
        return [hoje];
      }),
    );
  }
  return { campos: Object.fromEntries(campos) as R, bancoMudou };
}
