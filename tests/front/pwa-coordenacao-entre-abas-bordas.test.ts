// Bordas do protocolo entre abas que o teste principal não alcança (achadas por
// mutação): mensagens malformadas, mensagem que chega depois de fechar e o eco.
//
// A aba não pode se contar como "outra aba ocupada". O BroadcastChannel real não
// devolve a mensagem ao canal que a enviou, mas a guarda existe para o dia em
// que um navegador, uma extensão ou um proxy de canal devolver: sem ela, uma aba
// ocupada se bloquearia sozinha para sempre, e o app nunca mais se atualizaria.
// O dublê abaixo ENTREGA a mensagem também a quem enviou.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  JANELA_DE_CONSULTA_MS,
  criarCoordenacaoEntreAbas,
} from "@/lib/atualizacao/coordenacao-entre-abas";

class CanalQueEcoa {
  static todos: CanalQueEcoa[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  fechado = false;
  constructor() {
    CanalQueEcoa.todos.push(this);
  }
  postMessage(dado: unknown) {
    for (const canal of CanalQueEcoa.todos) {
      if (!canal.fechado) canal.onmessage?.({ data: dado });
    }
  }
  close() {
    this.fechado = true;
  }
}

/** Canal simples: guarda o que a aba envia e deixa o teste injetar mensagens. */
class CanalManual {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  enviadas: Array<{ tipo?: string }> = [];
  postMessage(dado: unknown) {
    this.enviadas.push(dado as { tipo?: string });
  }
  close() {}
  receber(dado: unknown) {
    this.onmessage?.({ data: dado });
  }
}

describe("coordenação entre abas — bordas", () => {
  beforeEach(() => {
    CanalQueEcoa.todos = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aba ocupada, sozinha, não conta a si mesma como par ocupado", () => {
    const c = criarCoordenacaoEntreAbas({
      estaLivre: () => false,
      fabricaDeCanal: () => new CanalQueEcoa(),
      alvoDeCicloDeVida: null,
    });

    c.anunciar();

    expect(c.paresOcupados()).toBe(0);
    c.fechar();
  });

  it("a pergunta 'todas livres?' não é adiada pelo eco do próprio estado ocupado", async () => {
    const c = criarCoordenacaoEntreAbas({
      estaLivre: () => false,
      fabricaDeCanal: () => new CanalQueEcoa(),
      alvoDeCicloDeVida: null,
    });

    const resposta = c.perguntarSeTodasLivres();
    await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS);

    // Sem outras abas, não há par ocupado: o veto desta aba mora no instalador.
    await expect(resposta).resolves.toBe(true);
    c.fechar();
  });

  it("outra aba realmente ocupada continua adiando, mesmo com o eco ligado", async () => {
    const eu = criarCoordenacaoEntreAbas({
      estaLivre: () => true,
      fabricaDeCanal: () => new CanalQueEcoa(),
      alvoDeCicloDeVida: null,
    });
    const outra = criarCoordenacaoEntreAbas({
      estaLivre: () => false,
      fabricaDeCanal: () => new CanalQueEcoa(),
      alvoDeCicloDeVida: null,
    });

    outra.anunciar();
    expect(eu.paresOcupados()).toBe(1);
    const resposta = eu.perguntarSeTodasLivres();
    await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS);

    await expect(resposta).resolves.toBe(false);
    eu.fechar();
    outra.fechar();
  });

  it.each([
    ["estado sem o campo livre", { tipo: "estado", de: "par-1" }],
    [
      "estado com livre que não é verdadeiro/falso",
      { tipo: "estado", de: "par-1", livre: "nao" },
    ],
    ["estado sem remetente", { tipo: "estado", livre: false }],
    ["tipo desconhecido", { tipo: "ola", de: "par-1", livre: false }],
    ["texto solto", "ocupada"],
    ["nulo", null],
  ])(
    "mensagem malformada (%s) é ignorada e não vira par ocupado",
    (_caso, dado) => {
      const canal = new CanalManual();
      const c = criarCoordenacaoEntreAbas({
        estaLivre: () => true,
        fabricaDeCanal: () => canal,
        alvoDeCicloDeVida: null,
      });

      canal.receber(dado);

      expect(c.paresOcupados()).toBe(0);
      c.fechar();
    },
  );

  it("controle: a mesma mensagem bem formada conta como par ocupado", () => {
    const canal = new CanalManual();
    const c = criarCoordenacaoEntreAbas({
      estaLivre: () => true,
      fabricaDeCanal: () => canal,
      alvoDeCicloDeVida: null,
    });

    canal.receber({ tipo: "estado", de: "par-1", livre: false });

    expect(c.paresOcupados()).toBe(1);
    c.fechar();
  });

  it("depois de fechar, anunciar não envia nada (aba fechada não fala)", () => {
    const canal = new CanalManual();
    const c = criarCoordenacaoEntreAbas({
      estaLivre: () => true,
      fabricaDeCanal: () => canal,
      alvoDeCicloDeVida: null,
    });
    c.fechar();
    const antes = canal.enviadas.length;

    c.anunciar();

    expect(canal.enviadas).toHaveLength(antes);
    expect(canal.enviadas.at(-1)?.tipo).toBe("adeus");
  });

  it("mensagem que já estava a caminho quando a aba fechou não recria par", () => {
    const canal = new CanalManual();
    const c = criarCoordenacaoEntreAbas({
      estaLivre: () => true,
      fabricaDeCanal: () => canal,
      alvoDeCicloDeVida: null,
    });
    // O navegador já tinha entregado o ouvinte à fila de eventos.
    const entregar = canal.onmessage;
    c.fechar();

    entregar?.({ data: { tipo: "estado", de: "par-1", livre: false } });

    expect(c.paresOcupados()).toBe(0);
  });
});
