// @vitest-environment jsdom
//
// TransportadorasCard — as duas funções puras que Ajustes, Frete e o Início
// usam para decidir "a transportadora está pronta para vender":
//  - `buscarConfiguracaoDeFrete`: erro OU resposta sem `success` = "não sei"
//    (`{ ok: false }`, cada um sozinho basta); o modo só é "multi" quando o
//    servidor diz "multi" (qualquer outra coisa é "legado"); transportadora
//    desconhecida nunca entra em "ligados";
//  - `emailDeContatoValido`: a régua de e-mail da SuperFrete (mesma da edge):
//    vazio, sem usuário, dois "@", caractere estranho, domínio sem ponto, final
//    com menos de duas letras e passar de 254 caracteres são recusados; o valor
//    aceito volta sem os espaços das pontas.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

const { buscarConfiguracaoDeFrete, emailDeContatoValido } = await import(
  "@/components/admin/settings/TransportadorasCard"
);

describe("buscarConfiguracaoDeFrete", () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const corpo = (extra: Record<string, unknown> = {}) => ({
    success: true,
    modo: "multi",
    ligados: ["melhor_envio", "frenet"],
    provedores: {
      melhor_envio: { tem_chave: true, sandbox: false, servicos: null },
    },
    ...extra,
  });

  it("pede a ação certa da edge de cotação", async () => {
    invoke.mockResolvedValue({ data: corpo(), error: null });
    await buscarConfiguracaoDeFrete();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("calculate-shipping", {
      body: { action: "ler_configuracao_frete" },
    });
  });

  it("resposta boa: modo multi, ligados e o mapa de provedores", async () => {
    invoke.mockResolvedValue({ data: corpo(), error: null });
    const r = await buscarConfiguracaoDeFrete();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.modo).toBe("multi");
    expect(r.config.ligados).toEqual(["melhor_envio", "frenet"]);
    expect(r.config.provedores.get("melhor_envio")?.tem_chave).toBe(true);
    expect(r.config.provedores.size).toBe(1);
  });

  it("qualquer modo que não seja 'multi' vira 'legado'", async () => {
    for (const modo of ["legado", "outro", undefined, ""]) {
      invoke.mockResolvedValue({ data: corpo({ modo }), error: null });
      const r = await buscarConfiguracaoDeFrete();
      expect(r.ok && r.config.modo).toBe("legado");
    }
  });

  it("transportadora desconhecida e 'ligados' que não é lista não entram", async () => {
    invoke.mockResolvedValue({
      data: corpo({ ligados: ["frenet", "correios_fantasma", 7, null] }),
      error: null,
    });
    const r = await buscarConfiguracaoDeFrete();
    expect(r.ok && r.config.ligados).toEqual(["frenet"]);
    invoke.mockResolvedValue({
      data: corpo({ ligados: "melhor_envio" }),
      error: null,
    });
    const s = await buscarConfiguracaoDeFrete();
    expect(s.ok && s.config.ligados).toEqual([]);
  });

  it("sem 'provedores' na resposta: mapa vazio, sem quebrar", async () => {
    invoke.mockResolvedValue({
      data: corpo({ provedores: undefined }),
      error: null,
    });
    const r = await buscarConfiguracaoDeFrete();
    expect(r.ok && r.config.provedores.size).toBe(0);
  });

  it("erro do servidor, mesmo com corpo de sucesso: 'não sei'", async () => {
    invoke.mockResolvedValue({ data: corpo(), error: { message: "falhou" } });
    expect(await buscarConfiguracaoDeFrete()).toEqual({ ok: false });
  });

  it("corpo sem success (ou success falso), sem erro: 'não sei'", async () => {
    invoke.mockResolvedValue({ data: corpo({ success: false }), error: null });
    expect(await buscarConfiguracaoDeFrete()).toEqual({ ok: false });
    invoke.mockResolvedValue({ data: null, error: null });
    expect(await buscarConfiguracaoDeFrete()).toEqual({ ok: false });
    invoke.mockResolvedValue(undefined);
    expect(await buscarConfiguracaoDeFrete()).toEqual({ ok: false });
  });

  it("a chamada que lança (rede) vira 'não sei' e não quebra a tela", async () => {
    invoke.mockRejectedValue(new Error("sem rede"));
    expect(await buscarConfiguracaoDeFrete()).toEqual({ ok: false });
  });
});

describe("emailDeContatoValido", () => {
  it.each([
    ["loja@exemplo.com", "loja@exemplo.com"],
    ["  loja@exemplo.com  ", "loja@exemplo.com"],
    ["a.b+c_d%e-f@sub.exemplo.com.br", "a.b+c_d%e-f@sub.exemplo.com.br"],
    ["a@b-c.co", "a@b-c.co"],
  ])("aceita %j", (entrada, esperado) => {
    expect(emailDeContatoValido(entrada)).toBe(esperado);
  });

  it.each([
    ["vazio", ""],
    ["só espaços", "   "],
    ["sem usuário", "@exemplo.com"],
    ["sem arroba", "loja.exemplo.com"],
    ["dois arrobas", "a@b@exemplo.com"],
    ["espaço no meio do usuário", "lo ja@exemplo.com"],
    ["acento no usuário", "lojá@exemplo.com"],
    ["domínio sem ponto", "loja@exemplo"],
    ["final com uma letra só", "loja@exemplo.c"],
    ["final com número", "loja@exemplo.c0m"],
    ["rótulo vazio no domínio", "loja@exemplo..com"],
    ["caractere estranho no domínio", "loja@exe_mplo.com"],
  ])("recusa: %s", (_nome, entrada) => {
    expect(emailDeContatoValido(entrada)).toBeNull();
  });

  it.each([
    ["número", 42],
    ["nulo", null],
    ["indefinido", undefined],
    ["objeto", {}],
  ])("recusa valor que não é texto: %s", (_nome, entrada) => {
    expect(emailDeContatoValido(entrada)).toBeNull();
  });

  it("o limite é 254 caracteres: 254 passa, 255 não", () => {
    const com254 = `a@${"b".repeat(248)}.com`;
    const com255 = `a@${"b".repeat(249)}.com`;
    expect(com254).toHaveLength(254);
    expect(com255).toHaveLength(255);
    expect(emailDeContatoValido(com254)).toBe(com254);
    expect(emailDeContatoValido(com255)).toBeNull();
  });
});
