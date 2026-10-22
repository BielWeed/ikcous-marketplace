// @vitest-environment jsdom
//
// O ícone ORIGINAL do Mercado Pago no painel (22/10/2026, pedido do dono: "o
// ícone do Mercado Pago a gente ainda não está colocando a original").
// Antes, o painel usava uma chave (cartão "Mercado Pago" de Ajustes) e uma
// carteira (conta "Mercado Pago" do Financeiro). Este arquivo prova:
//   I1  o glifo é um svg decorativo (aria-hidden), com 1 path, que herda a cor;
//   I2  a conta "Mercado Pago" do Financeiro desenha o glifo (e as outras
//       contas seguem com os ícones genéricos);
//   I3  o cartão "Mercado Pago" de Ajustes usa o glifo (leitura da fonte: a
//       tela inteira de Ajustes é pesada demais para montar aqui);
//   I4  o ícone nunca é o único portador do nome: "Mercado Pago" segue em texto.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IconeDoTipoDeConta } from "@/components/admin/financeiro/icones";
import { IconeMercadoPago } from "@/components/icons/IconeMercadoPago";

const FONTES = import.meta.glob<string>(
  "/src/views/admin/AdminSettingsView.tsx",
  { query: "?raw", import: "default", eager: true },
);

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("IconeMercadoPago", () => {
  it("I1 — svg decorativo, 1 path, herda a cor e aceita className", () => {
    act(() =>
      root.render(<IconeMercadoPago className="size-5 text-[#009EE3]" />),
    );
    const svg = host.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.getAttribute("fill")).toBe("currentColor");
    expect(svg?.getAttribute("class")).toContain("text-[#009EE3]");
    const paths = svg?.querySelectorAll("path") ?? [];
    expect(paths).toHaveLength(1);
    // O glifo do aperto de mãos (Simple Icons, CC0) começa por este traço.
    expect(paths[0]?.getAttribute("d")?.startsWith("M11.115 16.479")).toBe(
      true,
    );
  });

  it("I2 — a conta 'mercado_pago' do Financeiro desenha o glifo; as outras seguem genéricas", () => {
    const glifo = (tipo: string) => {
      act(() =>
        root.render(<IconeDoTipoDeConta tipo={tipo} className="size-5" />),
      );
      return host.querySelector("svg path")?.getAttribute("d") ?? "";
    };
    expect(glifo("mercado_pago").startsWith("M11.115 16.479")).toBe(true);
    for (const outro of ["caixa", "banco", "outro"]) {
      expect(glifo(outro).startsWith("M11.115 16.479")).toBe(false);
    }
  });

  it("I3 — o cartão 'Mercado Pago' de Ajustes usa o glifo, não a chave", () => {
    const fonte = FONTES["/src/views/admin/AdminSettingsView.tsx"] ?? "";
    const i = fonte.indexOf('titulo="Mercado Pago"');
    expect(i).toBeGreaterThan(-1);
    const trecho = fonte.slice(i, i + 400);
    expect(trecho).toContain("icone={IconeMercadoPago}");
    expect(trecho).not.toContain("icone={KeyRound}");
    // I4 — o nome continua em texto ao lado do ícone.
    expect(trecho).toContain('subtitulo="Chaves do seu Mercado Pago no app"');
  });
});
