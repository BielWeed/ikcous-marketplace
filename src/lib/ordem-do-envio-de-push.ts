// A leitura dos aparelhos é ordenada por endereço (a paginação precisa disso
// para não repetir nem pular ninguém), e isso agrupa por empresa: Google,
// Firefox, Apple, Windows. A send-push tem teto de tempo e corta o FIM da
// lista, então iPhone e Windows ficariam sempre sem tentativa. Aqui o ENVIO
// intercala os serviços (um de cada por rodada); o conjunto é o mesmo.
const servicoDoEndereco = (endpoint: unknown): string => {
  try {
    return new URL(String(endpoint)).hostname;
  } catch {
    return "?";
  }
};

export function intercalarPorServico<T extends { endpoint?: unknown }>(
  alvos: readonly T[] | null | undefined,
): T[] {
  const grupos = new Map<string, T[]>();
  for (const alvo of alvos ?? []) {
    const chave = servicoDoEndereco(alvo.endpoint);
    const grupo = grupos.get(chave);
    if (grupo) grupo.push(alvo);
    else grupos.set(chave, [alvo]);
  }
  const filas = [...grupos.values()];
  const saida: T[] = [];
  for (let rodada = 0; saida.length < (alvos?.length ?? 0); rodada++) {
    for (const fila of filas) {
      const alvo = fila.at(rodada);
      if (alvo !== undefined) saida.push(alvo);
    }
  }
  return saida;
}
