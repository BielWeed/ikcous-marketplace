// @vitest-environment jsdom
import { CartaoDaAssinatura } from "@/components/admin/inicio/CartaoDaAssinatura";
import type { AssinaturaDaLoja } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let tela: HTMLDivElement;
let raiz: Root;
beforeEach(() => {
  // 13/11/2026, meio-dia em Brasília: só o relógio é falso, os timers não.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-13T15:00:00Z"));
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
});
afterEach(() => {
  vi.useRealTimers();
  act(() => raiz.unmount());
  tela.remove();
});

const assinatura: AssinaturaDaLoja = {
  plano: "Plano de teste",
  status: "ativa",
  valorMensal: null,
  ciclo: null,
  inicioEm: null,
  proximaCobrancaEm: null,
  testeAte: null,
  recursos: [],
  gerenciarUrl: "https://example.com/assinatura",
  suporteWhatsapp: "34999999999",
  atualizadoEm: null,
};

it("reserva o glifo oficial ao suporte sem trocar o destino de gerenciar a assinatura", () => {
  act(() =>
    raiz.render(
      <CartaoDaAssinatura
        assinatura={assinatura}
        lida
        carregando={false}
        erro={null}
        onTentarDeNovo={() => undefined}
      />,
    ),
  );
  const suporte = tela.querySelector<HTMLAnchorElement>(
    'a[href="https://wa.me/5534999999999"]',
  );
  expect(suporte?.textContent).toContain("Suporte pelo WhatsApp");
  expect(suporte?.classList.contains("min-h-11")).toBe(true);
  expect(suporte?.getAttribute("target")).toBe("_blank");
  const svg = suporte?.querySelector("svg");
  expect(svg?.getAttribute("fill")).toBe("currentColor");
  expect(svg?.getAttribute("aria-hidden")).toBe("true");
  expect(svg?.querySelector("path")?.getAttribute("d")).toMatch(
    /^M17\.472 14\.382/,
  );
  const gerenciar = tela.querySelector<HTMLAnchorElement>(
    'a[href="https://example.com/assinatura"]',
  );
  expect(gerenciar?.textContent).toContain("Gerenciar assinatura");
  expect(gerenciar?.querySelector("svg.lucide-external-link")).not.toBeNull();
  expect(tela.textContent).toContain("Plano ativo");
});

function desenhar(parcial: Partial<AssinaturaDaLoja>) {
  act(() =>
    raiz.render(
      <CartaoDaAssinatura
        assinatura={{ ...assinatura, ...parcial }}
        lida
        carregando={false}
        erro={null}
        onTentarDeNovo={() => undefined}
      />,
    ),
  );
}

it("atrasada mostra 'Em aberto desde' com a data passada e o aviso de regularizar", () => {
  desenhar({ status: "atrasada", proximaCobrancaEm: "2026-09-10" });
  expect(tela.textContent).toContain("Em aberto desde");
  expect(tela.textContent).toContain("10/09/2026");
  expect(tela.textContent).not.toContain("Próxima cobrança");
  expect(tela.textContent).toContain("Regularize a assinatura");
});

it("atrasada sem data não inventa linha de data", () => {
  desenhar({ status: "atrasada", proximaCobrancaEm: null });
  expect(tela.textContent).not.toContain("Em aberto desde");
  expect(tela.textContent).toContain("Regularize a assinatura");
});

it("ativa com a data já passada esconde a linha em vez de mostrar data velha", () => {
  desenhar({ status: "ativa", proximaCobrancaEm: "2026-11-12" });
  expect(tela.textContent).not.toContain("Próxima cobrança");
  expect(tela.textContent).not.toContain("12/11/2026");
});

it("pendente com a data já passada esconde a linha, mas mantém o aviso", () => {
  desenhar({ status: "pendente", proximaCobrancaEm: "2026-10-01" });
  expect(tela.textContent).not.toContain("Próxima cobrança");
  expect(tela.textContent).not.toContain("01/10/2026");
  expect(tela.textContent).toContain("Regularize a assinatura");
});

it("ativa com a data de hoje ou futura mostra 'Próxima cobrança'", () => {
  desenhar({ status: "ativa", proximaCobrancaEm: "2026-11-13" });
  expect(tela.textContent).toContain("Próxima cobrança");
  expect(tela.textContent).toContain("13/11/2026");
  desenhar({ status: "ativa", proximaCobrancaEm: "2026-12-05" });
  expect(tela.textContent).toContain("Próxima cobrança");
  expect(tela.textContent).toContain("05/12/2026");
  expect(tela.textContent).not.toContain("Em aberto desde");
});

it("em teste mostra 'Teste até' e 'Cliente desde' ao lado da próxima cobrança", () => {
  desenhar({
    status: "teste",
    proximaCobrancaEm: "2026-11-20",
    testeAte: "2026-11-19",
    inicioEm: "2026-11-01",
  });
  expect(tela.textContent).toContain("Próxima cobrança");
  expect(tela.textContent).toContain("Teste até");
  expect(tela.textContent).toContain("19/11/2026");
  expect(tela.textContent).toContain("Cliente desde");
  expect(tela.textContent).toContain("01/11/2026");
});

it("linha ausente: 'Seu plano vai aparecer aqui', sem texto de defeito e sem botão", () => {
  act(() =>
    raiz.render(
      <CartaoDaAssinatura
        assinatura={null}
        lida
        carregando={false}
        erro={null}
        onTentarDeNovo={() => undefined}
      />,
    ),
  );
  expect(tela.textContent).toContain("Seu plano vai aparecer aqui");
  expect(tela.textContent).toContain(
    "Estamos ligando a sua assinatura a este painel. Nada muda na sua loja enquanto isso.",
  );
  expect(tela.textContent).not.toContain("sincronizado");
  expect(tela.querySelector("button")).toBeNull();
});

it("falha de leitura sem dado anterior continua sendo o estado de erro, não o texto de plano vazio", () => {
  act(() =>
    raiz.render(
      <CartaoDaAssinatura
        assinatura={null}
        lida={false}
        carregando={false}
        erro="Falha ao carregar"
        onTentarDeNovo={() => undefined}
      />,
    ),
  );
  expect(tela.textContent).toContain("Falha ao carregar");
  expect(tela.textContent).not.toContain("Seu plano vai aparecer aqui");
});
