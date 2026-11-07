/**
 * Regra UNICA da busca de produtos: a lista do catalogo, a tela /search e a
 * caixinha de sugestoes do topo usam esta mesma funcao -- se a caixinha diz
 * "2 produtos", a lista tem de mostrar os mesmos 2.
 *
 * A cliente digita "bolsa preta" e espera achar "Bolsa Grande Preta"; antes o
 * filtro exigia a frase inteira, na mesma ordem, e dizia "nenhum resultado".
 * Agora: a busca vira palavras, e TODAS precisam aparecer (em qualquer ordem)
 * no nome, na categoria, na descricao ou no VALOR de uma variacao a venda
 * ("Azul", "GG", "38"). Acento e maiuscula nao contam.
 * (Etiquetas/tags NAO entram: nenhuma tela do painel preenche esse campo, e
 * a lista nunca as procurou -- entrando so na caixinha, ela prometia o que a
 * lista nao entrega.)
 * Variacao: entra so o valor das ATIVAS, nunca o nome do grupo ("Cor",
 * "Tamanho" -- senao "cor" acharia todo produto com variacao). O valor curto
 * (1 ou 2 letras: "M", "P", "42") vale como PALAVRA INTEIRA: por trecho, "m"
 * acharia "Marrom" e "4" acharia o 42.
 *
 * Plural: o plural do portugues muda a palavra, nao so acrescenta "s". De cada
 * palavra digitada (com 4+ letras, para nao amputar "gas" nem "pes") saem as
 * formas no singular, e basta QUALQUER uma aparecer no texto:
 *   - tira o "s":          saias -> saia, shorts -> short, jeans -> jean
 *   - -res/-zes/-ses:      colares -> colar, flores -> flor, luzes -> luz
 *   - -oes/-aes:           cordoes -> cordao, paes -> pao
 *   - vogal + is:          aneis -> anel, lencois -> lencol, azuis -> azul
 *   - e/i/o/u + ns:        batons -> batom, bombons -> bombom
 * E o caminho de volta, para quem digita o singular e o cadastro esta no
 * plural irregular (palavra inteira): anel -> aneis, batom -> batons,
 * cartao -> cartoes/cartaes/cartaos, pao -> paes/paos.
 * A forma e buscada POR TRECHO (basta estar dentro do texto) e a forma "sem o
 * s" e sempre um pedaco da palavra digitada, entao o que ja era achado
 * continua sendo -- "oculos", "lapis", "pires" e "onibus" acham a si mesmos.
 * O custo e buscar um pouco mais largo ("jeans" -> "jean").
 *
 * Excecao medida: singular DERIVADO de so 3 letras so vale como PALAVRA
 * INTEIRA no produto. Por trecho, "cases" -> "cas" achava Casaco e tudo da
 * categoria "Casa", "cores" -> "cor" achava Colar Coracao e Corrente, "pares"
 * -> "par" achava Parka. Como palavra inteira, "luzes" ainda acha "Luz de
 * Presenca" e "gases" acha "Botijao de Gas". Forma de 2 letras nunca vale.
 * Sem tolerancia a erro de digitacao, de proposito.
 */
import { normalizeText } from "@/lib/utils";

const TAMANHO_MINIMO_PARA_TIRAR_O_S = 4;
/** Singular derivado menor que isto vira ruido ("mais" -> "mal" acharia "malha"). */
const TAMANHO_MINIMO_DO_SINGULAR = 3;
/** Idem para -is -> -l: "pais" -> "pal" acharia "palito". */
const TAMANHO_MINIMO_DO_SINGULAR_EM_L = 4;
/** Singular derivado mais curto que isto so vale como palavra inteira. */
const TAMANHO_MINIMO_PARA_ACHAR_POR_TRECHO = 4;
/** Palavra digitada mais curta que isto so acha variacao como palavra inteira. */
const TAMANHO_MINIMO_PARA_ACHAR_VARIACAO_POR_TRECHO = 3;

export interface FormaDaPalavra {
  /** A forma, ja normalizada (sem acento, minuscula). */
  readonly texto: string;
  /** Verdadeiro: so vale se aparecer como palavra inteira, nao como trecho. */
  readonly palavraInteira: boolean;
}

