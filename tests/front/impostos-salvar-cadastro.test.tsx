// Aba Impostos — GRAVAR o cadastro fiscal (`fiscal_cadastro_salvar`). O que prova:
//   S1  chama o RPC UMA vez, com o payload que `montarPayloadDoCadastro` validou e
//       nada além dos quatro campos (CNPJ e afins nunca vão por aqui)
//   S2  42501 (o banco recusa quem não é o dono) vira a frase do dono, sem repetir
//   S3  prazo de 30 s: a espera da tela termina com "confira antes de repetir" e
//       o aviso de que NÃO se sabe se gravou; a resposta que chega depois é ignorada
//   S4  queda de rede (sem código): mesma ideia, frase de "não deu para confirmar"
//   S5  NUNCA repete sozinho (nem no prazo, nem na queda, nem na recusa)
//   S6  o que o servidor responde de bom, mas o app não entende, não vira "falhou"
//       (a gravação deu certo: dizer que falhou faria a lojista repetir)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

import {
  ErroDoCadastroFiscal,
  salvarCadastroFiscal,
} from "@/hooks/useImpostos";
import {
  AVISO_DO_CADASTRO_ILEGIVEL,
  type PayloadDoCadastroFiscal,
  montarPayloadDoCadastro,
} from "@/lib/fiscal/cadastro";
import { FRASE_SO_O_DONO_ALTERA } from "@/lib/fiscal/textos";

const PRAZO = 30_000;
const HOJE = "2026-11-24";

function payloadValido(): PayloadDoCadastroFiscal {
  const r = montarPayloadDoCadastro(
    {
      regime: "simples",
      atividade: "comercio",
      abertaEm: "2024-05-10",
      vendeNoAppDesde: "2025-01-01",
    },
    HOJE,
  );
  if (!r.ok) throw new Error("o formulário de teste devia ser válido");
  return r.payload;
}

const linhaDoBanco = {
  id: true,
  regime: "simples",
  atividade: "comercio",
  aberta_em: "2024-05-10",
  vende_no_app_desde: "2025-01-01",
  atualizado_em: "2026-11-24T12:00:00Z",
  atualizado_por: "uid-qualquer",
};

const nuncaResponde = () => new Promise<never>(() => {});

/** Roda a gravação e devolve o erro que ela lançou (falha o teste se não lançar). */
async function falhaDe(
  promessa: Promise<unknown>,
): Promise<ErroDoCadastroFiscal> {
  try {
    await promessa;
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroDoCadastroFiscal);
    return erro as ErroDoCadastroFiscal;
  }
  throw new Error("devia ter falhado");
}

beforeEach(() => {
  vi.useFakeTimers();
  rpc.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("S1 — o que vai ao banco", () => {
  it("chama fiscal_cadastro_salvar UMA vez com o payload validado e devolve o cadastro", async () => {
    rpc.mockResolvedValue({ data: linhaDoBanco, error: null });

    const lido = await salvarCadastroFiscal(payloadValido());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("fiscal_cadastro_salvar", {
      p: {
        regime: "simples",
        atividade: "comercio",
        aberta_em: "2024-05-10",
        vende_no_app_desde: "2025-01-01",
      },
    });
    expect(lido).toMatchObject({
      estado: "com_cadastro",
      cadastro: { regime: "simples", atividade: "comercio" },
    });
  });

  it("datas opcionais vão como null (não como texto vazio)", async () => {
    rpc.mockResolvedValue({ data: linhaDoBanco, error: null });
    const r = montarPayloadDoCadastro(
      {
        regime: "mei",
        atividade: "comercio",
        abertaEm: "",
        vendeNoAppDesde: "",
      },
      HOJE,
    );
    if (!r.ok) throw new Error("devia ser válido");

    await salvarCadastroFiscal(r.payload);

    expect(rpc).toHaveBeenCalledWith("fiscal_cadastro_salvar", {
      p: {
        regime: "mei",
        atividade: "comercio",
        aberta_em: null,
        vende_no_app_desde: null,
      },
    });
  });

  it("campo a mais no objeto (CNPJ, quem, quando) NÃO vai ao servidor", async () => {
    rpc.mockResolvedValue({ data: linhaDoBanco, error: null });
    const comLixo = {
      ...payloadValido(),
      cnpj: "00.000.000/0000-00",
      atualizado_por: "outro-uid",
    } as PayloadDoCadastroFiscal;

    await salvarCadastroFiscal(comLixo);

    const [, args] = rpc.mock.calls[0] ?? [];
    expect(Object.keys(args.p).sort()).toEqual([
      "aberta_em",
      "atividade",
      "regime",
      "vende_no_app_desde",
    ]);
  });
});

describe("S2 — só o dono altera", () => {
  it("42501 vira a frase do dono (e não a do Financeiro), sem pedir para conferir", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission denied: nao e o dono" },
    });

    const erro = await falhaDe(salvarCadastroFiscal(payloadValido()));

    expect(erro.message).toBe("Só o dono da loja altera o cadastro fiscal.");
    expect(erro.message).toBe(FRASE_SO_O_DONO_ALTERA);
    expect(erro.semResposta).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("loja sem dono cadastrado: o banco também recusa com 42501, a mesma frase", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    const erro = await falhaDe(salvarCadastroFiscal(payloadValido()));
    expect(erro.message).toBe(FRASE_SO_O_DONO_ALTERA);
  });
});

