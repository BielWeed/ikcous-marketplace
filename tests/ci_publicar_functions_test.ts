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
 *    desconhecido, e resolve `loja`/`savy`/`almeida`/`sandbox` nos refs certos.
 *    Lojas clientes (`savy`, `almeida`) só admitem as cinco Functions
 *    financeiras e exigem `expected_sha` igual ao SHA do run.
 *
 * Extraído e não copiado: copiado, o teste passaria enquanto o arquivo
 * apodrece.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

import { bashMultiplataforma, caminhoPosix } from "./_bash_multiplataforma.ts";

const WORKFLOW = fromFileUrl(
  new URL("../.github/workflows/publicar-functions.yml", import.meta.url),
);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const REF_LOJA = "dekxabvqdsuukijblazl";
const REF_SAVY = "gnjsrucsmjkajijrakzr";
const REF_SANDBOX = "lofznuxcvezrhxsgjqyg";
const REF_ALMEIDA = "cuemaffjmhkebhmghbap";
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

/**
 * Roda o bloco de validação como o runner rodaria: bash, na raiz do repo.
 * O bash vem de `./_bash_multiplataforma.ts` — no Windows o do PATH pode
 * ser o do WSL, que não recebe as variáveis de ambiente (PROJETO chegava
 * VAZIO e o bloco morria em "projeto desconhecido").
 */
