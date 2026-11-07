// @vitest-environment jsdom
import { AdminErrorState } from "@/components/admin/AdminErrorState";
import { AddressForm } from "@/components/ui/custom/AddressForm";
import { ProductQA } from "@/components/ui/custom/ProductQA";
import { AdminLoginView } from "@/views/admin/AdminLoginView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  loading: true,
  error: null as string | null,
  login: vi.fn(),
  getQuestionsByProduct: vi.fn(),
  subscribeToQuestions: vi.fn(() => () => {}),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, login: estado.login }),
}));
vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [],
    loading: estado.loading,
    error: estado.error,
    getQuestionsByProduct: estado.getQuestionsByProduct,
    subscribeToQuestions: estado.subscribeToQuestions,
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingCoverage: "local", originCep: "38500-000" },
    isLoaded: true,
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  estado.loading = true;
  estado.error = null;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function digitar(id: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(id)!;
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
it("perguntas anunciam carregamento e depois falha, sem anunciar lista vazia", async () => {
  await act(async () => root.render(<ProductQA productId="p1" />));
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    "Sincronizando conversas",
  );
  estado.loading = false;
  estado.error = "Falha de rede";
  await act(async () => root.render(<ProductQA productId="p1" />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Não conseguimos carregar as perguntas",
  );
  expect(
    host.querySelector('[role="status"]')?.textContent ?? "",
  ).not.toContain("Sincronizando");
});
it("perguntas anunciam falha mesmo quando o carregamento não foi visto", async () => {
  estado.loading = false;
  estado.error = "Falha de rede";
  await act(async () => root.render(<ProductQA productId="p1" />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Não conseguimos carregar as perguntas",
  );
});
it("erro do painel é anunciado e mantém o botão para tentar novamente", () => {
  const tentar = vi.fn();
  act(() => root.render(<AdminErrorState onRetry={tentar} />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Algo deu errado",
  );
  act(() => host.querySelector("button")!.click());
  expect(tentar).toHaveBeenCalledOnce();
});
it("entrar no painel mantém um nome enquanto a rede responde", async () => {
  let terminar!: (valor: { success: boolean }) => void;
  estado.login.mockReturnValue(
    new Promise((resolve) => {
      terminar = resolve;
    }),
  );
  await act(async () =>
    root.render(<AdminLoginView onLogin={vi.fn()} onNavigate={vi.fn()} />),
  );
  act(() => {
    digitar("#admin-email", "teste@example.com");
    digitar("#admin-password", "senha-ficticia");
  });
  act(() =>
    host
      .querySelector<HTMLFormElement>("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  const botao = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  expect(botao.disabled).toBe(true);
  expect(botao.textContent).toContain("Entrando");
  expect(botao.getAttribute("aria-busy")).toBe("true");
  await act(async () => terminar({ success: true }));
  expect(botao.textContent).toContain("Entrar no Sistema");
});
it("salvar endereço mantém o nome durante o envio", async () => {
  let terminar!: () => void;
  const salvar = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        terminar = resolve;
      }),
  );
  await act(async () =>
    root.render(
      <AddressForm
        onSubmit={salvar}
        onCancel={vi.fn()}
        initialData={{
          id: "e1",
          user_id: "u1",
          name: "Casa",
          cep: "38500-000",
          street: "Rua de teste",
          number: "1",
          complement: "",
          neighborhood: "Centro",
          city: "Cidade",
          state: "MG",
          reference: "",
          recipient_name: "Pessoa de teste",
          is_default: true,
        }}
      />,
    ),
  );
  await act(async () => {
    host
      .querySelector<HTMLFormElement>("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(salvar).toHaveBeenCalledOnce();
  const botao = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  expect(botao.disabled).toBe(true);
  expect(botao.textContent).toContain("Salvando endereço");
  expect(botao.getAttribute("aria-busy")).toBe("true");
  await act(async () => terminar());
  expect(botao.textContent).toContain("Salvar endereço");
});
