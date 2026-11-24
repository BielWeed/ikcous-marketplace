// @vitest-environment jsdom
//
// A barrinha cinza no topo das folhas do painel era enfeite (aria-hidden, nada
// acontecia). Agora é a alça de verdade (AlcaDaFolha + useArrastarParaFechar):
// puxar para baixo além de 64px ou tocar fecha; um arrasto curto devolve a
// folha sem fechar nem deixar resíduo; e "Ações do pedido" respeita o veto de
// fechar (venda sendo anulada). A animação em si (entrada/saída) só o navegador
// prova — foi medida no Chromium (relatório) e o contrato de classes está aqui.
import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import { FolhaClientes } from "@/components/admin/users/FolhaClientes";
import type { Order } from "@/types";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

const janela = () => document.querySelector<HTMLElement>('[role="dialog"]');
const alca = () =>
  document.querySelector<HTMLElement>('[data-testid="folha-alca"]');
const evento = (tipo: string, y: number) =>
  new MouseEvent(tipo, { bubbles: true, clientY: y });

function Gestao() {
  const [aberta, setAberta] = useState(false);
  return (
    <FolhaClientes
      aberta={aberta}
      aoMudar={setAberta}
      titulo="Gestão de Cliente"
      gatilho={<button type="button">Abrir gestão</button>}
    >
      <p>Conteúdo</p>
    </FolhaClientes>
  );
}

const pedido = (): Order => ({
  id: "pedido-a",
  customer: { name: "Maria Aparecida", whatsapp: "11999999999" },
  items: [
    { productId: "p1", name: "Caneca", quantity: 1, price: 10, image: "" },
  ],
  subtotal: 10,
  total: 10,
  shipping: 0,
  discount: 0,
  status: "shipping",
  paymentMethod: "cash",
  paymentStatus: null,
  createdAt: "2026-10-17T12:00:00Z",
  updatedAt: "2026-10-17T12:00:00Z",
  cancelledAfterShipping: false,
});

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function abrirGestao() {
  await act(async () => {
    raiz.render(<Gestao />);
  });
  await act(async () => {
    hospedeiro.querySelector("button")?.click();
  });
  expect(janela()).not.toBeNull();
}

describe("Gestão de Cliente — a barrinha é alça de verdade", () => {
  it("existe, some para leitor de tela e carrega o contrato de animação (entra de baixo, sai para baixo)", async () => {
    await abrirGestao();
    expect(alca()?.getAttribute("aria-hidden")).toBe("true");
    const classes = janela()!.className;
    expect(classes).toContain("data-[state=open]:slide-in-from-bottom");
    expect(classes).toContain("data-[state=closed]:slide-out-to-bottom");
    // no computador a folha é janela no meio: a compensação do -translate-50%
    // evita a entrada "escorregando de lado" (o keyframe zera o transform).
    expect(classes).toContain("sm:data-[state=open]:slide-in-from-left-1/2");
  });

  it("puxar além de 64px fecha a folha", async () => {
    await abrirGestao();
    await act(async () => {
      alca()!.dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 220));
      window.dispatchEvent(evento("pointerup", 220));
    });
    expect(janela()).toBeNull();
  });

  it("puxar pouco devolve: continua aberta, sem resíduo de transform nem will-change", async () => {
    await abrirGestao();
    await act(async () => {
      alca()!.dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 140));
      window.dispatchEvent(evento("pointerup", 140));
    });
    expect(janela()).not.toBeNull();
    expect(janela()!.style.transform).toBe("");
    expect(janela()!.style.willChange).toBe("");
  });

  it("o clique sintético logo depois do arrasto curto NÃO fecha; um toque depois dele fecha", async () => {
    await abrirGestao();
    await act(async () => {
      alca()!.dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 140));
      window.dispatchEvent(evento("pointerup", 140));
    });
    await act(async () => alca()!.click());
    expect(janela()).not.toBeNull();
    await act(async () => alca()!.click());
    expect(janela()).toBeNull();
  });
});

describe("Ações do pedido — a barrinha é alça de verdade", () => {
  async function abrirAcoes() {
    await act(async () => {
      raiz.render(
        <AdminOrderCard
          order={pedido()}
          viewMode="compact"
          onSelect={vi.fn()}
          onWhatsApp={vi.fn()}
          onRegistrarPagamento={vi.fn()}
          registrandoPagamento={false}
          onStatusChange={async () => {}}
          onReceberAntesDeAvancar={vi.fn()}
        />,
      );
    });
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>(
          'button[aria-label^="Ações do pedido"]',
        )
        ?.click();
    });
    expect(janela()?.textContent).toContain("Ações do pedido");
  }

  it("puxar além de 64px fecha o menu e tocar na barrinha também", async () => {
    await abrirAcoes();
    await act(async () => {
      alca()!.dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 220));
      window.dispatchEvent(evento("pointerup", 220));
    });
    expect(janela()).toBeNull();

    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>(
          'button[aria-label^="Ações do pedido"]',
        )
        ?.click();
    });
    expect(janela()).not.toBeNull();
    await act(async () => alca()!.click());
    expect(janela()).toBeNull();
  });

  it("a entrada compensa o -translate-x-1/2 (antes escorregava ~197px de lado)", async () => {
    await abrirAcoes();
    const classes = janela()!.className;
    expect(classes).toContain("data-[state=open]:slide-in-from-left-1/2");
    expect(classes).toContain("data-[state=closed]:slide-out-to-left-1/2");
    expect(classes).toContain("data-[state=open]:slide-in-from-bottom");
  });
});
