// @vitest-environment jsdom
import { AdminCouponFormView } from "@/views/admin/AdminCouponFormView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  salvar: vi.fn(),
  navegar: vi.fn(),
  marcarAlterado: vi.fn(),
  cupom: {
    id: "cupom-1",
    code: "DEZ",
    type: "percentage",
    value: 10,
    active: true,
    usageCount: 0,
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { formasPagamentoEntrega: ["cash"] },
    isLoaded: true,
    products: [],
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: [h.cupom],
    loading: false,
    alcanceSuportado: false,
    alcanceSondado: true,
    updateCoupon: h.salvar,
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) },
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("não muda a ativação durante a gravação nem descarta uma mudança local ao terminar", async () => {
  let terminar!: () => void;
  h.salvar.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      terminar = resolve;
    }),
  );
  await act(async () => {
    root.render(
      <AdminCouponFormView
        couponId="cupom-1"
        onNavigate={h.navegar}
        onSetDirty={h.marcarAlterado}
      />,
    );
  });
  const codigo = host.querySelector<HTMLInputElement>("#coupon-code")!;
  const ativacao = host.querySelector<HTMLButtonElement>("#coupon-active")!;
  expect(ativacao.disabled).toBe(false);
  expect(ativacao.getAttribute("aria-checked")).toBe("true");

  await act(async () => {
    codigo.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(codigo, "DEZEDITADO");
    codigo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => codigo.blur());
  const salvar = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Salvar Cupom",
  )!;
  await act(async () => salvar.click());

  expect(h.salvar).toHaveBeenCalledExactlyOnceWith("cupom-1", {
    code: "DEZEDITADO",
  });
  expect(h.navegar).not.toHaveBeenCalled();
  expect(h.marcarAlterado).toHaveBeenLastCalledWith(true);
  await act(async () => ativacao.click());
  expect(ativacao.getAttribute("aria-checked")).toBe("true");
  expect(ativacao.disabled).toBe(true);
  expect(codigo.value).toBe("DEZEDITADO");

  await act(async () => terminar());
  expect(h.navegar).toHaveBeenCalledExactlyOnceWith("admin-coupons");
  expect(h.marcarAlterado).toHaveBeenLastCalledWith(false);
  expect(ativacao.getAttribute("aria-checked")).toBe("true");
  expect(codigo.value).toBe("DEZEDITADO");
  expect(h.salvar).toHaveBeenCalledTimes(1);
  expect(h.cupom.active).toBe(true);
});