const porTrecho = (texto: string): FormaDaPalavra => ({
  texto,
  palavraInteira: false,
});

/**
 * O caminho de volta: a palavra digitada e' o SINGULAR e o cadastro esta no
 * plural irregular. So as formas que NAO contem a palavra digitada precisam
 * existir ("colar" ja esta dentro de "colares"). Valem como PALAVRA INTEIRA: o
 * plural cadastrado e' uma palavra, e por trecho "pao" -> "paes" acharia
 * "Capaes" e qualquer sobra de radical curto.
 */
function formasNoPlural(palavra: string): FormaDaPalavra[] {
  const plurais: string[] = [];
  const inteira = (texto: string): FormaDaPalavra => ({
    texto,
    palavraInteira: true,
  });
  // anel -> aneis, lencol -> lencois, azul -> azuis
  if (
    palavra.length >= TAMANHO_MINIMO_DO_SINGULAR_EM_L &&
    /[aeou]l$/.test(palavra)
  ) {
    plurais.push(`${palavra.slice(0, -1)}is`);
  }
  // batom -> batons, bombom -> bombons
  if (
    palavra.length >= TAMANHO_MINIMO_DO_SINGULAR_EM_L &&
    /[eiou]m$/.test(palavra)
  ) {
    plurais.push(`${palavra.slice(0, -1)}ns`);
  }
  // cartao -> cartoes, cordao -> cordoes, pao -> paes, mao -> maos. "-oes" so
  // com radical de 2+ letras: "pao" -> "poes" acharia Poesia.
  if (palavra.length >= 3 && palavra.endsWith("ao")) {
    const radical = palavra.slice(0, -2);
    if (radical.length >= 2) plurais.push(`${radical}oes`);
    // "mao" so faz "maos": "maes" e outra palavra (Dia das Maes).
    if (palavra !== "mao") plurais.push(`${radical}aes`);
    plurais.push(`${radical}aos`);
  }
  return plurais.map(inteira);
}

/** Formas no singular que a palavra (JA normalizada, sem acento) pode ter. */
function formasDaPalavra(palavra: string): FormaDaPalavra[] {
  if (
    palavra.length < TAMANHO_MINIMO_PARA_TIRAR_O_S ||
    !palavra.endsWith("s")
  ) {
    return [porTrecho(palavra), ...formasNoPlural(palavra)];
  }
  // A forma "sem o s" mantem o comportamento de sempre: por trecho.
  const formas = new Map<string, FormaDaPalavra>([
    [palavra.slice(0, -1), porTrecho(palavra.slice(0, -1))],
  ]);
  const adicionar = (forma: string, minimo = TAMANHO_MINIMO_DO_SINGULAR) => {
    if (forma.length < minimo || formas.has(forma)) return;
    formas.set(forma, {
      texto: forma,
      palavraInteira: forma.length < TAMANHO_MINIMO_PARA_ACHAR_POR_TRECHO,
    });
  };

  // colares, flores, luzes, gases, portugueses
  if (/[rzs]es$/.test(palavra)) adicionar(palavra.slice(0, -2));
  // cordoes, paes (cordoes -> cordao)
  if (/[oa]es$/.test(palavra)) adicionar(`${palavra.slice(0, -3)}ao`);
  // aneis, lencois, azuis, animais
  if (/[aeou]is$/.test(palavra)) {
    adicionar(`${palavra.slice(0, -2)}l`, TAMANHO_MINIMO_DO_SINGULAR_EM_L);
  }
  // batons, bombons, homens (sem "a": "jeans" nao vira "jeam")
  if (/[eiou]ns$/.test(palavra)) adicionar(`${palavra.slice(0, -2)}m`);

  return [...formas.values()];
}

/**
 * Para cada palavra digitada, as formas aceitas (qualquer uma serve). A
 * pontuacao das PONTAS da palavra nao conta ("camiseta." e "camiseta," -- o
 * ponto do iPhone na barra de espaco dupla); a do meio fica ("3.5").
 */
