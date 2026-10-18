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

import {
  StatusPagamentoCartao,
  StatusPagamentoPix,
} from "@/views/admin/StatusPagamentoPix";

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

  it("usa o símbolo do PIX e nomeia o estado para o leitor de tela", async () => {
    await renderizar({ ligado: true, chaveOk: true });
    const botao = hospedeiro.querySelector("button")!;
    expect(botao.querySelector("svg.icone-pix")).not.toBeNull();
    expect(
      botao.querySelector("svg.icone-pix")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(botao.querySelector(".lucide-wallet")).toBeNull();
    expect(botao.getAttribute("aria-label")).toBe(
      "Pagamento online (PIX): Funcionando",
    );
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    expect(botao.querySelector(".truncate")).toBeNull();
  });

  it.each([
    {
      estado: "ok",
      ligado: true,
      chaveOk: true,
      texto: "Funcionando",
      verdes: 3,
      vermelhas: 0,
      diagnostico:
        "Isso só confirma que está ligado e com a chave pública da loja.",
    },
    {
      estado: "ok",
      ligado: true,
      chaveOk: false,
      texto: "Chave ausente",
      verdes: 0,
      vermelhas: 1,
      diagnostico: "Salve as chaves de novo em Pagamentos › Mercado Pago.",
    },
    {
      estado: "ok",
      ligado: false,
      chaveOk: true,
      texto: "Desligado",
      verdes: 0,
      vermelhas: 0,
      diagnostico:
        "Para receber com cartão pelo app, ligue crédito ou débito em Formas de pagamento.",
    },
    {
      estado: "carregando",
      ligado: true,
      chaveOk: true,
      texto: "Verificando…",
      verdes: 0,
      vermelhas: 0,
      diagnostico: "Estou lendo a configuração do cartão.",
    },
    {
      estado: "falhou",
      ligado: true,
      chaveOk: true,
      texto: "Não consegui verificar",
      verdes: 0,
      vermelhas: 0,
      diagnostico: "Abra Formas de pagamento para tentar de novo.",
    },
  ] as const)(
    "cartão: $estado, ligado=$ligado, chave=$chaveOk → $texto",
    async ({
      estado,
      ligado,
      chaveOk,
      texto,
      verdes,
      vermelhas,
      diagnostico,
    }) => {
      await act(async () => {
        raiz.render(
          <StatusPagamentoCartao
            estado={estado}
            ligado={ligado}
            chaveOk={chaveOk}
          />,
        );
      });
      const botao = hospedeiro.querySelector("button")!;
      expect(botao.textContent).toContain(texto);
      expect(botao.getAttribute("aria-label")).toBe(
        `Cartão pelo app: ${texto}`,
      );
      expect(botao.getAttribute("aria-expanded")).toBe("false");
      expect(botao.querySelector(".lucide-credit-card")).not.toBeNull();
      expect(botao.querySelectorAll("span.bg-emerald-400")).toHaveLength(
        verdes,
      );
      expect(botao.querySelectorAll("span.bg-red-400")).toHaveLength(vermelhas);
      expect(hospedeiro.textContent).not.toContain(diagnostico);
      expect(botao.querySelector(".truncate")).toBeNull();
      await act(async () => botao.click());
      expect(botao.getAttribute("aria-expanded")).toBe("true");
      const painel = document.getElementById(
        botao.getAttribute("aria-controls")!,
      );
      expect(painel?.textContent).toContain(diagnostico);
      expect(painel?.textContent).not.toMatch(/\btoken\b|\bRPC\b|\bfrota\b/i);
    },
  );

  it("os diagnósticos do PIX e do cartão abrem e recolhem de forma independente", async () => {
    await act(async () => {
      raiz.render(
        <>
          <StatusPagamentoPix ligado chaveOk />
          <StatusPagamentoCartao estado="ok" ligado chaveOk />
        </>,
      );
    });
    const [pix, cartao] = hospedeiro.querySelectorAll("button");
    await act(async () => cartao.click());
    expect(cartao.getAttribute("aria-expanded")).toBe("true");
    expect(pix.getAttribute("aria-expanded")).toBe("false");
    expect(cartao.getAttribute("aria-controls")).not.toBe(
      pix.getAttribute("aria-controls"),
    );
    await act(async () => cartao.click());
    expect(cartao.getAttribute("aria-expanded")).toBe("false");
    expect(pix.getAttribute("aria-expanded")).toBe("false");
  });

  it("ligado com chave: nível 3, rótulo 'Funcionando', diagnóstico recolhido", async () => {
    await renderizar({ ligado: true, chaveOk: true });

    expect(rotulo()).toContain("Funcionando");
    // Diagnóstico só aparece quando o lojista abre.
    expect(hospedeiro.textContent).not.toContain(
      "Ligado e com a chave pública da loja",
    );
    // Termômetro: as 3 barras acesas em verde.
    const barras = hospedeiro.querySelectorAll("span.bg-emerald-400");
    expect(barras.length).toBeGreaterThanOrEqual(3);
  });

  it("ligado SEM chave: rótulo 'Chave ausente' em vermelho; o clique abre o diagnóstico dizendo onde a chave mora", async () => {
    await renderizar({ ligado: true, chaveOk: false });

    expect(rotulo()).toContain("Chave ausente");
    expect(hospedeiro.textContent).not.toContain(
      "falta a chave pública da loja",
    );

    await act(async () => {
      hospedeiro.querySelector("button")!.click();
    });

    // G4 do painel simples: o diagnóstico diz o que houve e o que fazer na
    // língua da loja (onde a chave se salva), sem nome de configuração interna.
    expect(hospedeiro.textContent).toContain("falta a chave pública da loja");
    expect(hospedeiro.textContent).toContain(
      "Salve as chaves de novo em Pagamentos › Mercado Pago",
    );
  });

  it("desligado: rótulo 'Desligado' e diagnóstico fala em pagamento na entrega", async () => {
    await renderizar({ ligado: false, chaveOk: false });

    expect(rotulo()).toContain("Desligado");

    await act(async () => {
      hospedeiro.querySelector("button")!.click();
    });

    expect(hospedeiro.textContent).toContain("O cliente paga na entrega");
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
    expect(hospedeiro.textContent).toContain("falta a chave pública da loja");

    await act(async () => {
      botao.click();
    });
    // A saída é animada (~200ms): o texto some do DOM só no fim dela.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(hospedeiro.textContent).not.toContain(
      "falta a chave pública da loja",
    );
  });
});
