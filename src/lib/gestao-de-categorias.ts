// Gestão de categorias (migration 20261237000000): as regras PURAS que cercam as
// três portas do banco (`renomear_categoria`, `apagar_categoria_vazia` e
// `categorias_com_uso`), todas testáveis sem rede.
//
// A categoria do produto é guardada pelo NOME (texto), em quatro lugares: a
// linha de `categorias`, `produtos.categoria`, o link do banner e a lista
// "sem troca" da política de devolução. Quem troca os quatro numa transação só
// é o BANCO; este arquivo só lê a resposta pela FORMA, conta o que está em uso
// em português e traduz a recusa.

/** O que o servidor diz de UMA categoria na tela "Gerenciar categorias". */
export interface CategoriaComUso {
  readonly id: string;
  readonly nome: string;
  readonly slug: string;
  /** `false` = escondida da vitrine (a coluna `categorias.ativo`). */
  readonly ativa: boolean;
  readonly produtos: number;
  /** Dos `produtos`, quantos estão excluídos: a lista de produtos não os mostra. */
  readonly produtosExcluidos: number;
  readonly banners: number;
  readonly regraDeDevolucao: number;
}

/** O que `renomear_categoria` devolve. */
export interface ResultadoDoRenome {
  readonly id: string;
  readonly nomeAntigo: string;
  readonly nome: string;
  readonly slug: string;
  /** `false` quando o nome novo era o mesmo texto: nada foi escrito. */
  readonly mudou: boolean;
  readonly produtos: number;
  readonly banners: number;
  readonly regraDeDevolucao: number;
}

/** O que `apagar_categoria_vazia` devolve. */
export interface ResultadoDoApagar {
  readonly id: string;
  readonly nome: string;
}

/** O que mudou, para as telas que guardam o NOME da categoria se acertarem. */
export type MudancaDeCategoria =
  | {
      readonly tipo: "renomeada";
      readonly de: string;
      readonly para: string;
    }
  | { readonly tipo: "apagada"; readonly nome: string }
  | { readonly tipo: "visibilidade" };

/** Erro de gestão de categoria: a mensagem já é para a lojista; o `code` é o do banco. */
export class ErroDeCategoria extends Error {
  readonly code: string | undefined;
  constructor(mensagem: string, code?: string) {
    super(mensagem);
    this.name = "ErroDeCategoria";
    this.code = code;
  }
}

function objeto(dados: unknown, oQue: string): Record<string, unknown> {
  if (typeof dados !== "object" || dados === null || Array.isArray(dados)) {
    throw new Error(`Resposta inesperada do servidor ao ${oQue}.`);
  }
  return dados as Record<string, unknown>;
}

function texto(valor: unknown, oQue: string): string {
  if (typeof valor !== "string") {
    throw new Error(`Resposta inesperada do servidor ao ${oQue}.`);
  }
  return valor;
}

function contagem(valor: unknown, oQue: string): number {
  if (typeof valor !== "number" || !Number.isInteger(valor) || valor < 0) {
    throw new Error(`Resposta inesperada do servidor ao ${oQue}.`);
  }
  return valor;
}

/**
 * Lê a lista de `categorias_com_uso` pela FORMA; resposta torta é erro, nunca
 * lista vazia. A ordem que a lojista vê é a do idioma dela (pt-BR: "Íntimos"
 * fica entre "Hobbies" e "Joias"), não a do banco: o banco ordena por byte, igual
 * em qualquer loja, e o desempate é o id.
 */
