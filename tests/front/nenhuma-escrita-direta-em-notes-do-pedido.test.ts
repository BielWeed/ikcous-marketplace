// Nenhum código do app grava `marketplace_orders.notes` direto pelo PostgREST.
//
// POR QUÊ: a anotação interna da lojista mora em `marketplace_order_internal_notes` (migration
// 20261247000000, front no ar desde 17/10/2026). A migration 20261248000000 tira o UPDATE da coluna
// `notes` do papel `authenticated`: a partir dela, qualquer `.update({ notes })` ou `.upsert({ notes })`
// em `marketplace_orders` feito pelo app recebe 42501 (permission denied) — e, antes dela, grava a
// anotação interna onde a cliente a baixa. A coluna `notes` é escrita só na criação do pedido (RPCs
// SECURITY DEFINER) e pelo service_role. Esta guarda barra o app de voltar a escrevê-la.
//
// COMO PROCURA (parser do TypeScript, não regex): em todo arquivo de `src/` que mencione
// `marketplace_orders`, olha QUALQUER chamada `.update(...)` / `.upsert(...)` (o builder pode ter sido
// guardado numa variável antes do `;`, então não adianta seguir só a cadeia que nasce no `.from(...)`) e
// reprova um argumento que tenha a chave `notes` — escrita como identificador, 'notes', "notes", `notes`
// ou computada ["notes"]. Dentro do que prova que é `marketplace_orders` (cadeia com
// `.from("marketplace_orders")`), reprova também o argumento que não é um objeto literal (spread,
// variável, chamada): não dá para provar o que ele grava. Limite assumido: um builder guardado em
// variável com um argumento que não é literal (`pedido.update(dados)`) não é seguido até a origem.
// `tracking_code` é a única coluna que o painel ainda atualiza. Lista de exceções: vazia.
/* eslint-disable security/detect-non-literal-fs-filename --
   varredura da própria árvore do repositório (caminhos vêm do disco, não de entrada de usuário) */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");

/** Texto fixo de um nome de propriedade, ou null se for computado e não literal. */
function nomeDaChave(nome: ts.PropertyName): string | null {
  if (
    ts.isIdentifier(nome) ||
    ts.isStringLiteral(nome) ||
    ts.isNoSubstitutionTemplateLiteral(nome)
  )
    return nome.text;
  if (ts.isComputedPropertyName(nome)) {
    const dentro = nome.expression;
    if (
      ts.isStringLiteral(dentro) ||
      ts.isNoSubstitutionTemplateLiteral(dentro)
    )
      return dentro.text;
  }
  return null;
}

/** A cadeia do `.update(...)` nasce em `.from("marketplace_orders")`? */
function cadeiaEhDePedidos(expressao: ts.Expression): boolean {
  let atual: ts.Expression = expressao;
  for (;;) {
    if (ts.isCallExpression(atual)) {
      const alvo = atual.expression;
      const primeiro =
        atual.arguments.length > 0 ? atual.arguments[0] : undefined;
      if (
        ts.isPropertyAccessExpression(alvo) &&
        alvo.name.text === "from" &&
        primeiro &&
        (ts.isStringLiteral(primeiro) ||
          ts.isNoSubstitutionTemplateLiteral(primeiro)) &&
        primeiro.text === "marketplace_orders"
      )
        return true;
      atual = alvo;
    } else if (
      ts.isPropertyAccessExpression(atual) ||
      ts.isElementAccessExpression(atual) ||
      ts.isNonNullExpression(atual) ||
      ts.isParenthesizedExpression(atual) ||
      ts.isAwaitExpression(atual)
    )
      atual = atual.expression;
    else return false;
  }
}

