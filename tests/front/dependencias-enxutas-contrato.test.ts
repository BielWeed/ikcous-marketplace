/* eslint-disable security/detect-non-literal-fs-filename -- Varre só código de src deste checkout. */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const REMOVIDOS =
  /^(toJSONSchema|jsonSchema|zodToJsonSchema|webauthn|passkey|mfa|signInWithPasskey|registerPasskey|deletePasskey|listPasskeys|globalRegistry|registry)$/i;

function violacoes(codigo: string, nome = "exemplo.tsx"): string[] {
  const fonte = ts.createSourceFile(
    nome,
    codigo,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const erros: string[] = [];
  function visitar(no: ts.Node) {
    // Inclui imports com alias, destructuring e acesso por colchetes literais.
    // Comentários e nomes maiores ("jsonSchemaDoExemplo") não são chamadas.
    if (
      (ts.isIdentifier(no) || ts.isStringLiteral(no)) &&
      REMOVIDOS.test(no.text)
    )
      erros.push(no.text);
    if (
      ts.isCallExpression(no) &&
      ts.isPropertyAccessExpression(no.expression)
    ) {
      const metodo = no.expression.name.text;
      if (["meta", "describe"].includes(metodo))
        erros.push("metadados de schema");
      if (
        metodo === "register" &&
        no.expression.expression.getText(fonte) !== "form"
      )
        erros.push("registro de schema");
    }
    if (ts.isStringLiteral(no) && /^zod\//.test(no.text))
      erros.push("import interno do zod");
    if (ts.isStringLiteral(no) && /^@supabase\/auth-js/.test(no.text))
      erros.push("import direto de auth-js");
    ts.forEachChild(no, visitar);
  }
  visitar(fonte);
  return erros;
}

function arquivos(pasta: string): string[] {
  return fs.readdirSync(pasta, { withFileTypes: true }).flatMap((entrada) => {
    const arquivo = path.join(pasta, entrada.name);
    return entrada.isDirectory()
      ? arquivos(arquivo)
      : /\.[cm]?[jt]sx?$/.test(arquivo)
        ? [arquivo]
        : [];
  });
}

describe("loja enxuta — nenhum consumidor pede caminhos retirados", () => {
  it("varre toda a implementação do app, não só os imports diretos", () => {
    const fontes = arquivos("src");
    expect(fontes.length).toBeGreaterThan(0);
    expect(
      fontes.flatMap((arquivo) =>
        violacoes(fs.readFileSync(arquivo, "utf8"), arquivo).map(
          (erro) => `${arquivo}: ${erro}`,
        ),
      ),
    ).toEqual([]);
  });

  it.each([
    "z.toJSONSchema(schema)",
    'schema["toJSONSchema"]()',
    'schema["~standard"].jsonSchema.input({})',
    'import { toJSONSchema as gerar } from "zod"; gerar(s)',
    'const { jsonSchema: gerar } = schema["~standard"]',
    'import { zodToJsonSchema as gerar } from "zod-to-json-schema"',
    "z.registry()",
    "z.globalRegistry.add(s, {})",
    's.meta({ title: "campo" })',
    's.describe("campo")',
    "s.register(registro, {})",
    'import { process } from "zod/v4/core/to-json-schema"',
    "supabase.auth.signInWithPasskey({})",
    "supabase.auth.mfa.webauthn.register({})",
    "const { signInWithPasskey: entrar } = supabase.auth",
    'supabase.auth["signInWithPasskey"]({})',
    'import { WebAuthnApi } from "@supabase/auth-js/dist/module/lib/webauthn"',
  ])("a guarda reprova uso futuro: %s", (codigo) => {
    expect(violacoes(codigo).length).toBeGreaterThan(0);
  });

  it("não confunde parsing de JSON, resolver nem registro de campos com geração de schema", () => {
    expect(
      violacoes(`
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
const schema = z.object({ dados: z.json() });
schema.parse({ dados: {} });
zodResolver(schema);
form.register("street");
// z.toJSONSchema e passkey são só comentário
`),
    ).toEqual([]);
  });
});
