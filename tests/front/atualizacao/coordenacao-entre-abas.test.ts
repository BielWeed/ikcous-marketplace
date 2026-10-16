// COORDENAÇÃO ENTRE ABAS — presença por BroadcastChannel. Cada aba anuncia o
// estado (livre/ocupada) ao montar, a cada mudança, a cada ~5 s e quando outra
// aba consulta; despede-se ao sair. Silêncio é DESCONHECIDO, não "livre":
// o par cujo último estado foi "ocupada" continua adiando mesmo calado.
//
// Isto é cortesia: a segurança dos dados é o veto local de cada aba (testado em
// instalador.test.tsx e pwa-update-gate). Aqui só se prova o protocolo.
//
// O dublê de BroadcastChannel imita o que importa do navegador: a mensagem vai
// a TODOS os canais do mesmo nome, MENOS ao que enviou.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INTERVALO_DO_HEARTBEAT_MS,
  JANELA_DE_CONSULTA_MS,
  NOME_DO_CANAL_DE_ABAS,
  VALIDADE_DO_PAR_MS,
  criarCoordenacaoEntreAbas,
} from "@/lib/atualizacao/coordenacao-entre-abas";

class CanalDeTeste {
  static todos: CanalDeTeste[] = [];
  nome: string;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  fechado = false;
  enviadas: unknown[] = [];
  constructor(nome: string) {
    this.nome = nome;
    CanalDeTeste.todos.push(this);
  }
  postMessage(dado: unknown) {
    this.enviadas.push(dado);
    for (const outro of CanalDeTeste.todos) {
      if (outro !== this && !outro.fechado && outro.nome === this.nome) {
        outro.onmessage?.({ data: dado });
      }
    }
  }
  close() {
    this.fechado = true;
  }
}

const fabrica = (nome: string) => new CanalDeTeste(nome);

// alvo de ciclo de vida dublê (pagehide/pageshow) para não depender do window
function criarAlvo() {
  const ouvintes = new Map<string, Set<() => void>>();
  return {
    addEventListener: (t: string, f: () => void) => {
      if (!ouvintes.has(t)) ouvintes.set(t, new Set());
      ouvintes.get(t)?.add(f);
    },
    removeEventListener: (t: string, f: () => void) => {
      ouvintes.get(t)?.delete(f);
    },
    disparar: (t: string) => {
      for (const f of [...(ouvintes.get(t) ?? [])]) f();
    },
    quantos: (t: string) => ouvintes.get(t)?.size ?? 0,
  };
}

function nova(estaLivre: () => boolean, extra = {}) {
  const alvo = criarAlvo();
  const c = criarCoordenacaoEntreAbas({
    estaLivre,
    fabricaDeCanal: fabrica,
    alvoDeCicloDeVida: alvo,
    ...extra,
  });
  return { c, alvo };
}

