import { describe, expect, it } from "vitest";
// @ts-expect-error Módulo JS nativo sem declaração; é a prova de "sem conflito" das frentes paralelas.
import * as faixas from "../../scripts/paralelo/faixas.mjs";

const {
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
