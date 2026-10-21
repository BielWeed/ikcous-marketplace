/* eslint-disable security/detect-non-literal-fs-filename -- Apenas caminhos literais do repositório, sem entrada externa. */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
const require = createRequire(import.meta.url);
const nome = "20261330000000_mototaxi_privado.sql";
const ler = (path: string) =>
  existsSync(path) ? readFileSync(path, "utf8").replace(/\r/g, "") : "";
const migration = () => ler(`supabase/migrations/${nome}`);
const A = "62a-conferir-mototaxi-aplicado";
const B = "62b-antes-mototaxi-ausente";
it("aditiva: tabela privada, sem alterar store_config ou view pública", () => {
  const sql = migration();
  expect(sql).toContain("CREATE TABLE public.config_mototaxi");
  expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
  expect(sql).toContain(
    "REVOKE ALL ON public.config_mototaxi FROM PUBLIC, anon, authenticated",
  );
  expect(sql).toContain("FOR SELECT TO authenticated");
  expect(sql).toContain("public.is_admin_atual()");
  expect(sql).toContain(
    "GRANT SELECT ON public.config_mototaxi TO authenticated",
  );
  expect(sql).not.toMatch(
    /ALTER TABLE public\.store_config|CREATE OR REPLACE VIEW/,
  );
  expect(sql.replace(/--[^\n]*/g, "")).not.toMatch(
    /\bDROP\s+(TABLE|COLUMN|VIEW)|^\s*(BEGIN|COMMIT)\s*;/m,
  );
});
it("salva pela RPC autenticada com papel atual, payload restrito e CHECK BR", () => {
  const sql = migration();
  expect(sql).toContain(
    "CREATE OR REPLACE FUNCTION public.salvar_config_mototaxi",
  );
  expect(sql).toContain("SECURITY DEFINER");
  expect(sql).toContain("SET search_path TO 'public'");
  expect(sql).toContain(
    "IF NOT public.is_admin() OR NOT public.is_admin_atual()",
  );
  expect(sql).toContain(
    "REVOKE ALL ON FUNCTION public.salvar_config_mototaxi(text, text) FROM PUBLIC, anon, authenticated",
  );
  expect(sql).toContain(
    "GRANT EXECUTE ON FUNCTION public.salvar_config_mototaxi(text, text) TO authenticated",
  );
  expect(sql).toContain("config_mototaxi_whatsapp_check");
});
it("rollback preserva o contato e não reescreve funções ou views antigas", () => {
  const sql = ler(`supabase/migrations/rollback-manual-${nome}`);
  expect(sql).toContain("B1_BASELINE_DIVERGENT");
  expect(sql).toContain("REVOKE ALL ON public.config_mototaxi");
  expect(sql).toContain("REVOKE ALL ON FUNCTION public.salvar_config_mototaxi");
  expect(sql).not.toMatch(
    /DROP\s+(TABLE|COLUMN|VIEW|FUNCTION)|DELETE FROM|TRUNCATE/i,
  );
});
it("congela o corpo novo na consulta e passa fase zero sem escrever no banco", () => {
  const sql = migration();
  const corpo = sql.split("AS $$")[1]?.split("$$;")[0];
  expect(corpo).toBeTruthy();
  expect(ler(`scripts/publicacao/consultas/${A}.sql`).split("$corpo$")[1]).toBe(
    corpo,
  );
  const { avaliarFase0 } = require("../../scripts/db-prove-rollback.cjs");
  const fase = avaliarFase0({
    sqlMigration: sql,
    sqlRollback: ler(`supabase/migrations/rollback-manual-${nome}`),
    temRollback: true,
  });
  expect(fase.recusado, JSON.stringify(fase.motivos)).toBe(false);
  expect(ler(".github/workflows/rpc-ci.yml")).toContain(
    "run: node tests/banco/rodar-isolado.cjs tests/banco/mototaxi-viva.cjs",
  );
});
it("registra provas de ausência e presença com rol fechado e db-apply", async () => {
  const {
    ROL_FECHADO_POR_CONSULTA,
    contarStatements,
  } = require("../../scripts/publicacao/conferir-banco.cjs");
  const { VERIFICACOES } = require("../../scripts/db-apply.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    // @ts-expect-error script Node sem declaração TS; contrato exercitado neste teste.
    "../../scripts/frota/publicar-release.mjs"
  );
  const canais = JSON.parse(ler("scripts/frota/canais-de-backend.json"));
  expect(
    canais.provasDeObjetos.filter((p: any) =>
      p.versoes.includes("20261330000000"),
    ),
  ).toEqual([
    expect.objectContaining({ consulta: A, ausenciaConfirmadaPor: B }),
  ]);
  expect(new Map(Object.entries(VERIFICACOES)).get(nome)).toBeDefined();
  const rols = new Map(
    Object.entries(ROL_FECHADO_POR_CONSULTA as Record<string, string[]>),
  );
  for (const id of [A, B]) {
    const sql = ler(`scripts/publicacao/consultas/${id}.sql`);
    expect(contarStatements(sql)).toBe(1);
    expect(rols.get(id)?.length).toBeGreaterThan(2);
    expect(CONSULTAS_DE_ROL_FECHADO.has(id)).toBe(true);
    for (const item of rols.get(id) ?? []) expect(sql).toContain(`'${item}'`);
    expect(
      ler(".github/workflows/rpc-ci.yml").split(
        `"scripts/publicacao/consultas/${id}.sql"`,
      ).length - 1,
    ).toBe(2);
    expect(ler(".github/workflows/conferir-banco-da-loja.yml")).toContain(
      `- ${id}`,
    );
  }
});
