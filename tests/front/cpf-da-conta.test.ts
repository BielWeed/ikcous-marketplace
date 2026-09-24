// O CPF MORA NA CONTA (23/09/2026): `lerCpfDaConta`/`gravarCpfDaConta`
// embrulham as RPCs `get_my_cpf`/`set_my_cpf`
// (supabase/migrations/20261173000000_o_cpf_mora_na_conta.sql) — a ÚNICA
// porta entre a tela e `profiles.cpf`. Este arquivo prova o contrato do
// módulo: resultado DISCRIMINADO por `motivo`, mapeado só por
// `error.code` — o texto que o servidor manda (`message`/`details`/
// `hint`) NUNCA aparece no resultado nem em console.* (ajuste de
// segurança do dono, 23/09/2026: erro de conversão do Postgres pode ecoar
// o VALOR recebido).
import { describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

const CPF_TESTE = "52998224725";

function espiarConsole() {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
}

function restaurarConsole(
  espioes: Record<string, ReturnType<typeof vi.spyOn>>,
) {
  for (const espiao of Object.values(espioes)) espiao.mockRestore();
}

function nenhumaChamadaLevouOCpf(
  espioes: Record<string, ReturnType<typeof vi.spyOn>>,
) {
  for (const espiao of Object.values(espioes)) {
    for (const chamada of espiao.mock.calls) {
      expect(JSON.stringify(chamada)).not.toContain(CPF_TESTE);
    }
  }
}

describe("lerCpfDaConta", () => {
  it("{ ok: true, cpf } quando a RPC responde com um CPF gravado", async () => {
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: CPF_TESTE, error: null });
    const { lerCpfDaConta } = await import("@/lib/cpf-da-conta");

    const resultado = await lerCpfDaConta();

    expect(rpc).toHaveBeenCalledWith("get_my_cpf");
    expect(resultado).toEqual({ ok: true, cpf: CPF_TESTE });
  });

  it("{ ok: true, cpf: null } quando a conta ainda não tem CPF gravado", async () => {
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const { lerCpfDaConta } = await import("@/lib/cpf-da-conta");

    expect(await lerCpfDaConta()).toEqual({ ok: true, cpf: null });
  });

  it("42501 (sem privilégio — REVOKE de anon) vira motivo sem_sessao", async () => {
    rpc.mockReset();
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "42501",
        message: "permission denied for function get_my_cpf",
      },
    });
    const { lerCpfDaConta } = await import("@/lib/cpf-da-conta");

    expect(await lerCpfDaConta()).toEqual({ ok: false, motivo: "sem_sessao" });
  });

  it("código desconhecido vira motivo falha, sem carregar a mensagem do servidor", async () => {
    rpc.mockReset();
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "XXYYY", message: "algo inesperado" },
    });
    const { lerCpfDaConta } = await import("@/lib/cpf-da-conta");

    expect(await lerCpfDaConta()).toEqual({ ok: false, motivo: "falha" });
  });

  it("rejeição de rede vira motivo falha, sem lançar", async () => {
    rpc.mockReset();
    rpc.mockRejectedValueOnce(new TypeError("network error"));
    const { lerCpfDaConta } = await import("@/lib/cpf-da-conta");

    expect(await lerCpfDaConta()).toEqual({ ok: false, motivo: "falha" });
  });
});

describe("gravarCpfDaConta", () => {
  it("{ ok: true } e chama set_my_cpf só com os dígitos", async () => {
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const { gravarCpfDaConta } = await import("@/lib/cpf-da-conta");

    const resultado = await gravarCpfDaConta("529.982.247-25");

    expect(rpc).toHaveBeenCalledWith("set_my_cpf", { p_cpf: CPF_TESTE });
    expect(resultado).toEqual({ ok: true });
  });

  it("entrada vazia grava string vazia (limpa o CPF) — mesmo contrato da RPC", async () => {
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const { gravarCpfDaConta } = await import("@/lib/cpf-da-conta");

    await gravarCpfDaConta("");

    expect(rpc).toHaveBeenCalledWith("set_my_cpf", { p_cpf: "" });
  });

  it("CPF01 (RAISE da migration) vira motivo cpf_invalido — sem o texto da mensagem no resultado", async () => {
    rpc.mockReset();
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "CPF01", message: "CPF inválido." },
    });
    const { gravarCpfDaConta } = await import("@/lib/cpf-da-conta");

    const resultado = await gravarCpfDaConta("11111111111");

    expect(resultado).toEqual({ ok: false, motivo: "cpf_invalido" });
  });

  it("erro do Postgres que ECOA O VALOR na mensagem/details não vaza — resultado só carrega o motivo, sem console.*", async () => {
    rpc.mockReset();
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "22P02",
        message: `invalid input syntax for type text: "${CPF_TESTE}"`,
        details: CPF_TESTE,
        hint: null,
      },
    });
    const espioes = espiarConsole();
    const { gravarCpfDaConta } = await import("@/lib/cpf-da-conta");

    const resultado = await gravarCpfDaConta(CPF_TESTE);

    expect(resultado).toEqual({ ok: false, motivo: "falha" });
    expect(JSON.stringify(resultado)).not.toContain(CPF_TESTE);
    nenhumaChamadaLevouOCpf(espioes);
    restaurarConsole(espioes);
  });

  it("falha de rede (TypeError com o CPF na mensagem) vira {ok:false, motivo:'falha'}, sem vazar e sem console.*", async () => {
    rpc.mockReset();
    rpc.mockRejectedValueOnce(
      new TypeError(`network error ao gravar ${CPF_TESTE}`),
    );
    const espioes = espiarConsole();
    const { gravarCpfDaConta } = await import("@/lib/cpf-da-conta");

    const resultado = await gravarCpfDaConta(CPF_TESTE);

    expect(resultado).toEqual({ ok: false, motivo: "falha" });
    expect(JSON.stringify(resultado)).not.toContain(CPF_TESTE);
    nenhumaChamadaLevouOCpf(espioes);
    restaurarConsole(espioes);
  });
});

describe("mensagemFalhaCpf", () => {
  it("nunca inclui texto do servidor — só as três mensagens fixas por motivo", async () => {
    const { mensagemFalhaCpf } = await import("@/lib/cpf-da-conta");

    expect(mensagemFalhaCpf("cpf_invalido")).toBe(
      "CPF inválido. Confira os números e tente de novo.",
    );
    expect(mensagemFalhaCpf("sem_sessao")).toBe(
      "Entre na conta para salvar o CPF.",
    );
    expect(mensagemFalhaCpf("falha")).toContain(
      "Minha conta > Informações pessoais",
    );
    expect(mensagemFalhaCpf("falha", "no checkout")).toContain("no checkout");
  });
});
