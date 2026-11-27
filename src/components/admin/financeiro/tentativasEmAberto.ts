// Chaves de tentativas de lançamento que ainda não deram resposta de sucesso.
// Fechar e reabrir o formulário monta outro componente; sem esta memória ele
// geraria uma chave nova e o mesmo lançamento, se a primeira gravação ainda
// estiver viva no servidor, entraria duas vezes. Mesmo conteúdo = mesma chave.
// Fica na aba (sessionStorage): sobrevive a recarregar a página e some ao fechar
// a aba. Guarda só um resumo (hash) do conteúdo, nunca descrição nem valor, e
// vence em 10 minutos para um segundo lançamento igual de propósito não ser
// tomado por repetição. Sem armazenamento disponível (bloqueio, aba privada) a
// proteção entre aberturas simplesmente não existe; a da mesma abertura segue.
// A chave é de QUEM lançou (id da conta): no mesmo aparelho, a dona que entra
// depois da funcionária nunca herda a chave dela — o banco devolveria o
// lançamento antigo e o dela não gravaria. Sem conta conhecida, nada se guarda.
const VALIDADE_MS = 10 * 60_000;
const ARMAZEM = "fin-lancamento-tentativas-em-aberto";

type Registro = { chave: string; em: number; dono: string };

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

function endereco(dono: string, conteudo: string): string {
  return `${dono}:${resumo(conteudo)}`;
}

export function chaveEmAbertoDoConteudo(
  dono: string | null,
  conteudo: string,
): string | null {
  if (!dono) return null;
  const achada = ler().get(endereco(dono, conteudo));
  // Registro de antes do dono (sem `dono`) não vale nem para a mesma conta: sem
  // prova de quem era, chave nova arrisca um duplicado visível no extrato;
  // reaproveitar arriscaria sumir em silêncio o lançamento de outra pessoa.
  return typeof achada?.chave === "string" &&
    achada.dono === dono &&
    Date.now() - achada.em <= VALIDADE_MS
    ? achada.chave
    : null;
}

export function guardarChaveEmAberto(
  dono: string | null,
  conteudo: string,
  chave: string,
): void {
  if (!dono) return;
  const todos = ler();
  todos.set(endereco(dono, conteudo), { chave, em: Date.now(), dono });
  gravar(todos);
}

export function esquecerChaveEmAberto(
  dono: string | null,
  conteudo: string,
): void {
  if (!dono) return;
  const todos = ler();
  todos.delete(endereco(dono, conteudo));
  gravar(todos);
}

// Chamada pelo "Sair" (AuthContext). Nunca lança: `gravar` engole o erro.
export function esquecerTodasAsChavesEmAberto(): void {
  gravar(new Map());
}
