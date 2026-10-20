// Chaves de tentativas de lançamento que ainda não deram resposta de sucesso.
// Fechar e reabrir o formulário monta outro componente; sem esta memória ele
// geraria uma chave nova e o mesmo lançamento, se a primeira gravação ainda
// estiver viva no servidor, entraria duas vezes. Mesmo conteúdo = mesma chave.
// Fica na aba (sessionStorage): sobrevive a recarregar a página e some ao fechar
// a aba. Guarda só um resumo (hash) do conteúdo, nunca descrição nem valor, e
// vence em 10 minutos para um segundo lançamento igual de propósito não ser
// tomado por repetição. Sem armazenamento disponível (bloqueio, aba privada) a
// proteção entre aberturas simplesmente não existe; a da mesma abertura segue.
const VALIDADE_MS = 10 * 60_000;
const ARMAZEM = "fin-lancamento-tentativas-em-aberto";

type Registro = { chave: string; em: number };

// FNV-1a de 32 bits: resumo curto e estável, não é segredo nem prova de nada.
function resumo(conteudo: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < conteudo.length; i++) {
    h = Math.imul(h ^ conteudo.charCodeAt(i), 0x01000193);
  }
  return `${h >>> 0}:${conteudo.length}`;
}

function ler(): Map<string, Registro> {
  try {
    const bruto = sessionStorage.getItem(ARMAZEM);
    return new Map(Object.entries(bruto ? JSON.parse(bruto) : {}));
  } catch {
    return new Map();
  }
}

function gravar(todos: Map<string, Registro>): void {
  try {
    sessionStorage.setItem(ARMAZEM, JSON.stringify(Object.fromEntries(todos)));
  } catch {
    // Sem armazenamento: segue sem a proteção entre aberturas.
  }
}

export function chaveEmAbertoDoConteudo(conteudo: string): string | null {
  const achada = ler().get(resumo(conteudo));
  return typeof achada?.chave === "string" &&
    Date.now() - achada.em <= VALIDADE_MS
    ? achada.chave
    : null;
}

export function guardarChaveEmAberto(conteudo: string, chave: string): void {
  const todos = ler();
  todos.set(resumo(conteudo), { chave, em: Date.now() });
  gravar(todos);
}

export function esquecerChaveEmAberto(conteudo: string): void {
  const todos = ler();
  todos.delete(resumo(conteudo));
  gravar(todos);
}

export function esquecerTodasAsChavesEmAberto(): void {
  gravar(new Map());
}
