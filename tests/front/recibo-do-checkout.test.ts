// @vitest-environment jsdom
//
// O RECIBO DO CHECKOUT: depois que o pedido é feito/pago, a aba guarda SÓ o id
// do pedido (numa chave PRÓPRIA, separada do "pagamento pendente") para o F5
// dizer "Seu pedido já foi feito" em vez de "Seu carrinho está vazio". Valem a
// validade de 2 horas, a conferência do dono e o "melhor esforço" do arquivo
// irmão (storage que lança nunca derruba nada).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chaveDoPedidoPendenteDoCheckout } from "@/lib/pedido-pendente-do-checkout";
import {
  VALIDADE_DO_RECIBO_MS,
  esquecerReciboDoCheckout,
  guardarReciboDoCheckout,
  lerReciboDoCheckout,
} from "@/lib/recibo-do-checkout";

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const OUTRO_PEDIDO = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";
const AGORA = 1_800_000_000_000;

function armazemDeTeste() {
  const dados = new Map<string, string>();
  return {
    dados,
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      dados.set(chave, String(valor));
    },
    removeItem: (chave: string) => {
      dados.delete(chave);
    },
    clear: () => {
      dados.clear();
    },
    key: (i: number) => Array.from(dados.keys()).at(i) ?? null,
    get length() {
      return dados.size;
    },
  };
}

