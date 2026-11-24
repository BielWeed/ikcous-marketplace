// O que este teste protege, no CPF guardado entre o cadastro e a confirmação
// do e-mail (`@/lib/cpf-pendente-do-cadastro`), nos limites que os testes
// vizinhos não pisam:
//  - registro com userId vazio, e-mail vazio ou prazo que não é número é
//    LIXO: some na leitura. Um prazo "amanhã" (texto) nunca vencia, porque
//    toda comparação com texto dá falso, e o CPF ficava para sempre no
//    aparelho, em texto aberto;
//  - o prazo é inclusivo: no milissegundo exato do vencimento o CPF ainda vale,
//    1 ms depois não;
//  - o e-mail da sessão é comparado sem espaço nem maiúscula: sessão com
//    "Cliente@Example.com " não pode jogar fora o CPF da própria pessoa;
//  - o marcador de "já avisei" não cola em outro CPF da mesma conta que
//    entrou durante o voo da chamada.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pedidoCpfComCabecalho } from "./helpers/pedido-cpf-com-cabecalho";

const { rpc, getSession } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession },
    rpc: (...args: unknown[]) => pedidoCpfComCabecalho(rpc(...args)),
  },
}));

const CPF = "52998224725"; // 529.982.247-25 — dígitos válidos, de teste.
const OUTRO_CPF = "11144477735"; // 111.444.777-35 — outro CPF válido, de teste.
const USER_ID = "user-1";
const EMAIL = "cliente@example.com";
const CHAVE = "ikcous:cpf-pendente-cadastro";
const DIA_MS = 24 * 60 * 60 * 1000;

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

describe("cpf-pendente-do-cadastro — registro corrompido, prazo e e-mail", () => {
  let armazem: ReturnType<typeof armazemFalso>;

  function guardar(parcial: Record<string, unknown>) {
    armazem.setItem(
      CHAVE,
      JSON.stringify({
        v: 1,
        userId: USER_ID,
        email: EMAIL,
        cpf: CPF,
        expiraEm: Date.now() + 60_000,
        ...parcial,
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
    vi.useRealTimers();
  });

  describe("registro de formato inválido some na leitura", () => {
    it.each([
      ["userId vazio", { userId: "" }],
      ["userId que não é texto", { userId: 42 }],
      ["e-mail vazio", { email: "" }],
      ["e-mail que não é texto", { email: null }],
      ["prazo em texto", { expiraEm: "amanha" }],
      ["prazo ausente", { expiraEm: undefined }],
    ])("%s: devolve null e apaga o registro", async (_nome, defeito) => {
      guardar(defeito);
      const { lerPendente } = await import("@/lib/cpf-pendente-do-cadastro");

      expect(lerPendente()).toBeNull();
      expect(armazem.getItem(CHAVE)).toBeNull();
    });

    it("registro com prazo em texto também não é retomado nem grava o CPF", async () => {
      guardar({ expiraEm: "amanha" });
      const { retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      expect(await retomarCpfPendente({ userId: USER_ID, email: EMAIL })).toBe(
        "sem_pendente",
      );
      expect(rpc).not.toHaveBeenCalled();
      expect(armazem.getItem(CHAVE)).toBeNull();
    });
  });

  describe("o prazo é inclusivo no milissegundo exato", () => {
    const AGORA = 1_800_000_000_000;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(AGORA);
    });

    it("lerPendente: com o relógio EXATAMENTE no vencimento ainda devolve o registro", async () => {
      guardar({ expiraEm: AGORA });
      const { lerPendente } = await import("@/lib/cpf-pendente-do-cadastro");

      expect(lerPendente()?.cpf).toBe(CPF);
      expect(armazem.getItem(CHAVE)).not.toBeNull();
    });

    it("lerPendente: 1 ms depois do vencimento já expirou e apaga", async () => {
      guardar({ expiraEm: AGORA - 1 });
      const { lerPendente } = await import("@/lib/cpf-pendente-do-cadastro");

      expect(lerPendente()).toBeNull();
      expect(armazem.getItem(CHAVE)).toBeNull();
    });

    it("retomarCpfPendente: no vencimento exato ainda grava o CPF", async () => {
      guardar({ expiraEm: AGORA });
      rpc.mockResolvedValue({ data: null, error: null });
      const { retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      expect(await retomarCpfPendente({ userId: USER_ID, email: EMAIL })).toBe(
        "gravado",
      );
      expect(rpc).toHaveBeenCalledTimes(1);
    });

    it("retomarCpfPendente: 1 ms depois do vencimento diz expirado e não grava", async () => {
      guardar({ expiraEm: AGORA - 1 });
      const { retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      expect(await retomarCpfPendente({ userId: USER_ID, email: EMAIL })).toBe(
        "expirado",
      );
      expect(rpc).not.toHaveBeenCalled();
      expect(armazem.getItem(CHAVE)).toBeNull();
    });

    it("TTL: um registro com prazo 1 ms além das 24 h é recusado como relógio adulterado", async () => {
      guardar({ expiraEm: AGORA + DIA_MS + 1 });
      const { lerPendente } = await import("@/lib/cpf-pendente-do-cadastro");

      expect(lerPendente()).toBeNull();
    });
  });

  describe("e-mail da sessão é comparado normalizado", () => {
    it("sessão com maiúscula e espaço nas pontas ainda é a mesma pessoa", async () => {
      guardar({});
      rpc.mockResolvedValue({ data: null, error: null });
      const { retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      const resultado = await retomarCpfPendente({
        userId: USER_ID,
        email: "  Cliente@Example.COM ",
      });

      expect(resultado).toBe("gravado");
      expect(rpc).toHaveBeenCalledWith("set_my_cpf", { p_cpf: CPF });
      expect(armazem.getItem(CHAVE)).toBeNull();
    });
  });

  describe("marcador de aviso só cola no MESMO pendente", () => {
    it("outro CPF da mesma conta entra durante o voo: o registro novo não vira 'avisado'", async () => {
      guardar({});
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
      const { retomarCpfPendente, salvarPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      const emVoo = retomarCpfPendente({ userId: USER_ID, email: EMAIL });
      await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
      // A mesma conta refaz o cadastro e guarda OUTRO CPF enquanto a rede pendura.
      expect(
        salvarPendente({ userId: USER_ID, email: EMAIL, cpf: OUTRO_CPF }),
      ).toBe(true);
      falharDepois();
      expect(await emVoo).toBe("falhou");

      const guardado = JSON.parse(armazem.getItem(CHAVE) ?? "null");
      expect(guardado.cpf).toBe(OUTRO_CPF);
      expect(guardado.avisado).toBeUndefined();
    });

    it("sem troca nenhuma durante o voo, o mesmo pendente é marcado como avisado", async () => {
      guardar({});
      rpc.mockResolvedValue({
        data: null,
        error: { code: "XXYYY", message: "boom" },
      });
      const { retomarCpfPendente } = await import(
        "@/lib/cpf-pendente-do-cadastro"
      );

      expect(await retomarCpfPendente({ userId: USER_ID, email: EMAIL })).toBe(
        "falhou",
      );

      expect(JSON.parse(armazem.getItem(CHAVE) ?? "null").avisado).toBe(true);
    });
  });
});