describe("S2b — outras recusas do servidor", () => {
  it("dado recusado pelo banco (22023) mostra a frase do banco em português", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "regime inválido" },
    });
    const erro = await falhaDe(salvarCadastroFiscal(payloadValido()));
    expect(erro.message).toBe("regime inválido");
    expect(erro.semResposta).toBe(false);
  });

  it.each([
    [
      "pelo código do PostgREST",
      {
        code: "PGRST202",
        message: "Perhaps you meant to call another function",
      },
    ],
    [
      "pelo código do Postgres",
      { code: "42883", message: "function does not exist" },
    ],
    [
      "só pelo texto do PostgREST (sem código)",
      { message: "Could not find the function public.fiscal_cadastro_salvar" },
    ],
    [
      "tabela ausente",
      { code: "42P01", message: 'relation "fiscal_cadastro" does not exist' },
    ],
  ])(
    "função/tabela ainda não instalada neste banco (%s): frase própria, nunca o texto técnico",
    async (_como, erroDoBanco) => {
      rpc.mockResolvedValue({ data: null, error: erroDoBanco });
      const erro = await falhaDe(salvarCadastroFiscal(payloadValido()));
      expect(erro.message).toMatch(/cadastro fiscal ainda não foi instalado/);
      expect(erro.message).not.toContain("Could not find");
      expect(erro.message).not.toContain("does not exist");
      // o banco respondeu (não é "sem resposta"): nada a conferir, é só não instalado
      expect(erro.semResposta).toBe(false);
    },
  );

  it("recusa que o app não conhece vira frase genérica, sem texto técnico", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "internal: relation locked" },
    });
    const erro = await falhaDe(salvarCadastroFiscal(payloadValido()));
    expect(erro.message).toMatch(/Algo deu errado/);
    expect(erro.message).not.toContain("relation locked");
  });
});

describe("S3 — rede que conecta e não responde: 30 s", () => {
  it("espera até 30 s e então diz que não sabe se gravou, mandando conferir antes de repetir", async () => {
    rpc.mockImplementation(nuncaResponde);
    let desfecho: unknown = "pendente";
    salvarCadastroFiscal(payloadValido()).then(
      () => {
        desfecho = "ok";
      },
      (e) => {
        desfecho = e;
      },
    );

    await vi.advanceTimersByTimeAsync(PRAZO - 1);
    expect(desfecho).toBe("pendente");

    await vi.advanceTimersByTimeAsync(1);
    expect(desfecho).toBeInstanceOf(ErroDoCadastroFiscal);
    const erro = desfecho as ErroDoCadastroFiscal;
    expect(erro.semResposta).toBe(true);
    expect(erro.message).toMatch(
      /não deu para confirmar se o cadastro fiscal foi salvo/,
    );
    expect(erro.message).toMatch(/confira o cadastro fiscal antes de repetir/);
  });

  it("resposta que chega a tempo (29,999 s) vale e o relógio é desarmado", async () => {
    rpc.mockImplementation(
      () =>
        new Promise((resolver) =>
          setTimeout(
            () => resolver({ data: linhaDoBanco, error: null }),
            PRAZO - 1,
          ),
        ),
    );
    const promessa = salvarCadastroFiscal(payloadValido());
    await vi.advanceTimersByTimeAsync(PRAZO - 1);

    await expect(promessa).resolves.toMatchObject({ estado: "com_cadastro" });
    // nada fica armado depois
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a resposta que chega DEPOIS do prazo é ignorada: o erro de 'sem resposta' fica", async () => {
    let entregar: (v: unknown) => void = () => {};
    rpc.mockImplementation(
      () =>
        new Promise((resolver) => {
          entregar = resolver;
        }),
    );
    const promessa = salvarCadastroFiscal(payloadValido());
    const capturada = falhaDe(promessa);
    await vi.advanceTimersByTimeAsync(PRAZO);
    const erro = await capturada;
    expect(erro.semResposta).toBe(true);

    entregar({ data: linhaDoBanco, error: null });
    await vi.advanceTimersByTimeAsync(0);

    // a mesma promessa continua rejeitada, e o servidor não foi chamado outra vez
    await expect(promessa).rejects.toBe(erro);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("S4 — queda de rede sem resposta do banco", () => {
  it("erro SEM código: 'não deu para confirmar', mandando conferir antes de tentar de novo", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "TypeError: Failed to fetch" },
    });
    const erro = await falhaDe(salvarCadastroFiscal(payloadValido()));
    expect(erro.semResposta).toBe(true);
    expect(erro.message).toMatch(
      /não deu para confirmar se o cadastro fiscal foi salvo/,
    );
    expect(erro.message).toMatch(
      /confira o cadastro fiscal antes de tentar de novo/,
    );
    expect(erro.message).not.toContain("Failed to fetch");
  });

  it("a chamada que REJEITA (fetch lançou) tem o mesmo tratamento", async () => {
    rpc.mockRejectedValue(new TypeError("Failed to fetch"));
    const erro = await falhaDe(salvarCadastroFiscal(payloadValido()));
    expect(erro.semResposta).toBe(true);
    expect(erro.message).toMatch(/não deu para confirmar/);
  });
});

