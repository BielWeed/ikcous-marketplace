// Nenhum código do app grava `marketplace_orders.notes` direto pelo PostgREST.
//
// POR QUÊ: a anotação interna da lojista mora em `marketplace_order_internal_notes` (migration
// 20261247000000, front no ar desde 17/10/2026). A migration 20261248000000 tira o UPDATE da coluna
// `notes` do papel `authenticated`: a partir dela, qualquer `.update({ notes })` ou `.upsert({ notes })`
// em `marketplace_orders` feito pelo app recebe 42501 (permission denied) — e, antes dela, grava a
// anotação interna onde a cliente a baixa. A coluna `notes` é escrita só na criação do pedido (RPCs
// SECURITY DEFINER) e pelo service_role. Esta guarda barra o app de voltar a escrevê-la.
//
// O QUE VALE: toda cadeia `.from("marketplace_orders")….update(...)` / `.upsert(...)` em `src/` tem de
// passar um objeto LITERAL sem a chave `notes` e sem spread (um argumento que não é literal não dá para
// provar, então também reprova). `tracking_code` é a única coluna que o painel ainda atualiza.
/* eslint-disable security/detect-non-literal-fs-filename --
   varredura da própria árvore do repositório (caminhos vêm do disco, não de entrada de usuário) */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");

/** Os problemas de escrita em marketplace_orders dentro de UM texto de código. */
function escritasEmNotes(codigo: string): string[] {
  const achados: string[] = [];
  const origem = /\.from\(\s*(["'`])marketplace_orders\1\s*\)/g;
  for (let m = origem.exec(codigo); m; m = origem.exec(codigo)) {
    const depois = codigo.slice(m.index + m[0].length);
    const fim = depois.indexOf(";");
    const cadeia = fim === -1 ? depois : depois.slice(0, fim);
    const escrita = /\.(update|upsert)\s*\(/.exec(cadeia);
    if (!escrita) continue;
    const resto = cadeia.slice(escrita.index + escrita[0].length);
    const abre = resto.search(/\S/);
    if (abre === -1 || resto.charAt(abre) !== "{") {
      achados.push(`.${escrita[1]}( com argumento que não é um objeto literal`);
      continue;
    }
    let nivel = 0;
    let objeto = "";
    for (let i = abre; i < resto.length; i++) {
      const c = resto.charAt(i);
      if (c === "{") nivel++;
      if (c === "}") nivel--;
      objeto += c;
      if (nivel === 0) break;
    }
    if (/\.\.\./.test(objeto))
      achados.push(`.${escrita[1]}( com spread (${objeto.slice(0, 60)})`);
    if (/(^|[\s,{])(["']?)notes\2\s*[:,}]/.test(objeto))
      achados.push(
        `.${escrita[1]}( grava a chave notes (${objeto.slice(0, 60)})`,
      );
  }
  if (/rest\/v1\/marketplace_orders/.test(codigo))
    achados.push("chamada direta a rest/v1/marketplace_orders");
  return achados;
}

function arquivosDe(pasta: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivosDe(caminho));
    else if (/\.(ts|tsx)$/.test(nome)) saida.push(caminho);
  }
  return saida;
}

describe("nenhuma escrita direta em marketplace_orders.notes", () => {
  it("o detector pega a escrita que a migration 20261248 recusaria (e deixa passar o rastreio)", () => {
    const grava = (corpo: string) =>
      `await supabase.from("marketplace_orders")\n  .${corpo}\n  .eq("id", id);`;
    expect(escritasEmNotes(grava("update({ notes: texto })"))).toHaveLength(1);
    expect(escritasEmNotes(grava("update({ status, notes })"))).toHaveLength(1);
    expect(escritasEmNotes(grava('update({ "notes": texto })'))).toHaveLength(
      1,
    );
    expect(
      escritasEmNotes(
        grava("upsert({ id, notes: texto }, { onConflict: 'id' })"),
      ),
    ).toHaveLength(1);
    expect(escritasEmNotes(grava("update({ ...campos })"))).toHaveLength(1);
    expect(escritasEmNotes(grava("update(campos)"))).toHaveLength(1);
    expect(
      escritasEmNotes(
        "await supabase.from('marketplace_orders').update({ notes: 'x' });",
      ),
    ).toHaveLength(1);
    expect(
      escritasEmNotes(
        'fetch(`${url}/rest/v1/marketplace_orders?id=eq.1`, { method: "PATCH" })',
      ),
    ).toHaveLength(1);
    // O que o painel faz hoje: só o rastreio. Ler `notes` também é livre.
    expect(
      escritasEmNotes(grava("update({ tracking_code: codigo || null })")),
    ).toEqual([]);
    expect(
      escritasEmNotes(
        'const r = await supabase.from("marketplace_orders").select("id, notes, tracking_code").eq("id", id);',
      ),
    ).toEqual([]);
    // `notes` em outra tabela não é da conta desta guarda.
    expect(
      escritasEmNotes(
        'await supabase.from("marketplace_order_internal_notes").upsert({ order_id, note });',
      ),
    ).toEqual([]);
  });

  it("nenhum arquivo de src/ grava a chave notes (nem usa argumento que não dá para provar) em marketplace_orders", () => {
    const problemas: string[] = [];
    let varridos = 0;
    for (const arquivo of arquivosDe(join(RAIZ, "src"))) {
      const rel = relative(RAIZ, arquivo).split(sep).join("/");
      if (rel === "src/types/database.types.ts") continue;
      varridos++;
      for (const achado of escritasEmNotes(readFileSync(arquivo, "utf8")))
        problemas.push(`${rel}: ${achado}`);
    }
    expect(varridos).toBeGreaterThan(100);
    expect(problemas).toEqual([]);
  });

  it("o painel ainda atualiza o rastreio (a coluna que a migration deixa aberta)", () => {
    const detalhe = readFileSync(
      join(RAIZ, "src/components/admin/orders/OrderDetail.tsx"),
      "utf8",
    );
    expect(detalhe).toMatch(
      /\.from\("marketplace_orders"\)\s*\.update\(\{ tracking_code: codigo \|\| null \}\)/,
    );
  });
});
