// O preco do produto passa a deixar historico (migration 20261386000000; 26/10/2026).
//
// PASSO 1 de uma mudanca de produto: o "De" da promocao deixa de ser digitado e passa a ser o
// MENOR preco dos 30 dias antes do corte, calculado pelo banco a partir deste historico. Esta
// migration so GRAVA o historico; nenhum preco cobrado, tela ou funcao existente muda.
//
// Roda no CI sem banco: a ancora e' o arquivo em disco (import.meta.glob com ?raw, como
// pergunta-nasce-com-o-autor.test.ts). O COMPORTAMENTO do gatilho em Postgres de verdade e'
// provado por tests/banco/o-preco-do-produto-deixa-historico-viva.cjs (rpc-ci.yml).
import { describe, expect, it } from "vitest";

const MIGRATIONS = import.meta.glob<string>("/supabase/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

const NOME = "20261386000000_o_preco_do_produto_deixa_historico.sql";

const ler = (sufixo: string): string => {
  const par = Object.entries(MIGRATIONS).find(([caminho]) =>
    caminho.endsWith(`/${sufixo}`),
  );
  return par ? par[1] : "";
};

const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const destrutivo = ler(`rollback-manual-destrutivo-${NOME}`);

const semComentarios = (sql: string): string =>
  sql
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("--"))
    .join("\n");

const codigo = semComentarios(migration);
const codigoRollback = semComentarios(rollback);
const codigoDestrutivo = semComentarios(destrutivo);

