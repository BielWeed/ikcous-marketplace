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

const WORKFLOW = fromFileUrl(
  new URL("../.github/workflows/publicar-functions.yml", import.meta.url),
);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const REF_IKCOUS_PUBLICADA = "cafkrminfnokvgjqtkle";
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

/** Roda o bloco de validação como o runner rodaria: bash, na raiz do repo. */
async function validar(
  projeto: string,
  pedidas: string,
  expectedSha = "",
  actualSha = "a".repeat(40),
) {
  const yaml = await Deno.readTextFile(WORKFLOW);
  const bloco = blocoRunDoStep(yaml, "Resolve o projeto e valida os nomes");
  const saida = await Deno.makeTempFile({ prefix: "publicar_out_" });
  const proc = new Deno.Command("bash", {
    args: ["-c", bloco],
    cwd: RAIZ,
    env: {
      PROJETO: projeto,
      PEDIDAS: pedidas,
      EXPECTED_SHA: expectedSha,
      GITHUB_SHA: actualSha,
      GITHUB_OUTPUT: saida,
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
      assertEquals(reais.length, 3, "um deploy isolado por caminho de token");
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
    "os cinco destinos são fechados: CAF, Savy, Almeida, sandbox e loja",
    () => {
      assertStringIncludes(yaml, `loja) REF=${REF_LOJA} ;;`);
      assertStringIncludes(yaml, `savy) REF=${REF_SAVY} ;;`);
      assertStringIncludes(yaml, `almeida) REF=${REF_ALMEIDA} ;;`);
      assertStringIncludes(
        yaml,
        "ikcous-publicada) REF=cafkrminfnokvgjqtkle ;;",
      );
      assertStringIncludes(yaml, `sandbox) REF=${REF_SANDBOX} ;;`);
      assertStringIncludes(
        yaml,
        "options:\n          - ikcous-publicada\n          - savy\n          - almeida\n          - sandbox\n          - loja",
      );
    },
  );

  await t.step("o padrão é a loja no ar (CAF), nunca o projeto antigo", () => {
    // Quem dispara sem escolher cai no destino mais travado (só as cinco
    // financeiras + expected_sha). O padrão antigo, `loja`, apontava para o
    // DEK, que a loja principal deixou de usar em 03/10/2026.
    assertStringIncludes(yaml, "default: ikcous-publicada\n");
    assert(!yaml.includes("default: loja"), "padrão voltou para o DEK");
  });

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

  await t.step(
    "IKCOUS publicada resolve CAF e somente as cinco financeiras",
    async () => {
      const r = await validar("ikcous-publicada", "cobranca", "a".repeat(40));
      assertEquals(r.codigo, 0, r.stdout + r.stderr);
      assertEquals(r.outputs.ref, REF_IKCOUS_PUBLICADA);
      assertEquals(r.outputs.nomes, AS_CINCO_DA_COBRANCA);
      const unica = await validar(
        "ikcous-publicada",
        "criar-pagamento",
        "A".repeat(40),
      );
      assertEquals(unica.codigo, 0, unica.stdout + unica.stderr);
      assertEquals(unica.outputs.nomes, "criar-pagamento");
    },
  );

  await t.step(
    "IKCOUS publicada recusa SHA ausente divergente ou malformado",
    async () => {
      for (const expected of [
        "",
        "b".repeat(40),
        "a".repeat(39),
        "a".repeat(41),
        "g".repeat(40),
      ]) {
        const r = await validar("ikcous-publicada", "cobranca", expected);
        assertEquals(r.codigo, 1, expected);
        assertStringIncludes(r.stdout, "exige expected_sha");
        assert(!r.stdout.includes("projeto desconhecido"));
        assertEquals(r.outputs, {});
      }
    },
  );

  await t.step(
    "IKCOUS publicada recusa extras injecao WhatsApp e nomes vazios",
    async () => {
      for (const pedido of [
        "send-push",
        "criar-pagamento,send-push",
        "_shared",
        "send-order-whatsapp",
        "criar-pagamento;echo injected",
        "",
        " , ",
      ]) {
        const r = await validar("ikcous-publicada", pedido, "a".repeat(40));
        assertEquals(r.codigo, 1, pedido);
        assert(!r.stdout.includes("projeto desconhecido"));
        assertEquals(r.outputs, {});
      }
    },
  );

  await t.step(
    "CAF usa apenas segredo dedicado e prova readonly antes do deploy",
    () => {
      const yaml = semComentarios(Deno.readTextFileSync(WORKFLOW));
      const nomes = [
        "Confere o segredo IKCOUS publicada",
        "Prova somente leitura do banco CAF antes de publicar",
        "Publica IKCOUS publicada, uma function por vez",
        "Lista o que ficou publicado na IKCOUS publicada",
      ];
      let anterior = -1;
      for (const nome of nomes) {
        const inicio = yaml.indexOf(`name: ${nome}`);
        assert(inicio > anterior && inicio >= 0, nome);
        anterior = inicio;
        const proximo = yaml.indexOf("\n      - ", inicio + 1);
        const step = yaml.slice(inicio, proximo < 0 ? undefined : proximo);
        assertStringIncludes(step, "if: inputs.projeto == 'ikcous-publicada'");
        assertStringIncludes(
          step,
          "${{ secrets.SUPABASE_ACCESS_TOKEN_IKCOUS }}",
        );
        assert(!step.includes("${{ secrets.SUPABASE_ACCESS_TOKEN }}"));
        assert(!step.includes("${{ secrets.SUPABASE_ACCESS_TOKEN_SAVY }}"));
      }
      assertStringIncludes(
        yaml,
        "node scripts/publicacao/verificar-pagamentos-ikcous.cjs --site-publicado-caf",
      );
      for (const nome of [
        "Confere o segredo",
        "Publica, uma function por vez, sempre pelo nome",
        "Lista o que ficou publicado",
      ]) {
        const inicio = yaml.indexOf(`name: ${nome}\n`);
        const proximo = yaml.indexOf("\n      - ", inicio + 1);
        const step = yaml.slice(inicio, proximo < 0 ? undefined : proximo);
        assertStringIncludes(
          step,
          "if: inputs.projeto != 'savy' && inputs.projeto != 'ikcous-publicada'",
        );
      }
      const consulta = Deno.readTextFileSync(
        new URL(
          "../.github/workflows/conferir-banco-da-loja.yml",
          import.meta.url,
        ),
      );
      const caf = consulta.slice(
        consulta.indexOf("  verificar-ikcous-publicado:"),
      );
      assertStringIncludes(caf, "${{ secrets.SUPABASE_ACCESS_TOKEN_IKCOUS }}");
      assert(!caf.includes("${{ secrets.SUPABASE_ACCESS_TOKEN }}"));
    },
  );
  await t.step("recusa projeto fora da lista fechada", async () => {
    const r = await validar("producao", "credenciais-mercado-pago");
    assertEquals(r.codigo, 1);
    assertStringIncludes(r.stdout, "projeto desconhecido");
    assertEquals(r.outputs.ref, undefined);
  });
});

// ---------------------------------------------------------------------------
// "No ar ANTES" e modo SÓ LISTAR (ikcous-publicada) — lote do método de
// publicação na CAF, 04/10/2026. O desfazer das edges é redeploy do SHA
// anterior: a versão/updated_at de cada function no instante ANTES do deploy
// tem de ficar registrada no próprio run; e `functions: listar` mede isso sem
// publicar nada, antes de decidir a lista de deploy.
// ---------------------------------------------------------------------------
/** Os passos do job, na ordem: [nome, texto do passo]. Sem comentários. */
function passosDoWorkflow(yaml: string): [string, string][] {
  const corpo = semComentarios(yaml);
  const partes = corpo.split(/\n {6}- /).slice(1);
  return partes.map((p) => {
    const m = p.match(/name: (.+)/);
    return [m ? m[1].trim() : p.split("\n")[0].trim(), p] as [string, string];
  });
}

/** Avalia o `if:` de um passo (só as formas que este workflow usa). */
function seRoda(passo: string, projeto: string, modo: string): boolean {
  const m = passo.match(/\n\s+if: (.+)/);
  if (!m) return true;
  const expr = m[1].replace("${{", "").replace("}}", "").trim();
  assert(/^[\w.' =!&|-]+$/.test(expr), `if com forma não prevista: ${expr}`);
  const js = expr
    .replaceAll("inputs.projeto", JSON.stringify(projeto))
    .replaceAll("steps.alvo.outputs.modo", JSON.stringify(modo))
    .replaceAll("==", "===")
    .replaceAll("!=", "!==");
  return new Function(`return (${js});`)() === true;
}

Deno.test("publicar-functions: o passo 'Lista o que está no ar ANTES' existe só para ikcous-publicada, antes do deploy, igual ao de depois", async () => {
  const yaml = await Deno.readTextFile(WORKFLOW);
  const passos = passosDoWorkflow(yaml);
  const nomes = passos.map(([n]) => n);
  const iAntes = nomes.indexOf("Lista o que está no ar ANTES");
  const iPublica = nomes.indexOf(
    "Publica IKCOUS publicada, uma function por vez",
  );
  const iDepois = nomes.indexOf(
    "Lista o que ficou publicado na IKCOUS publicada",
  );
  assert(iAntes >= 0, "passo ANTES ausente");
  assert(
    iAntes < iPublica && iPublica < iDepois,
    "ordem: ANTES < deploy < depois",
  );
  const antes = passos[iAntes][1];
  const depois = passos[iDepois][1];
  assertStringIncludes(antes, "if: inputs.projeto == 'ikcous-publicada'\n");
  assert(
    !antes.includes("steps.alvo.outputs.modo"),
    "o ANTES roda também no modo listar",
  );
  assertStringIncludes(antes, "${{ secrets.SUPABASE_ACCESS_TOKEN_IKCOUS }}");
  assert(
    !antes.includes("secrets.SUPABASE_ACCESS_TOKEN }}") &&
      !antes.includes("_SAVY"),
  );
  assertStringIncludes(antes, 'supabase functions list --project-ref "$REF"');
  assertStringIncludes(antes, 'echo "## No ar ANTES em \\`$REF\\`"');
  assertStringIncludes(antes, 'tee -a "$GITHUB_STEP_SUMMARY"');
  // idêntico ao de depois, trocando só o título e o if
  const corpoDe = (p: string) => p.slice(p.indexOf("run: |"));
  assertEquals(
    corpoDe(antes).replace("No ar ANTES em", "Publicado em"),
    corpoDe(depois),
    "o run do ANTES é o mesmo do 'Lista o que ficou publicado na IKCOUS publicada', só com outro título",
  );
  // não roda para nenhuma outra loja, em nenhum modo
  for (const projeto of ["savy", "almeida", "sandbox", "loja"]) {
    for (const modo of ["publicar", "listar"]) {
      assertEquals(seRoda(antes, projeto, modo), false, `${projeto}/${modo}`);
    }
  }
  assertEquals(seRoda(antes, "ikcous-publicada", "publicar"), true);
  assertEquals(seRoda(antes, "ikcous-publicada", "listar"), true);
});

Deno.test("publicar-functions: com `listar` NENHUM passo de deploy (nem a prova do banco) roda; com nome real o comportamento é o de sempre", async () => {
  const yaml = await Deno.readTextFile(WORKFLOW);
  const passos = passosDoWorkflow(yaml);
  const deploys = passos.filter(([, p]) =>
    p.includes("supabase functions deploy"),
  );
  assertEquals(
    deploys.length,
    3,
    "os três passos de deploy (padrão, Savy, IKCOUS)",
  );
  for (const [nome, p] of deploys) {
    assertEquals(
      seRoda(p, "ikcous-publicada", "listar"),
      false,
      `${nome} não pode rodar em listar`,
    );
  }
  const prova = passos.find(([n]) =>
    n.startsWith("Prova somente leitura do banco CAF"),
  );
  assertEquals(seRoda(prova[1], "ikcous-publicada", "listar"), false);
  const depois = passos.find(
    ([n]) => n === "Lista o que ficou publicado na IKCOUS publicada",
  );
  assertEquals(
    seRoda(depois[1], "ikcous-publicada", "listar"),
    false,
    "nada foi publicado: sem a lista de depois",
  );
  // com nome real: exatamente UM deploy por projeto, o de sempre
  const esperado: Record<string, string> = {
    "ikcous-publicada": "Publica IKCOUS publicada, uma function por vez",
    savy: "Publica Savy, uma function por vez",
    almeida: "Publica, uma function por vez, sempre pelo nome",
    sandbox: "Publica, uma function por vez, sempre pelo nome",
    loja: "Publica, uma function por vez, sempre pelo nome",
  };
  for (const [projeto, nomeDoPasso] of Object.entries(esperado)) {
    const rodam = deploys
      .filter(([, p]) => seRoda(p, projeto, "publicar"))
      .map(([n]) => n);
    assertEquals(rodam, [nomeDoPasso], projeto);
  }
  assertEquals(
    seRoda(prova[1], "ikcous-publicada", "publicar"),
    true,
    "a prova segue rodando antes do deploy",
  );
  // o segredo e o setup-cli continuam rodando no listar (o list precisa deles)
  const segredo = passos.find(
    ([n]) => n === "Confere o segredo IKCOUS publicada",
  );
  assertEquals(seRoda(segredo[1], "ikcous-publicada", "listar"), true);
});

Deno.test("publicar-functions: `functions` exatamente `listar` em ikcous-publicada valida (SHA continua exigido), sem nome, modo listar; nas outras lojas e misturado a outros nomes segue recusado", async () => {
  const sha = "a".repeat(40);
  const r = await validar("ikcous-publicada", "listar", sha);
  assertEquals(r.codigo, 0, r.stdout + r.stderr);
  assertEquals(r.outputs.modo, "listar");
  assertEquals(r.outputs.nomes, "");
  assertEquals(r.outputs.ref, REF_IKCOUS_PUBLICADA);
  const comEspaco = await validar("ikcous-publicada", "  listar \n", sha);
  assertEquals(comEspaco.outputs.modo, "listar");
  // expected_sha NÃO é afrouxado
  for (const expected of ["", "b".repeat(40), "a".repeat(39), "g".repeat(40)]) {
    const s = await validar("ikcous-publicada", "listar", expected);
    assertEquals(s.codigo, 1, expected);
    assertStringIncludes(s.stdout, "exige expected_sha");
    assertEquals(s.outputs, {});
  }
  // fora de ikcous-publicada, "listar" é um nome como outro qualquer: não existe a function
  for (const projeto of ["savy", "almeida", "sandbox", "loja"]) {
    const s = await validar(
      projeto,
      "listar",
      projeto === "sandbox" || projeto === "loja" ? "" : sha,
    );
    assertEquals(s.codigo, 1, projeto);
    assertEquals(s.outputs, {}, projeto);
  }
  // misturado com outro nome, não é o modo listar
  for (const pedido of [
    "listar,criar-pagamento",
    "criar-pagamento listar",
    "listar,",
  ]) {
    const s = await validar("ikcous-publicada", pedido, sha);
    assertEquals(s.codigo, 1, pedido);
    assertEquals(s.outputs, {});
  }
  // com nome real, modo publicar e o resto igual
  const real = await validar("ikcous-publicada", "cobranca", sha);
  assertEquals(real.codigo, 0);
  assertEquals(real.outputs.modo, "publicar");
  assertEquals(real.outputs.nomes, AS_CINCO_DA_COBRANCA);
  const loja = await validar("loja", "credenciais-mercado-pago");
  assertEquals(loja.outputs.modo, "publicar");
  assertEquals(loja.outputs.nomes, "credenciais-mercado-pago");
});

// 09/10/2026: o comprovante da venda de balcão compartilha
// `_shared/pedido.ts` e `_shared/comprovante.ts` com as functions financeiras
// E com a send-order-confirmation. Se a release muda esses arquivos e a
// send-order-confirmation não pode ser publicada nas lojas reais, a release
// trava (ela ficaria PARADA pelo nome). Por isso IKCOUS e Savy — e SÓ elas —
// admitem a sexta function. Almeida (loja cliente de teste) continua nas cinco.
Deno.test("publicar-functions: send-order-confirmation sobe na IKCOUS e na Savy, só ali, e as cinco financeiras continuam iguais", async (t) => {
  const sha = "a".repeat(40);
  const CONFIRMACAO = "send-order-confirmation";

  for (const projeto of ["ikcous-publicada", "savy"]) {
    await t.step(
      `${projeto} admite a ${CONFIRMACAO}, sozinha ou junto das financeiras`,
      async () => {
        const sozinha = await validar(projeto, CONFIRMACAO, sha);
        assertEquals(sozinha.codigo, 0, sozinha.stdout + sozinha.stderr);
        assertEquals(sozinha.outputs.nomes, CONFIRMACAO);
        assertEquals(
          sozinha.outputs.ref,
          projeto === "savy" ? REF_SAVY : REF_IKCOUS_PUBLICADA,
        );

        const junto = await validar(
          projeto,
          `criar-pagamento,${CONFIRMACAO}`,
          sha,
        );
        assertEquals(junto.codigo, 0, junto.stdout + junto.stderr);
        assertEquals(junto.outputs.nomes, `criar-pagamento ${CONFIRMACAO}`);
      },
    );

    await t.step(
      `${projeto} continua exigindo o SHA exato para a ${CONFIRMACAO}`,
      async () => {
        for (const expected of ["", "b".repeat(40), "a".repeat(39)]) {
          const r = await validar(projeto, CONFIRMACAO, expected);
          assertEquals(r.codigo, 1, expected);
          assertStringIncludes(r.stdout, "exige expected_sha");
          assertEquals(r.outputs, {});
        }
      },
    );

    await t.step(
      `${projeto} continua RECUSANDO todas as outras fora das cinco`,
      async () => {
        for (const nome of [
          "send-otp-email",
          "notify-new-order",
          "send-push",
          "calculate-shipping",
          "melhor-envio-etiqueta",
          "_shared",
          "send-order-whatsapp",
        ]) {
          for (const pedido of [
            nome,
            `${CONFIRMACAO},${nome}`,
            `${nome} criar-pagamento`,
          ]) {
            const r = await validar(projeto, pedido, sha);
            assertEquals(
              r.codigo,
              1,
              `${projeto}: "${pedido}" deveria ser recusado`,
            );
            assertEquals(
              r.outputs,
              {},
              `${projeto}: "${pedido}" não pode virar output`,
            );
          }
        }
      },
    );
  }

  await t.step(
    "Almeida NÃO ganhou a send-order-confirmation: recusa com a mensagem de sempre",
    async () => {
      for (const pedido of [CONFIRMACAO, `criar-pagamento,${CONFIRMACAO}`]) {
        const r = await validar("almeida", pedido, sha);
        assertEquals(r.codigo, 1, pedido);
        assertStringIncludes(
          r.stdout,
          "só admite as cinco Functions financeiras",
        );
        assertEquals(r.outputs, {});
      }
    },
  );

  await t.step(
    "o apelido `cobranca` continua sendo SÓ as cinco (a sexta não entra por ele)",
    async () => {
      for (const projeto of ["ikcous-publicada", "savy", "almeida"]) {
        const r = await validar(projeto, "cobranca", sha);
        assertEquals(r.codigo, 0, r.stdout + r.stderr);
        assertEquals(r.outputs.nomes, AS_CINCO_DA_COBRANCA);
        assert(!r.outputs.nomes.includes(CONFIRMACAO));
      }
    },
  );

  await t.step(
    "fora das lojas cliente nada mudou: loja e sandbox seguem sem trava de nome",
    async () => {
      for (const projeto of ["loja", "sandbox"]) {
        const r = await validar(projeto, CONFIRMACAO);
        assertEquals(r.codigo, 0, r.stdout + r.stderr);
        assertEquals(r.outputs.nomes, CONFIRMACAO);
      }
    },
  );

  await t.step(
    "nenhum passo do workflow passa --no-verify-jwt (a verdade é o config.toml)",
    () => {
      assert(
        !semComentarios(Deno.readTextFileSync(WORKFLOW)).includes(
          "--no-verify-jwt",
        ),
      );
    },
  );
});

// O portão da release (scripts/frota/publicar-release.mjs) só imprime comando
// de publicação para o que está em `functionsPublicaveis` do canal; o workflow
// é quem de fato aceita ou recusa o nome. Se as duas listas divergirem, ou a
// release imprime um comando que o workflow recusa, ou trava uma function que
// o workflow aceitaria. Este teste roda o bash REAL do workflow contra cada
// pasta de supabase/functions/ e exige a mesma resposta do JSON, nos dois sentidos.
Deno.test("publicar-functions: o JSON dos canais e o workflow concordam, function por function, nos dois sentidos", async () => {
  const canais = JSON.parse(
    await Deno.readTextFile(`${RAIZ}/scripts/frota/canais-de-backend.json`),
  );
  const naoPublicadas = new Set(["_shared", ...canais.funcoesNaoPublicadas]);
  assert(
    naoPublicadas.has("send-order-whatsapp"),
    "send-order-whatsapp precisa continuar fora da lista",
  );
  const pastas: string[] = [];
  for await (const e of Deno.readDir(`${RAIZ}/supabase/functions`)) {
    if (e.isDirectory && !naoPublicadas.has(e.name)) pastas.push(e.name);
  }
  pastas.sort();
  assert(pastas.length >= 10, `pastas achadas: ${pastas.join(",")}`);

  const sha = "a".repeat(40);
  const nomesDosCanais = Object.values(canais.canais).map((c) => c.nome);
  assertEquals(nomesDosCanais.sort(), ["IKCOUS", "Savy"]);

  for (const [ref, canal] of Object.entries(canais.canais)) {
    const publicaveis = new Set(canal.functionsPublicaveis);
    for (const nome of publicaveis) {
      assert(
        pastas.includes(nome),
        `${canal.nome}: "${nome}" está em functionsPublicaveis mas não existe em supabase/functions/`,
      );
    }
    for (const nome of pastas) {
      const r = await validar(canal.functions, nome, sha);
      assertEquals(
        r.codigo === 0,
        publicaveis.has(nome),
        `${canal.nome} (${ref}): o workflow ${r.codigo === 0 ? "ACEITA" : "RECUSA"} "${nome}", mas o JSON ${publicaveis.has(nome) ? "a lista como publicável" : "não a lista"}`,
      );
    }
  }
});
