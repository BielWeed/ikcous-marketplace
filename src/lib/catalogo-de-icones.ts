import { formaAparece, palavrasDaBusca } from "@/lib/busca-de-produtos";
/**
 * Catálogo de ícones de categoria do PAINEL (só o painel o carrega).
 *
 * São ~100 desenhos originais em `public/icons/categorias.json` (fonte de revisão em
 * `docs/design/icones-de-categoria/`). O JSON NÃO entra no pacote de JavaScript: o painel o busca
 * por `fetch` só quando o seletor de ícone abre e o guarda em memória. A vitrine nunca o baixa; ela
 * desenha a forma que a própria categoria guarda (`categorias.icone_forma`).
 *
 * Falhou (sem internet, arquivo ausente, resposta que não é o catálogo)? O seletor segue com os 14
 * ícones clássicos e com o que a categoria já tem gravado; nada aqui lança para a tela.
 */
import {
  type ChaveDeIcone,
  formaDeIconeValida,
  iconeDaCategoria,
  nomeDoIcone,
} from "@/lib/icones-de-categoria";
import { normalizeText } from "@/lib/utils";

export interface IconeDoCatalogo {
  readonly chave: string;
  readonly nome: string;
  readonly grupo: string;
  /** Termos em pt-BR, minúsculos e sem acento, para a busca e para a sugestão pelo nome. */
  readonly palavras: readonly string[];
  /** UM path SVG (só traço), já validado contra o alfabeto da CHECK do banco. */
  readonly d: string;
}

export const URL_DO_CATALOGO = "/icons/categorias.json";
export const GRUPO_DOS_CLASSICOS = "Clássicos";
const TEMPO_MAXIMO_DA_BUSCA_MS = 15_000;

const ehTexto = (valor: unknown): valor is string =>
  typeof valor === "string" && valor.trim() !== "";

/**
 * Lê o JSON do catálogo item por item: o que não tem forma válida (a mesma regra da CHECK do
 * banco), nome, grupo ou chave única é descartado. Lança só se NADA se aproveita (ou se não for lista),
 * que é o que acontece quando o servidor devolve a página inicial no lugar do arquivo.
 */
export function lerCatalogo(json: unknown): IconeDoCatalogo[] {
  if (!Array.isArray(json)) throw new Error("catalogo-invalido");
  const vistas = new Set<string>();
  const itens: IconeDoCatalogo[] = [];
  for (const bruto of json) {
    if (typeof bruto !== "object" || bruto === null) continue;
    const { chave, nome, grupo, palavras, d } = bruto as Record<
      string,
      unknown
    >;
    if (
      !ehTexto(chave) ||
      !ehTexto(nome) ||
      !ehTexto(grupo) ||
      !formaDeIconeValida(d) ||
      vistas.has(chave)
    )
      continue;
    vistas.add(chave);
    itens.push({
      chave,
      nome,
      grupo,
      palavras: Array.isArray(palavras) ? palavras.filter(ehTexto) : [],
      d,
    });
  }
  if (itens.length === 0) throw new Error("catalogo-vazio");
  return itens;
}

let emMemoria: IconeDoCatalogo[] | null = null;
let emVoo: Promise<IconeDoCatalogo[]> | null = null;

/** O catálogo, se já foi carregado nesta sessão (sem pedir nada). */
export function catalogoEmMemoria(): readonly IconeDoCatalogo[] | null {
  return emMemoria;
}

/** Só para os testes: esquece o que foi carregado. */
export function esquecerOCatalogoCarregado() {
  emMemoria = null;
  emVoo = null;
}

/**
 * Busca o catálogo (uma vez por sessão do painel; pedidos simultâneos dividem a mesma busca).
 * Falha NÃO fica guardada: "Tentar de novo" faz uma busca nova.
 */
export function carregarCatalogo(): Promise<IconeDoCatalogo[]> {
  if (emMemoria) return Promise.resolve(emMemoria);
  if (emVoo) return emVoo;
  const busca = (async () => {
    const resposta = await fetch(URL_DO_CATALOGO, {
      headers: { Accept: "application/json" },
      // Sem internet de verdade o pedido pode ficar pendurado: passado o prazo, vira erro.
      signal: AbortSignal.timeout?.(TEMPO_MAXIMO_DA_BUSCA_MS),
    });
    if (!resposta.ok) throw new Error(`catalogo-http-${resposta.status}`);
    emMemoria = lerCatalogo(await resposta.json());
    return emMemoria;
  })();
  emVoo = busca;
  const soltar = () => {
    emVoo = null;
  };
  busca.then(soltar, soltar);
  return busca;
}

/** Grupos na ordem em que aparecem no catálogo. */
export function gruposDoCatalogo(lista: readonly IconeDoCatalogo[]): string[] {
  return [...new Set(lista.map((item) => item.grupo))];
}

