// Caça 7 (26/10/2026), defeito A: a chave da compra morava no sessionStorage,
// que morre ao FECHAR o app. Rede cai depois de o servidor gravar o pedido ->
// a tela diz "tente de novo, não sai em dobro" -> o cliente fecha e abre o
// PWA (o carrinho segue no localStorage) -> Finalizar girava chave NOVA ->
// segundo pedido, estoque baixado duas vezes.
//
// Agora o registro mora no localStorage, com o DONO no nome da chave e a
// validade (30 min) gravada no registro. A compra de amanhã, num carrinho
// idêntico, NÃO herda a chave de hoje: a validade é o que a esquece.
import {
  type ArmazenamentoSimples,
  PREFIXO_DA_CHAVE_DO_PEDIDO,
  criarGerenciadorDeChave,
  esquecerChaveDoPedidoDe,
} from "@/lib/chave-do-pedido";
import { PRAZO_DA_RETENTATIVA_MS } from "@/lib/pedido-sem-resposta";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MINUTO = 60_000;

// Map, não Record: indexação por chave variável em objeto é sink de injeção
// para o eslint.
function localStorageFalso() {
  const dados = new Map<string, string>();
  const armazenamento: ArmazenamentoSimples = {
    getItem: (k) => dados.get(k) ?? null,
    setItem: (k, v) => {
      dados.set(k, v);
    },
    removeItem: (k) => {
      dados.delete(k);
    },
  };
  return { dados, armazenamento };
}

function chaves(prefixo: string) {
  let n = 0;
  return () => `${prefixo}-${++n}`;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a chave da compra sobrevive a fechar e abrir o app", () => {
  it("o prazo é o mesmo do pedido sem resposta: 30 minutos", () => {
    expect(PRAZO_DA_RETENTATIVA_MS).toBe(30 * MINUTO);
  });

  it("gerenciador novo sobre o MESMO localStorage (sessionStorage vazio) devolve a MESMA chave", () => {
    const { armazenamento } = localStorageFalso();
    const antes = criarGerenciadorDeChave(armazenamento, chaves("a"), {
      dono: null,
    }).chavePara("compra");

    // Fechou e abriu o app: nada da instância anterior existe mais.
    const depois = criarGerenciadorDeChave(armazenamento, chaves("b"), {
      dono: null,
    }).chavePara("compra");

    expect(antes).toBe("a-1");
    expect(depois).toBe("a-1");
  });

  it("o registro leva o dono no nome: convidado e conta têm chaves de armazenamento próprias", () => {
    const { armazenamento, dados } = localStorageFalso();
    criarGerenciadorDeChave(armazenamento, chaves("a"), {
      dono: null,
    }).chavePara("compra");
    criarGerenciadorDeChave(armazenamento, chaves("b"), {
      dono: "user-1",
    }).chavePara("compra");

    expect([...dados.keys()].sort()).toEqual([
      "ikcous-chave-do-pedido:convidado",
      "ikcous-chave-do-pedido:user-1",
    ]);
  });

  it("troca de conta NUNCA herda a chave de outra, mesmo com a mesma impressão", () => {
    const { armazenamento } = localStorageFalso();
    const daConta1 = criarGerenciadorDeChave(armazenamento, chaves("c1"), {
      dono: "user-1",
    }).chavePara("compra");
    const daConta2 = criarGerenciadorDeChave(armazenamento, chaves("c2"), {
      dono: "user-2",
    }).chavePara("compra");
    const doConvidado = criarGerenciadorDeChave(armazenamento, chaves("cv"), {
      dono: null,
    }).chavePara("compra");

    expect(new Set([daConta1, daConta2, doConvidado]).size).toBe(3);
    // E cada um reencontra a SUA.
    expect(
      criarGerenciadorDeChave(armazenamento, chaves("x"), {
        dono: "user-1",
      }).chavePara("compra"),
    ).toBe(daConta1);
  });

  it("vale até o prazo de 30 minutos e, vencido, gira chave nova", () => {
    const { armazenamento } = localStorageFalso();
    const primeira = criarGerenciadorDeChave(armazenamento, chaves("a"), {
      dono: null,
    }).chavePara("compra");

    vi.advanceTimersByTime(30 * MINUTO - 1);
    expect(
      criarGerenciadorDeChave(armazenamento, chaves("b"), {
        dono: null,
      }).chavePara("compra"),
    ).toBe(primeira);

    vi.advanceTimersByTime(1);
    expect(
      criarGerenciadorDeChave(armazenamento, chaves("c"), {
        dono: null,
      }).chavePara("compra"),
    ).toBe("c-1");
  });

  it("a compra de AMANHÃ, num carrinho idêntico, não herda a chave de hoje", () => {
    const { armazenamento } = localStorageFalso();
    const hoje = criarGerenciadorDeChave(armazenamento, chaves("hoje"), {
      dono: "user-1",
    }).chavePara("carrinho-identico");

    vi.advanceTimersByTime(24 * 60 * MINUTO);

    const amanha = criarGerenciadorDeChave(armazenamento, chaves("amanha"), {
      dono: "user-1",
    }).chavePara("carrinho-identico");
    expect(amanha).toBe("amanha-1");
    expect(amanha).not.toBe(hoje);
  });

  it("a mesma instância aberta a noite inteira também não reaproveita a chave vencida", () => {
    const { armazenamento } = localStorageFalso();
    const gerente = criarGerenciadorDeChave(armazenamento, chaves("k"), {
      dono: null,
    });
    const hoje = gerente.chavePara("compra");

    vi.advanceTimersByTime(31 * MINUTO);

    expect(gerente.chavePara("compra")).not.toBe(hoje);
  });

  it("retentativa NÃO estende o prazo da compra original", () => {
    const { armazenamento } = localStorageFalso();
    const gerente = criarGerenciadorDeChave(armazenamento, chaves("k"), {
      dono: null,
    });
    const primeira = gerente.chavePara("compra");

    vi.advanceTimersByTime(20 * MINUTO);
    expect(gerente.chavePara("compra")).toBe(primeira);

    vi.advanceTimersByTime(11 * MINUTO);
    expect(
      criarGerenciadorDeChave(armazenamento, chaves("z"), {
        dono: null,
      }).chavePara("compra"),
    ).toBe("z-1");
  });

  it("o relógio é injetável", () => {
    const { armazenamento } = localStorageFalso();
    let agora = 1_000;
    const opcoes = { dono: null, agora: () => agora };
    const primeira = criarGerenciadorDeChave(
      armazenamento,
      chaves("a"),
      opcoes,
    ).chavePara("compra");
    agora += 30 * MINUTO + 1;
    expect(
      criarGerenciadorDeChave(armazenamento, chaves("b"), opcoes).chavePara(
        "compra",
      ),
    ).not.toBe(primeira);
  });

  it("esquecer() no sucesso apaga o registro: nem outro app aberto reencontra a chave", () => {
    const { armazenamento, dados } = localStorageFalso();
    const gerente = criarGerenciadorDeChave(armazenamento, chaves("a"), {
      dono: "user-1",
    });
    gerente.chavePara("compra");
    expect(dados.size).toBe(1);

    gerente.esquecer();

    expect(dados.size).toBe(0);
    expect(
      criarGerenciadorDeChave(armazenamento, chaves("b"), {
        dono: "user-1",
      }).chavePara("compra"),
    ).toBe("b-1");
  });

  it("esquecer() de um dono não toca no registro de outro", () => {
    const { armazenamento, dados } = localStorageFalso();
    const conta1 = criarGerenciadorDeChave(armazenamento, chaves("a"), {
      dono: "user-1",
    });
    conta1.chavePara("compra");
    criarGerenciadorDeChave(armazenamento, chaves("b"), {
      dono: "user-2",
    }).chavePara("compra");

    conta1.esquecer();

    expect([...dados.keys()]).toEqual(["ikcous-chave-do-pedido:user-2"]);
  });
});

