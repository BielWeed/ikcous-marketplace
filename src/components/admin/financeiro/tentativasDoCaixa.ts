// Uma intenção por autor, sessão e tipo, sem prazo. Guarda SOMENTE o UUID.
// Editar campos, fechar a folha ou recarregar não prova que o servidor recusou.
// Sem armazenamento, quem chama conserva a chave em memória enquanto a folha vive.
const PREFIXO = "ikcous_fin_caixa_tentativa:";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Tipo = "sangria" | "suprimento";

function endereco(autor: string, sessao: string, tipo: Tipo): string {
  return PREFIXO + JSON.stringify([autor, sessao, tipo]);
}

/** Em HTTP local, randomUUID pode faltar; getRandomValues gera UUID v4. */
function gerarChave(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function chaveDaTentativaDoCaixa(
  autor: string | null,
  sessao: string,
  tipo: Tipo,
): string {
  if (autor) {
    try {
      const salva = localStorage.getItem(endereco(autor, sessao, tipo));
      if (salva && UUID.test(salva)) return salva;
    } catch {
      // Armazenamento indisponível: identidade fica na ref da folha.
    }
  }
  const chave = gerarChave();
  if (autor) {
    try {
      localStorage.setItem(endereco(autor, sessao, tipo), chave);
    } catch {
      // Não impedir a operação; sem prometer proteção após desmontar.
    }
  }
  return chave;
}

export function esquecerTentativaDoCaixa(
  autor: string | null,
  sessao: string,
  tipo: Tipo,
  chave: string | null,
): void {
  if (!autor || !chave) return;
  try {
    const local = endereco(autor, sessao, tipo);
    // Uma resposta antiga não apaga uma intenção posterior de outra aba.
    if (localStorage.getItem(local) === chave) localStorage.removeItem(local);
  } catch {
    // A folha continua funcionando mesmo se a remoção for bloqueada.
  }
}

/** Só chamar depois de uma leitura confirmada do caixa, nunca em erro/carga. */
export function esquecerTentativasDeOutrasSessoes(
  autor: string | null,
  sessaoAtual: string | null,
): void {
  if (!autor) return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const local = localStorage.key(i);
      if (!local?.startsWith(PREFIXO)) continue;
      const alvo: unknown = JSON.parse(local.slice(PREFIXO.length));
      if (Array.isArray(alvo) && alvo[0] === autor && alvo[1] !== sessaoAtual) {
        localStorage.removeItem(local);
      }
    }
  } catch {
    // Sem leitura confiável, não concluir que uma intenção deixou de existir.
  }
}