describe("recibo do checkout (sessionStorage)", () => {
  let armazem: ReturnType<typeof armazemDeTeste>;

  beforeEach(() => {
    armazem = armazemDeTeste();
    vi.stubGlobal("sessionStorage", armazem);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("guarda só o id do pedido, o dono e a hora — nada de valor nem forma de pagamento", () => {
    guardarReciboDoCheckout("user-1", PEDIDO, AGORA);

    expect(armazem.dados.size).toBe(1);
    const [[, bruto]] = [...armazem.dados.entries()];
    expect(JSON.parse(bruto)).toEqual({
      pedidoId: PEDIDO,
      userId: "user-1",
      gravadoEm: AGORA,
    });
  });

  it("não mexe na chave do pagamento pendente (chaves separadas)", () => {
    armazem.setItem(chaveDoPedidoPendenteDoCheckout("user-1"), OUTRO_PEDIDO);

    guardarReciboDoCheckout("user-1", PEDIDO, AGORA);
    esquecerReciboDoCheckout();

    expect(armazem.getItem(chaveDoPedidoPendenteDoCheckout("user-1"))).toBe(
      OUTRO_PEDIDO,
    );
  });

  it("o dono certo lê o pedido", () => {
    guardarReciboDoCheckout("user-1", PEDIDO, AGORA);
    expect(lerReciboDoCheckout("user-1", AGORA + 1000)).toBe(PEDIDO);
  });

  it("visitante (sem conta) guarda e lê: os dois lados vazios valem", () => {
    guardarReciboDoCheckout(null, PEDIDO, AGORA);
    expect(lerReciboDoCheckout(null, AGORA + 1000)).toBe(PEDIDO);
    expect(lerReciboDoCheckout(undefined, AGORA + 1000)).toBe(PEDIDO);
  });

  it("recibo de outro usuário NÃO aparece — e continua guardado para o dono dele", () => {
    guardarReciboDoCheckout("user-1", PEDIDO, AGORA);

    expect(lerReciboDoCheckout("user-2", AGORA + 1000)).toBeNull();
    expect(lerReciboDoCheckout(null, AGORA + 1000)).toBeNull();
    expect(lerReciboDoCheckout("user-1", AGORA + 1000)).toBe(PEDIDO);
  });

  it("recibo de visitante não aparece para uma conta", () => {
    guardarReciboDoCheckout(null, PEDIDO, AGORA);
    expect(lerReciboDoCheckout("user-1", AGORA + 1000)).toBeNull();
  });

  it("vale por 2 horas: um instante antes ainda lê, na hora exata já venceu", () => {
    guardarReciboDoCheckout("user-1", PEDIDO, AGORA);

    expect(VALIDADE_DO_RECIBO_MS).toBe(2 * 60 * 60 * 1000);
    expect(
      lerReciboDoCheckout("user-1", AGORA + VALIDADE_DO_RECIBO_MS - 1),
    ).toBe(PEDIDO);
    expect(
      lerReciboDoCheckout("user-1", AGORA + VALIDADE_DO_RECIBO_MS),
    ).toBeNull();
  });

  it("ao vencer, a leitura apaga o recibo (nunca mais aparece, nem com o relógio de volta)", () => {
    guardarReciboDoCheckout("user-1", PEDIDO, AGORA);

    expect(
      lerReciboDoCheckout("user-1", AGORA + VALIDADE_DO_RECIBO_MS + 5),
    ).toBeNull();
    expect(armazem.dados.size).toBe(0);
    expect(lerReciboDoCheckout("user-1", AGORA + 1000)).toBeNull();
  });

  it("hora gravada no futuro (relógio mexido) não vale para sempre: é tratada como vencida", () => {
    guardarReciboDoCheckout("user-1", PEDIDO, AGORA + 10 * 60 * 60 * 1000);
    expect(lerReciboDoCheckout("user-1", AGORA)).toBeNull();
    expect(armazem.dados.size).toBe(0);
  });

  it("id fora do formato do pedido (uuid) não é guardado", () => {
    guardarReciboDoCheckout("user-1", "ped-999", AGORA);
    guardarReciboDoCheckout("user-1", "", AGORA);
    expect(armazem.dados.size).toBe(0);
  });

  it("conteúdo adulterado ou de versão velha é 'nada guardado' e some", () => {
    const [chave] = (() => {
      guardarReciboDoCheckout("user-1", PEDIDO, AGORA);
      return [...armazem.dados.keys()];
    })();

    for (const lixo of [
      "isto não é json",
      "null",
      "[]",
      JSON.stringify({
        pedidoId: "ped-999",
        userId: "user-1",
        gravadoEm: AGORA,
      }),
      JSON.stringify({ pedidoId: PEDIDO, userId: 7, gravadoEm: AGORA }),
      JSON.stringify({
        pedidoId: PEDIDO,
        userId: "user-1",
        gravadoEm: "ontem",
      }),
      JSON.stringify({ pedidoId: PEDIDO, userId: "user-1" }),
    ]) {
      armazem.setItem(chave, lixo);
      expect(lerReciboDoCheckout("user-1", AGORA + 1000)).toBeNull();
    }
  });

  it("um recibo novo substitui o anterior (um pedido por aba)", () => {
    guardarReciboDoCheckout("user-1", PEDIDO, AGORA);
    guardarReciboDoCheckout("user-1", OUTRO_PEDIDO, AGORA + 5000);

    expect(armazem.dados.size).toBe(1);
    expect(lerReciboDoCheckout("user-1", AGORA + 6000)).toBe(OUTRO_PEDIDO);
  });

  it("esquecer apaga, e apagar o que não existe não lança", () => {
    guardarReciboDoCheckout("user-1", PEDIDO, AGORA);
    esquecerReciboDoCheckout();
    expect(lerReciboDoCheckout("user-1", AGORA + 1000)).toBeNull();
    expect(() => esquecerReciboDoCheckout()).not.toThrow();
  });

  describe("storage com erro: nada guardado, nada quebra", () => {
    it("setItem, getItem e removeItem que lançam", () => {
      const quebrado = {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {
          throw new Error("SecurityError");
        },
        key: () => null,
        length: 0,
      };
      vi.stubGlobal("sessionStorage", quebrado);

      expect(() =>
        guardarReciboDoCheckout("user-1", PEDIDO, AGORA),
      ).not.toThrow();
      expect(lerReciboDoCheckout("user-1", AGORA)).toBeNull();
      expect(() => esquecerReciboDoCheckout()).not.toThrow();
    });

    it("até o ACESSO a sessionStorage lança (modo privado)", () => {
      vi.unstubAllGlobals();
      vi.spyOn(globalThis, "sessionStorage", "get").mockImplementation(() => {
        throw new Error("SecurityError");
      });

      expect(() =>
        guardarReciboDoCheckout("user-1", PEDIDO, AGORA),
      ).not.toThrow();
      expect(lerReciboDoCheckout("user-1", AGORA)).toBeNull();
      expect(() => esquecerReciboDoCheckout()).not.toThrow();
      vi.restoreAllMocks();
    });
  });
});
