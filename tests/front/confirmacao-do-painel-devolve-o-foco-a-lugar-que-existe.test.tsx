// @vitest-environment jsdom
//
// Caça de leitor de tela: ao fechar a pergunta "tem certeza?" (useConfirmarAcao)
// o Radix devolve o foco ao botão que a abriu — mas no "sim" esse botão fica
// desligado ("Devolvendo…") ou some (pedido cancelado), o foco não entra nele
// e cai no body: o leitor de tela fica sem lugar. O gancho agora leva o foco ao
// alvo estável que o chamador informa (o título do cartão), como o
// AdminOrderCard já fazia na folha de ações.
import { act, useRef, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useConfirmarAcao } from "@/hooks/useConfirmarAcao";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

type DepoisDoSim = "desliga" | "some" | "nada";

function Cartao({ depoisDoSim }: { depoisDoSim: DepoisDoSim }) {
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const { confirmar, dialogo } = useConfirmarAcao({ alvoDoFoco: tituloRef });
  const [ocupado, setOcupado] = useState(false);
  return (
    <div>
      <h3 ref={tituloRef} tabIndex={-1}>
        Devolução de dinheiro
      </h3>
      {!(ocupado && depoisDoSim === "some") && (
        <button
          type="button"
          disabled={ocupado && depoisDoSim === "desliga"}
          onClick={async () => {
            const ok = await confirmar({
              titulo: "Devolver o dinheiro ao cliente?",
              texto: "Não dá para desfazer.",
              verbo: "Devolver R$ 50,00",
            });
            if (ok) setOcupado(true);
          }}
        >
          {ocupado ? "Devolvendo…" : "Devolver R$ 50,00"}
        </button>
      )}
      {dialogo}
    </div>
  );
}

function botaoDaJanela(texto: string): HTMLButtonElement {
  const janela = document.querySelector('[data-testid="confirmar-acao"]')!;
  const botao = [...janela.querySelectorAll("button")].find(
    (b) => b.textContent === texto,
  );
  expect(botao, `botão "${texto}" da janela`).toBeTruthy();
  return botao!;
}

async function abrirEResponder(depoisDoSim: DepoisDoSim, resposta: string) {
  await act(async () => raiz.render(<Cartao depoisDoSim={depoisDoSim} />));
  const origem = hospedeiro.querySelector("button")!;
  await act(async () => {
    origem.focus();
    origem.click();
  });
  await act(async () => botaoDaJanela(resposta).click());
  // O Radix devolve o foco num setTimeout depois de desmontar a janela.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return origem;
}

describe("useConfirmarAcao — para onde vai o foco ao fechar", () => {
  it("no 'sim' com o botão de origem desligado, o foco vai ao título do cartão", async () => {
    const origem = await abrirEResponder("desliga", "Devolver R$ 50,00");
    expect(origem.disabled).toBe(true);
    expect(document.activeElement).toBe(hospedeiro.querySelector("h3"));
  });

  it("no 'sim' com o botão de origem fora da tela, o foco vai ao título do cartão", async () => {
    const origem = await abrirEResponder("some", "Devolver R$ 50,00");
    expect(origem.isConnected).toBe(false);
    expect(document.activeElement).toBe(hospedeiro.querySelector("h3"));
  });

  it("no 'Voltar' o foco volta ao botão que abriu a pergunta", async () => {
    const origem = await abrirEResponder("desliga", "Voltar");
    expect(origem.disabled).toBe(false);
    expect(document.activeElement).toBe(origem);
  });

  it("no 'sim' com o botão ainda ligado, o foco volta a ele", async () => {
    const origem = await abrirEResponder("nada", "Devolver R$ 50,00");
    expect(document.activeElement).toBe(origem);
  });
});