export function palavrasDaBusca(busca: string): FormaDaPalavra[][] {
  const palavras = normalizeText(busca).split(/\s+/).filter(Boolean);
  const aparadas = palavras
    .map((palavra) => palavra.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter(Boolean);
  // Sem nenhuma letra ou numero (so emoji ou simbolo) a busca segue como antes:
  // acha so quem tem aquilo no nome, nunca vira "lista inteira".
  return (aparadas.length > 0 ? aparadas : palavras).map(formasDaPalavra);
}

const ehLetraOuNumero = (caractere: string | undefined): boolean =>
  caractere !== undefined && /[a-z0-9]/.test(caractere);

/**
 * A forma aparece no texto (JA normalizado)? Por trecho, ou como palavra
 * inteira quando `palavraInteira` (vizinhos sao inicio/fim ou nao-letra).
 */
export function formaAparece(texto: string, forma: FormaDaPalavra): boolean {
  if (!forma.palavraInteira) return texto.includes(forma.texto);
  let posicao = texto.indexOf(forma.texto);
  while (posicao !== -1) {
    const antes = texto[posicao - 1];
    const depois = texto[posicao + forma.texto.length];
    if (!ehLetraOuNumero(antes) && !ehLetraOuNumero(depois)) return true;
    posicao = texto.indexOf(forma.texto, posicao + 1);
  }
  return false;
}

/** Cor, tamanho, numero: so o que a variacao ATIVA diz; `name` ("Cor") nao entra. */
interface VariacaoDaBusca {
  value: string;
  active: boolean;
}

/** Uma variacao por linha, para a palavra inteira enxergar onde uma acaba. */
function textoDasVariacoes(variacoes?: VariacaoDaBusca[]): string {
  return (variacoes ?? [])
    .filter((variacao) => variacao.active)
    .map((variacao) => normalizeText(variacao.value))
    .join("\n");
}

export function produtoCombinaComBusca(
  produto: {
    name: string;
    description?: string | null;
    category?: string | null;
    variants?: VariacaoDaBusca[];
  },
  busca: string,
): boolean {
  const palavras = palavrasDaBusca(busca);
  if (palavras.length === 0) return true;
  const texto = [produto.name, produto.category, produto.description]
    .map(normalizeText)
    .join("\n");
  const variacoes = textoDasVariacoes(produto.variants);
  return palavras.every(
    (formas) =>
      formas.some((forma) => formaAparece(texto, forma)) ||
      formas.some((forma) =>
        formaAparece(variacoes, {
          texto: forma.texto,
          palavraInteira:
            forma.palavraInteira ||
            forma.texto.length < TAMANHO_MINIMO_PARA_ACHAR_VARIACAO_POR_TRECHO,
        }),
      ),
  );
}

/**
 * Pontuacao de RELEVANCIA da busca, a mesma na caixinha do topo e na lista da
 * Home ("Relevancia"). Quem entra na lista e' `produtoCombinaComBusca`; a
 * pontuacao so ORDENA. A `busca` e' calculada uma vez e o resultado serve a
 * todos os produtos.
 */
export function pontuadorDaBusca(busca: string) {
  const query = normalizeText(busca);
  const palavras = palavrasDaBusca(query);

  return (produto: {
    name: string;
    description?: string | null;
    category?: string | null;
  }): number => {
    let score = 0;
    const name = normalizeText(produto.name);
    // `description` pode vir nula do banco: `.toLowerCase()` direto quebrava a
    // busca inteira. `normalizeText` aguenta nulo.
    const description = normalizeText(produto.description);
    const category = normalizeText(produto.category);

    // Exact match
    if (name === query) score += 100;
    // Starts with query
    else if (name.startsWith(query)) score += 85;
    // Contains query
    else if (name.includes(query)) score += 50;

    // Word level score (qualquer forma da palavra: "colares" -> "colar")
    for (const formas of palavras) {
      if (formas.some((forma) => formaAparece(name, forma))) score += 20;
      if (formas.some((forma) => formaAparece(category, forma))) score += 15;
    }

    // Category match
    if (category === query) score += 40;
    else if (category.includes(query)) score += 25;

    // Description match
    if (description.includes(query)) score += 5;

    return score;
  };
}
