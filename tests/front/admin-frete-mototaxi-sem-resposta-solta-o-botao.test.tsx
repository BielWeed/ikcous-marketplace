// @vitest-environment jsdom
//
// Frete: gravar o contato do mototaxi nao pode prender o botao Salvar. Rede que
// conecta e nao responde deixava a tela em "Salvando…" para sempre, com o botao
// desabilitado, e as regras de frete seguintes nem eram enviadas. Agora a
// gravacao do contato tem prazo: estourou, o botao volta, a tela diz o que pode
// ter sido gravado e que repetir e seguro (a RPC e um upsert da linha unica).
import {
  MENSAGEM_MOTOTAXI_SEM_RESPOSTA,
  PRAZO_DE_GRAVAR_O_CONTATO_DO_MOTOTAXI_MS,
} from "@/lib/prazo-da-requisicao";
import { AdminShippingView } from "@/views/admin/AdminShippingView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  update: vi.fn(async (_updates: Record<string, unknown>) => true),
  rpc: vi.fn(),
  config: {
    freeShippingMin: 0,
    shippingCoverage: "national",
    localDeliveryFee: 10,
    localCepRange: "",
    localDeliveryEnabled: true as boolean,
    localDeliveryDays: 1,
    originCep: "01000-000",
    storeAddress: "Rua Ficticia, 1",
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
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  s.update.mockResolvedValue(true);
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
  vi.useRealTimers();
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
const botao = (re: RegExp) =>
  [...host.querySelectorAll("button")].find((b) =>
    re.test(b.textContent?.trim() ?? ""),
  );
// Relogio falso SO depois de a tela estar pronta: o prazo da gravacao nasce
// dentro do clique, ja sob o relogio.
const relogioFalso = () =>
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout"],
    shouldAdvanceTime: true,
  });
const passarOPrazo = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(
      PRAZO_DE_GRAVAR_O_CONTATO_DO_MOTOTAXI_MS + 1,
    );
  });

it("gravacao do contato que nunca responde: passado o prazo o botao volta e a tela diz o que pode ter sido gravado", async () => {
  await abrir();
  await digitar("#mototaxi-whatsapp", "11987654321");
  await digitar("#local-delivery-fee", "18");
  s.rpc.mockImplementation(() => new Promise(() => {}));
  relogioFalso();

  await act(async () => botao(/^Salvar$/)?.click());
  expect(botao(/^Salvando/)?.disabled).toBe(true);

  await passarOPrazo();

  expect(botao(/^Salvando/)).toBeUndefined();
  const voltou = botao(/^Tentar de novo$/);
  expect(voltou).toBeDefined();
  expect(voltou!.disabled).toBe(false);
  expect(toast.error).toHaveBeenCalledWith(MENSAGEM_MOTOTAXI_SEM_RESPOSTA);
  // A primeira gravacao nao respondeu: as regras de frete nem foram enviadas.
  expect(s.update).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});

it("depois do prazo da para tocar de novo e, se a rede voltar, contato e regras sao gravados", async () => {
  await abrir();
  await digitar("#mototaxi-whatsapp", "11987654321");
  await digitar("#local-delivery-fee", "18");
  s.rpc.mockImplementationOnce(() => new Promise(() => {}));
  relogioFalso();

  await act(async () => botao(/^Salvar$/)?.click());
  await passarOPrazo();
  expect(s.update).not.toHaveBeenCalled();

  await act(async () => botao(/^Tentar de novo$/)?.click());

  expect(s.rpc).toHaveBeenCalledTimes(2);
  expect(s.rpc).toHaveBeenLastCalledWith("salvar_config_mototaxi", {
    p_whatsapp: "5511987654321",
    p_nome: null,
  });
  expect(s.update).toHaveBeenCalledTimes(1);
  expect(toast.success).toHaveBeenCalledWith("Regras de frete salvas!");
});

it("falha imediata do servidor segue com a mesma frase de sempre, sem a de falta de resposta", async () => {
  await abrir();
  await digitar("#mototaxi-whatsapp", "11987654321");
  s.rpc.mockResolvedValueOnce({ data: null, error: { message: "falhou" } });

  await act(async () => botao(/^Salvar$/)?.click());

  expect(toast.error).toHaveBeenCalledWith(
    "Não foi possível salvar o mototáxi. Tente de novo.",
  );
  expect(toast.error).not.toHaveBeenCalledWith(MENSAGEM_MOTOTAXI_SEM_RESPOSTA);
  expect(botao(/^Tentar de novo$/)?.disabled).toBe(false);
});