describe("o preco do produto deixa historico (20261386000000)", () => {
  it("o glob casou as migrations e a nova esta no disco", () => {
    expect(Object.keys(MIGRATIONS).length).toBeGreaterThan(100);
    expect(migration, `sumiu: ${NOME}`).not.toBe("");
    expect(rollback, "rollback comum sumiu").not.toBe("");
    expect(destrutivo, "rollback destrutivo sumiu").not.toBe("");
  });

  it("o numero 20261386000000 pertence a so uma migration (nenhuma outra tomou o numero)", () => {
    const versoes = Object.keys(MIGRATIONS)
      .map((c) => c.split("/").pop() ?? "")
      .filter((n) => /^\d{14}_/.test(n))
      .map((n) => n.slice(0, 14))
      .sort();
    expect(versoes.filter((v) => v === "20261386000000")).toHaveLength(1);
  });

  it("usa fim de linha LF (o CRLF do Windows quebra o md5 dos pre-voos vizinhos)", () => {
    expect(migration).not.toContain("\r");
    expect(rollback).not.toContain("\r");
    expect(destrutivo).not.toContain("\r");
  });

  it("nao tem BEGIN/COMMIT: quem abre a transacao e' o aplicador (regra do AGENTS.md)", () => {
    // Com BEGIN/COMMIT dentro do arquivo o ROLLBACK da prova vira no-op e a mudanca fica gravada.
    expect(codigo).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
    expect(codigoRollback).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
    expect(codigoDestrutivo).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
  });

  it("falha rapido em vez de travar a loja esperando lock", () => {
    expect(codigo).toMatch(/SET LOCAL lock_timeout\s*=\s*'5s'/);
  });

  describe("a tabela", () => {
    it("nasce com IF NOT EXISTS, as 7 colunas e a chave", () => {
      expect(codigo).toMatch(
        /CREATE TABLE IF NOT EXISTS public\.produto_historico_preco/,
      );
      for (const coluna of [
        /id uuid NOT NULL DEFAULT gen_random_uuid\(\)/,
        /produto_id uuid NOT NULL/,
        /preco numeric\(10,\s*2\) NOT NULL/,
        /preco_anterior numeric\(10,\s*2\)(?!\s*NOT NULL)/,
        /mudado_em timestamptz NOT NULL DEFAULT now\(\)/,
        /mudado_por uuid(?!\s*NOT NULL)/,
        /origem text NOT NULL/,
      ]) {
        expect(codigo).toMatch(coluna);
      }
      expect(codigo).toMatch(/PRIMARY KEY \(id\)/);
    });

    it("amarra o produto com ON DELETE CASCADE e restringe a origem", () => {
      expect(codigo).toMatch(
        /FOREIGN KEY \(produto_id\) REFERENCES public\.produtos\s*\(id\) ON DELETE CASCADE/,
      );
      expect(codigo).toMatch(
        /CHECK \(origem IN \('cadastro', 'mudanca', 'migracao'\)\)/,
      );
    });

    it("nao tem CHECK de valor: nada na tabela pode recusar um preco que o produto aceitou", () => {
      expect(codigo).not.toMatch(/CHECK \(\s*preco/);
      expect(codigo).not.toMatch(/CHECK \(\s*preco_anterior/);
    });

    it("tem o indice (produto_id, mudado_em DESC)", () => {
      expect(codigo).toMatch(
        /CREATE INDEX IF NOT EXISTS \w+\s+ON public\.produto_historico_preco\s*\(produto_id, mudado_em DESC\)/,
      );
    });
  });

  describe("quem le e quem escreve", () => {
    it("liga a RLS e fecha tudo antes de abrir so a leitura", () => {
      expect(codigo).toMatch(
        /ALTER TABLE public\.produto_historico_preco ENABLE ROW LEVEL SECURITY/,
      );
      expect(codigo).toMatch(
        /REVOKE ALL ON TABLE public\.produto_historico_preco FROM PUBLIC, anon, authenticated, service_role/,
      );
      expect(codigo).toMatch(
        /GRANT SELECT ON TABLE public\.produto_historico_preco TO authenticated, service_role;/,
      );
    });

    it("nenhum GRANT de tabela a anon nem de escrita a ninguem", () => {
      const grants = codigo.match(/GRANT[^;]*;/gi) ?? [];
      const sobreATabela = grants.filter((g) =>
        g.includes("produto_historico_preco"),
      );
      expect(sobreATabela.length).toBeGreaterThan(0);
      for (const g of sobreATabela) {
        if (/^REVOKE/i.test(g)) continue;
        expect(g).not.toMatch(/\banon\b/i);
        expect(g).not.toMatch(
          /INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL/i,
        );
      }
    });

    it("tem UMA politica, de leitura, para authenticated, so do admin atual", () => {
      const politicas = codigo.match(/CREATE POLICY[\s\S]*?;/g) ?? [];
      expect(politicas).toHaveLength(1);
      expect(politicas[0]).toMatch(/FOR SELECT TO authenticated/);
      expect(politicas[0]).toMatch(/\(SELECT public\.rls_admin_atual\(\)\)/);
      expect(codigo).toMatch(
        /DROP POLICY IF EXISTS produto_historico_preco_select_policy ON public\.produto_historico_preco/,
      );
      expect(codigo).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/i);
    });
  });

  describe("o gatilho", () => {
    it("a funcao e' SECURITY DEFINER com search_path fixo e nao engole erro", () => {
      expect(codigo).toMatch(
        /CREATE OR REPLACE FUNCTION public\.registrar_historico_de_preco\(\)\s+RETURNS trigger/,
      );
      expect(codigo).toMatch(/SECURITY DEFINER/);
      expect(codigo).toMatch(/SET search_path = pg_catalog, pg_temp/);
      // So o corpo da funcao do gatilho: o pos-voo da migration tem o seu proprio laco, de conferencia.
      const inicio = codigo.indexOf("AS $function$");
      const corpo = codigo.slice(
        inicio,
        codigo.indexOf("$function$;", inicio + 5),
      );
      expect(corpo.length).toBeGreaterThan(200);
      expect(corpo).not.toMatch(/EXCEPTION/i);
      expect(corpo).not.toMatch(/\bLOOP\b/i);
      expect(corpo.match(/INSERT INTO/g)).toHaveLength(2);
      expect(corpo).not.toMatch(/\b(SELECT|UPDATE|DELETE)\b/);
    });

    it("so executa o gatilho quem tem de executar: ninguem de aplicacao", () => {
      expect(codigo).toMatch(
        /REVOKE ALL ON FUNCTION public\.registrar_historico_de_preco\(\) FROM PUBLIC, anon, authenticated, service_role/,
      );
      expect(codigo).not.toMatch(
        /GRANT EXECUTE ON FUNCTION public\.registrar_historico_de_preco/,
      );
    });

    it("grava 'cadastro' no INSERT e 'mudanca' so quando o preco muda", () => {
      expect(codigo).toMatch(/TG_OP = 'INSERT'/);
      expect(codigo).toMatch(/'cadastro'/);
      expect(codigo).toMatch(
        /NEW\.preco_venda IS DISTINCT FROM OLD\.preco_venda/,
      );
      expect(codigo).toMatch(/'mudanca'/);
      expect(codigo).toMatch(/OLD\.preco_venda/);
      expect(codigo).toMatch(/auth\.uid\(\)/);
    });

    it("nao grava linha com preco NULL (guarda defensiva)", () => {
      expect(codigo).toMatch(/NEW\.preco_venda IS NULL/);
    });

    it("e' AFTER INSERT OR UPDATE OF preco_venda e recria sem erro sem trancar a leitura de produtos", () => {
      // CREATE OR REPLACE TRIGGER pega SHARE ROW EXCLUSIVE; o DROP TRIGGER IF EXISTS pegaria ACCESS EXCLUSIVE e bloquearia a vitrine.
      expect(codigo).toMatch(
        /CREATE OR REPLACE TRIGGER tr_produto_historico_de_preco\s+AFTER INSERT OR UPDATE OF preco_venda ON public\.produtos\s+FOR EACH ROW/,
      );
      expect(codigo).not.toMatch(/DROP TRIGGER/i);
    });
  });

  describe("o que ja existia", () => {
    it("o backfill e' uma linha por produto sem historico, 'migracao', sem data inventada", () => {
      expect(codigo).toMatch(
        /INSERT INTO public\.produto_historico_preco[^;]*?SELECT p\.id, p\.preco_venda, NULL, now\(\), NULL, 'migracao'\s+FROM public\.produtos p[\s\S]*?AND NOT EXISTS \(SELECT 1 FROM public\.produto_historico_preco h WHERE h\.produto_id = p\.id\)/,
      );
      // Nenhuma data literal: o historico comeca honestamente no dia da migration.
      const backfill = codigo.slice(
        codigo.indexOf("SELECT p.id, p.preco_venda, NULL, now()"),
      );
      expect(backfill.split(";")[0]).not.toMatch(/'\d{4}-\d{2}-\d{2}/);
    });

    it("cria o gatilho ANTES do backfill (o lock do CREATE TRIGGER fecha a janela entre os dois)", () => {
      const gatilho = codigo.indexOf(
        "CREATE OR REPLACE TRIGGER tr_produto_historico_de_preco",
      );
      const backfill = codigo.indexOf(
        "SELECT p.id, p.preco_venda, NULL, now()",
      );
      expect(backfill).toBeGreaterThan(-1);
      expect(gatilho).toBeGreaterThan(-1);
      expect(backfill).toBeGreaterThan(gatilho);
    });

    it("nao toca em nada que existia: uma funcao nova, nenhum ALTER/UPDATE/DELETE fora da tabela nova", () => {
      const funcoes = [
        ...codigo.matchAll(/CREATE (?:OR REPLACE )?FUNCTION\s+(public\.\w+)/g),
      ].map((m) => m[1]);
      expect(funcoes).toEqual(["public.registrar_historico_de_preco"]);
      const alteres = [...codigo.matchAll(/ALTER TABLE ([\w.]+)/g)].map(
        (m) => m[1],
      );
      for (const alvo of alteres) {
        expect(alvo).toBe("public.produto_historico_preco");
      }
      expect(codigo).not.toMatch(/\bUPDATE\s+public\./i);
      expect(codigo).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(codigo).not.toMatch(/\bDROP\s+(TABLE|COLUMN|FUNCTION)/i);
    });

    it("recusa, sem escrever, loja que nao tem o chao esperado (pre-voo fail-closed)", () => {
      expect(codigo).toMatch(/B1_BASELINE_DIVERGENT/);
      expect(codigo).toMatch(
        /to_regprocedure\('public\.rls_admin_atual\(\)'\)/,
      );
      expect(codigo).toMatch(/produtos/);
      expect(codigo).toMatch(/preco_venda/);
    });

    it("confere o resultado antes de terminar (pos-voo): RLS, ACL, gatilho e cobertura", () => {
      expect(codigo).toMatch(/B2_POSVOO_DIVERGENTE/);
      expect(codigo).toMatch(/relrowsecurity/);
      expect(codigo).toMatch(/has_table_privilege\('anon'/);
      expect(codigo).toMatch(/tgenabled/);
    });

    it("avisa o PostgREST da tabela nova", () => {
      expect(codigo).toMatch(/NOTIFY pgrst, 'reload schema'/);
    });
  });

  describe("o rollback", () => {
    it("o comum para de gravar e sela a leitura, mas NAO apaga a tabela nem as linhas", () => {
      expect(codigoRollback).toMatch(
        /DROP TRIGGER IF EXISTS tr_produto_historico_de_preco ON public\.produtos/,
      );
      expect(codigoRollback).toMatch(
        /DROP FUNCTION IF EXISTS public\.registrar_historico_de_preco\(\)/,
      );
      expect(codigoRollback).toMatch(
        /DROP POLICY IF EXISTS produto_historico_preco_select_policy/,
      );
      expect(codigoRollback).not.toMatch(/DROP TABLE/i);
      expect(codigoRollback).not.toMatch(/CASCADE/i);
    });

    it("o destrutivo exige confirmacao e o rollback comum antes, e so entao apaga a tabela", () => {
      expect(codigoDestrutivo).toMatch(
        /app\.confirmo_apagar_historico_de_preco/,
      );
      expect(codigoDestrutivo).toMatch(/'APAGAR'/);
      expect(codigoDestrutivo).toMatch(/RAISE EXCEPTION/);
      expect(codigoDestrutivo).toMatch(
        /DROP TABLE IF EXISTS public\.produto_historico_preco;/,
      );
      expect(codigoDestrutivo).not.toMatch(/CASCADE/i);
      expect(destrutivo.indexOf("RAISE EXCEPTION")).toBeLessThan(
        destrutivo.indexOf("DROP TABLE"),
      );
    });
  });
});
