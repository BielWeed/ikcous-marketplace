import { describe, expect, it } from "vitest";
// @ts-expect-error Módulo JS nativo sem declaração; é a prova de "sem conflito" das frentes paralelas.
import * as faixas from "../../scripts/paralelo/faixas.mjs";

const {
  riscoDoConteudo,
  riscoDoCaminho,
  arquivoPermitido,
  casa,
  conferirAlterados,
  globsSeSobrepoem,
  maiorPrefixoDeMigration,
  prefixoDeMigration,
  validarManifesto,
} = faixas;

const manifesto = (extra: Record<string, unknown> = {}) => ({
  plano: "teste",
  frentes: [
    {
      nome: "cupom",
      posse: [
        "src/views/customer/CheckoutView.tsx",
        "tests/front/cupom-*.test.ts",
      ],
      faixa_migrations: { de: "20261300", ate: "20261309" },
    },
    {
      nome: "painel",
      posse: ["src/views/admin/**"],
      faixa_migrations: { de: "20261310", ate: "20261319" },
    },
  ],
  ...extra,
});

describe("casa (glob → caminho)", () => {
  it("* não atravessa diretório; ** atravessa", () => {
    expect(casa("src/*.ts", "src/a.ts")).toBe(true);
    expect(casa("src/*.ts", "src/x/a.ts")).toBe(false);
    expect(casa("src/**", "src/x/y/a.ts")).toBe(true);
    expect(casa("src/**/a.ts", "src/a.ts")).toBe(true);
    expect(casa("src/**/a.ts", "src/x/y/a.ts")).toBe(true);
  });

  it("aceita barra invertida e ./ (Windows) e não confunde ponto com curinga", () => {
    expect(casa("src/a.ts", "src\\a.ts")).toBe(true);
    expect(casa("./src/a.ts", "src/a.ts")).toBe(true);
    expect(casa("src/a.ts", "src/aXts")).toBe(false);
  });
});

describe("globsSeSobrepoem (conservador)", () => {
  it.each([
    ["src/views/admin/**", "src/views/admin/AdminOrdersView.tsx", true],
    ["src/views/admin/**", "src/views/customer/**", false],
    ["src/a.ts", "src/a.ts", true],
    ["src/a.ts", "src/b.ts", false],
    ["src/*View.tsx", "src/CheckoutView.tsx", true],
    ["src/*View.tsx", "src/lib.ts", false],
    ["src/**", "src/App.tsx", true],
    ["src/a/*.ts", "src/b/*.ts", false],
    ["src/a/*.ts", "src/a/*.tsx", true], // curinga × curinga: não prova disjunção → sobrepõe
    ["src/a", "src/a/b.ts", false], // arquivo × arquivo dentro: caminhos diferentes
  ])("%s × %s → %s", (a, b, esperado) => {
    expect(globsSeSobrepoem(a, b)).toBe(esperado);
    expect(globsSeSobrepoem(b, a)).toBe(esperado); // simétrico
  });
});

