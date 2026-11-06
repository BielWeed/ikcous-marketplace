// Marcador local "esta conta já ligou os avisos neste aparelho".
//
// A limpeza do app (purga de versão obrigatória, 2º degrau da recuperação de
// chunk, último recurso do sentinela) desregistra o service worker, e a
// inscrição de push morre junto com o registro antigo: a lojista parava de
// receber aviso de pedido novo e nada religava sozinho. O app só pode religar
// sem pedir nada quando sabe que a pessoa JÁ tinha ligado — e o navegador, depois
// da limpeza, não diz mais isso (a inscrição sumiu). Este marcador é essa
// memória, e é ele que separa "perdeu na limpeza" de "desligou de propósito".
//
// Regras:
//  - Um marcador POR CONTA (a chave leva o id): o aparelho compartilhado não
//    religa para quem nunca aceitou.
//  - Quem grava: o toque que inscreve com sucesso e a sonda que confirma que a
//    inscrição do navegador é DESTA conta. Quem apaga: desligar, Sair e soltar
//    o aparelho. Na dúvida não se grava e não se religa.
//  - O prefixo `ikcous_` está na lista branca da purga de `localStorage`
//    (`localStoragePurgeWhitelist.ts`): sem isso a própria limpeza apagaria o
//    marcador e o religar nunca teria o que ler.
//  - Nada daqui lança: `localStorage` pode estar bloqueado (modo privado) e
//    push nunca pode quebrar o fluxo de quem chama.

/** Prefixo da chave; o id da conta vem depois. Começa com `ikcous_` de propósito. */
export const PREFIXO_AVISOS_LIGADOS = "ikcous_push_avisos_ligados:";

function chaveDaConta(userId: string): string {
  return `${PREFIXO_AVISOS_LIGADOS}${userId}`;
}

export function marcarAvisosLigados(userId: string): void {
  try {
    localStorage.setItem(chaveDaConta(userId), "1");
  } catch {
    // sem armazenamento: só não religa sozinho depois de uma limpeza
  }
}

export function avisosEstavamLigados(userId: string): boolean {
  try {
    return localStorage.getItem(chaveDaConta(userId)) !== null;
  } catch {
    return false;
  }
}

export function esquecerAvisosLigados(userId: string): void {
  try {
    localStorage.removeItem(chaveDaConta(userId));
  } catch {
    // idem
  }
}

/** Aparelho solto sem saber de quem é a sessão: ninguém é religado depois. */
export function esquecerTodosOsAvisosLigados(): void {
  try {
    // `key(i)`/`length` e não `Object.keys`: coletar antes de apagar, porque
    // remover muda os índices.
    const dessaConta: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const chave = localStorage.key(i);
      if (chave?.startsWith(PREFIXO_AVISOS_LIGADOS)) dessaConta.push(chave);
    }
    for (const chave of dessaConta) localStorage.removeItem(chave);
  } catch {
    // idem
  }
}

// Religar sozinho é UMA tentativa por conta por carregamento do app: o hook de
// push monta em várias telas, e uma falha repetida (rede, serviço de push) não
// pode virar laço a cada navegação. A próxima carga tenta de novo.
const jaTentouNestaCarga = new Set<string>();

/** `true` só na primeira vez que a conta pede a tentativa nesta carga. */
export function reservarTentativaDeReligar(userId: string): boolean {
  if (jaTentouNestaCarga.has(userId)) return false;
  jaTentouNestaCarga.add(userId);
  return true;
}
