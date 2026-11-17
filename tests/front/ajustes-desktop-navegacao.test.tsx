// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  desktop: true,
  loaded: true,
  falhou: false,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { formasPagamentoEntrega: ["pix", "cash"] },
    isLoaded: estado.loaded,
    configIndisponivel: estado.falhou,
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
vi.mock("@/components/admin/AdminHelpModal", () => ({
  AdminHelpModal: () => null,
}));
// A fronteira externa é substituída só para observar montagem/rascunho;
// seleção, guardas, acordeões e grupos são os componentes de produção.
vi.mock("@/components/admin/settings/EmailDaLojaSection", () => ({
  EmailDaLojaSection: ({
    onDirtyMudou,
  }: { onDirtyMudou: (v: boolean) => void }) => (
    <input aria-label="Rascunho de email" onInput={() => onDirtyMudou(true)} />
  ),
}));
vi.mock("@/components/admin/settings/MercadoPagoSection", () => ({
  MercadoPagoSection: () => null,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { AdminSettingsView } from "@/views/admin/AdminSettingsView";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let mudou: (() => void) | undefined;
let navegar = vi.fn<(view: import("@/types").View, id?: string) => void>();
let dirty = vi.fn<(dirty: boolean) => void>();
beforeEach(() => {
  estado.desktop = true;
  estado.loaded = true;
  estado.falhou = false;
  vi.stubGlobal("matchMedia", () => ({
    matches: estado.desktop,
    addEventListener: (_: string, cb: () => void) => {
      mudou = cb;
    },
    removeEventListener: vi.fn(),
  }));
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  navegar = vi.fn();
  dirty = vi.fn();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  mudou = undefined;
});
async function montar() {
  await act(async () =>
    root.render(<AdminSettingsView onNavigate={navegar} onSetDirty={dirty} />),
  );
}
async function clicar(texto: string, pai: ParentNode = host) {
  const botao = [...pai.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) =>
      b.getAttribute("aria-label") === texto || b.textContent?.includes(texto),
  );
  expect(botao, texto).toBeDefined();
  await act(async () => botao!.click());
}
const grupo = (chave: string) =>
  host.querySelector<HTMLElement>(`#grupo-de-ajustes-${chave}`)!;
const indice = () =>
  host.querySelector<HTMLElement>('nav[aria-label="Grupos de ajustes"]')!;

it("no desktop mostra os seis destinos e um único grupo, com conteúdo aberto", async () => {
  await montar();
  expect(indice()).not.toBeNull();
  expect(indice().querySelectorAll("button")).toHaveLength(6);
  expect(grupo("minha-loja").hidden).toBe(false);
  expect(grupo("aparencia").hidden).toBe(true);
  expect(host.querySelector<HTMLElement>("#conteudo-minha-loja")!.hidden).toBe(
    false,
  );
  await clicar("Aparência do app", indice());
  expect(grupo("minha-loja").hidden).toBe(true);
  expect(grupo("aparencia").hidden).toBe(false);
  expect(host.querySelector<HTMLElement>("#conteudo-aparencia")!.hidden).toBe(
    false,
  );
  expect(
    indice().querySelector('[aria-current="true"]')?.textContent,
  ).toContain("Aparência do app");
});
it("Entrega continua sendo porta direta sem trocar o grupo selecionado", async () => {
  await montar();
  await clicar("Entrega e frete", indice());
  expect(navegar).toHaveBeenCalledWith("admin-shipping");
  expect(grupo("minha-loja").hidden).toBe(false);
});
it("Gerenciar seleciona e abre Pagamentos", async () => {
  await montar();
  await clicar("Gerenciar recebimentos");
  expect(grupo("pagamentos").hidden).toBe(false);
  expect(host.querySelector<HTMLElement>("#conteudo-pagamentos")!.hidden).toBe(
    false,
  );
  expect(
    indice().querySelector('[aria-current="true"]')?.textContent,
  ).toContain("Pagamentos");
});
it("Ver o PIX leva também o foco para Pagamentos, sem deixá-lo no grupo oculto", async () => {
  await montar();
  await clicar("Ferramentas", indice());
  const link = [
    ...grupo("ferramentas").querySelectorAll<HTMLButtonElement>("button"),
  ].find((b) => b.textContent?.includes("Ver o PIX em Pagamentos"))!;
  expect(link).toBeDefined();
  link.focus();
  await act(async () => link.click());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  expect(grupo("ferramentas").hidden).toBe(true);
  expect(grupo("pagamentos").hidden).toBe(false);
  expect(document.activeElement?.id).toBe("grupo-de-ajustes-pagamentos");
});
it("trocar grupo e largura preserva a mesma instância e o rascunho não salvo", async () => {
  await montar();
  await clicar("E-mail da loja", grupo("minha-loja"));
  for (
    let n = 0;
    n < 5 && !host.querySelector('input[aria-label="Rascunho de email"]');
    n++
  ) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  const input = host.querySelector<HTMLInputElement>(
    'input[aria-label="Rascunho de email"]',
  )!;
  expect(input).not.toBeNull();
  await act(async () => {
    input.value = "rascunho";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(dirty).toHaveBeenLastCalledWith(true);
  await clicar("Aparência do app", indice());
  await clicar("Minha loja", indice());
  expect(host.querySelector('input[aria-label="Rascunho de email"]')).toBe(
    input,
  );
  expect(input.value).toBe("rascunho");
  await act(async () => {
    estado.desktop = false;
    mudou?.();
  });
  expect(indice()).toBeNull();
  expect(grupo("aparencia").hidden).toBe(false);
  expect(host.querySelector('input[aria-label="Rascunho de email"]')).toBe(
    input,
  );
  expect(dirty).toHaveBeenLastCalledWith(true);
});
it("no celular mantém os seis acordeões fechados e não exibe índice", async () => {
  estado.desktop = false;
  await montar();
  expect(indice()).toBeNull();
  expect(host.querySelectorAll("[data-cabecalho-grupo]")).toHaveLength(6);
  expect(host.querySelector<HTMLElement>("#conteudo-aparencia")!.hidden).toBe(
    true,
  );
  await clicar("Aparência do app");
  expect(host.querySelector<HTMLElement>("#conteudo-aparencia")!.hidden).toBe(
    false,
  );
});
it("não apresenta o índice antes de carregar a configuração", async () => {
  estado.loaded = false;
  await montar();
  expect(indice()).toBeNull();
  expect(
    host.querySelector('[aria-label="Carregando ajustes"]'),
  ).not.toBeNull();
});
