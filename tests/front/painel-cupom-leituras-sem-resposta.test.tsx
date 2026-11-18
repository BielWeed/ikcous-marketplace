// @vitest-environment jsdom
import { setCachedCouponsData } from "@/utils/admin_cache";
import { AdminCouponFormView } from "@/views/admin/AdminCouponFormView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Formulário e hook reais: retirar o prazo da sonda ou da RPC deixa os
// respectivos avisos ausentes mesmo depois dos 20 segundos.
const h = vi.hoisted(() => ({ sonda: vi.fn(), clientes: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { formasPagamentoEntrega: ["cash"] } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        limit: h.sonda,
        order: async () => ({
          data: [
            {
              id: "cupom-1",
              code: "VIP",
              type: "percentage",
              value: 10,
              active: true,
              usage_count: 0,
              alcance: "exclusivo",
              min_purchase: 0,
              usage_limit: 0,
              valid_until: null,
            },
          ],
          error: null,
        }),
      }),
    }),
    rpc: h.clientes,
  },
}));

let raiz: Root;
let tela: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.sonda.mockReset().mockResolvedValue({ error: null });
  h.clientes.mockReset().mockResolvedValue({ data: [], error: null });
  setCachedCouponsData(null);
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
});
afterEach(() => {
  act(() => raiz.unmount());
  tela.remove();
  setCachedCouponsData(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function montar() {
  await act(async () =>
    raiz.render(
      <AdminCouponFormView
        couponId="cupom-1"
        onNavigate={vi.fn()}
        onSetDirty={vi.fn()}
      />,
    ),
  );
}
async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

it("sonda de alcance sem resposta libera os campos básicos e mostra a indisponibilidade em 20 s", async () => {
  h.sonda.mockReturnValue(new Promise(() => {}));
  await montar();
  await passar(19_999);
  expect(tela.textContent).not.toContain("Somente os campos básicos");
  await passar(1);
  expect(tela.textContent).toContain(
    "As opções de público estão indisponíveis.",
  );
  expect(tela.querySelector("#coupon-code")).not.toBeNull();
});

it("lista exclusiva sem resposta sai de carregando e mostra a falha em 20 s", async () => {
  h.clientes.mockReturnValue(new Promise(() => {}));
  await montar();
  expect(tela.textContent).toContain("Carregando a lista…");
  await passar(19_999);
  expect(tela.textContent).toContain("Carregando a lista…");
  await passar(1);
  expect(tela.textContent).not.toContain("Carregando a lista…");
  expect(tela.textContent).toContain(
    "A lista de clientes deste cupom não carregou.",
  );
  expect(tela.textContent).toContain("Carregar de novo");
});
