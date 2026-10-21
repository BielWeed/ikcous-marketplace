// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { OrderStatusBadge } from "@/components/admin/orders/OrderStatusBadge";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const fonte = (caminho: string) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- arquivos locais fixos dos casos abaixo
  readFileSync(`src/${caminho}`, "utf8");

describe("cores mínimas após integrar as duas frentes", () => {
  it.each(["padrao", "cartao"] as const)(
    "selo %s mantém rótulo e respiro, sem pintar o recipiente",
    (tamanho) => {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(
        <OrderStatusBadge status="shipping" tamanho={tamanho} retiradaNaLoja />,
      );
      expect(host.textContent).toBe("Pronto para retirar");
      expect(host.querySelector('[aria-hidden="true"]')).not.toBeNull();
      expect(host.innerHTML).toContain("text-sky-400");
      expect(host.firstElementChild?.className).toContain(
        tamanho === "cartao" ? "px-2.5 py-1" : "px-2 py-0.5",
      );
      expect(host.innerHTML).not.toMatch(/bg-\w+-\d+\//);
    },
  );

  it.each([
    "components/admin/orders/AdminOrderCard.tsx",
    "views/admin/AdminCouponsView.tsx",
  ])("%s não pinta avisos e confirmações de estado", (caminho) => {
    const codigo = fonte(caminho);
    // Botão de ação é alvo interativo, não recipiente de aviso.
    const semBotao = codigo
      .split("\n")
      .filter(
        (l) =>
          !l.startsWith("const PERIGO") &&
          !l.includes("className={`${SECUNDARIO}"),
      )
      .join("\n");
    const tinta = caminho.includes("Coupons")
      ? /bg-amber-400\//
      : /bg-(?:amber|red|emerald)-(?:300|400|500)\//;
    expect(semBotao.match(tinta)?.[0]).toBeUndefined();
  });

  it("aviso do PDV usa âmbar adaptável ao Claro, não hex fixo", () => {
    const css = fonte("components/admin/pdv/pdv.css");
    expect(css.match(/\.pdv-orange\s*\{([^}]+)\}/)?.[1]).toContain(
      "var(--lit-t-fbbf24, #fbbf24)",
    );
    const claro = fonte("components/layouts/temas-do-painel.css").match(
      /html\.admin-mode\[data-admin-tema="claro"\]\s*\{([^}]+)\}/,
    )?.[1];
    expect(claro).toContain("--lit-t-fbbf24: #92400e");
  });

  it.each([
    "text-red-400",
    "text-emerald-400",
    "text-amber-400",
    "text-zinc-400",
  ])("a regra branca dos detalhes não captura span com tom %s", (tom) => {
    const css = fonte("components/admin/products/catalogo-produtos.css");
    const regra = css.match(
      /(\.produto-detalhes\s+:is\([^}]+?)\s*\{\s*color:\s*var\(--lit-t-f4f4f5/,
    );
    expect(regra).not.toBeNull();
    const host = document.createElement("div");
    host.className = "produto-detalhes";
    host.innerHTML = `<span class="font-semibold ${tom}">-10</span><span>Rótulo neutro</span>`;
    // Contrato do SELETOR real (não getComputedStyle do jsdom):
    // a regra mais específica não pode sequer corresponder ao número.
    expect(host.firstElementChild?.matches(regra![1])).toBe(false);
    expect(host.lastElementChild?.matches(regra![1])).toBe(true);
  });

  it.each([
    [
      "components/admin/users/CartaoCliente.tsx",
      "tomDoValor(Number(customer.total_spent || 0))",
    ],
    ["views/admin/AdminUserDetailView.tsx", "tomDoValor(resumo.totalGasto)"],
    [
      "components/admin/financeiro/FolhasDoCaixa.tsx",
      'situacao === "bateu" && classeDoTexto("neutro")',
    ],
  ])("zero é neutro no contrato de %s", (caminho, expressao) => {
    expect(fonte(caminho).includes(expressao)).toBe(true);
  });
});
