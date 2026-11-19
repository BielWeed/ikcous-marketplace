// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { PromoverAdminConfirmacao } from "@/components/admin/users/PromoverAdminConfirmacao";
import type { Customer } from "@/utils/admin_cache";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Produtos e banners dependem de vários hooks/providers; a ficha de devolução
// compõe ações, reembolso e consultas. Como o ajuste é só de classes, travamos
// seus elementos na fonte, como texto-longo-devolucao-e-opcoes.test.ts.
// O jsdom não mede transbordamento real a 360px.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- teste: entrada fixa, sem dado de usuário
const fonte = (arquivo: string) => readFileSync(arquivo, "utf8");
const classes = (trecho: string, elemento: string) =>
  trecho
    // eslint-disable-next-line security/detect-non-literal-regexp -- teste: entrada fixa, sem dado de usuário
    .match(new RegExp(`<${elemento}\\s+className="([^"]+)"`))?.[1]
    .split(/\s+/) ?? [];

function confirmarQueQuebra(trecho: string) {
  expect.soft(classes(trecho, "AlertDialogHeader")).toContain("min-w-0");
  const descricao = classes(trecho, "AlertDialogDescription");
  expect.soft(descricao).toContain("[overflow-wrap:anywhere]");
  expect.soft(descricao).not.toContain("truncate");
  expect.soft(descricao).not.toContain("whitespace-nowrap");
}

let desmontar: (() => void) | undefined;
let hospedeiro: HTMLDivElement | undefined;
afterEach(() => {
  desmontar?.();
  hospedeiro?.remove();
  document.body.removeAttribute("style");
});

describe("nomes sem espaços não alargam o painel", () => {
  it("produto: excluir e duplicar permitem encolher o cabeçalho e quebrar o nome", () => {
    const texto = fonte("src/views/admin/AdminProductsView.tsx");
    for (const [estado, nome] of [
      ["productToDelete", "?.name"],
      ["planoDeCopia", "planoDeCopia?.nome"],
    ]) {
      const inicio = texto.indexOf(`open={${estado} !== null}`);
      expect(inicio).toBeGreaterThan(-1);
      const fim = texto.indexOf("</AlertDialog>", inicio);
      const dialogo = texto.slice(inicio, fim);
      expect(dialogo).toContain(nome);
      confirmarQueQuebra(dialogo);
    }
  });

  it("banner: excluir permite quebrar tanto o título como o link usado de reserva", () => {
    const texto = fonte("src/views/admin/AdminBannersView.tsx");
    const inicio = texto.indexOf("open={bannerToDelete !== null}");
    expect(inicio).toBeGreaterThan(-1);
    const dialogo = texto.slice(
      inicio,
      texto.indexOf("</AlertDialog>", inicio),
    );
    expect(dialogo).toContain("bannerEmExclusao?.title");
    expect(dialogo).toContain("bannerEmExclusao?.link");
    confirmarQueQuebra(dialogo);
  });

  it("administrador: nome com 120 letras tem quebra no título e cabeçalho pode encolher", async () => {
    const nome = "A".repeat(120);
    const customer: Customer = {
      id: "cliente-ficticio",
      full_name: nome,
      email: "cliente@example.com",
      phone: "",
      role: "customer",
      created_at: "2026-11-18T00:00:00Z",
      orders_count: 0,
      total_spent: 0,
    };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    const raiz = createRoot(hospedeiro);
    desmontar = () => act(() => raiz.unmount());
    await act(async () => {
      raiz.render(
        <PromoverAdminConfirmacao
          acao="promover"
          aberta
          customer={customer}
          aoFechar={() => {}}
          aoConcluir={() => {}}
          retornoDoFoco={{ current: null }}
        />,
      );
    });
    const titulo = document.querySelector('[data-slot="alert-dialog-title"]');
    expect(titulo?.textContent).toContain(nome);
    expect
      .soft(titulo?.classList.contains("[overflow-wrap:anywhere]"))
      .toBe(true);
    expect
      .soft(
        titulo
          ?.closest('[data-slot="alert-dialog-header"]')
          ?.classList.contains("min-w-0"),
      )
      .toBe(true);
    expect(titulo?.classList.contains("truncate")).toBe(false);
    expect(
      document
        .querySelector('[data-testid="promover-quem"]')
        ?.classList.contains("break-all"),
    ).toBe(true);
  });

  it("devolução: o dd que recebe o nome do cliente quebra palavras sem perder min-w-0", () => {
    const texto = fonte(
      "src/components/admin/devolucoes/DetalheDaDevolucao.tsx",
    );
    expect(texto).toMatch(
      /<Linha rotulo="Cliente">\s*\{detalhe\.pedido\?\.customer_name/,
    );
    const linha = texto.slice(
      texto.indexOf("function Linha("),
      texto.indexOf("function FotoDoCliente("),
    );
    expect(linha).toContain(
      'className="flex items-start justify-between gap-3 text-xs"',
    );
    const valor = classes(linha, "dd");
    expect.soft(valor).toContain("min-w-0");
    expect.soft(valor).toContain("[overflow-wrap:anywhere]");
    expect(valor).not.toContain("truncate");
    expect(linha).toMatch(/<dd[^>]*>\s*\{children\}/);
  });
});
