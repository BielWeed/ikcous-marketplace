import {
  buscarRevisaoConfigFrete,
  descartarCacheDeFreteDoNavegador,
} from "@/lib/revisao-do-frete";
// @vitest-environment jsdom
//
// A REVISÃO DA CONFIGURAÇÃO DE FRETE (release 1.5.7) — CONTRATO-1.5.7.md
// R1-2 e R2-8. `buscarRevisaoConfigFrete` é o único jeito de o navegador
// saber "o cache que eu tenho ainda é da configuração de agora?" sem cotar
// nada; `descartarCacheDeFreteDoNavegador` é o botão de pânico que o painel
// aperta depois de salvar.
import { supabase } from "@/lib/supabase";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

const invoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;

describe("buscarRevisaoConfigFrete", () => {
  afterEach(() => {
    invoke.mockReset();
  });

  it("chama a ação pública, sem CEP nem admin, e devolve a revisão", async () => {
    invoke.mockResolvedValue({
      data: { revisaoConfig: "abc123" },
      error: null,
    });
    const revisao = await buscarRevisaoConfigFrete();
    expect(revisao).toBe("abc123");
    expect(invoke).toHaveBeenCalledWith("calculate-shipping", {
      body: { action: "revisao_config_frete" },
    });
  });

  it("erro da edge: null (fail closed — nunca 'sem mudança')", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: "Edge Function retornou 500" },
    });
    expect(await buscarRevisaoConfigFrete()).toBeNull();
  });

  it("corpo sem o campo, ou com tipo errado: null", async () => {
    invoke.mockResolvedValue({ data: {}, error: null });
    expect(await buscarRevisaoConfigFrete()).toBeNull();
    invoke.mockResolvedValue({ data: { revisaoConfig: 123 }, error: null });
    expect(await buscarRevisaoConfigFrete()).toBeNull();
    invoke.mockResolvedValue({ data: { revisaoConfig: "" }, error: null });
    expect(await buscarRevisaoConfigFrete()).toBeNull();
  });

  it("a chamada lança (rede fora do ar): null, nunca propaga a exceção", async () => {
    invoke.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(buscarRevisaoConfigFrete()).resolves.toBeNull();
  });
});

describe("descartarCacheDeFreteDoNavegador", () => {
  it("apaga só as chaves com o prefixo do cache de frete, preservando o resto", () => {
    const armazem = new Map<string, string>();
    const chaves = () => Array.from(armazem.keys());
    vi.stubGlobal("localStorage", {
      get length() {
        return armazem.size;
      },
      key: (i: number) => chaves().at(i) ?? null,
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });

    armazem.set("ikcous_shipping_cache_v2_69000000", "{}");
    armazem.set("ikcous_shipping_cache_01001000", "[]");
    armazem.set("marketplace_cart_v1", "[]");
    armazem.set("ikcous_last_shipping_cep", "69000-000");

    descartarCacheDeFreteDoNavegador();

    expect(armazem.has("ikcous_shipping_cache_v2_69000000")).toBe(false);
    expect(armazem.has("ikcous_shipping_cache_01001000")).toBe(false);
    // O que NÃO é cache de frete sobrevive — inclusive o CEP lembrado, que
    // é outra chave (sem o prefixo do cache).
    expect(armazem.has("marketplace_cart_v1")).toBe(true);
    expect(armazem.has("ikcous_last_shipping_cep")).toBe(true);

    vi.unstubAllGlobals();
  });

  it("localStorage indisponível: não lança", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => descartarCacheDeFreteDoNavegador()).not.toThrow();
    vi.unstubAllGlobals();
  });
});
