// @vitest-environment jsdom
import { PainelRecolhivel } from "@/components/admin/shipping/PainelRecolhivel";
import type { StoreConfig } from "@/types";
import { Gift } from "lucide-react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loja, updateConfig, invoke, erroToast, sucessoToast } = vi.hoisted(
  () => ({
    loja: { atual: {} as StoreConfig },
    updateConfig: vi.fn(),
    invoke: vi.fn(),
    erroToast: vi.fn(),
    sucessoToast: vi.fn(),
  }),
);
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: loja.atual, isLoaded: true, updateConfig }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/pagamento-pelo-app-no-painel", () => ({
  usePagamentoPeloApp: () => true,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke },
    from: () => ({
      select: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }),
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: sucessoToast, error: erroToast },
}));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const modos = [
  ["Eu entrego", true, false],
  ["Eu entrego ou ele retira", true, true],
  ["Só retirada", false, true],
] as const;
const locais = [
  ["Não dar frete grátis", 0],
  ["Grátis acima de um valor", 150],
  ["Sempre grátis", 0.01],
  ["Só produtos marcados", -1],
] as const;
const nacionais = [
  ["Não dar frete grátis", "desligado", 0, null, 0, "mais_barata"],
  ["Grátis acima de um valor", "acima_de_valor", 199, null, 0, "mais_barata"],
  ["Grátis acima de um valor", "acima_de_valor", 199, null, 0, "todas"],
  ["Sempre grátis", "sempre", 0, null, 0, "mais_barata"],
  ["Só produtos marcados", "por_produto", 0, null, 0, "mais_barata"],
  [
    "Desconto no frete",
    "desconto_na_mais_barata",
    80,
    "percentual",
    10,
    "mais_barata",
  ],
  [
    "Desconto no frete",
    "desconto_na_mais_barata",
    80,
    "fixo",
    7.5,
    "mais_barata",
  ],
] as const;

