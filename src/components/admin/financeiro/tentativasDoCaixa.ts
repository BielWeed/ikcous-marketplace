import { gerarUuidV4 as gerarChave } from "@/lib/uuid-v4";
import type { SessaoDeCaixa } from "@/types/financeiro";

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

/** Só a leitura nova do histórico comprova quais sessões foram fechadas. */
export function esquecerTentativasDeSessoesFechadas(
  autor: string | null,
  sessoes: readonly SessaoDeCaixa[],
): void {
  if (!autor) return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const local = localStorage.key(i);
      if (!local?.startsWith(PREFIXO)) continue;
      const alvo: unknown = JSON.parse(local.slice(PREFIXO.length));
      if (
        Array.isArray(alvo) &&
        alvo[0] === autor &&
        sessoes.some(
          (sessao) =>
            sessao.id === alvo[1] &&
            sessao.status === "fechado" &&
            sessao.fechadoEm,
        )
      ) {
        localStorage.removeItem(local);
      }
    }
  } catch {
    // Sem leitura confiável, não concluir que uma intenção deixou de existir.
  }
}