describe("coordenação entre abas", () => {
  beforeEach(() => {
    CanalDeTeste.todos = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("constantes do protocolo: janela ~300 ms, heartbeat ~5 s, validade do par 10 min", () => {
    expect(JANELA_DE_CONSULTA_MS).toBe(300);
    expect(INTERVALO_DO_HEARTBEAT_MS).toBe(5000);
    expect(VALIDADE_DO_PAR_MS).toBe(10 * 60 * 1000);
  });

  describe("quem pergunta", () => {
    it("NENHUM par conhecido: depois da janela segue (o veto local de cada aba é quem protege)", async () => {
      const { c } = nova(() => true);
      const p = c.perguntarSeTodasLivres();
      await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 1);
      await expect(p).resolves.toBe(true);
      c.fechar();
    });

    it("par OCUPADO: adia — e logo, sem esperar a janela inteira", async () => {
      const a = nova(() => true);
      const b = nova(() => false);
      await expect(a.c.perguntarSeTodasLivres()).resolves.toBe(false);
      a.c.fechar();
      b.c.fechar();
    });

    it("par LIVRE: segue depois da janela", async () => {
      const a = nova(() => true);
      const b = nova(() => true);
      const p = a.c.perguntarSeTodasLivres();
      await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 1);
      await expect(p).resolves.toBe(true);
      a.c.fechar();
      b.c.fechar();
    });

    it("um livre e um ocupado: ocupado vence (qualquer 'ocupada' adia)", async () => {
      const a = nova(() => true);
      const b = nova(() => true);
      const c = nova(() => false);
      const p = a.c.perguntarSeTodasLivres();
      await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 1);
      await expect(p).resolves.toBe(false);
      for (const x of [a, b, c]) x.c.fechar();
    });

    it("a resposta à consulta é a situação de AGORA: par que estava ocupado e liberou deixa passar", async () => {
      let livre = false;
      const a = nova(() => true);
      const b = nova(() => livre);
      await expect(a.c.perguntarSeTodasLivres()).resolves.toBe(false);
      livre = true;
      const p = a.c.perguntarSeTodasLivres();
      await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 1);
      await expect(p).resolves.toBe(true);
      a.c.fechar();
      b.c.fechar();
    });

    it("par que não consegue dizer se está livre (estaLivre lança) é tratado como OCUPADO", async () => {
      const a = nova(() => true);
      const b = nova(() => {
        throw new Error("estado ilegível");
      });
      await expect(a.c.perguntarSeTodasLivres()).resolves.toBe(false);
      a.c.fechar();
      b.c.fechar();
    });
  });

  describe("silêncio é DESCONHECIDO, não 'livre'", () => {
    it("par que anunciou 'ocupada' e CALOU (congelado em segundo plano) continua adiando", async () => {
      const a = nova(() => true);
      const fantasma = new CanalDeTeste(NOME_DO_CANAL_DE_ABAS);
      fantasma.postMessage({
        tipo: "estado",
        de: "aba-congelada",
        livre: false,
      });
      // 9 minutos de silêncio total (menos que a validade): ainda ocupada
      await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
      const p = a.c.perguntarSeTodasLivres();
      await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 1);
      await expect(p).resolves.toBe(false);
      expect(a.c.paresOcupados()).toBe(1);
      a.c.fechar();
    });

    it("par sem NENHUM sinal por mais de 10 min é descartado (aba que morreu sem se despedir)", async () => {
      const a = nova(() => true);
      const fantasma = new CanalDeTeste(NOME_DO_CANAL_DE_ABAS);
      fantasma.postMessage({ tipo: "estado", de: "aba-morta", livre: false });
      await vi.advanceTimersByTimeAsync(VALIDADE_DO_PAR_MS + 1000);
      const p = a.c.perguntarSeTodasLivres();
      await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 1);
      await expect(p).resolves.toBe(true);
      expect(a.c.paresOcupados()).toBe(0);
      a.c.fechar();
    });

    it("par que se DESPEDE (adeus / pagehide) sai do mapa na hora", async () => {
      const a = nova(() => true);
      const b = nova(() => false);
      expect(a.c.paresOcupados()).toBe(1);
      b.alvo.disparar("pagehide");
      expect(a.c.paresOcupados()).toBe(0);
      // a página de b foi embora de verdade: some do canal, não responde mais
      CanalDeTeste.todos[1].fechado = true;
      const p = a.c.perguntarSeTodasLivres();
      await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 1);
      await expect(p).resolves.toBe(true);
      a.c.fechar();
      b.c.fechar();
    });

    it("fechar() também se despede (desmontar o gate não deixa par fantasma)", () => {
      const a = nova(() => true);
      const b = nova(() => false);
      expect(a.c.paresOcupados()).toBe(1);
      b.c.fechar();
      expect(a.c.paresOcupados()).toBe(0);
      a.c.fechar();
    });
  });

  describe("presença: ao montar, a cada mudança, a cada 5 s", () => {
    it("anuncia ao montar", () => {
      const a = nova(() => true);
      const canal = CanalDeTeste.todos[0];
      expect(canal.enviadas).toContainEqual(
        expect.objectContaining({ tipo: "estado", livre: true }),
      );
      a.c.fechar();
    });

    it("repete o estado a cada ~5 s (heartbeat) com o valor do momento", async () => {
      let livre = true;
      const a = nova(() => livre);
      const canal = CanalDeTeste.todos[0];
      const antes = canal.enviadas.length;
      livre = false;
      await vi.advanceTimersByTimeAsync(INTERVALO_DO_HEARTBEAT_MS + 1);
      expect(canal.enviadas.length).toBeGreaterThan(antes);
      expect(canal.enviadas.at(-1)).toMatchObject({
        tipo: "estado",
        livre: false,
      });
      a.c.fechar();
    });

    it("anunciar() publica na hora a mudança de estado", () => {
      let livre = true;
      const a = nova(() => livre);
      const b = nova(() => true);
      expect(b.c.paresOcupados()).toBe(0);
      livre = false;
      a.c.anunciar();
      expect(b.c.paresOcupados()).toBe(1);
      a.c.fechar();
      b.c.fechar();
    });

    it("pageshow (volta do bfcache) reanuncia", () => {
      let livre = true;
      const a = nova(() => livre);
      const b = nova(() => true);
      livre = false;
      a.alvo.disparar("pageshow");
      expect(b.c.paresOcupados()).toBe(1);
      a.c.fechar();
      b.c.fechar();
    });
  });

  describe("sem BroadcastChannel", () => {
    it("fábrica devolvendo null: pares DESCONHECIDOS, segue na hora, sem timer e sem erro", async () => {
      const c = criarCoordenacaoEntreAbas({
        estaLivre: () => true,
        fabricaDeCanal: () => null,
        alvoDeCicloDeVida: criarAlvo(),
      });
      await expect(c.perguntarSeTodasLivres()).resolves.toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(() => c.anunciar()).not.toThrow();
      expect(() => c.fechar()).not.toThrow();
    });

    it("construtor lançando (SecurityError): não derruba o boot", async () => {
      const c = criarCoordenacaoEntreAbas({
        estaLivre: () => true,
        fabricaDeCanal: () => {
          throw new Error("SecurityError");
        },
        alvoDeCicloDeVida: criarAlvo(),
      });
      await expect(c.perguntarSeTodasLivres()).resolves.toBe(true);
    });

    it("ambiente SEM a global BroadcastChannel (padrão): criar não lança", async () => {
      vi.stubGlobal("BroadcastChannel", undefined);
      const c = criarCoordenacaoEntreAbas({
        estaLivre: () => true,
        alvoDeCicloDeVida: criarAlvo(),
      });
      await expect(c.perguntarSeTodasLivres()).resolves.toBe(true);
    });

    it("postMessage lançando (canal fechado): não derruba", () => {
      const canal = new CanalDeTeste(NOME_DO_CANAL_DE_ABAS);
      canal.postMessage = () => {
        throw new Error("InvalidStateError");
      };
      expect(() => {
        const c = criarCoordenacaoEntreAbas({
          estaLivre: () => true,
          fabricaDeCanal: () => canal,
          alvoDeCicloDeVida: criarAlvo(),
        });
        c.anunciar();
        c.fechar();
      }).not.toThrow();
    });
  });

  it("lixo no canal (mensagem que não é do protocolo) é ignorado", async () => {
    const a = nova(() => true);
    const intruso = new CanalDeTeste(NOME_DO_CANAL_DE_ABAS);
    for (const lixo of [
      null,
      42,
      "texto",
      {},
      { tipo: "estado" },
      { tipo: "estado", de: "x" },
      { tipo: "estado", de: "x", livre: "não" },
      { tipo: "desconhecido", de: "x" },
      [],
    ]) {
      intruso.postMessage(lixo);
    }
    const p = a.c.perguntarSeTodasLivres();
    await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 1);
    await expect(p).resolves.toBe(true);
    expect(a.c.paresOcupados()).toBe(0);
    a.c.fechar();
  });

  it("a aba não ouve a si mesma nem conta a si como par", async () => {
    const a = nova(() => false);
    expect(a.c.paresOcupados()).toBe(0);
    const p = a.c.perguntarSeTodasLivres();
    await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 1);
    await expect(p).resolves.toBe(true);
    a.c.fechar();
  });

  describe("fechar", () => {
    it("some tudo: ouvintes, canal, timers — e consulta pendente NÃO autoriza instalar", async () => {
      const a = nova(() => true);
      const canal = CanalDeTeste.todos[0];
      expect(a.alvo.quantos("pagehide")).toBe(1);
      const p = a.c.perguntarSeTodasLivres();
      a.c.fechar();
      await expect(p).resolves.toBe(false);
      expect(canal.fechado).toBe(true);
      expect(canal.onmessage).toBeNull();
      expect(a.alvo.quantos("pagehide")).toBe(0);
      expect(a.alvo.quantos("pageshow")).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      // depois de fechada, perguntar não instala nada nem lança
      await expect(a.c.perguntarSeTodasLivres()).resolves.toBe(false);
      expect(() => a.c.fechar()).not.toThrow();
    });
  });
});
