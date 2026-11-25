// O preço do frete entra no total do pedido, então a resposta guardada no
// navegador só pode virar preço na tela se for do carrinho de agora, da config
// de agora, estiver dentro da validade (2 h) e a lojista não tiver mexido no
// frete depois. As duas decisões são funções puras, e os testes de tela só as
// alcançam por dentro do componente inteiro: aqui cada guarda e cada fronteira
// é exercitada direto.
import {
  chaveDoCacheDeFrete,
  cotacaoAindaBateComARevisao,
  cotacaoCacheadaQueAindaServe,
} from "@/components/ui/custom/ShippingCalculator";
import type { ShippingOption } from "@/types";
import { describe, expect, it, vi } from "vitest";

// O módulo da tela importa o cliente do banco e contextos só por causa do
// componente; as funções daqui são puras e nunca os tocam.
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/contexts/CartContext", () => ({
  useCartState: () => ({ freteGratis: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { freeShippingMin: 0 }, isLoaded: true }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

const DUAS_HORAS = 2 * 60 * 60 * 1000;
const AGORA = 1_800_000_000_000;
const CONTEXTO = "ctx-loja-a";
const ASSINATURA = "carrinho-1x2";
const OPCOES = [
  { id: "pac", name: "PAC", price: 18.5, days: 5 },
] as unknown as ShippingOption[];

const envelope = (extra: Record<string, unknown> = {}) => ({
  contexto: CONTEXTO,
  assinatura: ASSINATURA,
  gravadoEm: AGORA - 60_000,
  opcoes: OPCOES,
  revisaoConfig: "rev-7",
  ...extra,
});

const serve = (bruto: unknown, agora = AGORA) =>
  cotacaoCacheadaQueAindaServe(bruto, ASSINATURA, agora, CONTEXTO);

describe("cotacaoCacheadaQueAindaServe", () => {
  it("envelope inteiro, do mesmo carrinho e da mesma config, dentro da validade: serve as opções", () => {
    expect(serve(envelope())).toBe(OPCOES);
  });

  it.each([null, undefined, 0, "", "texto", 42, true, false])(
    "bruto %j não é envelope: sem cache",
    (bruto) => {
      expect(serve(bruto)).toBeNull();
    },
  );

  it("a lista crua do formato antigo (array de opções) não vale", () => {
    expect(serve(OPCOES)).toBeNull();
  });

  it("outra config da loja (contexto diferente) ou sem contexto: recota", () => {
    expect(serve(envelope({ contexto: "ctx-loja-b" }))).toBeNull();
    expect(serve(envelope({ contexto: undefined }))).toBeNull();
    expect(serve(envelope({ contexto: 7 }))).toBeNull();
  });

  it("contexto vazio só serve se o de agora também for vazio (comparação exata)", () => {
    expect(serve(envelope({ contexto: "" }))).toBeNull();
    expect(
      cotacaoCacheadaQueAindaServe(
        envelope({ contexto: "" }),
        ASSINATURA,
        AGORA,
        "",
      ),
    ).toBe(OPCOES);
  });

  it("outro carrinho (assinatura diferente) ou sem assinatura: recota", () => {
    expect(serve(envelope({ assinatura: "carrinho-1x3" }))).toBeNull();
    expect(serve(envelope({ assinatura: undefined }))).toBeNull();
    expect(serve(envelope({ assinatura: 12 }))).toBeNull();
  });

  it("data de gravação ausente, texto, NaN ou infinita: recota", () => {
    for (const gravadoEm of [undefined, null, "1800000000000", Number.NaN]) {
      expect(serve(envelope({ gravadoEm }))).toBeNull();
    }
    expect(serve(envelope({ gravadoEm: Number.POSITIVE_INFINITY }))).toBeNull();
    expect(serve(envelope({ gravadoEm: Number.NEGATIVE_INFINITY }))).toBeNull();
  });

  it("validade de 2 h: no limite exato ainda serve; 1 ms depois não", () => {
    expect(serve(envelope({ gravadoEm: AGORA - DUAS_HORAS }))).toBe(OPCOES);
    expect(serve(envelope({ gravadoEm: AGORA - DUAS_HORAS - 1 }))).toBeNull();
  });

  it("gravada neste exato instante (idade zero) serve", () => {
    expect(serve(envelope({ gravadoEm: AGORA }))).toBe(OPCOES);
  });

  it("relógio que andou para trás (gravada no futuro, nem que seja 1 ms): recusa", () => {
    expect(serve(envelope({ gravadoEm: AGORA + 1 }))).toBeNull();
    expect(serve(envelope({ gravadoEm: AGORA + DUAS_HORAS }))).toBeNull();
  });

  it("sem opções (lista vazia, ausente ou não lista): não serve, para não travar o frete em 'cotando'", () => {
    expect(serve(envelope({ opcoes: [] }))).toBeNull();
    expect(serve(envelope({ opcoes: undefined }))).toBeNull();
    expect(serve(envelope({ opcoes: null }))).toBeNull();
    expect(serve(envelope({ opcoes: { 0: OPCOES[0], length: 1 } }))).toBeNull();
    expect(serve(envelope({ opcoes: "pac" }))).toBeNull();
  });

  it("a revisão da config NÃO é decidida aqui (isso é a última guarda, outra função)", () => {
    expect(serve(envelope({ revisaoConfig: null }))).toBe(OPCOES);
    expect(serve(envelope({ revisaoConfig: undefined }))).toBe(OPCOES);
  });

  it("devolve a mesma lista que estava guardada, sem copiar nem filtrar", () => {
    const duas = [
      ...OPCOES,
      { id: "sedex", name: "SEDEX", price: 31, days: 2 },
    ] as unknown as ShippingOption[];
    expect(serve(envelope({ opcoes: duas }))).toBe(duas);
  });
});

describe("cotacaoAindaBateComARevisao — a última guarda antes de servir o cache", () => {
  it("as duas revisões iguais e preenchidas: serve", () => {
    expect(cotacaoAindaBateComARevisao("rev-7", "rev-7")).toBe(true);
  });

  it("a lojista mexeu no frete depois (revisões diferentes): não serve", () => {
    expect(cotacaoAindaBateComARevisao("rev-7", "rev-8")).toBe(false);
    expect(cotacaoAindaBateComARevisao("rev-8", "rev-7")).toBe(false);
  });

  it("revisão de agora não carregou (null): não serve, mesmo com cache preenchido", () => {
    expect(cotacaoAindaBateComARevisao("rev-7", null)).toBe(false);
  });

  it("revisão de agora vazia: não serve, nem contra um cache também vazio", () => {
    expect(cotacaoAindaBateComARevisao("rev-7", "")).toBe(false);
    expect(cotacaoAindaBateComARevisao("", "")).toBe(false);
  });

  it("envelope sem revisão (de antes da guarda): não serve", () => {
    for (const antiga of [undefined, null, 7, {}, [], false]) {
      expect(cotacaoAindaBateComARevisao(antiga, "rev-7")).toBe(false);
    }
  });

  it("os dois ausentes (null/undefined) nunca contam como iguais", () => {
    expect(cotacaoAindaBateComARevisao(null, null)).toBe(false);
    expect(cotacaoAindaBateComARevisao(undefined, null)).toBe(false);
  });

  it("a comparação é exata: maiúscula e espaço contam", () => {
    expect(cotacaoAindaBateComARevisao("REV-7", "rev-7")).toBe(false);
    expect(cotacaoAindaBateComARevisao("rev-7 ", "rev-7")).toBe(false);
  });

  it("número igual ao texto não engana (tipo estrito)", () => {
    expect(cotacaoAindaBateComARevisao(7, "7")).toBe(false);
  });
});

describe("chaveDoCacheDeFrete", () => {
  it("usa a chave v2 com o prefixo que o logout varre", () => {
    expect(chaveDoCacheDeFrete("01001000")).toBe(
      "ikcous_shipping_cache_v2_01001000",
    );
    expect(chaveDoCacheDeFrete("01001000")).toMatch(/^ikcous_shipping_cache_/);
  });

  it("CEPs diferentes têm chaves diferentes, e a chave antiga (v1) nunca é usada", () => {
    expect(chaveDoCacheDeFrete("01001000")).not.toBe(
      chaveDoCacheDeFrete("01001001"),
    );
    expect(chaveDoCacheDeFrete("01001000")).not.toBe(
      "ikcous_shipping_cache_01001000",
    );
  });
});
