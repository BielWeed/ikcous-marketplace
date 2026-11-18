// Duas (ou mais) "abas" simuladas para testar useLeaderElection: cada aba é uma
// reimportação FRESCA do módulo (vi.resetModules) — o módulo guarda TAB_ID e o
// BroadcastChannel como singletons, então só assim cada aba tem identidade e
// canal próprios. Mesmo idioma de
// lider-nao-duplica-quando-abas-seguidoras-correm-pela-vaga.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { vi } from "vitest";

export const LEADER_KEY = "pwa_leader_tab";
export const LEADER_TTL = 5000;

export type Mensagem = { type: string; tabId: string };
type Ouvinte = (evento: { data: Mensagem }) => void;

/** BroadcastChannel falso com fan-out de verdade entre instâncias do mesmo
 * nome; registra tudo o que foi enviado (`enviadas`). */
export class CanalFalso {
  static registro = new Map<string, Set<CanalFalso>>();
  static todas: CanalFalso[] = [];
  static enviadas: Array<Mensagem & { de: CanalFalso }> = [];

  name: string;
  private ouvintes: Ouvinte[] = [];

  constructor(name: string) {
    this.name = name;
    if (!CanalFalso.registro.has(name))
      CanalFalso.registro.set(name, new Set());
    CanalFalso.registro.get(name)?.add(this);
    CanalFalso.todas.push(this);
  }

  addEventListener(_tipo: "message", ouvinte: Ouvinte) {
    this.ouvintes.push(ouvinte);
  }

  removeEventListener(_tipo: "message", ouvinte: Ouvinte) {
    this.ouvintes = this.ouvintes.filter((o) => o !== ouvinte);
  }

  postMessage(data: Mensagem) {
    CanalFalso.enviadas.push({ ...data, de: this });
    const pares = CanalFalso.registro.get(this.name);
    if (!pares) return;
    for (const outra of pares) {
      if (outra === this) continue;
      queueMicrotask(() => outra.entregar(data));
    }
  }

  entregar(data: Mensagem) {
    for (const ouvinte of [...this.ouvintes]) ouvinte({ data });
  }

  close() {
    CanalFalso.registro.get(this.name)?.delete(this);
  }

  static reiniciar() {
    CanalFalso.registro.clear();
    CanalFalso.todas = [];
    CanalFalso.enviadas = [];
  }
}

export function armazenamentoQueFunciona() {
  const armazem = new Map<string, string>();
  return {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
  };
}

/** Armazenamento do site bloqueado (cookies de terceiros / modo restrito):
 * qualquer acesso lança SecurityError. */
export function armazenamentoBloqueado() {
  const recusa = () => {
    throw new DOMException("bloqueado", "SecurityError");
  };
  return { getItem: recusa, setItem: recusa, removeItem: recusa };
}

/** Armazenamento cheio: lê normal, mas toda gravação lança QuotaExceeded. */
export function armazenamentoCheio() {
  const base = armazenamentoQueFunciona();
  return {
    ...base,
    setItem: () => {
      throw new DOMException("cheio", "QuotaExceededError");
    },
  };
}

export type Aba = {
  estados: boolean[];
  canal: CanalFalso;
  raiz: Root;
  tabId: string;
};

export function criarAbas() {
  let roots: Root[] = [];
  let hosts: HTMLDivElement[] = [];

  async function montarAba(): Promise<Aba> {
    vi.resetModules();
    const mod = await import("@/hooks/useLeaderElection");
    const hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    hosts.push(hospedeiro);
    const raiz = createRoot(hospedeiro);
    roots.push(raiz);
    const estados: boolean[] = [];
    let tabId = "";
    function Sonda() {
      const r = mod.useLeaderElection();
      estados.push(r.isLeader);
      tabId = r.tabId;
      return null;
    }
    act(() => {
      raiz.render(<Sonda />);
    });
    const canal = CanalFalso.todas.at(-1);
    if (!canal) throw new Error("canal de broadcast não foi criado no mount");
    return { estados, canal, raiz, tabId };
  }

  /** A aba trava (crash): o efeito para, sem `beforeunload` — nenhuma
   * renúncia sai e a chave de líder (se existir) fica com o ts antigo. */
  function travarAba(aba: Aba) {
    act(() => {
      aba.raiz.unmount();
    });
    roots = roots.filter((r) => r !== aba.raiz);
  }

  function limpar() {
    act(() => {
      for (const raiz of roots) raiz.unmount();
    });
    for (const host of hosts) host.remove();
    roots = [];
    hosts = [];
  }

  return { montarAba, travarAba, limpar };
}

export const lider = (aba: Aba) => aba.estados.at(-1) === true;

export async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
