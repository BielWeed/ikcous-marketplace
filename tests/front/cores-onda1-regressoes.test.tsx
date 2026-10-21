// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import {
  OrderStatusBadge,
  PaymentStatusBadge,
  type PaymentStatusKey,
  paymentStatusConfig,
  rotuloDoPagamento,
} from "@/components/admin/orders/OrderStatusBadge";
import type { Coupon } from "@/types";
import { AdminCouponsView } from "@/views/admin/AdminCouponsView";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: [
      {
        id: "ativo",
        code: "ATIVO",
        type: "percentage",
        value: 10,
        usageCount: 0,
        active: true,
      },
      {
        id: "expirado",
        code: "EXPIRADO",
        type: "percentage",
        value: 10,
        usageCount: 0,
        active: true,
        validUntil: "2000-01-01T00:00:00Z",
      },
      {
        id: "inativo",
        code: "INATIVO",
        type: "percentage",
        value: 10,
        usageCount: 0,
        active: false,
      },
      {
        id: "esgotado",
        code: "ESGOTADO",
        type: "percentage",
        value: 10,
        usageCount: 1,
        usageLimit: 1,
        active: true,
      },
    ] satisfies Coupon[],
    loading: false,
    updateCoupon: vi.fn(),
    deleteCoupon: vi.fn(),
    refreshCoupons: vi.fn(),
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableCoupons: true },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

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

  it.each([
    ["Ativo", "text-emerald-400", "bg-emerald-400"],
    ["Expirado", "text-zinc-400", "bg-zinc-400"],
    ["Inativo", "text-zinc-400", "bg-zinc-400"],
    ["Esgotado", "text-zinc-400", "bg-zinc-400"],
  ])(
    "selo de cupom %s renderiza ponto e texto sem fundo nem borda",
    (rotulo, cor, ponto) => {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(
        <AdminCouponsView onNavigate={() => {}} />,
      );
      const card = host
        .querySelector(`[aria-label="Copiar código ${rotulo.toUpperCase()}"]`)
        ?.closest(".group");
      expect(card).not.toBeNull();
      const selo = [...card!.querySelectorAll("span")].find(
        (el) => el.textContent?.trim() === rotulo,
      )!;
      expect(selo).toBeDefined();
      const classes = [selo, ...selo.querySelectorAll("*")].flatMap((el) => [
        ...el.classList,
      ]);
      expect(
        classes.filter((classe) =>
          /^(?:bg|border)-[a-z]+-500\/\d+/.test(classe),
        ),
      ).toEqual([]);
      expect(
        [...selo.classList].some((classe) =>
          /^(?:bg-|border(?:-|$))/.test(classe),
        ),
      ).toBe(false);
      expect(selo.classList.contains(cor)).toBe(true);
      expect(
        selo.querySelector(`[aria-hidden="true"].${ponto}`),
      ).not.toBeNull();
    },
  );

  it.each(Object.keys(paymentStatusConfig) as PaymentStatusKey[])(
    "pagamento %s renderiza ponto e texto sem recipiente pintado nas duas escalas",
    (estado) => {
      const paymentStatus = estado === "sem_cobranca" ? null : estado;
      for (const tamanho of ["padrao", "cartao"] as const) {
        for (const compact of [false, true]) {
          const host = document.createElement("div");
          host.innerHTML = renderToStaticMarkup(
            <PaymentStatusBadge
              paymentStatus={paymentStatus}
              tamanho={tamanho}
              compact={compact}
            />,
          );
          const classes = [...host.querySelectorAll("*")].flatMap((el) => [
            ...el.classList,
          ]);
          expect(
            classes.filter((classe) =>
              /^(?:bg|border)-[a-z]+-500\/\d+/.test(classe),
            ),
          ).toEqual([]);
          expect(host.firstElementChild?.classList.contains("border")).toBe(
            false,
          );
          expect(host.querySelector('[aria-hidden="true"]')).not.toBeNull();
          if (compact)
            expect(host.firstElementChild?.getAttribute("title")).toBe(
              rotuloDoPagamento(paymentStatus),
            );
          else expect(host.textContent).toBe(rotuloDoPagamento(paymentStatus));
        }
      }
    },
  );

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
