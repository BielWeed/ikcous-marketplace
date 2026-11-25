// @vitest-environment jsdom
//
// Privacidade e meus dados — bordas sem guarda:
//  1. A linha "E-mail pedido:" só aparece no pedido de CORREÇÃO DE E-MAIL em
//     aberto (que tem e-mail novo); o pedido de exclusão em aberto não a mostra.
//  2. Com o pedido sendo gravado, a tecla Esc NÃO fecha a pergunta (o pedido
//     ainda está a caminho; fechar mostraria uma tela sem resposta).
//  3. O formulário do e-mail segura o envio do navegador (nada de recarregar a
//     página): o evento "submit" chega com o comportamento padrão cancelado.
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
const pergunta = () => document.querySelector('[role="alertdialog"]');

let raiz: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.resetAllMocks();
  order.mockResolvedValue({ data: [], error: null });
  host = document.createElement("div");
  document.body.append(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
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

function digitarEmail(valor: string) {
  const campo = document.getElementById(
    "privacidade-email-novo",
  ) as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Privacidade — linha do e-mail pedido", () => {
  it("pedido de exclusão em aberto não mostra 'E-mail pedido'; o de e-mail mostra o endereço", async () => {
    order.mockResolvedValue({
      data: [
        {
          id: "p-1",
          user_id: "conta-inventada",
          tipo: "excluir_conta",
          email_novo: null,
          situacao: "aberto",
          criado_em: "2026-11-06T12:00:00Z",
        },
      ],
      error: null,
    });
    await montar();
    expect(host.textContent).toContain("Pedido enviado em");
    expect(host.textContent).not.toContain("E-mail pedido");

    order.mockResolvedValue({
      data: [
        {
          id: "p-2",
          user_id: "conta-inventada",
          tipo: "corrigir_email",
          email_novo: "novo@example.com",
          situacao: "aberto",
          criado_em: "2026-11-06T12:00:00Z",
        },
      ],
      error: null,
    });
    act(() => raiz.unmount());
    raiz = createRoot(host);
    await montar();
    expect(host.textContent).toContain("E-mail pedido: novo@example.com");
  });
});

describe("Privacidade — pergunta do e-mail", () => {
  async function abrirPergunta() {
    await montar();
    await act(async () => botao("Corrigir meu e-mail").click());
    expect(pergunta()).not.toBeNull();
  }

  it("o formulário segura o envio do navegador (submit chega cancelado)", async () => {
    await abrirPergunta();
    digitarEmail("novo@example.com");
    single.mockReturnValue(new Promise(() => {}));
    const formulario = document.getElementById(
      "form-email-da-conta",
    ) as HTMLFormElement;
    const evento = new Event("submit", { bubbles: true, cancelable: true });
    await act(async () => {
      formulario.dispatchEvent(evento);
    });
    expect(evento.defaultPrevented).toBe(true);
  });

  it("com o pedido sendo gravado, Esc não fecha a pergunta", async () => {
    single.mockReturnValue(new Promise(() => {}));
    await abrirPergunta();
    digitarEmail("novo@example.com");
    await act(async () => botao("Enviar pedido").click());
    expect(insert).toHaveBeenCalledTimes(1);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(pergunta()).not.toBeNull();
  });

  it("sem envio em andamento, Esc fecha a pergunta (controle)", async () => {
    await abrirPergunta();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(pergunta()).toBeNull();
  });
});
