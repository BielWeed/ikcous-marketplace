// O PostgREST devolve no máximo 1.000 linhas por chamada (teto do projeto),
// sem avisar: quem lê "tudo" numa chamada só recebe um pedaço e acha que é o
// todo. Aqui a leitura anda de 1.000 em 1.000 com `.range()` até a página vir
// menor que o tamanho — a prova de que acabou.
export const TAMANHO_DA_PAGINA = 1000;
// Freio contra laço infinito (100 mil linhas); nunca chega nele na prática.
const MAXIMO_DE_PAGINAS = 100;

type Resposta<T> = { data: T[] | null; error: unknown };

export async function lerEmPaginas<T>(
  buscar: (de: number, ate: number) => PromiseLike<Resposta<T>>,
): Promise<{ data: T[] | null; error: unknown }> {
  const todas: T[] = [];
  for (let pagina = 0; pagina < MAXIMO_DE_PAGINAS; pagina++) {
    const de = pagina * TAMANHO_DA_PAGINA;
    const { data, error } = await buscar(de, de + TAMANHO_DA_PAGINA - 1);
    if (error) return { data: null, error };
    const linhas = data ?? [];
    todas.push(...linhas);
    if (linhas.length < TAMANHO_DA_PAGINA) return { data: todas, error: null };
  }
  // A ultima pagina ainda veio cheia: nao se sabe se acabou. Devolver o pedaco
  // como se fosse tudo seria o corte silencioso de volta; vira erro.
  return {
    data: null,
    error: new Error("Lista grande demais para ler de uma vez"),
  };
}
