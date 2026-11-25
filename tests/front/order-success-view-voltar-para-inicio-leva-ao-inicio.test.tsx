// @vitest-environment jsdom
//
// Buraco de prova achado por MUTAÇÃO em `OrderSuccessView.tsx`: trocar o
// destino do botão "Voltar para Início" (de "home" para "orders") não derrubava
// nenhum teste — os vizinhos só clicavam em "Meus Pedidos". Para o convidado
// (que não tem "Meus Pedidos") esse é o ÚNICO botão da tela: se ele levasse
// aos pedidos, cairia numa busca que exige o e-mail que ele nunca informou.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const onNavigate = vi.fn();
let usuario: { id: string } | null = null;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { whatsappNumber: "34999998888" } }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function botaoComTexto(raiz: ParentNode, texto: string) {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
}

describe("OrderSuccessView — 'Voltar para Início' leva ao início", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeAll(async () => {
    await import("@/views/customer/OrderSuccessView");
  }, 60_000);

  beforeEach(() => {
    onNavigate.mockClear();
    usuario = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function abrir() {
    const { OrderSuccessView } = await import(
      "@/views/customer/OrderSuccessView"
    );
    await act(async () => {
      raiz.render(<OrderSuccessView onNavigate={onNavigate} />);
    });
  }

  it("convidado: o único botão da tela volta ao início, uma vez, e não a 'orders'", async () => {
    await abrir();
    const botoes = [...hospedeiro.querySelectorAll("button")];
    expect(botoes).toHaveLength(1);
    await act(async () => {
      botaoComTexto(hospedeiro, "Voltar para Início")?.click();
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("home");
  });

  it("cliente com conta: cada botão leva ao seu destino (início e pedidos não se trocam)", async () => {
    usuario = { id: "u1" };
    await abrir();
    await act(async () => {
      botaoComTexto(hospedeiro, "Voltar para Início")?.click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith("home");
    await act(async () => {
      botaoComTexto(hospedeiro, "Meus Pedidos")?.click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith("orders");
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });
});
