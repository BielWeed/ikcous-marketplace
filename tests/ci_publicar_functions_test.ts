import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
// @ts-nocheck
/**
 * O workflow "Publicar edge functions (Supabase)" só publica o que foi pedido,
 * pelo nome, no projeto escolhido — .github/workflows/publicar-functions.yml
 *
 * O QUE ESTES TESTES MEDEM:
 *
 * 1. O arquivo, do jeito que está: só dispara à mão (nada de push/PR
 *    publicando em produção), só lê o repositório, nunca passa
 *    `--no-verify-jwt` (a verdade é o supabase/config.toml, e a flag ganharia
 *    dele — #162), e todo `functions deploy` leva um nome (sem nome o CLI
 *    publica o diretório inteiro — DEPLOYMENT.md §2).
 *
 * 2. O bloco de validação, EXTRAÍDO do arquivo e rodado com bash: aceita os
 *    nomes que existem, expande o apelido `cobranca` nas cinco do Mercado
 *    Pago, recusa a `send-order-whatsapp` (despublicada em 11/08/2026),
 *    recusa `_shared`, nome inexistente, nome com shell dentro e projeto
 *    desconhecido, e resolve `loja`/`sandbox` nos refs certos.
 *
 * Extraído e não copiado: copiado, o teste passaria enquanto o arquivo
 * apodrece.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const WORKFLOW = fromFileUrl(
  new URL("../.github/workflows/publicar-functions.yml", import.meta.url),
);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const REF_LOJA = "cafkrminfnokvgjqtkle";
const REF_SANDBOX = "lofznuxcvezrhxsgjqyg";
const AS_CINCO_DA_COBRANCA =
  "criar-pagamento webhook-mercadopago reconciliar-pagamentos estornar-pagamento credenciais-mercado-pago";

/**
 * O arquivo sem as linhas de comentário: o cabeçalho EXPLICA o que o workflow
 * não faz (cita `--no-verify-jwt` e o deploy sem nome), e o teste mede o que
 * ele FAZ.
 */