describe("validarManifesto", () => {
  it("aceita frentes disjuntas", () => {
    expect(validarManifesto(manifesto()).erros).toEqual([]);
  });

  it("reprova posse que se cruza", () => {
    const m = manifesto();
    m.frentes[1].posse.push("src/views/customer/*.tsx");
    const { erros } = validarManifesto(m);
    expect(erros.join("\n")).toMatch(/posse se cruza: cupom .* × painel/);
  });

  it("reprova posse que encosta em arquivo compartilhado", () => {
    const m = manifesto();
    m.frentes[0].posse.push("src/App.tsx");
    const { erros } = validarManifesto(m);
    expect(erros.join("\n")).toMatch(/compartilhado "src\/App\.tsx"/);
  });

  it("libera compartilhado a UMA frente, por caminho exato", () => {
    const m = manifesto({ liberados: { "src/App.tsx": "cupom" } });
    m.frentes[0].posse.push("src/App.tsx");
    expect(validarManifesto(m).erros).toEqual([]);
    const ok = arquivoPermitido(m.frentes[0], m, "src/App.tsx");
    const negado = arquivoPermitido(m.frentes[1], m, "src/App.tsx");
    expect(ok.ok).toBe(true);
    expect(negado.ok).toBe(false);
  });

  it("reprova libera para frente inexistente e liberação por glob", () => {
    const m = manifesto({ liberados: { "src/*.tsx": "fantasma" } });
    const { erros } = validarManifesto(m);
    expect(erros.join("\n")).toMatch(/é glob/);
    expect(erros.join("\n")).toMatch(/frente inexistente "fantasma"/);
  });

  it("reprova faixas de migration que se cruzam, invertidas ou abaixo do piso", () => {
    const m = manifesto();
    m.frentes[1].faixa_migrations = { de: "20261305", ate: "20261320" };
    expect(validarManifesto(m).erros.join("\n")).toMatch(
      /faixas de migration se cruzam/,
    );

    const inv = manifesto();
    inv.frentes[0].faixa_migrations = { de: "20261309", ate: "20261300" };
    expect(validarManifesto(inv).erros.join("\n")).toMatch(/invertida/);

    const piso = validarManifesto(manifesto(), {
      maiorMigrationExistente: "20261305",
    });
    expect(piso.erros.join("\n")).toMatch(/já existe migration 20261305/);
  });

  it("reprova migration em posse, glob largo, nome ruim, duplicata e plano vazio", () => {
    const m = manifesto();
    m.frentes[0].posse.push("supabase/migrations/2026*.sql");
    m.frentes[1].posse.push("**/*.ts");
    m.frentes.push({ nome: "cupom", posse: ["x/y.ts"] } as never);
    m.frentes.push({ nome: "Ruim Nome", posse: ["z"] } as never);
    const texto = validarManifesto(m).erros.join("\n");
    expect(texto).toMatch(/migration não entra em "posse"/);
    expect(texto).toMatch(/glob largo demais/);
    expect(texto).toMatch(/frente repetida: cupom/);
    expect(texto).toMatch(/nome inválido: Ruim Nome/);
    expect(
      validarManifesto({ plano: "p", frentes: [] }).erros.join("\n"),
    ).toMatch(/"frentes" vazio/);
  });

  it("avisa (não reprova) com uma frente só", () => {
    const m = manifesto();
    m.frentes = [m.frentes[0]];
    const r = validarManifesto(m);
    expect(r.erros).toEqual([]);
    expect(r.avisos.join("\n")).toMatch(/só uma frente/);
  });
});

describe("arquivoPermitido / conferirAlterados", () => {
  const m = manifesto();
  const [cupom, painel] = m.frentes;

  it("posse própria passa; posse alheia e arquivo solto não", () => {
    expect(
      arquivoPermitido(cupom, m, "src/views/customer/CheckoutView.tsx").ok,
    ).toBe(true);
    expect(
      arquivoPermitido(cupom, m, "tests/front/cupom-regra.test.ts").ok,
    ).toBe(true);
    expect(
      arquivoPermitido(cupom, m, "src/views/admin/AdminOrdersView.tsx").ok,
    ).toBe(false);
    expect(
      arquivoPermitido(painel, m, "src/views/admin/AdminOrdersView.tsx").ok,
    ).toBe(true);
    expect(arquivoPermitido(painel, m, "src/lib/qualquer.ts").motivo).toMatch(
      /fora da posse/,
    );
  });

  it("compartilhado e processo são de ninguém", () => {
    for (const c of [
      "package-lock.json",
      "src/types/database.types.ts",
      ".claude/lane.json",
      "scripts/paralelo/frente.mjs",
    ]) {
      const r = arquivoPermitido(cupom, m, c);
      expect(r.ok, c).toBe(false);
      expect(r.motivo).toMatch(/compartilhado/);
    }
  });

  it("migration só dentro da faixa da frente (inclui rollback-manual)", () => {
    expect(
      arquivoPermitido(cupom, m, "supabase/migrations/20261301000000_x.sql").ok,
    ).toBe(true);
    expect(
      arquivoPermitido(cupom, m, "rollback-manual-20261301000000_x.sql").ok,
    ).toBe(true);
    expect(
      arquivoPermitido(cupom, m, "supabase/migrations/20261311000000_x.sql")
        .motivo,
    ).toMatch(/fora da faixa/);
    expect(
      arquivoPermitido(painel, m, "supabase/migrations/20261301000000_x.sql")
        .ok,
    ).toBe(false);
    expect(
      arquivoPermitido(cupom, m, "supabase/migrations/nome-torto.sql").ok,
    ).toBe(false);
    const semFaixa = { ...cupom, faixa_migrations: undefined };
    expect(
      arquivoPermitido(semFaixa, m, "supabase/migrations/20261301000000_x.sql")
        .motivo,
    ).toMatch(/não tem faixa_migrations/);
  });

  it("conferirAlterados devolve só as violações", () => {
    const v = conferirAlterados(cupom, m, [
      "src/views/customer/CheckoutView.tsx",
      "package.json",
      "src\\views\\admin\\AdminOrdersView.tsx",
    ]);
    expect(v.map((x: { caminho: string }) => x.caminho)).toEqual([
      "package.json",
      "src/views/admin/AdminOrdersView.tsx",
    ]);
  });
});

