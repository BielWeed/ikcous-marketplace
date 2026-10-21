// @vitest-environment jsdom
import { CartaoDaAssinatura } from "@/components/admin/inicio/CartaoDaAssinatura";
import type { AssinaturaDaLoja } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let tela: HTMLDivElement;
let raiz: Root;
beforeEach(() => {
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
});
afterEach(() => {
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
