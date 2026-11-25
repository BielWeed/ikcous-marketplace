// Caça por mutação em `src/config/configuracaoDaLoja.ts` (25/11/2026).
//
// `pagamentoOnlineLigado()` é a trava que abre (ou não) a cobrança online, e o
// comentário do próprio módulo promete: "falha fechada por desenho: só `true`
// liga o checkout online". Hoje o contrato da ficha (`fichaDaLoja.ts`) já
// recusa quem não manda um booleano, então os testes vizinhos só alimentam o
// módulo com `true`/`false` — e por isso trocar `=== true` por "qualquer valor
// verdadeiro" (ou por `!== false`) passava em todos eles.
//
// Aqui a ficha é DUBLADA para entregar o que o contrato nunca deixaria passar,
// só para provar que a trava do atalho se sustenta sozinha: se o contrato da
// ficha um dia afrouxar, um "true" de texto, um 1 ou um campo ausente continuam
// sem abrir a cobrança. É defesa em profundidade, não caminho que o app percorre.
import { afterEach, describe, expect, it, vi } from "vitest";

const { lerFichaDaLoja } = vi.hoisted(() => ({
  lerFichaDaLoja: vi.fn<() => unknown>(),
}));

vi.mock("@/config/fichaDaLoja", () => ({ lerFichaDaLoja }));

import {
  modoManutencao,
  pagamentoOnlineLigado,
} from "@/config/configuracaoDaLoja";

function fichaComPagamento(pagamentoOnline: unknown) {
  return {
    configuracao: {
      mpPublicKey: null,
      vapidPublicKey: null,
      pagamentoOnline,
      manutencao: false,
    },
  };
}

describe("pagamentoOnlineLigado — só o booleano true abre a cobrança", () => {
  afterEach(() => {
    lerFichaDaLoja.mockReset();
  });

  it.each([
    ["o texto 'true'", "true"],
    ["o número 1", 1],
    ["um objeto vazio", {}],
    ["um campo ausente (undefined)", undefined],
    ["null", null],
    ["o texto vazio", ""],
  ])("%s NÃO liga o checkout online", (_nome, valor) => {
    lerFichaDaLoja.mockReturnValue(fichaComPagamento(valor));
    expect(pagamentoOnlineLigado()).toBe(false);
  });

  it("false desliga e o booleano true liga (o caminho de sempre continua de pé)", () => {
    lerFichaDaLoja.mockReturnValue(fichaComPagamento(false));
    expect(pagamentoOnlineLigado()).toBe(false);

    lerFichaDaLoja.mockReturnValue(fichaComPagamento(true));
    expect(pagamentoOnlineLigado()).toBe(true);
  });

  it("o atalho da manutenção não herda a pergunta do pagamento (cada um lê o seu campo)", () => {
    lerFichaDaLoja.mockReturnValue({
      configuracao: {
        mpPublicKey: null,
        vapidPublicKey: null,
        pagamentoOnline: true,
        manutencao: false,
      },
    });
    expect(pagamentoOnlineLigado()).toBe(true);
    expect(modoManutencao()).toBe(false);
  });
});