describe("migrations", () => {
  it("lê o prefixo de 8 dígitos de migration e de rollback manual", () => {
    expect(prefixoDeMigration("supabase/migrations/20261206000000_x.sql")).toBe(
      "20261206",
    );
    expect(prefixoDeMigration("rollback-manual-20261206000000_x.sql")).toBe(
      "20261206",
    );
    expect(
      prefixoDeMigration("supabase/migrations/_arquivadas/2026_x.sql"),
    ).toBeNull();
  });

  it("acha o maior prefixo ignorando pastas e lixo", () => {
    expect(
      maiorPrefixoDeMigration([
        "20261204000000_a.sql",
        "20261206000000_b.sql",
        "_arquivadas",
        "LEIA-ME.md",
      ]),
    ).toBe("20261206");
    expect(maiorPrefixoDeMigration([])).toBeNull();
  });
});

describe("achados da revisão independente (09/10/2026)", () => {
  it("`**` dentro de um segmento atravessa diretório: sobrepõe (era falso 'disjunto')", () => {
    expect(globsSeSobrepoem("src/lib/**.ts", "src/lib/util/data.ts")).toBe(
      true,
    );
    expect(globsSeSobrepoem("src/x**", "src/xa/b.ts")).toBe(true);
    expect(globsSeSobrepoem("src/**.ts", "src/a/b.ts")).toBe(true);
    expect(casa("src/lib/**.ts", "src/lib/util/data.ts")).toBe(true); // a regex já atravessava
  });

  it("validar reprova `**` que não é segmento inteiro (não engole src/types/**)", () => {
    for (const glob of ["src/lib/**.ts", "src/t**"]) {
      const m = manifesto();
      m.frentes[0].posse.push(glob);
      expect(validarManifesto(m).erros.join("\n"), glob).toMatch(
        /"\*\*" só vale como segmento inteiro/,
      );
    }
  });

  it("não distingue maiúscula de minúscula (disco do dono é Windows/macOS)", () => {
    expect(globsSeSobrepoem("src/Pages/**", "src/pages/x.tsx")).toBe(true);
    expect(globsSeSobrepoem("src/Foo.ts", "src/foo.ts")).toBe(true);
    const m = manifesto();
    m.frentes[0].posse.push("src/app.tsx");
    expect(validarManifesto(m).erros.join("\n")).toMatch(
      /compartilhado "src\/App\.tsx"/,
    );
    const [cupom] = m.frentes;
    expect(arquivoPermitido(cupom, m, "src/app.tsx").motivo).toMatch(
      /compartilhado/,
    );
  });

  it("configuração dos hooks e dos portões é compartilhada", () => {
    const [cupom] = manifesto().frentes;
    for (const c of [
      "lefthook.yml",
      ".commitlintrc.json",
      ".secretlintrc.json",
      "eslint.config.js",
      "biome.json",
    ]) {
      expect(arquivoPermitido(cupom, manifesto(), c).ok, c).toBe(false);
    }
  });

  it("plano + frente cabem na mensagem do merge (commitlint, 100 colunas)", () => {
    const m = manifesto();
    m.plano = "p".repeat(30);
    m.frentes[0].nome = "f".repeat(31);
    expect(validarManifesto(m).erros.join("\n")).toMatch(
      /passam de 60 caracteres/,
    );
    m.frentes[0].nome = "f".repeat(30);
    expect(validarManifesto(m).erros.join("\n")).not.toMatch(/passam de 60/);
  });
});

