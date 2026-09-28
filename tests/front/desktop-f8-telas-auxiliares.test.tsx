// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({
    notifications: [],
    markAllAsRead: vi.fn(),
    deleteNotification: vi.fn(),
    markAsRead: vi.fn(),
  }),
}));
const estado = vi.hoisted(() => ({
  computador: false,
  config: {
    storeName: "Loja de teste",
    businessHours: "Segunda a sexta",
    whatsappNumber: "11999999999",
    storeCity: "São Paulo",
    storeState: "SP",
    storeAddress: "Rua das Flores, 10",
    originCep: "01001-000",
    storeDescription: "<p>Descrição da loja</p>",
  } as Record<string, string | null> | null,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config }),
}));
vi.mock("@/hooks/useTelaDeComputador", () => ({
  useTelaDeComputador: () => estado.computador,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    login: vi.fn(),
    signUp: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    resendConfirmationEmail: vi.fn(),
    isPasswordRecovery: false,
    setIsPasswordRecovery: vi.fn(),
  }),
}));
// @ts-expect-error flag de teste do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let host: HTMLDivElement;
beforeEach(() => {
  estado.computador = false;
  estado.config = {
    storeName: "Loja de teste",
    businessHours: "Segunda a sexta",
    whatsappNumber: "11999999999",
    storeCity: "São Paulo",
    storeState: "SP",
    storeAddress: "Rua das Flores, 10",
    originCep: "01001-000",
    storeDescription: "<p>Descrição da loja</p>",
  };
  host = document.createElement("div");
  document.body.append(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

it("limita notificações a 768px só no computador", async () => {
  const { NotificationsView } = await import(
    "@/views/customer/NotificationsView"
  );
  await act(async () => raiz.render(<NotificationsView />));
  const pagina = host.firstElementChild as HTMLElement;
  expect(classesDoCelular(pagina.className)).toBe(
    "pb-customer flex min-h-full flex-col bg-zinc-50/40 dark:bg-zinc-950/40",
  );
  expect(pagina.classList.contains("lg:max-w-3xl")).toBe(true);
  expect(pagina.classList.contains("lg:mx-auto")).toBe(true);
});

it("monta a faixa e os cartões completos de Sobre no computador", async () => {
  estado.computador = true;
  const { AboutStoreView } = await import("@/views/customer/AboutStoreView");
  await act(async () => raiz.render(<AboutStoreView />));

  const conteudo = host.firstElementChild!.firstElementChild as HTMLElement;
  expect(conteudo.className).toContain("max-w-5xl");
  const faixa = host.querySelector("header")!;
  expect(faixa.className).toContain("bg-zinc-900");
  expect(faixa.querySelector("div")?.className).toContain("size-24");
  expect(faixa.querySelector("div")?.className).toContain("rounded-3xl");
  expect(faixa.querySelector("h1")?.className).toContain("text-[40px]");
  expect(faixa.textContent).toContain("A marca por trás deste app.");
  expect(host.querySelector("section")?.parentElement?.className).toContain(
    "grid-cols-[minmax(0,1fr)_380px]",
  );
  expect(host.querySelector("section div")?.className).toContain("text-[17px]");
  expect(host.textContent).toContain("SOBRE A LOJA");
  expect(host.textContent).toContain("QUEM SOMOS");
  const contato = host.querySelector("aside");
  expect(contato?.className).toContain("sticky top-24");
  expect(contato?.textContent).toContain("Horário de atendimento");
  expect(contato?.textContent).toContain("São Paulo, SP");
  expect(contato?.textContent).toContain("Rua das Flores, 10");
  expect(contato?.textContent).toContain("Localização aproximada");
  expect(contato?.textContent).toContain("Falar no WhatsApp");
  expect(contato?.textContent).toContain("Abrir no Google Maps");
  expect(
    host.querySelector("button[aria-label='Falar com a loja no WhatsApp']"),
  ).toBeNull();
});

it("omite o cartão de contato para uma loja mínima no computador", async () => {
  estado.computador = true;
  estado.config = {
    storeName: "Loja mínima",
    storeDescription: "<p>Somente a história da marca.</p>",
  };
  const { AboutStoreView } = await import("@/views/customer/AboutStoreView");
  await act(async () => raiz.render(<AboutStoreView />));

  expect(host.querySelector("aside")).toBeNull();
  expect(host.textContent).not.toContain("Horário de atendimento");
  expect(host.textContent).not.toContain("Onde estamos");
  expect(host.textContent).not.toContain("Localização aproximada");
  expect(host.textContent).not.toContain("Falar no WhatsApp");
  expect(host.textContent).not.toContain("Abrir no Google Maps");
  expect(host.textContent).toContain("Somente a história da marca.");
  expect(host.querySelector("section")?.parentElement?.className).toContain(
    "grid-cols-1",
  );
});

it("mantém o JSX e as classes de Sobre no celular", async () => {
  const { AboutStoreView } = await import("@/views/customer/AboutStoreView");
  await act(async () => raiz.render(<AboutStoreView />));
  const conteudo = host.firstElementChild!.firstElementChild as HTMLElement;
  expect(classesDoCelular(conteudo.className)).toBe(
    "mx-auto max-w-md space-y-6 px-4 py-6 sm:px-6 sm:py-8",
  );
  expect(host.querySelector("header")).toBeNull();
  expect(host.querySelector("aside")).toBeNull();
  const botao = host.querySelector<HTMLButtonElement>(
    "button[aria-label='Falar com a loja no WhatsApp']",
  )!;
  expect(classesDoCelular(botao.className)).toBe(
    "fixed right-4 z-[115] flex size-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/40 transition-transform hover:bg-emerald-700 active:scale-95",
  );
  expect(botao.style.bottom).toContain("--nav-height");
});

it("centraliza login, cadastro e recuperação sem alterar as classes do celular", async () => {
  const { AuthView } = await import("@/views/shared/AuthView");
  await act(async () => raiz.render(<AuthView onNavigate={() => {}} />));
  const pagina = host.firstElementChild as HTMLElement;
  expect(classesDoCelular(pagina.className)).toBe(
    "pb-customer relative flex min-h-full w-full flex-shrink-0 flex-col items-center overflow-x-hidden bg-white p-6 sm:pb-8",
  );
  const coluna = pagina.lastElementChild as HTMLElement;
  expect(classesDoCelular(coluna.className)).toBe(
    "z-10 flex w-full max-w-[440px] flex-1 flex-col justify-between",
  );
  expect(coluna.classList.contains("lg:flex-none")).toBe(true);
  expect(coluna.classList.contains("lg:my-auto")).toBe(true);
  expect(classesDoCelular(coluna.firstElementChild!.className)).toBe(
    "flex flex-1 flex-col justify-center sm:justify-start",
  );
  for (const [botao, titulo] of [
    ["CADASTRO", "Criar Conta"],
    ["IDENTIFICAR-SE", "Bem-vindo"],
    ["Esqueceu?", "Recuperar"],
  ]) {
    const acao = [...host.querySelectorAll("button")].find(
      (el) => el.textContent?.trim() === botao,
    )!;
    await act(async () => acao.click());
    expect(host.querySelector("h1")?.textContent).toContain(titulo);
    expect(pagina.lastElementChild).toBe(coluna);
    expect(coluna.classList.contains("lg:my-auto")).toBe(true);
  }
});

it("renderiza o login com config nula sem derrubar a tela", async () => {
  estado.config = null;
  const { AuthView } = await import("@/views/shared/AuthView");
  await act(async () => raiz.render(<AuthView onNavigate={() => {}} />));
  expect(host.querySelector("h1")?.textContent).toContain("Bem-vindo");
});
