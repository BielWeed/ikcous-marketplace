import { AdminShippingView } from "@/views/admin/AdminShippingView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
// @vitest-environment jsdom
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({
  update: vi.fn(async (_updates: Record<string, unknown>) => true),
  rpc: vi.fn(),
  erroLeitura: false,
  config: {
    freeShippingMin: 0,
    shippingCoverage: "national",
    localDeliveryFee: 10,
    localCepRange: "",
    localDeliveryEnabled: true as boolean,
    localDeliveryDays: 1,
    originCep: "01000-000",
    storeAddress: "Rua Fictícia, 1",
    storeName: "Loja",
    enabledShippingMethods: ["sedex", "pac"],
    whatsappNumber: "551132345678",
    businessHours: "Horário que não pertence ao frete",
    nationalShippingStrategy: "desligado",
    nationalShippingMin: 0,
    nationalDiscountType: null,
    nationalDiscountValue: 0,
    nationalBenefitScope: "mais_barata",
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: s.config,
    isLoaded: true,
    updateConfig: s.update,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/components/admin/settings/TransportadorasCard", () => ({
  buscarConfiguracaoDeFrete: async () => ({
    ok: true,
    config: { ligados: [], provedores: new Map() },
  }),
  NOME_DO_PROVEDOR: new Map(),
  PROVEDORES_QUE_EXIGEM_EMAIL_PARA_SALVAR: new Set(),
  emailDeContatoValido: () => true,
  TransportadorasSection: () => null,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: s.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: s.erroLeitura ? null : { whatsapp: null, nome: null },
            error: s.erroLeitura ? { message: "erro" } : null,
          }),
        }),
      }),
    }),
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  s.erroLeitura = false;
  s.update.mockResolvedValue(true);
  s.config.localDeliveryFee = 10;
  s.config.localDeliveryEnabled = true;
  s.config.originCep = "01000-000";
  s.config.storeAddress = "Rua Fictícia, 1";
  s.config.enabledShippingMethods = ["sedex", "pac"];
  s.rpc.mockImplementation(async (_nome, args) => ({
    data: { whatsapp: args.p_whatsapp, nome: args.p_nome },
    error: null,
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function abrir() {
  await act(async () =>
    root.render(<AdminShippingView active painelInicial="local" />),
  );
  const b = [...host.querySelectorAll("button")].find((x) =>
    x.textContent?.includes("Na sua região"),
  );
  await act(async () => b?.click());
}
async function digitar(id: string, value: string) {
  const campo = host.querySelector<HTMLInputElement>(id);
  expect(campo).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(campo, value);
    campo!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const botao = () =>
  [...host.querySelectorAll("button")].find((b) =>
    /^(Salvar|Tentar de novo)$/.test(b.textContent?.trim() ?? ""),
  );
it("grava só o contato privado e mantém os outros blocos fora do payload de frete", async () => {
  await abrir();
  expect(host.textContent).toContain("O número fica só no painel");
  await digitar("#mototaxi-whatsapp", "(11) 98765-4321");
  await digitar("#mototaxi-nome", "Zé");
  expect(botao()?.disabled).toBe(false);
  await act(async () => botao()?.click());
  expect(s.rpc).toHaveBeenCalledWith("salvar_config_mototaxi", {
    p_whatsapp: "5511987654321",
    p_nome: "Zé",
  });
  // Só mexer no contato não regrava nem as regras de frete.
  expect(s.update).not.toHaveBeenCalled();
  expect(
    host.querySelector<HTMLInputElement>("#mototaxi-whatsapp")!.value,
  ).toBe("5511987654321");
});
it("salva só o mototáxi mesmo com retirada antiga sem CEP ou endereço, sem dizer que salvou frete", async () => {
  s.config.localDeliveryEnabled = false;
  s.config.enabledShippingMethods = ["store-pickup"];
  s.config.originCep = "";
  s.config.storeAddress = "";
  await abrir();
  await digitar("#mototaxi-whatsapp", "11987654321");
  expect(botao()?.disabled).toBe(false);
  await act(async () => botao()?.click());
  expect(s.rpc).toHaveBeenCalledWith("salvar_config_mototaxi", {
    p_whatsapp: "5511987654321",
    p_nome: null,
  });
  expect(s.update).not.toHaveBeenCalled();
  expect(toast.success).toHaveBeenCalledWith("Contato do mototáxi salvo");
  expect(toast.success).not.toHaveBeenCalledWith("Regras de frete salvas!");
});
it("salvar uma regra manda somente os campos de frete, não contato nem horário", async () => {
  await abrir();
  const taxa = host.querySelector<HTMLInputElement>("#local-delivery-fee");
  expect(taxa).not.toBeNull();
  await digitar("#local-delivery-fee", "18");
  await act(async () => botao()?.click());
  expect(s.update).toHaveBeenCalledTimes(1);
  expect(Object.keys(s.update.mock.calls[0][0]).sort()).toEqual(
    [
      "freeShippingMin",
      "shippingCoverage",
      "localDeliveryFee",
      "localCepRange",
      "localDeliveryEnabled",
      "localDeliveryDays",
      "nationalShippingStrategy",
      "nationalShippingMin",
      "nationalDiscountType",
      "nationalDiscountValue",
      "nationalBenefitScope",
    ].sort(),
  );
  expect(s.rpc).not.toHaveBeenCalled();
});
it("não grava frete quando o contato pendente falha primeiro", async () => {
  await abrir();
  await digitar("#mototaxi-whatsapp", "11987654321");
  await digitar("#local-delivery-fee", "18");
  s.rpc.mockResolvedValueOnce({ data: null, error: { message: "falhou" } });
  await act(async () => botao()?.click());
  expect(s.update).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith(
    "Não foi possível salvar o mototáxi. Tente de novo.",
  );
  expect(botao()?.textContent).toContain("Tentar de novo");
});
it("contato salvo não é regravado quando o frete falha depois", async () => {
  await abrir();
  await digitar("#mototaxi-whatsapp", "(11) 98765-4321");
  await digitar("#local-delivery-fee", "18");
  s.update.mockResolvedValueOnce(false);
  await act(async () => botao()?.click());
  expect(s.rpc).toHaveBeenCalledTimes(1);
  expect(s.update).toHaveBeenCalledTimes(1);
  expect(s.rpc.mock.invocationCallOrder[0]).toBeLessThan(
    s.update.mock.invocationCallOrder[0],
  );
  expect(botao()?.textContent).toContain("Tentar de novo");
  expect(toast.success).not.toHaveBeenCalled();
  await act(async () => botao()?.click());
  expect(s.rpc).toHaveBeenCalledTimes(1);
  expect(s.update).toHaveBeenCalledTimes(2);
  expect(toast.success).toHaveBeenCalledWith("Regras de frete salvas!");
  expect(toast.success).not.toHaveBeenCalledWith("Contato do mototáxi salvo");
});
it("as travas do frete continuam quando contato e frete mudaram juntos", async () => {
  s.config.localDeliveryEnabled = false;
  s.config.enabledShippingMethods = ["store-pickup"];
  s.config.originCep = "";
  await abrir();
  await digitar("#mototaxi-whatsapp", "11987654321");
  await digitar("#local-delivery-fee", "18");
  expect(botao()?.disabled).toBe(true);
  await act(async () => botao()?.click());
  expect(s.rpc).not.toHaveBeenCalled();
  expect(s.update).not.toHaveBeenCalled();
});
it("número inválido não pode ser salvo", async () => {
  await abrir();
  await digitar("#mototaxi-whatsapp", "11999");
  expect(botao()?.disabled).toBe(true);
  expect(s.rpc).not.toHaveBeenCalled();
});
it("falha de gravação não vira salvo", async () => {
  await abrir();
  await digitar("#mototaxi-whatsapp", "11987654321");
  s.rpc.mockResolvedValueOnce({ data: null, error: { message: "falhou" } });
  await act(async () => botao()?.click());
  expect(botao()?.textContent).toContain("Tentar de novo");
});
it("falha na leitura deixa contato protegido e oferece nova tentativa", async () => {
  s.erroLeitura = true;
  await abrir();
  expect(host.textContent).toContain("Não foi possível carregar o mototáxi");
  expect(
    host
      .querySelector<HTMLInputElement>("#mototaxi-whatsapp")
      ?.matches(":disabled"),
  ).toBe(true);
});