describe("Entrega e frete — escolhas novas, valores antigos", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.clearAllMocks();
    loja.atual = {
      originCep: "38400-000",
      storeCity: "Cidade Exemplo",
      storeState: "MG",
      storeAddress: "Rua Exemplo, 123",
      freeShippingMin: 0,
      shippingCoverage: "local",
      localDeliveryFee: 10,
      localDeliveryDays: 1,
      localDeliveryEnabled: true,
      localCepRange: "38400",
      enabledShippingMethods: ["pac", "sedex"],
      nationalShippingStrategy: "desligado",
      nationalShippingMin: 0,
      nationalDiscountType: null,
      nationalDiscountValue: 0,
      nationalBenefitScope: "mais_barata",
    } as StoreConfig;
    updateConfig.mockImplementation(async (patch: Partial<StoreConfig>) => {
      loja.atual = { ...loja.atual, ...patch };
      return true;
    });
    invoke.mockImplementation(async (_: string, { body }: any) =>
      body.action === "ler_configuracao_frete"
        ? {
            data: {
              success: true,
              modo: "multi",
              ligados: ["frenet"],
              provedores: {
                frenet: { tem_chave: true, sandbox: false, servicos: ["1"] },
              },
            },
          }
        : { data: { success: true, ligados: [] } },
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  async function montar() {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => root.render(<AdminShippingView active />));
  }
  async function clicar(texto: string, contexto: ParentNode = host) {
    const b = [...contexto.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) =>
        b.textContent?.trim() === texto ||
        b.getAttribute("aria-label") === texto,
    );
    expect(b, texto).toBeTruthy();
    expect(b!.disabled, texto).toBe(false);
    await act(async () => b!.click());
  }
  async function escolher(id: string, texto: string) {
    const bloco = host.querySelector(id)!;
    const radio = [
      ...bloco.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ].find((b) => b.textContent?.includes(texto));
    expect(radio, texto).toBeTruthy();
    await act(async () => radio!.click());
  }
  async function digitar(id: string, valor: string) {
    const campo = host.querySelector<HTMLInputElement>(`#${id}`)!;
    expect(campo, id).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  function salvar() {
    return [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      /^(Salvar|Tentar de novo)$/.test(b.textContent?.trim() ?? ""),
    )!;
  }

  const casos = modos.flatMap((modo) =>
    [false, true].flatMap((fora) =>
      locais.flatMap((local) =>
        nacionais.map((nacional) => ({ modo, fora, local, nacional })),
      ),
    ),
  );
  it.each(casos)(
    "grava o contrato antigo: $modo / fora=$fora / $local / $nacional",
    async ({ modo, fora, local, nacional }) => {
      await montar();
      await digitar("local-delivery-fee", "12.5");
      await clicar("Na sua região", host.querySelector("#painel-frete-local")!);
      await escolher("#bloco-frete-local", modo[0]);
      await clicar(
        "Fora da sua região",
        host.querySelector("#painel-frete-nacional")!,
      );
      const chave = host.querySelector<HTMLButtonElement>(
        '[role="switch"][aria-label="Vender para fora da sua região"]',
      );
      expect(chave).toBeTruthy();
      if (fora) await act(async () => chave!.click());
      expect(chave!.getAttribute("aria-checked")).toBe(String(fora));
      await clicar("Frete grátis", host.querySelector("#painel-frete-gratis")!);
      await escolher("#bloco-frete-local-estrategias", local[0]);
      if (local[1] === 150) await digitar("frete-gratis-acima-de", "150");
      await clicar("Fora da região", host.querySelector('[role="tablist"]')!);
      await escolher("#bloco-estrategia-nacional", nacional[0]);
      if (
        nacional[1] === "acima_de_valor" ||
        nacional[1] === "desconto_na_mais_barata"
      )
        await digitar("frete-nacional-minimo", String(nacional[2]));
      if (nacional[3]) {
        await escolher(
          "#bloco-estrategia-nacional",
          nacional[3] === "fixo" ? "Valor em R$" : "Porcentagem",
        );
        await digitar("frete-nacional-valor-desconto", String(nacional[4]));
      }
      if (nacional[5] === "todas")
        await escolher("#bloco-estrategia-nacional", "Qualquer uma");
      // Também garante gravação para o caso em que todas as escolhas eram os padrões.
      await act(async () => salvar().click());
      // Oráculo literal do fluxo antigo: não reaproveita a função de conversão que está sendo testada.
      expect(updateConfig).toHaveBeenLastCalledWith({
        freeShippingMin: local[1],
        shippingCoverage: fora ? "national" : "local",
        localDeliveryFee: 12.5,
        localCepRange: "38400",
        localDeliveryEnabled: modo[1],
        localDeliveryDays: 1,
        ...(modo[2]
          ? { enabledShippingMethods: ["pac", "sedex", "store-pickup"] }
          : {}),
        nationalShippingStrategy: nacional[1],
        nationalShippingMin: nacional[2],
        nationalDiscountType: nacional[3],
        nationalDiscountValue: nacional[4],
        nationalBenefitScope: nacional[5],
      });
    },
  );

  it("reserva espaço para título e resumo quando o selo de erro precisa de outra linha", async () => {
    await act(async () =>
      root.render(
        <PainelRecolhivel
          id="frete-teste"
          titulo="Frete grátis"
          resumo="Na região: acima de R$ 100"
          icone={Gift}
          aberta
          comPendencia
          onToggle={vi.fn()}
        >
          Conteúdo
        </PainelRecolhivel>,
      ),
    );
    const cabecalho = host.querySelector<HTMLButtonElement>("button")!;
    const titulo = [...cabecalho.querySelectorAll("span")].find(
      (span) => span.textContent === "Frete grátis",
    )!;
    // jsdom não mede pixels: prende as guardas de quebra de linha, não a prova visual.
    expect(cabecalho.classList.contains("flex-wrap")).toBe(true);
    expect(titulo.parentElement!.classList.contains("basis-40")).toBe(true);
    expect(cabecalho.getAttribute("aria-label")).toBe("Frete grátis");
    expect(cabecalho.textContent).toContain("Resolva o erro para fechar");
  });

  it("não anuncia pronta quando não conseguiu confirmar as transportadoras", async () => {
    loja.atual.shippingCoverage = "national";
    invoke.mockResolvedValue({ data: { success: false } });
    await montar();
    expect(host.querySelector("header")?.textContent).not.toContain(
      "Pronta para vender",
    );
    expect(host.textContent).toContain("A confirmar");
  });
  it("só retirada sem endereço não anuncia pronta para vender", async () => {
    loja.atual.localDeliveryEnabled = false;
    loja.atual.enabledShippingMethods = ["store-pickup"];
    loja.atual.storeAddress = "";
    await montar();
    expect(host.querySelector("header")?.textContent).not.toContain(
      "Pronta para vender",
    );
    expect(host.textContent).toContain("cadastre o endereço");
  });
  it("bloqueia grátis local acima de valor vazio sem desligar a regra", async () => {
    await montar();
    await escolher(
      "#bloco-frete-local-estrategias",
      "Grátis acima de um valor",
    );
    await digitar("frete-gratis-acima-de", "");
    expect(host.textContent).toContain(
      "Escreva o valor. Para não dar frete grátis, escolha a primeira opção.",
    );
    expect(salvar().disabled).toBe(true);
    expect(updateConfig).not.toHaveBeenCalled();
  });
  it("salva só transportadoras sem regravar nem anunciar regras salvas", async () => {
    await montar();
    const chave = host.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Ligar Frenet"]',
    )!;
    await act(async () => chave.click());
    await act(async () => salvar().click());
    expect(updateConfig).not.toHaveBeenCalled();
    await act(async () => {
      await vi.waitFor(() =>
        expect(sucessoToast).toHaveBeenCalledWith("Provedores atualizados!", {
          description: undefined,
        }),
      );
    });
    expect(sucessoToast).not.toHaveBeenCalledWith("Regras de frete salvas!");
  });

  it("salva regras e transportadoras juntas mantendo o objeto antigo na falha parcial", async () => {
    await montar();
    await digitar("local-delivery-fee", "12.5");
    const chave = host.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Ligar Frenet"]',
    )!;
    await act(async () => chave.click());
    invoke.mockResolvedValue({
      data: { success: false, error: "Falha simulada" },
    });
    await act(async () => salvar().click());
    expect(updateConfig).toHaveBeenCalledExactlyOnceWith({
      freeShippingMin: 0,
      shippingCoverage: "local",
      localDeliveryFee: 12.5,
      localCepRange: "38400",
      localDeliveryEnabled: true,
      localDeliveryDays: 1,
      nationalShippingStrategy: "desligado",
      nationalShippingMin: 0,
      nationalDiscountType: null,
      nationalDiscountValue: 0,
      nationalBenefitScope: "mais_barata",
    });
    expect(erroToast).toHaveBeenCalledWith(
      "As regras foram salvas, mas as transportadoras não. Toque em Tentar de novo.",
    );
    invoke.mockResolvedValue({ data: { success: true, ligados: [] } });
    await act(async () => salvar().click());
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(sucessoToast).not.toHaveBeenCalledWith("Regras de frete salvas!");
  });

  it("salva transportadoras pelo topo; na falha parcial repete só a lista", async () => {
    await montar();
    const chave = host.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Ligar Frenet"]',
    );
    expect(chave).toBeTruthy();
    await act(async () => chave!.click());
    expect(host.textContent).not.toContain("Salvar provedores");
    invoke.mockImplementation(async (_: string, { body }: any) =>
      body.action === "save_active_providers"
        ? { data: { success: false, error: "Falha simulada" } }
        : { data: { success: true } },
    );
    await act(async () => salvar().click());
    expect(updateConfig).not.toHaveBeenCalled();
    expect(erroToast).toHaveBeenCalledWith(
      "As transportadoras não foram salvas. Toque em Tentar de novo.",
    );
    expect(salvar().textContent).toContain("Tentar de novo");
    invoke.mockResolvedValue({ data: { success: true, ligados: [] } });
    await act(async () => salvar().click());
    expect(updateConfig).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenLastCalledWith("calculate-shipping", {
      body: { action: "save_active_providers", ligados: [] },
    });
  });
});
