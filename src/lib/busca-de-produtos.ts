/**
 * Regra UNICA da busca de produtos: a lista do catalogo, a tela /search e a
 * caixinha de sugestoes do topo usam esta mesma funcao -- se a caixinha diz
 * "2 produtos", a lista tem de mostrar os mesmos 2.
 *
 * A cliente digita "bolsa preta" e espera achar "Bolsa Grande Preta"; antes o
 * filtro exigia a frase inteira, na mesma ordem, e dizia "nenhum resultado".
 * Agora: a busca vira palavras, e TODAS precisam aparecer (em qualquer ordem)
 * no nome, na categoria ou na descricao. Acento e maiuscula nao contam.
 * (Etiquetas/tags NAO entram: nenhuma tela do painel preenche esse campo, e
 * a lista nunca as procurou -- entrando so na caixinha, ela prometia o que a
 * lista nao entrega.)
 *
 * Plural: o plural do portugues muda a palavra, nao so acrescenta "s". De cada
 * palavra digitada (com 4+ letras, para nao amputar "gas" nem "pes") saem as
 * formas no singular, e basta QUALQUER uma aparecer no texto:
 *   - tira o "s":          saias -> saia, shorts -> short, jeans -> jean
 *   - -res/-zes/-ses:      colares -> colar, flores -> flor, luzes -> luz
 *   - -oes/-aes:           cordoes -> cordao, paes -> pao   (cordoes, paes)
 *   - vogal + is:          aneis -> anel, lencois -> lencol, azuis -> azul
 *   - -ns:                 batons -> batom, bombons -> bombom
 * Como a busca e por trecho (a forma so precisa estar DENTRO do texto) e a
 * forma "sem o s" e sempre um pedaco da palavra digitada, o que ja era achado
 * continua sendo -- "oculos", "lapis", "pires" e "onibus" acham a si mesmos.
 * O custo e buscar um pouco mais largo ("jeans" -> "jean").
 * Sem tolerancia a erro de digitacao, de proposito.
 */
import { normalizeText } from "@/lib/utils";

const TAMANHO_MINIMO_PARA_TIRAR_O_S = 4;
/** Singular derivado menor que isto vira ruido ("mais" -> "mal" acharia "malha"). */
const TAMANHO_MINIMO_DO_SINGULAR = 3;
/** Idem para -is -> -l: "pais" -> "pal" acharia "palito". */
const TAMANHO_MINIMO_DO_SINGULAR_EM_L = 4;

/** Formas no singular que a palavra (JA normalizada, sem acento) pode ter. */
function formasDaPalavra(palavra: string): string[] {
  if (
    palavra.length < TAMANHO_MINIMO_PARA_TIRAR_O_S ||
    !palavra.endsWith("s")
  ) {
    return [palavra];
  }
  const formas = new Set<string>([palavra.slice(0, -1)]);
  const adicionar = (forma: string, minimo = TAMANHO_MINIMO_DO_SINGULAR) => {
    if (forma.length >= minimo) formas.add(forma);
  };

  // colares, flores, luzes, gases, portugueses
  if (/[rzs]es$/.test(palavra)) adicionar(palavra.slice(0, -2));
  // cordoes, paes (cordoes -> cordao)
  if (/[oa]es$/.test(palavra)) adicionar(`${palavra.slice(0, -3)}ao`);
  // aneis, lencois, azuis, animais
  if (/[aeou]is$/.test(palavra)) {
    adicionar(`${palavra.slice(0, -2)}l`, TAMANHO_MINIMO_DO_SINGULAR_EM_L);
  }
  // batons, bombons, homens
  if (palavra.endsWith("ns")) adicionar(`${palavra.slice(0, -2)}m`);

  return [...formas];
}

/** Para cada palavra digitada, as formas aceitas (qualquer uma serve). */
export function palavrasDaBusca(busca: string): string[][] {
  return normalizeText(busca).split(/\s+/).filter(Boolean).map(formasDaPalavra);
}

export function produtoCombinaComBusca(
  produto: {
    name: string;
    description?: string | null;
    category?: string | null;
  },
  busca: string,
): boolean {
  const palavras = palavrasDaBusca(busca);
  if (palavras.length === 0) return true;
  const texto = [produto.name, produto.category, produto.description]
    .map(normalizeText)
    .join("\n");
  return palavras.every((formas) =>
    formas.some((forma) => texto.includes(forma)),
  );
}
