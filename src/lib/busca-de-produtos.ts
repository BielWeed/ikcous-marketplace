/**
 * Regra UNICA da busca de produtos do catalogo e da tela /search.
 *
 * A cliente digita "bolsa preta" e espera achar "Bolsa Grande Preta"; antes o
 * filtro exigia a frase inteira, na mesma ordem, e dizia "nenhum resultado".
 * Agora: a busca vira palavras, e TODAS precisam aparecer (em qualquer ordem)
 * no nome, na categoria ou na descricao. Acento e maiuscula nao contam.
 *
 * Plural: tira-se UM "s" final da palavra digitada ("shorts" -> "short",
 * "saias" -> "saia"). So em palavra com 4+ letras, para nao amputar "gas" nem
 * "pes". O custo e buscar um pouco mais largo ("jeans" -> "jean").
 * Sem tolerancia a erro de digitacao, de proposito.
 */
import { normalizeText } from "@/lib/utils";

const TAMANHO_MINIMO_PARA_TIRAR_O_S = 4;

function palavrasDaBusca(busca: string): string[] {
  return normalizeText(busca)
    .split(/\s+/)
    .filter(Boolean)
    .map((palavra) =>
      palavra.length >= TAMANHO_MINIMO_PARA_TIRAR_O_S && palavra.endsWith("s")
        ? palavra.slice(0, -1)
        : palavra,
    );
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
  return palavras.every((palavra) => texto.includes(palavra));
}