describe("achados da 2ª revisão (faixas)", () => {
  it("rollback-manual também mora em supabase/migrations/ (convenção atual da skill)", () => {
    expect(
      prefixoDeMigration(
        "supabase/migrations/rollback-manual-20261300000000_x.sql",
      ),
    ).toBe("20261300");
    const [cupom] = manifesto().frentes;
    expect(
      arquivoPermitido(
        cupom,
        manifesto(),
        "supabase/migrations/rollback-manual-20261301000000_x.sql",
      ).ok,
    ).toBe(true);
    expect(
      arquivoPermitido(
        cupom,
        manifesto(),
        "supabase/migrations/rollback-manual-20261399000000_x.sql",
      ).ok,
    ).toBe(false);
  });

  it("`liberados` só entrega ARQUIVO COMPARTILHADO: o resto transferiria posse e furaria a faixa de migration", () => {
    const m = manifesto({
      liberados: { "src/views/admin/AdminOrdersView.tsx": "cupom" },
    });
    expect(validarManifesto(m).erros.join("\n")).toMatch(
      /não é arquivo compartilhado/,
    );
    const mig = manifesto({
      liberados: { "supabase/migrations/20261311000000_x.sql": "cupom" },
    });
    expect(validarManifesto(mig).erros.join("\n")).toMatch(/é migration/);
  });

  it("migration não diferencia caixa da pasta (disco do dono é Windows/macOS)", () => {
    expect(prefixoDeMigration("Supabase/Migrations/20261300000000_x.sql")).toBe(
      "20261300",
    );
    const m = manifesto();
    m.frentes[0].posse.push("SUPABASE/migrations/*.sql");
    expect(validarManifesto(m).erros.join("\n")).toMatch(
      /migration não entra em "posse"/,
    );
    const [cupom] = m.frentes;
    expect(
      arquivoPermitido(cupom, m, "SUPABASE/Migrations/20261399000000_x.sql").ok,
    ).toBe(false);
  });

  it("risco vem dos caminhos (mapa de risco do AGENTS.md)", () => {
    expect(riscoDoCaminho("supabase/migrations/20261300000000_x.sql")).toMatch(
      /migration/,
    );
    expect(
      riscoDoCaminho("supabase/functions/criar-pagamento/index.ts"),
    ).toMatch(/edge function/);
    expect(riscoDoCaminho("vercel.json")).toMatch(/CSP/);
    expect(riscoDoCaminho("src/sw/sw.ts")).toMatch(/service worker/);
    expect(riscoDoCaminho("src/views/customer/CheckoutView.tsx")).toMatch(
      /checkout/,
    );
    expect(riscoDoCaminho("src/hooks/useOtpLogin.ts")).toMatch(/OTP/);
    expect(riscoDoCaminho("src/views/admin/AdminDevolucoesView.tsx")).toMatch(
      /devolução/,
    );
    expect(riscoDoCaminho("src/views/admin/AdminBannersView.tsx")).toBeNull();
  });

  it("risco semântico vem do CONTEÚDO do diff (o nome do arquivo não tem palavra-chave) — achado do Codex P1", () => {
    const diff = (...l: string[]) =>
      ["--- a/x", "+++ b/x", "@@ -1 +1 @@", ...l].join("\n");
    // useFinanceiro.ts chama as RPCs de dinheiro
    expect(
      riscoDoConteudo(
        "src/hooks/useFinanceiro.ts",
        diff('+  supabase.rpc("fin_saldo_do_caixa")'),
      ),
    ).toContain("RPC/tabela fin_* (dinheiro)");
    expect(
      riscoDoConteudo("src/x.ts", diff("+select confirmar_pagamento(1)")),
    ).toContain("dinheiro / pedido");
    expect(
      riscoDoConteudo(
        "src/x.ts",
        diff("+create function f() security definer"),
      ),
    ).toContain("SECURITY DEFINER");
    expect(
      riscoDoConteudo("src/x.ts", diff("-  if (is_admin_atual()) {")),
    ).toContain("gate de admin");
    // assinatura exportada REMOVIDA ou ALTERADA (outro módulo pode consumir); símbolo novo não
    for (const l of [
      "-export function useOrders(id: string) {",
      "-export const useOrders = (id: string) => {",
      "-export const useOrders = async (id) => {",
      "-export type Pedido = {",
      "-export interface Pedido {",
      "-export default function Tela() {",
    ]) {
      expect(
        riscoDoConteudo("src/hooks/useOrders.ts", diff(l)).join(),
        l,
      ).toMatch(/export alterado\/removido/);
    }
    expect(
      riscoDoConteudo(
        "src/hooks/useOrders.ts",
        diff("+export function novoSimbolo() {"),
      ),
    ).toEqual([]);
    expect(
      riscoDoConteudo(
        "src/x.ts",
        diff("-export const LIMITE = 10;", "+export const LIMITE = 20;"),
      ),
    ).toEqual([]);
    // teste e documentação citam essas palavras o tempo todo: ficam fora
    expect(
      riscoDoConteudo("tests/front/fin.test.ts", diff('+rpc("fin_saldo")')),
    ).toEqual([]);
    expect(
      riscoDoConteudo(
        "supabase/functions/x/index_test.ts",
        diff('+rpc("fin_saldo")'),
      ),
    ).toEqual([]);
    expect(riscoDoConteudo("docs/x.md", diff("+fin_saldo"))).toEqual([]);
    // cabeçalhos do diff (`+++`/`---`) não contam como mudança
    expect(
      riscoDoConteudo("src/x.ts", "--- a/fin_x.ts\n+++ b/fin_x.ts"),
    ).toEqual([]);
  });
});
