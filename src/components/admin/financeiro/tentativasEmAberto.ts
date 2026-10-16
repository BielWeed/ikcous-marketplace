// Chaves de tentativas de lançamento que ainda não deram resposta de sucesso.
// Fechar e reabrir o formulário monta outro componente; sem esta memória ele
// geraria uma chave nova e o mesmo lançamento, se a primeira gravação ainda
// estiver viva no servidor, entraria duas vezes. Mesmo conteúdo = mesma chave.
// Fica na aba (sessionStorage): sobrevive a recarregar a página e some ao fechar
// a aba. Guarda só um resumo (hash) do conteúdo, nunca descrição nem valor, e
// vence em 10 minutos para um segundo lançamento igual de propósito não ser
// tomado por repetição.
const VALIDADE_MS = 10 * 60_000;
const CHAVE_DO_ARMAZEM = "fin-lancamento-tentativas-em-aberto";

type Registro = { chave: string; em: number };

const emMemoria = new Map<string, Registro>();

// FNV-1a de 32 bits: resumo curto e estável, não é segredo nem prova de nada.
function resumoDoConteudo(conteudo: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < conteudo.length; i++) {
    h ^= conteudo.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}:${conteudo.length}`;
}

function ler(): Record<string, Registro> {
  try {
    const bruto = globalThis.sessionStorage?.getItem(CHAVE_DO_ARMAZEM);
    if (bruto) {
      const lido = JSON.parse(bruto);
      if (lido && typeof lido === "object") return lido;
    }
  } catch {
    // Sem armazenamento (aba privada, bloqueio): vale só a memória do módulo.
  }
  return Object.fromEntries(emMemoria);
}

function gravar(todos: Record<string, Registro>): void {
  emMemoria.clear();
  for (const [k, v] of Object.entries(todos)) emMemoria.set(k, v);
  try {
    globalThis.sessionStorage?.setItem(CHAVE_DO_ARMAZEM, JSON.stringify(todos));
  } catch {
    // Idem: a memória do módulo já foi atualizada acima.
  }
}

export function chaveEmAbertoDoConteudo(conteudo: string): string | null {
  const resumo = resumoDoConteudo(conteudo);
  const todos = ler();
  const achada = todos[resumo];
  if (!achada) return null;
  if (
    typeof achada.chave !== "string" ||
    typeof achada.em !== "number" ||
    Date.now() - achada.em > VALIDADE_MS
  ) {
    delete todos[resumo];
    gravar(todos);
    return null;
  }
  return achada.chave;
}

export function guardarChaveEmAberto(conteudo: string, chave: string): void {
  const todos = ler();
  todos[resumoDoConteudo(conteudo)] = { chave, em: Date.now() };
  gravar(todos);
}

export function esquecerChaveEmAberto(conteudo: string): void {
  const todos = ler();
  delete todos[resumoDoConteudo(conteudo)];
  gravar(todos);
}

export function esquecerTodasAsChavesEmAberto(): void {
  gravar({});
}