/** Todas as palavras digitadas aparecem no texto (já normalizado); termo vazio combina com tudo. */
function buscaCombina(texto: string, termo: string): boolean {
  return palavrasDaBusca(termo).every((formas) =>
    formas.some((forma) => formaAparece(texto, forma)),
  );
}

const textoDeBusca = (item: IconeDoCatalogo) =>
  normalizeText(`${item.nome} ${item.palavras.join(" ")}`);

/**
 * Busca pela mesma regra da busca de produtos da vitrine: todas as palavras digitadas precisam
 * aparecer (em qualquer ordem) no nome ou nas palavras do ícone; acento, caixa e plural não contam.
 */
export function buscarNoCatalogo(
  lista: readonly IconeDoCatalogo[],
  termo: string,
): IconeDoCatalogo[] {
  return lista.filter((item) => buscaCombina(textoDeBusca(item), termo));
}

/** Os 14 clássicos pela mesma regra de busca (rótulo + chave). */
export function classicoCombinaComBusca(
  chave: ChaveDeIcone,
  termo: string,
): boolean {
  return buscaCombina(normalizeText(`${nomeDoIcone(chave)} ${chave}`), termo);
}

// ── Sugestão pelo nome da categoria ──────────────────────────────────────────────────────────
// "Calças" -> Calça; "Tênis" -> Tênis; "Bolsas e mochilas" -> Bolsa. Só palavra INTEIRA conta
// ("Casa" nunca vira "Casaco"), e o plural vem da mesma regra da busca da vitrine.

/** As formas que uma palavra (já normalizada) pode ter: ela mesma e o singular. */
function formasDe(palavra: string): Set<string> {
  const formas = new Set<string>([palavra]);
  for (const forma of palavrasDaBusca(palavra)[0] ?? [])
    formas.add(forma.texto);
  // body -> bodies, hobby -> hobbies: o plural em -ies das palavras de loja que vêm do inglês.
  if (palavra.length > 4 && palavra.endsWith("ies"))
    formas.add(`${palavra.slice(0, -3)}y`);
  return formas;
}

const palavrasDoTexto = (texto: string) =>
  normalizeText(texto)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const mesmaPalavra = (a: Set<string>, b: Set<string>) =>
  [...a].some((forma) => b.has(forma));

/** Posição (índice) onde a frase aparece, inteira e em sequência, nas palavras do nome; ou -1. */
function posicaoDaFrase(
  nome: readonly Set<string>[],
  frase: readonly Set<string>[],
): number {
  for (let inicio = 0; inicio + frase.length <= nome.length; inicio++) {
    if (frase.every((forma, i) => mesmaPalavra(forma, nome[inicio + i])))
      return inicio;
  }
  return -1;
}

export type Sugestao =
  | { readonly tipo: "catalogo"; readonly item: IconeDoCatalogo }
  | { readonly tipo: "classico"; readonly chave: ChaveDeIcone };

/**
 * O ícone que mais combina com o nome da categoria, ou `null`. Vence a frase mais longa que
 * aparece no nome (mais palavras casadas), depois a que vem
 * primeiro no nome, depois a ordem do catálogo. Sem nada no catálogo, cai no ícone clássico que a
 * vitrine já deduzia pelo nome ("Moda feminina" -> Moda).
 */
export function sugerirPeloNome(
  lista: readonly IconeDoCatalogo[],
  nomeDaCategoria: string,
): Sugestao | null {
  const palavrasDoNome = palavrasDoTexto(nomeDaCategoria);
  if (palavrasDoNome.length === 0) return null;
  const nome = palavrasDoNome.map(formasDe);
  let melhor: { item: IconeDoCatalogo; pontos: number } | null = null;
  for (const item of lista) {
    let pontosDoItem = 0;
    for (const frase of [item.nome, ...item.palavras]) {
      const palavrasDaFrase = palavrasDoTexto(frase);
      if (palavrasDaFrase.length === 0) continue;
      const inicio = posicaoDaFrase(nome, palavrasDaFrase.map(formasDe));
      if (inicio === -1) continue;
      // frase mais longa vence; entre iguais, a que aparece primeiro no nome
      const pontos = palavrasDaFrase.length * 10 + Math.max(0, 4 - inicio);
      pontosDoItem = Math.max(pontosDoItem, pontos);
    }
    if (pontosDoItem > 0 && (!melhor || pontosDoItem > melhor.pontos))
      melhor = { item, pontos: pontosDoItem };
  }
  if (melhor) return { tipo: "catalogo", item: melhor.item };
  const classico = iconeDaCategoria({ name: nomeDaCategoria });
  return classico === "etiqueta" ? null : { tipo: "classico", chave: classico };
}
