// Mantém a consulta aguardável e acrescenta o encadeamento usado pelo PostgREST.
export function comPaginacao<
  Args extends unknown[],
  Resposta extends { data: unknown[] | null; error: unknown },
>(consultar: (...args: Args) => Promise<Resposta>) {
  return (...args: Args) => {
    const resposta = consultar(...args);
    return Object.assign(resposta, {
      order: () => ({
        range: async (de: number, ate: number) => {
          const { data, error } = await resposta;
          return { data: data?.slice(de, ate + 1) ?? null, error };
        },
      }),
    });
  };
}
