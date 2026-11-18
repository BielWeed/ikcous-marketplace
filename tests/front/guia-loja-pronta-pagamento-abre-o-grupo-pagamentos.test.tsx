// @vitest-environment jsdom
import { LojaProntaEEstoqueBaixo } from "@/components/admin/dashboard/LojaProntaEEstoqueBaixo";
import { AdminArea } from "@/components/layouts/AdminArea";
import { montarEnderecoDaLoja } from "@/lib/endereco-da-loja";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { type Mock, afterEach, beforeEach, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ desktop: true }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { formasPagamentoEntrega: [] },
    isLoaded: true,
    updateConfig: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/config/configuracaoDaLoja", () => ({
  chavePublicaMercadoPago: () => "",
}));
vi.mock("@/lib/flags", () => ({ pagamentoOnlineLigado: () => false }));
vi.mock("@/lib/config-do-cartao", () => ({
  PARCELAS_MAX_TETO: 12,
  buscarConfigDoCartao: async () => ({
    ok: true,
    config: { credito: false, debito: false, parcelasMax: 12 },
  }),
  salvarConfigDoCartao: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));
vi.mock("@/components/layouts/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: import("react").ReactNode }) =>
    children,
}));
vi.mock("@/components/admin/AdminHelpModal", () => ({
  AdminHelpModal: () => null,
}));
vi.mock("@/components/admin/settings/MercadoPagoSection", () => ({
  MercadoPagoSection: () => null,
}));
import { AdminSettingsView } from "@/views/admin/AdminSettingsView";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let rolagem: Mock<(arg?: boolean | ScrollIntoViewOptions) => void>;
beforeEach(() => {
  estado.desktop = true;
  vi.stubGlobal("matchMedia", () => ({
    matches: estado.desktop,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  rolagem = vi.fn();
  Element.prototype.scrollIntoView = rolagem;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const grupo = (chave: string) =>
  host.querySelector<HTMLElement>(`#grupo-de-ajustes-${chave}`)!;

it.each([
  { desktop: true, boasVindas: true, lista: false },
  { desktop: false, boasVindas: true, lista: false },
  { desktop: true, boasVindas: false, lista: false },
  { desktop: true, boasVindas: false, lista: true },
])(
  "o passo abre Pagamentos ($desktop, boas-vindas: $boasVindas, lista: $lista)",
  async ({ desktop, boasVindas, lista }) => {
    estado.desktop = desktop;
    const navegar = vi.fn();
    await act(async () =>
      root.render(
        <LojaProntaEEstoqueBaixo
          somenteBoasVindas={boasVindas}
          stats={{ inventoryAlerts: 0 }}
          config={{
            storeName: "Loja de teste",
            logoUrl: "https://exemplo.test/logo.png",
            ...montarEnderecoDaLoja({
              cep: "01310100",
              rua: "Rua de teste",
              numero: "10",
              complemento: "",
              bairro: "Centro",
              cidade: "São Paulo",
              uf: "SP",
            }),
            whatsappNumber: "11999999999",
          }}
          ligado={false}
          chaveOk={false}
          formasNaEntrega={[]}
          produtos={[{ isActive: true, stock: 1 }]}
          configCarregando={false}
          produtosCarregando={false}
          onNavigate={navegar}
          onTentarDeNovo={vi.fn()}
        />,
      ),
    );
    if (lista) {
      await act(async () =>
        host.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click(),
      );
    }
    const botao = [...host.querySelectorAll("button")]
      .filter((b) => b.textContent?.includes("Configurar como você recebe"))
      .at(-1);
    expect(botao).toBeDefined();
    await act(async () => botao!.click());
    expect(navegar).toHaveBeenCalledWith("admin-settings", "pagamentos");
    await act(async () =>
      root.render(
        <AdminArea
          currentView={navegar.mock.calls[0][0]}
          selectedProductId={navegar.mock.calls[0][1]}
          onNavigate={navegar}
          setIsAdminDirty={vi.fn()}
          setBackOverride={vi.fn()}
          handleAdminUserDetailBack={vi.fn()}
          backOverride={null}
          isTransitionSupported={false}
        />,
      ),
    );
    expect(grupo("pagamentos").hidden).toBe(false);
    expect(
      host.querySelector<HTMLElement>("#conteudo-pagamentos")!.hidden,
    ).toBe(false);
    if (desktop) expect(grupo("minha-loja").hidden).toBe(true);
    // A rolagem corre num setTimeout(0) depois de trocar de grupo: espera ela e
    // exige que tenha sido pedida NO grupo de Pagamentos, não em outro elemento.
    await vi.waitFor(() => expect(rolagem).toHaveBeenCalled());
    expect(rolagem.mock.contexts).toContain(grupo("pagamentos"));
  },
);

it("sem parâmetro continua abrindo Minha loja", async () => {
  await act(async () =>
    root.render(<AdminSettingsView onNavigate={vi.fn()} />),
  );
  expect(grupo("minha-loja").hidden).toBe(false);
  expect(grupo("pagamentos").hidden).toBe(true);
});

it("o atalho seleciona Pagamentos mesmo se Ajustes já estava montado", async () => {
  await act(async () =>
    root.render(<AdminSettingsView onNavigate={vi.fn()} active={false} />),
  );
  await act(async () =>
    root.render(
      <AdminSettingsView
        onNavigate={vi.fn()}
        active
        grupoInicial="pagamentos"
      />,
    ),
  );
  expect(grupo("pagamentos").hidden).toBe(false);
});