/** O nome do método chamado (`update`, `upsert`...) ou null. */
function metodoDaChamada(chamada: ts.CallExpression): string | null {
  const alvo = chamada.expression;
  if (ts.isPropertyAccessExpression(alvo)) return alvo.name.text;
  if (
    ts.isElementAccessExpression(alvo) &&
    (ts.isStringLiteral(alvo.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(alvo.argumentExpression))
  )
    return alvo.argumentExpression.text;
  return null;
}

/** Os objetos literais que o argumento de update/upsert carrega (um objeto ou uma lista deles). */
function objetosDoArgumento(
  arg: ts.Expression,
): ts.ObjectLiteralExpression[] | null {
  let atual: ts.Expression = arg;
  while (
    ts.isParenthesizedExpression(atual) ||
    ts.isAsExpression(atual) ||
    ts.isSatisfiesExpression(atual)
  )
    atual = atual.expression;
  if (ts.isObjectLiteralExpression(atual)) return [atual];
  if (ts.isArrayLiteralExpression(atual)) {
    const objetos: ts.ObjectLiteralExpression[] = [];
    for (const item of atual.elements) {
      const dentro = objetosDoArgumento(item);
      if (!dentro) return null;
      objetos.push(...dentro);
    }
    return objetos;
  }
  return null;
}

/** Os problemas de escrita em marketplace_orders dentro de UM texto de código. */
function escritasEmNotes(
  codigo: string,
  nomeDoArquivo = "arquivo.tsx",
): string[] {
  const achados: string[] = [];
  if (/rest\/v1\/marketplace_orders/.test(codigo))
    achados.push("chamada direta a rest/v1/marketplace_orders");
  if (!codigo.includes("marketplace_orders")) return achados;

  const fonte = ts.createSourceFile(
    nomeDoArquivo,
    codigo,
    ts.ScriptTarget.Latest,
    true,
    nomeDoArquivo.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.TSX,
  );

  const visitar = (no: ts.Node): void => {
    if (ts.isCallExpression(no)) {
      const metodo = metodoDaChamada(no);
      if (metodo === "update" || metodo === "upsert") {
        const primeiro = no.arguments.length > 0 ? no.arguments[0] : undefined;
        const trecho = no.getText(fonte).replace(/\s+/g, " ").slice(0, 70);
        const objetos = primeiro ? objetosDoArgumento(primeiro) : [];
        if (objetos === null) {
          if (cadeiaEhDePedidos(no.expression))
            achados.push(
              `.${metodo}( em marketplace_orders com argumento que não é um objeto literal (${trecho})`,
            );
        } else {
          for (const objeto of objetos) {
            for (const propriedade of objeto.properties) {
              if (ts.isSpreadAssignment(propriedade)) {
                if (cadeiaEhDePedidos(no.expression))
                  achados.push(`.${metodo}( com spread (${trecho})`);
                continue;
              }
              if (!propriedade.name) continue;
              const chave = nomeDaChave(propriedade.name);
              if (chave === "notes")
                achados.push(`.${metodo}( grava a chave notes (${trecho})`);
              else if (chave === null && cadeiaEhDePedidos(no.expression))
                achados.push(
                  `.${metodo}( em marketplace_orders com chave computada que não dá para provar (${trecho})`,
                );
            }
          }
        }
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
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
    // O controle e as formas óbvias.
    expect(escritasEmNotes(grava("update({ notes: texto })"))).toHaveLength(1);
    expect(escritasEmNotes(grava("update({ status, notes })"))).toHaveLength(1);
    expect(escritasEmNotes(grava('update({ "notes": texto })'))).toHaveLength(
      1,
    );
    expect(escritasEmNotes(grava("update({ 'notes': texto })"))).toHaveLength(
      1,
    );
    expect(escritasEmNotes(grava("update({ `notes`: texto })"))).toHaveLength(
      1,
    );
    expect(
      escritasEmNotes(
        grava("upsert({ id, notes: texto }, { onConflict: 'id' })"),
      ),
    ).toHaveLength(1);
    expect(
      escritasEmNotes(grava("upsert([{ id, notes: texto }, { id: 2 }])")),
    ).toHaveLength(1);
    expect(
      escritasEmNotes(
        "await supabase.from('marketplace_orders').update({ notes: 'x' });",
      ),
    ).toHaveLength(1);
    // Os dois contraexemplos da revisão: chave computada e builder guardado antes do `;`.
    expect(
      escritasEmNotes(
        'await supabase.from("marketplace_orders").update({ ["notes"]: texto }).eq("id", id);',
      ),
    ).toHaveLength(1);
    expect(
      escritasEmNotes(
        'const pedido = supabase.from("marketplace_orders");\npedido.update({ notes: texto });',
      ),
    ).toHaveLength(1);
    // Variações do mesmo furo.
    expect(
      escritasEmNotes(
        'const pedido = supabase.from("marketplace_orders");\nawait pedido.update({ ["notes"]: texto }).eq("id", id);',
      ),
    ).toHaveLength(1);
    expect(
      escritasEmNotes(
        'const t = supabase.from("marketplace_orders");\nawait t["update"]({ notes: texto });',
      ),
    ).toHaveLength(1);
    expect(
      escritasEmNotes(
        'const { error } = await supabase.from("marketplace_orders")\n.update({ ...campos, status } as never);\nawait outro.upsert({ notes });',
      ),
    ).toHaveLength(2);
    // Argumento que não dá para provar, na cadeia de marketplace_orders.
    expect(escritasEmNotes(grava("update({ ...campos })"))).toHaveLength(1);
    expect(escritasEmNotes(grava("update(campos)"))).toHaveLength(1);
    expect(escritasEmNotes(grava("update({ [coluna]: texto })"))).toHaveLength(
      1,
    );
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
    expect(
      escritasEmNotes(
        'await supabase.from("marketplace_order_internal_notes").upsert({ order_id, note });\nconst p = supabase.from("marketplace_orders").select("id");',
      ),
    ).toEqual([]);
    // Em arquivo que não fala de marketplace_orders, a guarda nem olha.
    expect(
      escritasEmNotes('await supabase.from("products").update({ notes: x });'),
    ).toEqual([]);
  });

  it("nenhum arquivo de src/ grava a chave notes (nem usa argumento que não dá para provar) em marketplace_orders", () => {
    const problemas: string[] = [];
    let varridos = 0;
    let mencionam = 0;
    for (const arquivo of arquivosDe(join(RAIZ, "src"))) {
      const rel = relative(RAIZ, arquivo).split(sep).join("/");
      if (rel === "src/types/database.types.ts") continue;
      varridos++;
      const codigo = readFileSync(arquivo, "utf8");
      if (codigo.includes("marketplace_orders")) mencionam++;
      for (const achado of escritasEmNotes(codigo, arquivo))
        problemas.push(`${rel}: ${achado}`);
    }
    expect(varridos).toBeGreaterThan(100);
    // A guarda tem de estar olhando para alguma coisa (senão um filtro quebrado a deixaria verde).
    expect(mencionam).toBeGreaterThan(5);
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
