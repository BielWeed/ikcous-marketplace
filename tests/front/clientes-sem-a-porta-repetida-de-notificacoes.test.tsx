// @vitest-environment jsdom
//
// O Gabriel apontou em 24/08/2026 que a tela de Notificacoes do painel
// "esta duplicada". Medido no painel dele rodando, ele estava certo — mas o
// que se repetia nao era a tela, e sim as PORTAS para ela:
//
//   porta                                   abre                      igual?
//   sino da barra de cima                   Notificacoes, todos       —
//   cartao "Disparo Push" (tela Clientes)   Notificacoes, todos       IDENTICA
//   botao "Push" da sidebar (desktop)       Notificacoes, todos       (e o menu)
//   "Notificacao Push" no menu do cliente   Notificacoes MIRANDO      diferente
//                                           aquele cliente
//
// O cartao "Disparo Push" chamava `onNavigate("admin-push")` SEM id, entao
// entregava exatamente o que o sino ja entrega, ocupando metade da faixa de
// cima de uma tela cheia. Ele saiu. O menu do cliente FICOU, porque passa
// `customer.id` e a tela muda de modo com ele — tirar aquele custaria a
// funcao de avisar uma pessoa so.
//
// O teste de baixo prende as tres coisas de uma vez: a porta repetida sumiu,
// a porta que sobrou continua funcionando, e o cartao que ficou nao herdou a
// grade de dois lugares (senao ele fica torto, com meia largura e um buraco
// do lado).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CustomerBanners } from "@/components/admin/dashboard/CustomerBanners";
import type { View } from "@/types";

describe("a tela de Clientes nao repete mais a porta de Notificacoes", () => {
  let container: HTMLDivElement;
  let root: Root;
  let idas: Array<{ view: View; id?: string }>;

  function clicar(el: Element | null) {
    act(() => {
      el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  beforeEach(() => {
    idas = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <CustomerBanners
          onNavigate={(view: View, id?: string) => idas.push({ view, id })}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("nenhum cartao daqui leva mais para a tela de Notificacoes", () => {
    const cartoes = [...container.querySelectorAll('[role="button"]')];
    for (const cartao of cartoes) {
      clicar(cartao);
    }

    expect(idas.filter((ida) => ida.view === "admin-push")).toEqual([]);
  });

  it("nao sobrou nenhum texto de disparo de push na tela", () => {
    expect(container.textContent).not.toMatch(/disparo|push/i);
  });

  it("o cartao de Canais de Atendimento continua abrindo o que abria", () => {
    const cartoes = [...container.querySelectorAll('[role="button"]')];

    expect(cartoes).toHaveLength(1);
    clicar(cartoes[0]);
    expect(idas).toEqual([{ view: "admin-whatsapp-config", id: undefined }]);
  });

  it("o cartao que ficou ocupa a linha toda, nao meia grade", () => {
    const grade = container.firstElementChild as HTMLElement;

    expect(grade.className).not.toMatch(/grid-cols-2/);
  });
});
