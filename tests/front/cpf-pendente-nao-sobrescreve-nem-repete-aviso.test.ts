// O CPF MORA NA CONTA — o pendente do cadastro não pode voltar depois e
// sobrescrever o CPF que a cliente digitou em Minha conta (ou no checkout),
// nem repetir o aviso de erro a cada abertura do app por 24 h.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pedidoCpfComCabecalho } from "./helpers/pedido-cpf-com-cabecalho";

const { rpc, getSession } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession },
    rpc: (...args: unknown[]) => {
      const resposta = rpc(...args);
      return args[0] === "set_my_cpf"
        ? pedidoCpfComCabecalho(resposta)
        : resposta;
    },
  },
}));

const CPF = "52998224725"; // 529.982.247-25 — dígitos válidos, de teste.
const USER_ID = "user-1";
const OUTRA_CONTA = "user-2";
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
  };
}

describe("cpf pendente: não sobrescreve a cliente e não repete o aviso", () => {
  let armazem: ReturnType<typeof armazemFalso>;

  function gravarPendente(userId = USER_ID) {
    armazem.setItem(
      CHAVE,
      JSON.stringify({
        v: 1,
        userId,
        email: EMAIL,
        cpf: CPF,
        expiraEm: Date.now() + 60 * 60 * 1000,
      }),
    );
  }

  beforeEach(() => {
    vi.resetModules();
    rpc.mockReset();
    getSession.mockReset();
    getSession.mockResolvedValue({
      data: {
        session: { access_token: "token-user-1", user: { id: USER_ID } },
      },
    });
    armazem = armazemFalso();
    vi.stubGlobal("localStorage", armazem);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("descartarPendenteDaConta", () => {
    it("apaga o pendente da MESMA conta que acabou de gravar/limpar o CPF", async () => {
      gravarPendente(USER_ID);
      const { descartarPendenteDaConta } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      descartarPendenteDaConta(USER_ID);

      expect(armazem.getItem(CHAVE)).toBeNull();
    });

    it("NÃO apaga o pendente de OUTRA conta (cadastro de outra pessoa no mesmo aparelho)", async () => {
      gravarPendente(OUTRA_CONTA);
      const { descartarPendenteDaConta } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      descartarPendenteDaConta(USER_ID);

      expect(armazem.getItem(CHAVE)).not.toBeNull();
    });

    it("sem pendente, com lixo no lugar do registro ou com storage quebrado: não lança", async () => {
      const { descartarPendenteDaConta } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );
      expect(() => descartarPendenteDaConta(USER_ID)).not.toThrow();

      armazem.setItem(CHAVE, "{lixo");
      expect(() => descartarPendenteDaConta(USER_ID)).not.toThrow();

      vi.stubGlobal("localStorage", {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {},
        removeItem: () => {
          throw new Error("SecurityError");
        },
      });
      expect(() => descartarPendenteDaConta(USER_ID)).not.toThrow();
    });

    it("depois de descartar, a próxima abertura do app NÃO chama set_my_cpf (o CPF digitado fica)", async () => {
      gravarPendente(USER_ID);
      const { descartarPendenteDaConta, retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      descartarPendenteDaConta(USER_ID);
      const resultado = await retomarCpfPendente({
        userId: USER_ID,
        email: EMAIL,
      });

      expect(resultado).toBe("sem_pendente");
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  describe("retomarCpfPendente: falhas", () => {
    it("CPF recusado pelo servidor (cpf_invalido) é terminal: avisa UMA vez e descarta, nunca fica até o TTL", async () => {
      gravarPendente();
      rpc.mockResolvedValue({
        data: null,
        error: { code: "CPF01", message: "x" },
      });
      const { retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      const primeira = await retomarCpfPendente({
        userId: USER_ID,
        email: EMAIL,
      });
      expect(primeira).toBe("falhou");
      expect(armazem.getItem(CHAVE)).toBeNull();

      const segunda = await retomarCpfPendente({
        userId: USER_ID,
        email: EMAIL,
      });
      expect(segunda).toBe("sem_pendente");
      expect(rpc).toHaveBeenCalledTimes(1);
    });

    it("falha de rede: continua tentando a cada abertura, mas só a PRIMEIRA devolve 'falhou' (o aviso)", async () => {
      gravarPendente();
      const expiraAntes = JSON.parse(armazem.getItem(CHAVE)!).expiraEm;
      rpc.mockResolvedValue({
        data: null,
        error: { code: "XXYYY", message: "boom" },
      });
      const { retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      const resultados = [];
      for (let i = 0; i < 3; i++) {
        resultados.push(
          await retomarCpfPendente({ userId: USER_ID, email: EMAIL }),
        );
      }

      expect(resultados).toEqual([
        "falhou",
        "falhou_ja_avisado",
        "falhou_ja_avisado",
      ]);
      // Continua tentando (3 chamadas) e o prazo de 24 h NÃO é renovado.
      expect(rpc).toHaveBeenCalledTimes(3);
      expect(JSON.parse(armazem.getItem(CHAVE)!).expiraEm).toBe(expiraAntes);
    });

    it("a cliente salva o CPF em Minha conta DURANTE o voo da chamada que falha: o pendente descartado NÃO ressuscita", async () => {
      gravarPendente();
      let falharDepois: () => void = () => {};
      rpc.mockImplementation(
        () =>
          new Promise((resolve) => {
            falharDepois = () =>
              resolve({
                data: null,
                error: { code: "XXYYY", message: "boom" },
              });
          }),
      );
      const { retomarCpfPendente, descartarPendenteDaConta } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      const emVoo = retomarCpfPendente({ userId: USER_ID, email: EMAIL });
      await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
      // Minha conta grava o CPF e descarta o pendente enquanto a rede pendura.
      descartarPendenteDaConta(USER_ID);
      expect(armazem.getItem(CHAVE)).toBeNull();
      falharDepois();

      expect(await emVoo).toBe("falhou");
      expect(armazem.getItem(CHAVE)).toBeNull();
    });

    it("outra pessoa se cadastra no aparelho DURANTE o voo: o pendente dela não é sobrescrito pelo marcador de aviso", async () => {
      gravarPendente(USER_ID);
      let falharDepois: () => void = () => {};
      rpc.mockImplementation(
        () =>
          new Promise((resolve) => {
            falharDepois = () =>
              resolve({
                data: null,
                error: { code: "XXYYY", message: "boom" },
              });
          }),
      );
      const { retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      const emVoo = retomarCpfPendente({ userId: USER_ID, email: EMAIL });
      await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
      gravarPendente(OUTRA_CONTA);
      falharDepois();
      await emVoo;

      const guardado = JSON.parse(armazem.getItem(CHAVE)!);
      expect(guardado.userId).toBe(OUTRA_CONTA);
      expect(guardado.avisado).toBeUndefined();
    });

    it("depois de avisada e a rede voltar: grava, remove, e não avisa de novo", async () => {
      gravarPendente();
      rpc.mockResolvedValueOnce({
        data: null,
        error: { code: "XXYYY", message: "boom" },
      });
      rpc.mockResolvedValueOnce({ data: null, error: null });
      const { retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      expect(await retomarCpfPendente({ userId: USER_ID, email: EMAIL })).toBe(
        "falhou",
      );
      expect(await retomarCpfPendente({ userId: USER_ID, email: EMAIL })).toBe(
        "gravado",
      );
      expect(armazem.getItem(CHAVE)).toBeNull();
    });

    it("sem sessão na hora de gravar (saiu da conta no meio): não avisa ninguém e MANTÉM o CPF para o próximo login", async () => {
      gravarPendente();
      getSession.mockResolvedValue({ data: { session: null } });
      const { retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      const resultado = await retomarCpfPendente({
        userId: USER_ID,
        email: EMAIL,
      });

      expect(resultado).toBe("sem_sessao");
      expect(armazem.getItem(CHAVE)).not.toBeNull();
      expect(rpc).not.toHaveBeenCalled();
    });

    it("registro antigo (sem o marcador de aviso) continua válido", async () => {
      gravarPendente();
      const { lerPendente } = await import("@/lib/cpf-pendente-do-cadastro");
      expect(lerPendente()?.cpf).toBe(CPF);
    });
  });
});