function semComentarios(yaml: string): string {
  return yaml
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

/** Tira do workflow o corpo do `run: |` do step cujo `name:` casa. */
function blocoRunDoStep(yaml: string, nomeDoStep: string): string {
  const linhas = yaml.split(/\r?\n/);
  const iNome = linhas.findIndex((l) => l.includes(`name: ${nomeDoStep}`));
  assert(iNome >= 0, `step "${nomeDoStep}" não achado no workflow`);
  const iRun = linhas.findIndex(
    (l, i) => i > iNome && /^\s*run:\s*\|\s*$/.test(l),
  );
  assert(iRun > iNome, `o step "${nomeDoStep}" não tem um \`run: |\``);
  const recuoDe = (l: string) => l.match(/^\s*/)[0].length;
  const recuoRun = recuoDe(linhas.at(iRun));
  const corpo: string[] = [];
  for (const l of linhas.slice(iRun + 1)) {
    if (l.trim() === "") {
      corpo.push("");
      continue;
    }
    if (recuoDe(l) <= recuoRun) break;
    corpo.push(l);
  }
  const menorRecuo = Math.min(
    ...corpo
      .filter((l) => l.trim() !== "")
      .map((l) => l.match(/^\s*/)[0].length),
  );
  return corpo.map((l) => l.slice(menorRecuo)).join("\n");
}

/** Roda o bloco de validação como o runner rodaria: bash, na raiz do repo. */
async function validar(projeto: string, pedidas: string) {
  const yaml = await Deno.readTextFile(WORKFLOW);
  const bloco = blocoRunDoStep(yaml, "Resolve o projeto e valida os nomes");
  const saida = await Deno.makeTempFile({ prefix: "publicar_out_" });
  const proc = new Deno.Command("bash", {
    args: ["-c", bloco],
    cwd: RAIZ,
    env: { PROJETO: projeto, PEDIDAS: pedidas, GITHUB_OUTPUT: saida },
    stdout: "piped",
    stderr: "piped",
  });
  const r = await proc.output();
  const dec = new TextDecoder();
  const outputs: Record<string, string> = {};
  for (const linha of (await Deno.readTextFile(saida)).split("\n")) {
    const i = linha.indexOf("=");
    if (i > 0) outputs[linha.slice(0, i)] = linha.slice(i + 1);
  }
  await Deno.remove(saida);
  return {
    codigo: r.code,
    stdout: dec.decode(r.stdout),
    stderr: dec.decode(r.stderr),
    outputs,
  };
}

Deno.test("o workflow de publicação, do jeito que está no arquivo", async (t) => {
  const yaml = semComentarios(await Deno.readTextFile(WORKFLOW));

  await t.step(
    "só dispara à mão: workflow_dispatch e nenhum gatilho automático",
    () => {
      assertStringIncludes(yaml, "workflow_dispatch:");
      for (const gatilho of [
        "\n  push:",
        "\n  pull_request:",
        "\n  schedule:",
        "\n  release:",
      ]) {
        assert(
          !yaml.includes(gatilho),
          `gatilho automático no workflow de deploy: ${gatilho.trim()}`,
        );
      }
    },
  );

  await t.step("só lê o repositório", () => {
    assertStringIncludes(yaml, "permissions:\n  contents: read");
    assert(
      !/:\s*write\b/.test(yaml),
      "alguma permissão de escrita no workflow de deploy",
    );
  });

  await t.step(
    "nunca passa --no-verify-jwt: a verdade é o supabase/config.toml",
    () => {
      assert(
        !yaml.includes("--no-verify-jwt"),
        "o workflow passa --no-verify-jwt",
      );
    },
  );

  await t.step(
    "todo deploy leva um nome e o ref resolvido, nunca o diretório inteiro",
    () => {
      const reais = yaml
        .split("\n")
        .filter(
          (l) =>
            l.includes("supabase functions deploy") && !l.includes("::group::"),
        );
      assertEquals(
        reais.length,
        1,
        `esperava exatamente uma chamada real de deploy, achei ${reais.length}`,
      );
      assertEquals(
        reais.at(0).trim(),
        'supabase functions deploy "$n" --project-ref "$REF"',
      );
    },
  );

  await t.step(
    "a credencial é o segredo SUPABASE_ACCESS_TOKEN, conferido antes de publicar",
    () => {
      assertStringIncludes(yaml, "${{ secrets.SUPABASE_ACCESS_TOKEN }}");
      const iConfere = yaml.indexOf("name: Confere o segredo");
      const iPublica = yaml.indexOf("name: Publica, uma function por vez");
      assert(
        iConfere > 0 && iPublica > iConfere,
        "o segredo tem de ser conferido ANTES do passo que publica",
      );
      assert(
        !/SUPABASE_ACCESS_TOKEN:\s*["']?(sbp_|eyJ)/.test(yaml),
        "token literal no workflow",
      );
    },
  );

  await t.step(
    "os dois destinos são fechados e apontam para os refs do DEPLOYMENT.md",
    () => {
      assertStringIncludes(yaml, `loja) REF=${REF_LOJA} ;;`);
      assertStringIncludes(yaml, `sandbox) REF=${REF_SANDBOX} ;;`);
      assertStringIncludes(
        yaml,
        "options:\n          - loja\n          - sandbox",
      );
    },
  );

  await t.step(
    "um deploy por projeto de cada vez, nunca cancelado no meio",
    () => {
      assertStringIncludes(
        yaml,
        "group: publicar-functions-${{ inputs.projeto }}",
      );
      assertStringIncludes(yaml, "cancel-in-progress: false");
    },
  );
});

Deno.test("o bloco de validação, rodado de verdade", async (t) => {
  await t.step("aceita um nome que existe e resolve a loja", async () => {
    const r = await validar("loja", "credenciais-mercado-pago");
    assertEquals(r.codigo, 0, r.stderr + r.stdout);
    assertEquals(r.outputs.ref, REF_LOJA);
    assertEquals(r.outputs.nomes, "credenciais-mercado-pago");
  });

  await t.step(
    "aceita vírgula ou espaço, mantém a ordem e não repete",
    async () => {
      const r = await validar(
        "sandbox",
        "criar-pagamento, webhook-mercadopago criar-pagamento",
      );
      assertEquals(r.codigo, 0, r.stderr + r.stdout);
      assertEquals(r.outputs.ref, REF_SANDBOX);
      assertEquals(r.outputs.nomes, "criar-pagamento webhook-mercadopago");
    },
  );

  await t.step(
    "`cobranca` vira as cinco do Mercado Pago, na ordem da §5.3",
    async () => {
      const r = await validar("loja", " cobranca ");
      assertEquals(r.codigo, 0, r.stderr + r.stdout);
      assertEquals(r.outputs.nomes, AS_CINCO_DA_COBRANCA);
      for (const n of AS_CINCO_DA_COBRANCA.split(" ")) {
        const stat = await Deno.stat(
          `${RAIZ}/supabase/functions/${n}/index.ts`,
        );
        assert(
          stat.isFile,
          `a §5.3 cita ${n}, mas ela não existe no repositório`,
        );
      }
    },
  );

  await t.step(
    "recusa a send-order-whatsapp, despublicada em 11/08/2026",
    async () => {
      const r = await validar("loja", "send-order-whatsapp");
      assertEquals(r.codigo, 1);
      assertStringIncludes(r.stdout, "send-order-whatsapp foi despublicada");
      assertEquals(r.outputs.nomes, undefined);
    },
  );

  await t.step(
    "recusa _shared, nome inexistente, nome com shell dentro e pedido vazio",
    async () => {
      for (const pedido of [
        "_shared",
        "naoexiste",
        "criar-pagamento;echo pwned",
        "$(id)",
        "../x",
        "",
      ]) {
        const r = await validar("loja", pedido);
        assertEquals(
          r.codigo,
          1,
          `"${pedido}" deveria ser recusado; saída: ${r.stdout}${r.stderr}`,
        );
        assertEquals(
          r.outputs.nomes,
          undefined,
          `"${pedido}" não pode virar output`,
        );
      }
    },
  );

  await t.step("recusa projeto fora da lista fechada", async () => {
    const r = await validar("producao", "credenciais-mercado-pago");
    assertEquals(r.codigo, 1);
    assertStringIncludes(r.stdout, "projeto desconhecido");
    assertEquals(r.outputs.ref, undefined);
  });
});
