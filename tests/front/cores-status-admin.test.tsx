import { readFileSync } from "node:fs";
import {
  OrderStatusBadge,
  paymentStatusConfig,
  statusConfig,
} from "@/components/admin/orders/OrderStatusBadge";
import { type TomDeEstado, classeDoTexto } from "@/lib/tons-de-estado";
import type { OrderStatus } from "@/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const fonte = (caminho: string) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminhos locais fixos dos casos abaixo
  readFileSync(new URL(`../../src/${caminho}`, import.meta.url), "utf8");

describe("cores de significado dos pedidos", () => {
  const casos: [OrderStatus, TomDeEstado][] = [
    ["pending", "info"],
    ["processing", "atencao"],
    ["shipping", "info"],
    ["delivered", "positivo"],
    ["cancelled", "negativo"],
  ];
  it.each(casos)("%s tem o mesmo tom nas duas apresentações", (status, tom) => {
    // eslint-disable-next-line security/detect-object-injection -- união fechada de status no teste
    expect(statusConfig[status].color).toBe(classeDoTexto(tom));
    for (const tamanho of ["padrao", "cartao"] as const) {
      const html = renderToStaticMarkup(
        <OrderStatusBadge status={status} tamanho={tamanho} />,
      );
      expect(html).toContain(classeDoTexto(tom));
      // eslint-disable-next-line security/detect-object-injection -- união fechada de status no teste
      expect(html).toContain(statusConfig[status].label);
      expect(html).not.toMatch(/(?:violet|indigo|cyan|rose)-/);
    }
  });
  it("recusa é negativa, nunca rosa", () => {
    expect(paymentStatusConfig.recusado.color).toBe(classeDoTexto("negativo"));
    expect(paymentStatusConfig.recusado.bgColor).toBe("bg-red-500/10");
    expect(paymentStatusConfig.recusado.borderColor).toBe("border-red-500/20");
  });
});

describe("contrato das cores nas telas", () => {
  it.each([
    "views/admin/AdminCouponsView.tsx",
    "views/admin/AdminSettingsView.tsx",
    "components/admin/orders/AdminOrderCard.tsx",
    "components/admin/orders/GuiaDoPagamentoQueNaoFechou.tsx",
  ])("%s não volta a usar laranja ou rosa para estados", (caminho) => {
    // A cor do ícone de navegação identifica uma seção, não um estado.
    const estados = fonte(caminho)
      .split("\n")
      .filter((linha) => !linha.includes("porta.tela ==="))
      .join("\n");
    expect(estados.match(/(?:text|bg|border)-(?:orange|rose)-/)).toBeNull();
  });

  it("cupom expirado usa o mesmo selo neutro dos indisponíveis", () => {
    expect(fonte("views/admin/AdminCouponsView.tsx")).toMatch(
      /Expirado:\s*`border-zinc-500\/20 bg-zinc-500\/10 \$\{classeDoTexto\("neutro"\)\}`/,
    );
  });

  it("estoque esgotado do PDV é negativo, não atenção", () => {
    expect(fonte("components/admin/pdv/BuscaDeProduto.tsx")).toContain(
      'produto.estoque <= 0 ? "pdv-red" : undefined',
    );
  });

  it("produto inativo no PDV é neutro", () => {
    const codigo = fonte("components/admin/pdv/CupomDaVenda.tsx");
    expect(codigo).toMatch(
      /className="pdv-icon pdv-muted"\s*\/>\s*Produto inativo/,
    );
  });
});

function luminancia(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("PDV mantém a paleta própria com significado e contraste", () => {
  it.each([
    ["pdv-orange", "#fbbf24"],
    ["pdv-added", "#3ddc97"],
  ])("%s tem o tom decidido e contraste AA", (classe, hex) => {
    const css = fonte("components/admin/pdv/pdv.css");
    // eslint-disable-next-line security/detect-non-literal-regexp -- nomes de classe fixos dos dois casos acima
    const bloco = css.match(new RegExp(`\\.${classe} \\{([^}]+)\\}`))?.[1];
    expect(bloco).toContain(hex);
    // Fundos reais do tema admin (bg, surface, raised); também cobre o
    // branco translúcido de 4% dos ícones sobre a superfície elevada.
    for (const fundo of ["#09090b", "#1e1e23", "#2b2b31", "#343439"]) {
      expect(
        (luminancia(hex) + 0.05) / (luminancia(fundo) + 0.05),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