describe("registro ilegível nunca quebra a compra", () => {
  const impressao = "compra";

  it.each([
    ["JSON quebrado", "{isso nao e json"],
    ["não é objeto", "42"],
    ["null", "null"],
    [
      "sem validade (formato de antes)",
      '{"impressao":"compra","chave":"velha"}',
    ],
    [
      "validade que não é número",
      '{"impressao":"compra","chave":"velha","expiraEm":"amanha"}',
    ],
    [
      "validade já vencida",
      `{"impressao":"compra","chave":"velha","expiraEm":${Date.parse("2026-10-26T09:59:00Z")}}`,
    ],
    [
      "validade absurda, muito além do prazo",
      `{"impressao":"compra","chave":"velha","expiraEm":${Date.parse("2030-01-01T00:00:00Z")}}`,
    ],
    [
      "chave que não é texto",
      `{"impressao":"compra","chave":7,"expiraEm":${Date.parse("2026-10-26T10:10:00Z")}}`,
    ],
  ])("%s: ignora o registro e gira chave nova, sem lançar", (_nome, cru) => {
    const { armazenamento } = localStorageFalso();
    armazenamento.setItem("ikcous-chave-do-pedido:convidado", cru);
    const gerente = criarGerenciadorDeChave(armazenamento, chaves("nova"), {
      dono: null,
    });

    expect(() => gerente.chavePara(impressao)).not.toThrow();
    expect(gerente.chavePara(impressao)).toBe("nova-1");
  });

  it("armazenamento que lança em tudo: a instância ainda repete a chave", () => {
    const quebrado: ArmazenamentoSimples = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("cheio");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    };
    const gerente = criarGerenciadorDeChave(quebrado, chaves("k"), {
      dono: null,
    });
    expect(gerente.chavePara(impressao)).toBe("k-1");
    expect(gerente.chavePara(impressao)).toBe("k-1");
    expect(() => gerente.esquecer()).not.toThrow();
  });
});

describe("esquecerChaveDoPedidoDe — troca de conta apaga o registro de quem saiu", () => {
  it("apaga só o registro do dono indicado", () => {
    const { armazenamento, dados } = localStorageFalso();
    criarGerenciadorDeChave(armazenamento, chaves("a"), {
      dono: "user-1",
    }).chavePara("compra");
    criarGerenciadorDeChave(armazenamento, chaves("b"), {
      dono: "user-2",
    }).chavePara("compra");

    esquecerChaveDoPedidoDe("user-1", armazenamento);

    expect([...dados.keys()]).toEqual([`${PREFIXO_DA_CHAVE_DO_PEDIDO}user-2`]);
  });

  it("não lança com armazenamento quebrado nem com dono vazio", () => {
    const quebrado: ArmazenamentoSimples = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error("bloqueado");
      },
    };
    expect(() => esquecerChaveDoPedidoDe("user-1", quebrado)).not.toThrow();
    expect(() => esquecerChaveDoPedidoDe("", quebrado)).not.toThrow();
  });
});
