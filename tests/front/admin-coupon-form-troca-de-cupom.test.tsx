// @vitest-environment jsdom
import type { ClienteDoCupom, Coupon } from "@/types";
import { AdminCouponFormView } from "@/views/admin/AdminCouponFormView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let cupons: Coupon[] = [];
const atualizar = vi.fn();
const listarClientes = vi.fn();
const marcarSujo = vi.fn();
const navegar = vi.fn();

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: cupons,
    loading: false,
    addCoupon: vi.fn(),
    updateCoupon: atualizar,
    alcanceSuportado: true,
    alcanceSondado: true,
    listarClientesDoCupom: listarClientes,
    buscarClientesParaCupom: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { formasPagamentoEntrega: ["cash"] } }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const cupomA: Coupon = {
  id: "cupom-a",
  code: "CUPOMA",
  type: "fixed",
  value: 10,
  minPurchase: 80,
  usageLimit: 5,
  validUntil: "2026-11-30T23:59:59.999Z",
  active: false,
  alcance: "vitrine",
  usageCount: 0,
};
const cupomB: Coupon = {
  id: "cupom-b",
  code: "CUPOMB",
  type: "percentage",
  value: 30,
  minPurchase: 0,
  usageLimit: 0,
  active: true,
  alcance: "codigo",
  usageCount: 0,
};

let raiz: Root;
let tela: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  cupons = [cupomA, cupomB];
  atualizar.mockResolvedValue(undefined);
  listarClientes.mockResolvedValue([]);
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
});

afterEach(() => {
  act(() => raiz.unmount());
  tela.remove();
  vi.unstubAllGlobals();
});

async function mostrar(couponId?: string) {
  await act(async () => {
    raiz.render(
      <AdminCouponFormView
        couponId={couponId}
        onNavigate={(view, id) => navegar(view, id)}
        onSetDirty={marcarSujo}
      />,
    );
  });
}

function campo(id: string): HTMLInputElement {
  const encontrado = tela.querySelector<HTMLInputElement>(`#coupon-${id}`);
  if (!encontrado) throw new Error(`Campo não encontrado: ${id}`);
  return encontrado;
}

function botao(nome: string): HTMLButtonElement {
  const encontrado = [...tela.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === nome,
  );
  if (!encontrado) throw new Error(`Botão não encontrado: ${nome}`);
  return encontrado;
}

function conferirB() {
  expect(campo("code").value).toBe("CUPOMB");
  expect(campo("value").value).toBe("30");
  expect(campo("min-purchase").value).toBe("");
  expect(campo("usage-limit").value).toBe("");
  expect(campo("valid-until").value).toBe("");
  expect(botao("% Percentual").getAttribute("aria-pressed")).toBe("true");
  expect(
    tela.querySelector("#coupon-active")?.getAttribute("aria-checked"),
  ).toBe("true");
  expect(marcarSujo).toHaveBeenLastCalledWith(false);
}

describe("formulário de cupom — troca de identidade sem desmontar a tela", () => {
  it("mostra e salva somente os dados de B, inclusive os campos vazios", async () => {
    await mostrar(cupomA.id);
    expect(campo("code").value).toBe("CUPOMA");
    expect(campo("value").value).toBe("10");
    expect(campo("min-purchase").value).toBe("80");

    await mostrar(cupomB.id);
    conferirB();

    await act(async () => botao("Salvar Cupom").click());
    expect(atualizar).toHaveBeenCalledWith(
      "cupom-b",
      expect.objectContaining({
        code: "CUPOMB",
        type: "percentage",
        value: 30,
        minPurchase: 0,
        usageLimit: 0,
        validUntil: undefined,
        active: true,
      }),
    );
    // O alcance de B já era "codigo": nenhuma mudança herdada de A é enviada.
    expect(atualizar.mock.calls[0][1]).not.toHaveProperty("alcance");
  });

  it("limpa A enquanto B não chegou e não reaplica uma carga tardia de A", async () => {
    cupons = [cupomA];
    await mostrar(cupomA.id);

    await mostrar(cupomB.id);
    for (const id of [
      "code",
      "value",
      "min-purchase",
      "usage-limit",
      "valid-until",
    ]) {
      expect(campo(id).value, id).toBe("");
    }
    expect(marcarSujo).toHaveBeenLastCalledWith(false);

    // Uma nova resposta ainda só tem A; não pertence ao id da rota.
    cupons = [{ ...cupomA, code: "ANTIGO" }];
    await mostrar(cupomB.id);
    expect(campo("code").value).toBe("");
    expect(campo("value").value).toBe("");

    cupons = [cupomB];
    await mostrar(cupomB.id);
    conferirB();

    // Mesmo depois da carga de B, uma resposta antiga não volta a encher o form.
    cupons = [cupomA];
    await mostrar(cupomB.id);
    conferirB();
  });

  it("ignora os clientes de A que chegam depois dos clientes de B", async () => {
    let responderA!: (lista: ClienteDoCupom[]) => void;
    const respostaA = new Promise<ClienteDoCupom[]>((resolve) => {
      responderA = resolve;
    });
    listarClientes.mockImplementation((id: string) =>
      id === cupomA.id
        ? respostaA
        : Promise.resolve([{ id: "cliente-b", nome: "Pessoa B", email: null }]),
    );
    cupons = [
      { ...cupomA, alcance: "exclusivo" },
      { ...cupomB, alcance: "exclusivo" },
    ];
    await mostrar(cupomA.id);
    expect(listarClientes).toHaveBeenCalledWith(cupomA.id);

    await mostrar(cupomB.id);
    expect(tela.textContent).toContain("Pessoa B");
    await act(async () => {
      responderA([{ id: "cliente-a", nome: "Pessoa A", email: null }]);
      await respostaA;
    });

    conferirB();
    expect(tela.textContent).toContain("Pessoa B");
    expect(tela.textContent).not.toContain("Pessoa A");
    expect(marcarSujo).toHaveBeenLastCalledWith(false);
  });

  it("volta ao formulário vazio ao sair da edição para criar outro cupom", async () => {
    await mostrar(cupomA.id);
    await mostrar();

    for (const id of [
      "code",
      "value",
      "min-purchase",
      "usage-limit",
      "valid-until",
    ]) {
      expect(campo(id).value, id).toBe("");
    }
    expect(botao("% Percentual").getAttribute("aria-pressed")).toBe("true");
    expect(marcarSujo).toHaveBeenLastCalledWith(false);
  });
});
