// O CPF MORA NA CONTA (23/09/2026) — pendente de cadastro. Quando o
// `signUp` não devolve sessão (confirmação de e-mail pendente), o CPF
// informado no cadastro fica em localStorage sob uma chave EXCLUSIVA
// ("ikcous:cpf-pendente-cadastro") até a pessoa confirmar o e-mail — em
// QUALQUER aba, já que o link de confirmação no Android abre uma aba nova
// e a aba do cadastro pode ter fechado. Este arquivo prova: formato do
// registro, limpeza de lixo (expirado/inválido/versão desconhecida),
// retomada casando userId+email, dedupe de evento duplicado, e que
// storage indisponível nunca quebra o fluxo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

const CPF = "52998224725"; // 529.982.247-25 — dígitos válidos, de teste.
const USER_ID = "user-1";
const EMAIL = "cliente@example.com";
const CHAVE = "ikcous:cpf-pendente-cadastro";

function armazemFalso() {
  const mapa = new Map<string, string>();
  return {
    getItem: (chave: string) => mapa.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      mapa.set(chave, valor);
    },
    removeItem: (chave: string) => {
      mapa.delete(chave);
    },
    get tamanho() {
      return mapa.size;
    },
    mapaCru: mapa,
  };
}

describe("cpf-pendente-do-cadastro", () => {
  let armazem: ReturnType<typeof armazemFalso>;

  beforeEach(() => {
    vi.resetModules();
    rpc.mockReset();
    armazem = armazemFalso();
    vi.stubGlobal("localStorage", armazem);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("salvarPendente grava só dígitos, e-mail normalizado e expiraEm ~24h à frente, sob a chave exclusiva", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const { salvarPendente } = await import("@/lib/cpf-pendente-do-cadastro");

    const ok = salvarPendente({
      userId: USER_ID,
      email: " Cliente@Example.com ",
      cpf: "529.982.247-25",
    });

    expect(ok).toBe(true);
    const bruto = armazem.getItem(CHAVE);
    expect(bruto).not.toBeNull();
    const registro = JSON.parse(bruto!);
    expect(registro).toEqual({
      v: 1,
      userId: USER_ID,
      email: "cliente@example.com",
      cpf: CPF,
      expiraEm: 1_000_000 + 24 * 60 * 60 * 1000,
    });
    // Nenhuma outra chave recebe o CPF.
    expect(armazem.tamanho).toBe(1);
  });

  it("salvarPendente devolve false (sem lançar) quando localStorage.setItem explode", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    });
    const { salvarPendente } = await import("@/lib/cpf-pendente-do-cadastro");

    expect(salvarPendente({ userId: USER_ID, email: EMAIL, cpf: CPF })).toBe(
      false,
    );
  });

  it("lerPendente devolve null e remove: JSON inválido", async () => {
    armazem.setItem(CHAVE, "{ isto não é json");
    const { lerPendente } = await import("@/lib/cpf-pendente-do-cadastro");

    expect(lerPendente()).toBeNull();
    expect(armazem.getItem(CHAVE)).toBeNull();
  });

  it("lerPendente devolve null e remove: versão desconhecida", async () => {
    armazem.setItem(
      CHAVE,
      JSON.stringify({
        v: 2,
        userId: USER_ID,
        email: EMAIL,
        cpf: CPF,
        expiraEm: Date.now() + 1000,
      }),
    );
    const { lerPendente } = await import("@/lib/cpf-pendente-do-cadastro");

    expect(lerPendente()).toBeNull();
    expect(armazem.getItem(CHAVE)).toBeNull();
  });

  it("lerPendente devolve null e remove: CPF inválido gravado (dado corrompido)", async () => {
    armazem.setItem(
      CHAVE,
      JSON.stringify({
        v: 1,
        userId: USER_ID,
        email: EMAIL,
        cpf: "11111111111",
        expiraEm: Date.now() + 1000,
      }),
    );
    const { lerPendente } = await import("@/lib/cpf-pendente-do-cadastro");

    expect(lerPendente()).toBeNull();
    expect(armazem.getItem(CHAVE)).toBeNull();
  });

  it("lerPendente devolve null e remove: expirado (TTL de 24h vencido)", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000_000_000);
    armazem.setItem(
      CHAVE,
      JSON.stringify({
        v: 1,
        userId: USER_ID,
        email: EMAIL,
        cpf: CPF,
        expiraEm: 1_999_999_999,
      }),
    );
    const { lerPendente } = await import("@/lib/cpf-pendente-do-cadastro");

    expect(lerPendente()).toBeNull();
    expect(armazem.getItem(CHAVE)).toBeNull();
  });

  it("lerPendente devolve o registro dentro do TTL", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    armazem.setItem(
      CHAVE,
      JSON.stringify({
        v: 1,
        userId: USER_ID,
        email: EMAIL,
        cpf: CPF,
        expiraEm: 1_000_001,
      }),
    );
    const { lerPendente } = await import("@/lib/cpf-pendente-do-cadastro");

    expect(lerPendente()).toEqual({
      v: 1,
      userId: USER_ID,
      email: EMAIL,
      cpf: CPF,
      expiraEm: 1_000_001,
    });
  });

  describe("retomarCpfPendente", () => {
    function gravarPendenteBruto(
      overrides: Partial<Record<string, unknown>> = {},
    ) {
      armazem.setItem(
        CHAVE,
        JSON.stringify({
          v: 1,
          userId: USER_ID,
          email: EMAIL,
          cpf: CPF,
          expiraEm: Date.now() + 1000,
          ...overrides,
        }),
      );
    }

    it("sem pendente: não chama a RPC", async () => {
      const { retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      const resultado = await retomarCpfPendente({
        userId: USER_ID,
        email: EMAIL,
      });

      expect(resultado).toBe("sem_pendente");
      expect(rpc).not.toHaveBeenCalled();
    });

    it("userId da sessão bate: chama set_my_cpf uma vez e remove o pendente no sucesso", async () => {
      gravarPendenteBruto();
      rpc.mockResolvedValueOnce({ data: null, error: null });
      const { retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      const resultado = await retomarCpfPendente({
        userId: USER_ID,
        email: EMAIL,
      });

      expect(resultado).toBe("gravado");
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith("set_my_cpf", { p_cpf: CPF });
      expect(armazem.getItem(CHAVE)).toBeNull();
    });

    it("sessão de OUTRA conta (userId diverge): remove sem gravar, RPC nunca chamada", async () => {
      gravarPendenteBruto();
      const { retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      const resultado = await retomarCpfPendente({
        userId: "outro-user",
        email: EMAIL,
      });

      expect(resultado).toBe("outra_conta");
      expect(rpc).not.toHaveBeenCalled();
      expect(armazem.getItem(CHAVE)).toBeNull();
    });

    it("e-mail da sessão diverge (mesmo userId por coincidência não é o caso real, mas o contrato pede o par): remove sem gravar", async () => {
      gravarPendenteBruto();
      const { retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      const resultado = await retomarCpfPendente({
        userId: USER_ID,
        email: "outro@example.com",
      });

      expect(resultado).toBe("outra_conta");
      expect(rpc).not.toHaveBeenCalled();
      expect(armazem.getItem(CHAVE)).toBeNull();
    });

    it("expirado: remove sem gravar", async () => {
      vi.spyOn(Date, "now").mockReturnValue(2_000_000_000);
      gravarPendenteBruto({ expiraEm: 1_999_999_999 });
      const { retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      const resultado = await retomarCpfPendente({
        userId: USER_ID,
        email: EMAIL,
      });

      expect(resultado).toBe("expirado");
      expect(rpc).not.toHaveBeenCalled();
      expect(armazem.getItem(CHAVE)).toBeNull();
    });

    it("falha na gravação (rede/servidor): MANTÉM o pendente até expirar — não some antes da hora", async () => {
      gravarPendenteBruto();
      rpc.mockResolvedValueOnce({
        data: null,
        error: { code: "XXYYY", message: "boom" },
      });
      const { retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      const resultado = await retomarCpfPendente({
        userId: USER_ID,
        email: EMAIL,
      });

      expect(resultado).toBe("falhou");
      expect(armazem.getItem(CHAVE)).not.toBeNull();
    });

    it("perfil não encontrado (CPF03 — o UPDATE não achou linha): MANTÉM o pendente, nunca trata como salvo", async () => {
      gravarPendenteBruto();
      rpc.mockResolvedValueOnce({
        data: null,
        error: { code: "CPF03", message: "Perfil não encontrado" },
      });
      const { retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      const resultado = await retomarCpfPendente({
        userId: USER_ID,
        email: EMAIL,
      });

      expect(resultado).toBe("falhou");
      expect(armazem.getItem(CHAVE)).not.toBeNull();
    });

    it("NOVA ABA + SIGNED_IN e INITIAL_SESSION quase simultâneos: só UMA chamada a set_my_cpf, pendente removido uma vez", async () => {
      gravarPendenteBruto();
      let resolverRpc: (v: unknown) => void;
      rpc.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolverRpc = resolve;
          }),
      );
      const { retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      // Dois eventos "quase simultâneos" (SIGNED_IN + INITIAL_SESSION) —
      // o segundo chega ANTES do primeiro terminar.
      const p1 = retomarCpfPendente({ userId: USER_ID, email: EMAIL });
      const p2 = retomarCpfPendente({ userId: USER_ID, email: EMAIL });

      resolverRpc!({ data: null, error: null });
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(rpc).toHaveBeenCalledTimes(1);
      expect([r1, r2]).toContain("gravado");
      expect([r1, r2]).toContain("ja_em_curso");
      expect(armazem.getItem(CHAVE)).toBeNull();
    });

    it("retorno DENTRO do TTL grava normalmente (não é o caso de expirado)", async () => {
      vi.spyOn(Date, "now").mockReturnValue(1_000_000);
      gravarPendenteBruto({ expiraEm: 1_000_000 + 60_000 });
      rpc.mockResolvedValueOnce({ data: null, error: null });
      const { retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      const resultado = await retomarCpfPendente({
        userId: USER_ID,
        email: EMAIL,
      });

      expect(resultado).toBe("gravado");
    });
  });
});
