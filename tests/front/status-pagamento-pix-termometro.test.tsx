// @vitest-environment jsdom
//
// Pedido do Gabriel (02/09, foto dos Ajustes): o bloco "Pagamento online
// (PIX)" era um card gigante com três parágrafos de diagnóstico — para algo
// que é só um TERMÔMETRO de status. O card virou uma linha compacta com
// termômetro de 3 níveis (▮▮▮ verde funcionando / ▮▯▯ vermelho chave
// ausente / ▯▯▯ cinza desligado) e o diagnóstico completo a um clique.
//
// Este arquivo prova os TRÊS estados do componente puro
// (`ligado`/`chaveOk` chegam por prop — o componente não lê env) e o
// comportamento de expandir/recolher o diagnóstico.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StatusPagamentoPix } from "@/views/admin/StatusPagamentoPix";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("StatusPagamentoPix — termômetro compacto do pagamento online", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  async function renderizar(props: { ligado: boolean; chaveOk: boolean }) {
    await act(async () => {
      raiz.render(<StatusPagamentoPix {...props} />);
    });
  }

  const rotulo = () =>
    hospedeiro.querySelector<HTMLButtonElement>("button")!.textContent ?? "";

  it("ligado com chave: nível 3, rótulo 'Funcionando', diagnóstico recolhido", async () => {
    await renderizar({ ligado: true, chaveOk: true });

    expect(rotulo()).toContain("Funcionando");
    // Diagnóstico só aparece quando o lojista abre.
    expect(hospedeiro.textContent).not.toContain("MP_ACCESS_TOKEN");
    // Termômetro: as 3 barras acesas em verde.
    const barras = hospedeiro.querySelectorAll("span.bg-emerald-400");
    expect(barras.length).toBeGreaterThanOrEqual(3);
  });

  it("ligado SEM chave: rótulo 'Chave ausente' em vermelho; o clique abre o diagnóstico com o nome da variável", async () => {
    await renderizar({ ligado: true, chaveOk: false });

    expect(rotulo()).toContain("Chave ausente");
    expect(hospedeiro.textContent).not.toContain("VITE_MP_PUBLIC_KEY");

    await act(async () => {
      hospedeiro.querySelector("button")!.click();
    });

    expect(hospedeiro.textContent).toContain("VITE_MP_PUBLIC_KEY");
    expect(hospedeiro.textContent).toContain("antes de divulgar a loja");
  });

  it("desligado: rótulo 'Desligado' e diagnóstico fala em pagamento na entrega", async () => {
    await renderizar({ ligado: false, chaveOk: false });

    expect(rotulo()).toContain("Desligado");

    await act(async () => {
      hospedeiro.querySelector("button")!.click();
    });

    expect(hospedeiro.textContent).toContain("pagamento na entrega");
  });

  it("desligado não herda cor de problema: sem vermelho nem verde no rótulo", async () => {
    await renderizar({ ligado: false, chaveOk: true });

    const textoRotulo = hospedeiro.querySelector("button span span");
    expect(hospedeiro.textContent).toContain("Desligado");
    // O estado desligado é neutro (zinc) — não é erro, não é sucesso.
    expect(textoRotulo?.className).not.toContain("text-red-400");
    expect(textoRotulo?.className).not.toContain("text-emerald-400");
  });

  it("segundo clique recolhe o diagnóstico de volta", async () => {
    await renderizar({ ligado: true, chaveOk: false });

    const botao = hospedeiro.querySelector("button")!;
    await act(async () => {
      botao.click();
    });
    expect(hospedeiro.textContent).toContain("VITE_MP_PUBLIC_KEY");

    await act(async () => {
      botao.click();
    });
    // A saída é animada (~200ms): o texto some do DOM só no fim dela.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(hospedeiro.textContent).not.toContain("VITE_MP_PUBLIC_KEY");
  });
});
