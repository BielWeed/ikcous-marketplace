// @vitest-environment jsdom
//
// As duas exceções da trava "valor da entrega negativo não salva"
// (AdminShippingView, handleSave). Sem elas a trava barraria quem não tem
// culpa do número:
//  (a) no modo "Só retirada" o campo do valor some da tela; um "-3" que ficou
//      escondido ali não pode impedir de salvar (a entrega nem existe mais);
//  (b) quem mexeu SÓ no contato do mototáxi não está salvando o frete: um
//      valor ruim que já estava gravado não pode travar esse contato.
// A trava em si (campo visível, "-3") é coberta por
// frete-valor-da-entrega-negativo-avisa.test.tsx.
import { AdminShippingView } from "@/views/admin/AdminShippingView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  update: vi.fn(async (_updates: Record<string, unknown>) => true),
  rpc: vi.fn(),
  toastErro: vi.fn(),
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
            data: { whatsapp: null, nome: null },
            error: null,
          }),
        }),
      }),
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: { error: s.toastErro, success: vi.fn() },
}));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MENSAGEM_DA_TRAVA = "O valor da entrega não pode ser negativo.";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  s.update.mockResolvedValue(true);
  s.config.localDeliveryFee = 10;
  s.config.localDeliveryEnabled = true;
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
  expect(campo, `campo ${id} ausente`).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(campo, value);
    campo!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const botaoSalvar = () =>
  [...host.querySelectorAll("button")].find((b) =>
    /^(Salvar|Tentar de novo)$/.test(b.textContent?.trim() ?? ""),
  );

it("(a) 'Só retirada' com um valor negativo escondido no campo: o Salvar não é barrado", async () => {
  await abrir();
  await digitar("#local-delivery-fee", "-3");

  const soRetirada = [...host.querySelectorAll<HTMLElement>("[role=radio]")]
    .concat([...host.querySelectorAll<HTMLElement>("button")])
    .find((el) => el.textContent?.includes("Só retirada"));
  expect(soRetirada, "opção 'Só retirada' ausente").toBeTruthy();
  await act(async () => soRetirada!.click());
  // O campo do valor sumiu da tela: o "-3" ficou escondido no formulário.
  expect(host.querySelector("#local-delivery-fee")).toBeNull();

  expect(botaoSalvar()?.disabled).toBe(false);
  await act(async () => botaoSalvar()?.click());

  expect(s.toastErro).not.toHaveBeenCalledWith(
    MENSAGEM_DA_TRAVA,
    expect.anything(),
  );
  expect(s.update).toHaveBeenCalledTimes(1);
  expect(s.update).toHaveBeenCalledWith(
    expect.objectContaining({ localDeliveryEnabled: false }),
  );
});

it("(b) só o contato do mototáxi mudou e o valor da entrega já gravado era negativo: salva o contato sem a trava", async () => {
  s.config.localDeliveryFee = -3;
  await abrir();
  await digitar("#mototaxi-whatsapp", "(11) 98765-4321");

  expect(botaoSalvar()?.disabled).toBe(false);
  await act(async () => botaoSalvar()?.click());

  expect(s.toastErro).not.toHaveBeenCalledWith(
    MENSAGEM_DA_TRAVA,
    expect.anything(),
  );
  expect(s.rpc).toHaveBeenCalledWith("salvar_config_mototaxi", {
    p_whatsapp: "5511987654321",
    p_nome: null,
  });
  // Só o contato: o frete não é regravado (nem o "-3" vira 0 = grátis).
  expect(s.update).not.toHaveBeenCalled();
});