async function validar(
  projeto: string,
  pedidas: string,
  expectedSha = "",
  actualSha = "a".repeat(40),
) {
  const yaml = await Deno.readTextFile(WORKFLOW);
  const bloco = blocoRunDoStep(yaml, "Resolve o projeto e valida os nomes");
  const saida = await Deno.makeTempFile({ prefix: "publicar_out_" });
  const proc = new Deno.Command(bashMultiplataforma(), {
    args: ["-c", bloco],
    cwd: RAIZ,
    env: {
      PROJETO: projeto,
      PEDIDAS: pedidas,
      EXPECTED_SHA: expectedSha,
      GITHUB_SHA: actualSha,
      GITHUB_OUTPUT: caminhoPosix(saida),
    },
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
      assertEquals(reais.length, 2, "um deploy isolado por caminho de token");
      for (const chamada of reais) {
        assertEquals(
          chamada.trim(),
          'supabase functions deploy "$n" --project-ref "$REF"',
        );
      }
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
    "os quatro destinos são fechados: loja, Savy, Almeida e sandbox",
    () => {
      assertStringIncludes(yaml, `loja) REF=${REF_LOJA} ;;`);
      assertStringIncludes(yaml, `savy) REF=${REF_SAVY} ;;`);
      assertStringIncludes(yaml, `almeida) REF=${REF_ALMEIDA} ;;`);
      assertStringIncludes(yaml, `sandbox) REF=${REF_SANDBOX} ;;`);
      assertStringIncludes(
        yaml,
        "options:\n          - loja\n          - savy\n          - almeida\n          - sandbox",
      );
    },
  );

  await t.step(
    "Almeida usa o MESMO segredo da loja (mesmo org Supabase), nunca o da Savy",
    () => {
      // As etapas de token da loja/sandbox têm `if: inputs.projeto != 'savy'`,
      // então Almeida cai nelas. O segredo da Savy tem de continuar exclusivo
      // da Savy: uma condição que citasse 'almeida' nas etapas Savy, ou um
      // segredo novo, mudaria de quem é a credencial sem ninguém decidir.
      assert(!yaml.includes("inputs.projeto == 'almeida'"));
      assert(!yaml.includes("SUPABASE_ACCESS_TOKEN_ALMEIDA"));
      const inicio = yaml.indexOf("name: Publica Savy, uma function por vez");
      const proximo = yaml.indexOf("\n      - ", inicio + 1);
      const step = yaml.slice(inicio, proximo < 0 ? undefined : proximo);
      assertStringIncludes(step, "if: inputs.projeto == 'savy'");
      assert(!step.includes("almeida"));
    },
  );

  await t.step("Savy usa somente o token próprio nas etapas de deploy", () => {
    const nomes = [
      "Confere o segredo Savy",
      "Publica Savy, uma function por vez",
      "Lista o que ficou publicado na Savy",
    ];
    for (const nome of nomes) {
      const inicio = yaml.indexOf(`name: ${nome}`);
      assert(inicio >= 0, `step Savy ausente: ${nome}`);
      const proximo = yaml.indexOf("\n      - ", inicio + 1);
      const step = yaml.slice(inicio, proximo < 0 ? undefined : proximo);
      assertStringIncludes(step, "if: inputs.projeto == 'savy'");
      assertStringIncludes(step, "${{ secrets.SUPABASE_ACCESS_TOKEN_SAVY }}");
      assert(!step.includes("${{ secrets.SUPABASE_ACCESS_TOKEN }}"));
    }
    for (const nome of [
      "Confere o segredo",
      "Publica, uma function por vez, sempre pelo nome",
      "Lista o que ficou publicado",
    ]) {
      const inicio = yaml.indexOf(`name: ${nome}\n`);
      assert(inicio >= 0, `step loja/sandbox ausente: ${nome}`);
      const proximo = yaml.indexOf("\n      - ", inicio + 1);
      const step = yaml.slice(inicio, proximo < 0 ? undefined : proximo);
      assertStringIncludes(step, "if: inputs.projeto != 'savy'");
      assertStringIncludes(step, "${{ secrets.SUPABASE_ACCESS_TOKEN }}");
      assert(!step.includes("${{ secrets.SUPABASE_ACCESS_TOKEN_SAVY }}"));
    }
  });

  await t.step(
    "checkout e trava de SHA precedem todo deploy de loja cliente",
    () => {
      assertStringIncludes(yaml, "expected_sha:");
      assertStringIncludes(yaml, "ref: ${{ github.sha }}");
      assertStringIncludes(yaml, "EXPECTED_SHA: ${{ inputs.expected_sha }}");
      const iTrava = yaml.indexOf("Loja cliente");
      const iPrimeiroDeploy = yaml.indexOf(
        "name: Publica, uma function por vez",
      );
      assert(iTrava > 0 && iTrava < iPrimeiroDeploy);
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
    "Savy resolve a ref própria e mantém as cinco Functions",
    async () => {
      const r = await validar("savy", "cobranca", "a".repeat(40));
      assertEquals(r.codigo, 0, r.stderr + r.stdout);
      assertEquals(r.outputs.ref, REF_SAVY);
      assertEquals(r.outputs.nomes, AS_CINCO_DA_COBRANCA);
    },
  );

  await t.step("Savy exige o SHA exato do commit aprovado", async () => {
    for (const expected of ["", "b".repeat(40), "a".repeat(39)]) {
      const r = await validar("savy", "cobranca", expected);
      assertEquals(r.codigo, 1, `SHA ${expected} deveria falhar`);
      assertEquals(r.outputs.nomes, undefined);
    }
    const r = await validar("savy", "criar-pagamento", "a".repeat(40));
    assertEquals(r.codigo, 0, r.stderr + r.stdout);
  });

  await t.step("Savy só admite as cinco Functions financeiras", async () => {
    const r = await validar("savy", "send-push", "a".repeat(40));
    assertEquals(r.codigo, 1);
    assertEquals(r.outputs.nomes, undefined);
  });

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

  await t.step(
    "Almeida resolve a ref própria e mantém as cinco Functions",
    async () => {
      const r = await validar("almeida", "cobranca", "a".repeat(40));
      assertEquals(r.codigo, 0, r.stderr + r.stdout);
      assertEquals(r.outputs.ref, REF_ALMEIDA);
      assertEquals(r.outputs.nomes, AS_CINCO_DA_COBRANCA);
      assertStringIncludes(r.stdout, `Projeto: almeida (${REF_ALMEIDA})`);
    },
  );

  await t.step(
    "Almeida aceita uma function financeira sozinha e SHA em maiúsculas",
    async () => {
      const r = await validar(
        "almeida",
        "criar-pagamento",
        "A".repeat(40),
        "a".repeat(40),
      );
      assertEquals(r.codigo, 0, r.stderr + r.stdout);
      assertEquals(r.outputs.nomes, "criar-pagamento");
    },
  );

  await t.step(
    "Almeida exige o SHA exato: vazio, outro, curto ou comprido recusam",
    async () => {
      for (const expected of [
        "",
        "b".repeat(40),
        "a".repeat(39),
        "a".repeat(41),
        `${"a".repeat(39)}g`,
      ]) {
        const r = await validar("almeida", "cobranca", expected);
        assertEquals(r.codigo, 1, `SHA "${expected}" deveria falhar`);
        // Pelo MOTIVO certo: sem isto, o teste passaria com o destino ainda
        // "desconhecido" (recusa por outro caminho) e não provaria a trava.
        assertStringIncludes(r.stdout, "exige expected_sha");
        assert(!r.stdout.includes("projeto desconhecido"));
        assertEquals(r.outputs.nomes, undefined);
        assertEquals(r.outputs.ref, undefined);
      }
    },
  );

  await t.step(
    "Almeida recusa function não financeira, sozinha ou no meio de um pedido",
    async () => {
      for (const pedido of [
        "send-push",
        "melhor-envio-etiqueta",
        "criar-pagamento send-push",
        "send-push, criar-pagamento",
      ]) {
        const r = await validar("almeida", pedido, "a".repeat(40));
        assertEquals(r.codigo, 1, `"${pedido}" deveria ser recusado`);
        assertStringIncludes(
          r.stdout,
          "só admite as cinco Functions financeiras",
        );
        assert(!r.stdout.includes("projeto desconhecido"));
        assertEquals(
          r.outputs.nomes,
          undefined,
          `"${pedido}" não pode virar output`,
        );
        assertEquals(r.outputs.ref, undefined);
      }
    },
  );

  await t.step(
    "Almeida mantém as recusas gerais: whatsapp, nome inválido, pedido vazio",
    async () => {
      for (const pedido of [
        "send-order-whatsapp",
        "$(id)",
        "criar-pagamento;echo pwned",
        "",
      ]) {
        const r = await validar("almeida", pedido, "a".repeat(40));
        assertEquals(r.codigo, 1, `"${pedido}" deveria ser recusado`);
        assert(!r.stdout.includes("projeto desconhecido"));
        assertEquals(r.outputs.nomes, undefined);
      }
    },
  );

  await t.step(
    "os outros destinos NÃO mudaram: loja e sandbox seguem sem trava de SHA",
    async () => {
      for (const [projeto, ref] of [
        ["loja", REF_LOJA],
        ["sandbox", REF_SANDBOX],
      ]) {
        const r = await validar(projeto, "send-push");
        assertEquals(r.codigo, 0, r.stderr + r.stdout);
        assertEquals(r.outputs.ref, ref);
        assertEquals(r.outputs.nomes, "send-push");
      }
      const savy = await validar("savy", "cobranca", "a".repeat(40));
      assertEquals(savy.outputs.ref, REF_SAVY);
    },
  );

  await t.step("recusa projeto fora da lista fechada", async () => {
    const r = await validar("producao", "credenciais-mercado-pago");
    assertEquals(r.codigo, 1);
    assertStringIncludes(r.stdout, "projeto desconhecido");
    assertEquals(r.outputs.ref, undefined);
  });
});
