// A TELA "NOVA SENHA" SOBREVIVE AO RECARREGAMENTO.
//
// O DEFEITO QUE ISTO RESOLVE: o link do e-mail de "Esqueceu?" cria uma sessão
// guardada no aparelho (o supabase-js a grava no `localStorage`) e abre o app
// em "Nova senha". Só que o MODO "nova senha" vivia na memória e em
// `?type=recovery`, que o app apaga do endereço logo ao abrir. Um F5, uma aba
// que o celular descartou ou fechar e reabrir o app voltava com a sessão e sem
// o modo: a pessoa caía logada no Perfil, achava que tinha trocado a senha, e a
// antiga (a esquecida) continuava valendo.
//
// A marca guardada aqui é só "esta conta está no meio da troca". Ela NÃO dá
// acesso a nada, nunca cria nem estende sessão: apenas mantém a tela "Nova
// senha" para quem JÁ está com a sessão do link. Por isso o risco de guardá-la
// é pequeno — e é contido assim:
//  - validade de 1 hora, a partir de quando o link foi aberto (o link do
//    Supabase vale 1 hora por padrão); depois disso o app abre normal;
//  - presa à conta da sessão: marca de uma conta não vale para a sessão de
//    outra (e é apagada);
//  - só vale COM sessão no aparelho: marca sem sessão não prende ninguém numa
//    tela sem conta;
//  - apagada ao trocar a senha, ao sair, ao trocar de conta e ao vencer;
//  - todo acesso ao storage é protegido: storage cheio/privado/ilegível nunca
//    derruba o app, só volta ao comportamento de antes (modo só em memória).
//
// Chave com o prefixo "ikcous_": já está na lista branca da purga de versão
// (src/lib/localStoragePurgeWhitelist.ts), como a sessão ("sb-") com a qual
// vive e morre.
//
// NUNCA gravar aqui e-mail, token ou qualquer dado pessoal: só o id da conta
// (UUID, que já mora na sessão ao lado) e o prazo.

/** Chave EXCLUSIVA — nenhum outro módulo lê nem escreve aqui. */
const CHAVE_RECUPERACAO_EM_ANDAMENTO = "ikcous_recuperacao_de_senha";

const VALIDADE_DA_RECUPERACAO_MS = 60 * 60 * 1000;

interface Marca {
  /** Conta da sessão do link; `null` até a sessão existir (abriu pelo endereço). */
  uid: string | null;
  /** Instante (ms) em que a marca vence. */
  ate: number;
}

function armazem(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function ler(): Marca | null {
  try {
    const store = armazem();
    if (!store) return null;
    const texto = store.getItem(CHAVE_RECUPERACAO_EM_ANDAMENTO);
    if (!texto) return null;
    const marca = JSON.parse(texto) as Partial<Marca> | null;
    if (
      !marca ||
      typeof marca.ate !== "number" ||
      !Number.isFinite(marca.ate) ||
      (marca.uid !== null && typeof marca.uid !== "string")
    ) {
      esquecerRecuperacao();
      return null;
    }
    return { uid: marca.uid ?? null, ate: marca.ate };
  } catch {
    esquecerRecuperacao();
    return null;
  }
}

function gravar(marca: Marca): void {
  try {
    armazem()?.setItem(CHAVE_RECUPERACAO_EM_ANDAMENTO, JSON.stringify(marca));
  } catch {
    // Storage cheio ou bloqueado: o modo segue só em memória, como antes.
  }
}

/**
 * O link de recuperação foi aberto agora (ou o código foi confirmado): marca
 * a conta e RECOMEÇA a validade de 1 hora. `uid` pode ser `null` quando a
 * sessão ainda não existe; `vincularRecuperacao` completa depois.
 */
export function iniciarRecuperacao(uid: string | null): void {
  gravar({ uid, ate: Date.now() + VALIDADE_DA_RECUPERACAO_MS });
}

/**
 * Garante a marca sem mexer na validade: se já há uma marca viva, só a deixa
 * (vinculando a conta, se faltava); se não há, começa uma.
 */
export function garantirRecuperacao(uid: string | null): void {
  const atual = ler();
  if (!atual || atual.ate <= Date.now()) {
    iniciarRecuperacao(uid);
    return;
  }
  if (atual.uid === null && uid !== null) gravar({ ...atual, uid });
}

/** Presa a marca (aberta pelo endereço, sem conta ainda) à conta da sessão. */
export function vincularRecuperacao(uid: string): void {
  const atual = ler();
  if (atual && atual.uid === null && atual.ate > Date.now()) {
    gravar({ ...atual, uid });
  }
}

/**
 * Ao subir o app: a pessoa estava no meio da troca de senha? Só diz que sim
 * com marca viva, sessão no aparelho e conta igual à da marca. Qualquer outra
 * combinação apaga a marca (não fica resíduo que prenda a tela depois).
 */
export function recuperacaoEmAndamento(uidDaSessao: string | null): boolean {
  const marca = ler();
  if (!marca) return false;
  const vale =
    marca.ate > Date.now() &&
    uidDaSessao !== null &&
    (marca.uid === null || marca.uid === uidDaSessao);
  if (!vale) esquecerRecuperacao();
  return vale;
}

/** Troca concluída, saída, troca de conta ou vencimento: a marca não serve mais. */
export function esquecerRecuperacao(): void {
  try {
    armazem()?.removeItem(CHAVE_RECUPERACAO_EM_ANDAMENTO);
  } catch {
    // Nada a fazer: sem storage, também não há marca para ficar.
  }
}