export function lerCategoriasComUso(dados: unknown): CategoriaComUso[] {
  const oQue = "listar as categorias";
  if (!Array.isArray(dados)) {
    throw new Error(`Resposta inesperada do servidor ao ${oQue}.`);
  }
  const lista = dados.map((item) => {
    const c = objeto(item, oQue);
    if (typeof c.ativo !== "boolean") {
      throw new Error(`Resposta inesperada do servidor ao ${oQue}.`);
    }
    return {
      id: texto(c.id, oQue),
      nome: texto(c.nome, oQue),
      slug: typeof c.slug === "string" ? c.slug : "",
      ativa: c.ativo,
      produtos: contagem(c.produtos, oQue),
      produtosExcluidos: contagem(c.produtos_excluidos, oQue),
      banners: contagem(c.banners, oQue),
      regraDeDevolucao: contagem(c.regra_devolucao, oQue),
    };
  });
  return lista.sort(
    (a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }) ||
      a.nome.localeCompare(b.nome, "pt-BR") ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Lê a resposta de `renomear_categoria` pela FORMA. */
export function lerResultadoDoRenome(dados: unknown): ResultadoDoRenome {
  const oQue = "renomear a categoria";
  const r = objeto(dados, oQue);
  if (typeof r.mudou !== "boolean") {
    throw new Error(`Resposta inesperada do servidor ao ${oQue}.`);
  }
  return {
    id: texto(r.id, oQue),
    nomeAntigo: texto(r.nome_antigo, oQue),
    nome: texto(r.nome, oQue),
    slug: typeof r.slug === "string" ? r.slug : "",
    mudou: r.mudou,
    produtos: contagem(r.produtos, oQue),
    banners: contagem(r.banners, oQue),
    regraDeDevolucao: contagem(r.regra_devolucao, oQue),
  };
}

/** Lê a resposta de `apagar_categoria_vazia` pela FORMA. */
export function lerResultadoDoApagar(dados: unknown): ResultadoDoApagar {
  const oQue = "apagar a categoria";
  const r = objeto(dados, oQue);
  if (r.apagada !== true) {
    throw new Error(`Resposta inesperada do servidor ao ${oQue}.`);
  }
  return { id: texto(r.id, oQue), nome: texto(r.nome, oQue) };
}

/**
 * A régua da vitrine para "é a mesma categoria": minúscula e sem espaço nas
 * pontas (a mesma de `HomeView` e `useSearch`). NÃO tira acento: "Íntimos" e
 * "Intimos" são duas categorias, como no banco.
 */
export function chaveDaCategoria(nome: string): string {
  return nome.trim().toLowerCase();
}

export function mesmaCategoria(a: string, b: string): boolean {
  return chaveDaCategoria(a) === chaveDaCategoria(b);
}

/**
 * "Todas" é o filtro que a vitrine mostra antes de todas as categorias (e "all"
 * é o valor dele no painel): uma categoria com esse nome colidiria com ele e
 * nunca poderia ser filtrada. O banco recusa ao renomear; a tela recusa também
 * ao criar. Devolve a frase para a lojista, ou `null` quando o nome serve.
 */
export function erroDoNomeReservado(nome: string): string | null {
  const chave = chaveDaCategoria(nome);
  if (chave !== "todas" && chave !== "all") return null;
  return `O nome “${nome.trim()}” já é do filtro que mostra todos os produtos da loja. Escolha outro nome.`;
}

/** O nome está na lista de categorias que a tela conhece (pela régua da vitrine)? */
export function categoriaExisteNaLista(
  nome: string,
  lista: readonly { readonly name: string }[],
): boolean {
  return lista.some((c) => mesmaCategoria(c.name, nome));
}

/**
 * Troca o nome antigo pelo novo numa lista de nomes de categoria (a "sem troca
 * por gosto" da política de devolução), do mesmo jeito que o banco faz ao
 * renomear: quem é a mesma categoria pela régua da vitrine passa a ter o nome
 * novo, a ordem fica e o que ficou repetido é tirado. Devolve a MESMA lista
 * (mesma referência) quando nada mudou.
 */
export function trocarNomeNaLista(
  lista: readonly string[],
  de: string,
  para: string,
): string[] {
  if (!lista.some((item) => mesmaCategoria(item, de))) return lista as string[];
  const trocada = lista.map((item) => (mesmaCategoria(item, de) ? para : item));
  return trocada.filter((item, i) => trocada.indexOf(item) === i);
}

/** A categoria está em uso: produto, banner ou regra de devolução aponta para ela. */
export function categoriaEmUso(c: {
  readonly produtos: number;
  readonly banners: number;
  readonly regraDeDevolucao: number;
}): boolean {
  return c.produtos > 0 || c.banners > 0 || c.regraDeDevolucao > 0;
}

const plural = (n: number, um: string, varios: string) =>
  `${n} ${n === 1 ? um : varios}`;

/**
 * "3 produtos, 1 banner e a regra de devolução" — ou `null` quando não há uso.
 * Produto EXCLUÍDO conta (o banco o troca e ele impede apagar), mas a lojista
 * não o vê na lista de produtos: o texto diz quantos são, em vez de deixá-la
 * contando "3 produtos" quando enxerga 1.
 */
export function descreverUso(c: {
  readonly produtos: number;
  readonly produtosExcluidos?: number;
  readonly banners: number;
  readonly regraDeDevolucao: number;
}): string | null {
  const partes: string[] = [];
  if (c.produtos > 0) {
    const excluidos = c.produtosExcluidos ?? 0;
    const sobre =
      excluidos === 0
        ? ""
        : excluidos === 1
          ? " (1 excluído, que não aparece na lista)"
          : ` (${excluidos} excluídos, que não aparecem na lista)`;
    partes.push(`${plural(c.produtos, "produto", "produtos")}${sobre}`);
  }
  if (c.banners > 0) partes.push(plural(c.banners, "banner", "banners"));
  if (c.regraDeDevolucao > 0) partes.push("a regra de devolução");
  if (partes.length === 0) return null;
  if (partes.length === 1) return partes[0] ?? null;
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

/** O que a lojista lê depois de renomear: o que acompanhou o nome novo. */
export function fraseDoRenome(r: ResultadoDoRenome): string {
  if (!r.mudou) return "O nome já era esse. Nada foi mudado.";
  const acompanhou = descreverUso(r);
  return acompanhou
    ? `Categoria renomeada para “${r.nome}”. Acompanharam o nome novo: ${acompanhou}.`
    : `Categoria renomeada para “${r.nome}”.`;
}

/**
 * Traduz a falha das três portas. As frases do banco (22023, 23505, 55006 e
 * P0002) já são para a lojista e sobem como estão; as outras viram texto
 * nosso. Função ausente (o front chegou antes do banco da loja) tem frase
 * própria, para a lojista não achar que errou.
 */
export function mensagemDaFalhaDeCategoria(erro: unknown): string {
  const e = (erro ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const mensagem = typeof e.message === "string" ? e.message : "";
  if (code === "42501") {
    return "Só quem administra a loja pode mudar as categorias. Entre de novo e tente outra vez.";
  }
  if (code === "PGRST202" || code === "42883") {
    return "Esta função ainda não chegou à sua loja. Tente de novo em alguns minutos.";
  }
  if (["22023", "23505", "55006", "P0002"].includes(code) && mensagem) {
    return mensagem;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "Sem internet agora. Nada foi mudado; tente de novo quando voltar.";
  }
  return "Não foi possível concluir agora. Nada foi mudado; tente de novo.";
}

/** Texto de apoio do campo de nome: o limite que o banco impõe. */
export const LIMITE_DO_NOME_DA_CATEGORIA = 80;