describe("S5 — nunca repete sozinho", () => {
  it.each([
    ["prazo estourado", () => rpc.mockImplementation(nuncaResponde)],
    [
      "queda de rede",
      () =>
        rpc.mockResolvedValue({
          data: null,
          error: { message: "Failed to fetch" },
        }),
    ],
    ["fetch que lança", () => rpc.mockRejectedValue(new Error("rede"))],
    [
      "recusa do servidor",
      () => rpc.mockResolvedValue({ data: null, error: { code: "42501" } }),
    ],
  ])("%s: uma chamada só, mesmo esperando minutos", async (_nome, preparar) => {
    preparar();
    const capturada = falhaDe(salvarCadastroFiscal(payloadValido()));
    await vi.advanceTimersByTimeAsync(PRAZO * 10);
    await capturada;
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("uma gravação que travou não contamina a seguinte (nada é guardado entre chamadas)", async () => {
    rpc.mockImplementationOnce(nuncaResponde);
    const primeira = falhaDe(salvarCadastroFiscal(payloadValido()));
    await vi.advanceTimersByTimeAsync(PRAZO);
    await primeira;

    rpc.mockResolvedValueOnce({ data: linhaDoBanco, error: null });
    await expect(salvarCadastroFiscal(payloadValido())).resolves.toMatchObject({
      estado: "com_cadastro",
    });
    // duas chamadas porque a PESSOA chamou duas vezes, não porque o código repetiu
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("duas gravações ao mesmo tempo seguem cada uma o próprio caminho", async () => {
    rpc.mockImplementationOnce(nuncaResponde);
    rpc.mockResolvedValueOnce({ data: linhaDoBanco, error: null });
    const travada = falhaDe(salvarCadastroFiscal(payloadValido()));
    const boa = salvarCadastroFiscal(payloadValido());

    await expect(boa).resolves.toMatchObject({ estado: "com_cadastro" });
    await vi.advanceTimersByTimeAsync(PRAZO);
    expect((await travada).semResposta).toBe(true);
  });
});

describe("S6 — o banco gravou, mas a resposta não é a esperada", () => {
  it.each([
    ["null", null],
    ["lista vazia", []],
    [
      "regime que este app não conhece",
      { ...linhaDoBanco, regime: "regime_de_2030" },
    ],
  ])(
    "%s: não vira erro (a gravação deu certo); volta 'sem cadastro' com o aviso certo",
    async (_nome, data) => {
      rpc.mockResolvedValue({ data, error: null });

      const lido = await salvarCadastroFiscal(payloadValido());

      expect(lido.estado).toBe("sem_cadastro");
      // `null` e lista vazia: sem aviso; regime desconhecido: com o aviso de cadastro ilegível
      if (data !== null && !Array.isArray(data)) {
        expect(lido).toEqual({
          estado: "sem_cadastro",
          aviso: AVISO_DO_CADASTRO_ILEGIVEL,
        });
      }
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );
});
