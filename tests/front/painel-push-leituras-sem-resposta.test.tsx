// @vitest-environment jsdom
import { AdminPushView } from "@/views/admin/AdminPushView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// A tela é real; só a fronteira de rede é simulada, por consulta.
const h = vi.hoisted(() => ({
  produtos: vi.fn(),
  perfil: vi.fn(),
  historico: vi.fn(),
  aparelhos: vi.fn(),
  contar: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { realTimeSalesAlerts: false },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({ isSupported: false, subscribe: vi.fn() }),
}));
vi.mock("@/hooks/useVOR", () => ({
  useVOR: () => ({ recordAction: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") return { select: h.aparelhos };
      if (tabela === "public_profiles")
        return {
          select: () => ({ eq: () => ({ single: h.perfil }) }),
        };
      if (tabela === "vw_produtos_public")
        return {
          select: () => ({
            eq: () => ({
              order: () => ({ order: () => ({ range: h.produtos }) }),
            }),
          }),
        };
      return {
        select: () => ({
          not: () => ({ order: () => ({ limit: h.historico }) }),
        }),
      };
    },
    rpc: h.contar,
    functions: { invoke: vi.fn() },
  },
}));
class Observador {
  observe() {}
  unobserve() {}
  disconnect() {}
}
let raiz: Root;
let tela: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", Observador);
  vi.stubGlobal("IntersectionObserver", Observador);
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
  localStorage.clear();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.produtos.mockReset().mockResolvedValue({ data: [], error: null });
  h.perfil.mockReset().mockResolvedValue({
    data: { full_name: "Cliente de teste" },
    error: null,
  });
  h.historico.mockReset().mockResolvedValue({ data: [], error: null });
  h.aparelhos.mockReset().mockResolvedValue({ count: 8, error: null });
  h.contar.mockReset().mockResolvedValue({ data: 2, error: null });
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
});
afterEach(() => {
  act(() => raiz.unmount());
  tela.remove();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function montar(targetUserId?: string) {
  await act(async () =>
    raiz.render(
      <AdminPushView onNavigate={vi.fn()} targetUserId={targetUserId} />,
    ),
  );
}
async function passar(ms = 20_000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function botao(texto: string) {
  const encontrado = [...tela.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
  expect(encontrado).toBeTruthy();
  return encontrado!;
}
async function clicar(texto: string) {
  await act(async () => botao(texto).click());
}
function adiada<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

it("produtos sem resposta liberam o destino e oferecem nova tentativa após 20 s", async () => {
  h.produtos.mockReturnValue(new Promise(() => {}));
  await montar();
  await clicar("Ao tocar na mensagem");
  const destino = () =>
    tela.querySelector("#push-destination") as HTMLButtonElement;
  expect(destino().disabled).toBe(true);
  await passar(19_999);
  expect(destino().disabled).toBe(true);
  await passar(1);
  expect(destino().disabled).toBe(false);
  expect(tela.textContent).toContain("Não deu para carregar os produtos.");
  h.produtos.mockResolvedValue({
    data: [{ id: "p1", nome: "Produto de teste" }],
    error: null,
  });
  await clicar("Tentar de novo");
  expect(tela.textContent).not.toContain("Não deu para carregar os produtos.");
});

it("nome sem resposta deixa de dizer Carregando após 20 s", async () => {
  h.perfil.mockReturnValue(new Promise(() => {}));
  await montar("cliente-1");
  expect(tela.textContent).toContain("Cliente: Carregando...");
  await passar();
  expect(tela.textContent).not.toContain("Cliente: Carregando...");
  expect(tela.textContent).toContain("conexão");
});

it("histórico sem resposta troca carregando por erro e permite tentar de novo", async () => {
  h.historico.mockReturnValue(new Promise(() => {}));
  await montar();
  await clicar("O que já foi ao ar");
  expect(tela.textContent).toContain("Carregando o histórico…");
  await passar();
  expect(tela.textContent).not.toContain("Carregando o histórico…");
  expect(tela.textContent).toContain("Não foi possível carregar o histórico");
  h.historico.mockResolvedValue({ data: [], error: null });
  await clicar("Tentar de novo");
  expect(tela.textContent).not.toContain(
    "Não foi possível carregar o histórico",
  );
});

it("contagem total esgota em 20 s, ignora resposta tardia e pode ser medida de novo no foco", async () => {
  const consulta = adiada<{ count: number; error: null }>();
  h.aparelhos.mockReturnValue(consulta.promessa);
  await montar();
  await passar();
  // A regra atual de erro é alcance desconhecido e envio bloqueado.
  expect(botao("Enviar agora para — aparelhos").disabled).toBe(true);
  await act(async () => consulta.resolver({ count: 99, error: null }));
  expect(botao("Enviar agora para — aparelhos").disabled).toBe(true);
  h.aparelhos.mockResolvedValue({ count: 8, error: null });
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(botao("Enviar agora para 8 aparelhos").disabled).toBe(false);
});

it("contagens dos grupos sem resposta vencem em 20 s sem aceitar números tardios", async () => {
  const consulta = adiada<{ data: number; error: null }>();
  h.contar.mockReturnValue(consulta.promessa);
  await montar();
  expect(botao("Gastaram R$ 150+").textContent).toContain("—");
  await passar();
  await act(async () => consulta.resolver({ data: 99, error: null }));
  expect(botao("Gastaram R$ 150+").textContent).toContain("—");
  expect(botao("Inativos há 30 dias").textContent).toContain("—");
  expect(botao("Novos em 7 dias").textContent).toContain("—");
  h.contar.mockResolvedValue({ data: 3, error: null });
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(botao("Gastaram R$ 150+").textContent).toContain("3");
});

it("contagem do segmento esgota em 20 s e não aceita uma resposta tardia como medição atual", async () => {
  await montar();
  const consulta = adiada<{ data: number; error: null }>();
  h.contar.mockReturnValue(consulta.promessa);
  await clicar("Gastaram R$ 150+");
  await passar();
  expect(botao("Enviar agora para — aparelhos").disabled).toBe(true);
  await act(async () => consulta.resolver({ data: 99, error: null }));
  expect(botao("Enviar agora para — aparelhos").disabled).toBe(true);
  h.contar.mockResolvedValue({ data: 3, error: null });
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(botao("Enviar agora para 3 aparelhos").disabled).toBe(false);
});
