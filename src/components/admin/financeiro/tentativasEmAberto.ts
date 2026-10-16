// Chaves de tentativas de lançamento que ainda não deram resposta de sucesso.
// Fechar e reabrir o formulário monta outro componente; sem esta memória ele
// geraria uma chave nova e o mesmo lançamento, se a primeira gravação ainda
// estiver viva no servidor, entraria duas vezes. Mesmo conteúdo = mesma chave.
// Vive só enquanto a aba está aberta (recarregar a página zera) e vence em 10
// minutos, para um segundo lançamento igual de propósito não ser tomado por repetição.
const VALIDADE_MS = 10 * 60_000;

const emAberto = new Map<string, { chave: string; em: number }>();

export function chaveEmAbertoDoConteudo(conteudo: string): string | null {
  const achada = emAberto.get(conteudo);
  if (!achada) return null;
  if (Date.now() - achada.em > VALIDADE_MS) {
    emAberto.delete(conteudo);
    return null;
  }
  return achada.chave;
}

export function guardarChaveEmAberto(conteudo: string, chave: string): void {
  emAberto.set(conteudo, { chave, em: Date.now() });
}

export function esquecerChaveEmAberto(conteudo: string): void {
  emAberto.delete(conteudo);
}

export function esquecerTodasAsChavesEmAberto(): void {
  emAberto.clear();
}
