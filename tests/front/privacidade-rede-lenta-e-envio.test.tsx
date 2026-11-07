// @vitest-environment jsdom
import { PrivacidadeEMeusDados } from "@/components/account/PrivacidadeEMeusDados";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { order, insert, single } = vi.hoisted(() => ({
  order: vi.fn(),
  insert: vi.fn(),
  single: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ order }) }),
      insert: (...args: unknown[]) => {
        insert(...args);
        return { select: () => ({ single }) };
      },
    }),
  },
}));
// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class Observador {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", Observador);
const botao = (texto: string) =>
  [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  )!;
describe("Privacidade: rede lenta e formulário de e-mail", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    order.mockResolvedValue({ data: [], error: null });
    single.mockResolvedValue({
      data: {
        id: "pedido-inventado",
        user_id: "conta-inventada",
        tipo: "corrigir_email",
        email_novo: "novo@example.com",
        situacao: "aberto",
        criado_em: "2026-11-06T12:00:00Z",
      },
      error: null,
    });
    host = document.createElement("div");
    document.body.append(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.useRealTimers();
  });
  async function montar() {
    await act(async () =>
      raiz.render(
        <PrivacidadeEMeusDados
          userId="conta-inventada"
          emailAtual="antes@example.com"
        />,
      ),
    );
  }
  it("leitura pendurada vira erro com nova tentativa; resposta velha não substitui a nova", async () => {
    let concluir!: (valor: unknown) => void;
    order.mockReturnValueOnce(
      new Promise((resolve) => {
        concluir = resolve;
      }),
    );
    await montar();
    await act(async () => vi.advanceTimersByTimeAsync(15001));
    expect(host.textContent).not.toContain("Verificando seus pedidos");
    const retry = botao("Ver de novo meus pedidos");
    expect(retry).toBeDefined();
    await act(async () => retry!.click());
    expect(botao("Corrigir meu e-mail")).toBeDefined();
    await act(async () => concluir({ data: null, error: { code: "falha" } }));
    expect(botao("Corrigir meu e-mail")).toBeDefined();
  });
  it.each(["excluir_conta", "corrigir_email"] as const)(
    "%s: envio pendurado libera Voltar, avisa a incerteza e relê o pedido gravado",
    async (tipo) => {
      single.mockReturnValue(new Promise(() => {}));
      await montar();
      await act(async () =>
        botao(
          tipo === "excluir_conta" ? "Pedir exclusão" : "Corrigir meu e-mail",
        ).click(),
      );
      if (tipo === "corrigir_email") {
        const email = document.getElementById(
          "privacidade-email-novo",
        ) as HTMLInputElement;
        act(() => {
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )!.set!.call(email, "novo@example.com");
          email.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }
      order.mockResolvedValue({
        data: [
          {
            id: "pedido-gravado",
            user_id: "conta-inventada",
            tipo,
            situacao: "aberto",
            criado_em: "2026-11-07T12:00:00Z",
          },
        ],
        error: null,
      });
      await act(async () =>
        botao(
          tipo === "excluir_conta" ? "Sim, pedir exclusão" : "Enviar pedido",
        ).click(),
      );
      expect(botao("Voltar").disabled).toBe(true);
      await act(async () => vi.advanceTimersByTimeAsync(15_001));
      expect(botao("Voltar").disabled).toBe(false);
      expect(document.body.textContent).toContain(
        "Confira se o pedido aparece na lista antes de tentar de novo.",
      );
      expect(document.body.textContent).not.toContain("não foi enviado");
      expect(order).toHaveBeenCalledTimes(2);
      await act(async () => botao("Voltar").click());
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(host.textContent).toContain("Pedido enviado em");
      expect(
        botao(
          tipo === "excluir_conta" ? "Pedir exclusão" : "Corrigir meu e-mail",
        ),
      ).toBeUndefined();
    },
  );
  it("libera a janela mesmo se a releitura também ficar pendurada e permite reenviar depois", async () => {
    single.mockReturnValue(new Promise(() => {}));
    await montar();
    await act(async () => botao("Pedir exclusão").click());
    order.mockReturnValue(new Promise(() => {}));
    await act(async () => botao("Sim, pedir exclusão").click());
    await act(async () => vi.advanceTimersByTimeAsync(15_001));
    expect(botao("Voltar").disabled).toBe(false);
    expect(botao("Sim, pedir exclusão").disabled).toBe(false);
    // A ref interna também precisa ser liberada: uma nova tentativa chega ao banco.
    await act(async () => botao("Sim, pedir exclusão").click());
    expect(insert).toHaveBeenCalledTimes(2);
  });
  it("Enter repetido enquanto o pedido aguarda não duplica nem fecha a confirmação", async () => {
    single.mockReturnValue(new Promise(() => {}));
    await montar();
    await act(async () => botao("Corrigir meu e-mail").click());
    const email = document.getElementById(
      "privacidade-email-novo",
    ) as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(email, "novo@example.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = email.form!;
    await act(async () => form.requestSubmit());
    expect(insert).toHaveBeenCalledTimes(1);
    expect(email.disabled).toBe(true);
    // O botão já está desabilitado. A proteção do handler também precisa
    // recusar um submit repetido, sem tratar o pedido EM VOO como duplicado.
    await act(async () =>
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    expect(insert).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(email.isConnected).toBe(true);
  });
  it("o formulário do e-mail tem um único submit e nunca pede exclusão", async () => {
    await montar();
    await act(async () => botao("Corrigir meu e-mail").click());
    const email = document.getElementById(
      "privacidade-email-novo",
    ) as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(email, "novo@example.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(email.form).not.toBeNull();
    const enviar = botao("Enviar pedido");
    expect(enviar.type).toBe("submit");
    expect(enviar.form).toBe(email.form);
    await act(async () => email.form!.requestSubmit(enviar));
    expect(insert).toHaveBeenCalledExactlyOnceWith({
      user_id: "conta-inventada",
      tipo: "corrigir_email",
      email_novo: "novo@example.com",
    });
  });
});
