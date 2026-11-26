// @ts-nocheck
/* eslint-disable security/detect-object-injection, security/detect-non-literal-require -- teste: as chaves vêm de constantes e do cadastro de fixture; os módulos exigidos são os de scripts/frota deste repositório. */
/**
 * O CADASTRO DA LOJA NOVA nos arquivos do repositório que listam as lojas
 * (nova-loja B5, 26/11/2026; scripts/frota/cadastro-da-loja.mjs).
 *
 * Tudo roda numa CÓPIA temporária da árvore (os scripts de frota, os dois
 * cadastros, a política e os workflows): nenhum arquivo real é tocado e
 * nenhuma loja de verdade é cadastrada.
 *
 * O QUE ESTES TESTES MEDEM:
 *  1. Sem --aplicar: o comando mostra o diff e o SQL e NÃO escreve nada (os
 *     bytes de todos os arquivos da árvore ficam iguais).
 *  2. Com --aplicar: a loja entra em lojas.json (assinante, segredo
 *     SUPABASE_ACCESS_TOKEN_<SLUG>, functionsNomeadas true), em
 *     canais-de-backend.json (o mesmo canal das assinantes) e nos 8 workflows
 *     (pelo GERADOR), e o resultado passa nas guardas que já existem:
 *     validarCadastro, lerCanais, a concordância dos dois cadastros e o
 *     `lojas-nos-workflows.cjs --conferir`.
 *  3. As lojas que já existem ficam byte a byte iguais: o diff fora da loja
 *     nova é vazio (IKCOUS, Savy, os alvos legado e a política, onde moram as
 *     lojas de teste descontinuadas).
 *  4. Rodar duas vezes não muda nada; cadastro interrompido no meio converge.
 *  5. Recusa: slug repetido com outro ref, ref de outra loja, a mesma loja com
 *     outro nome, slug/ref/nome/domínio/chave fora do formato, workflows já
 *     fora de sincronia.
 *  6. O SQL da caderneta (frota_lojas) só é GERADO, com ON CONFLICT (id) DO NOTHING.
 *  7. CRLF é preservado.
 */
import { createRequire } from "node:module";
import { parse } from "https://deno.land/std@0.177.0/encoding/yaml.ts";
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { lerCanais } from "../scripts/frota/publicar-release.mjs";

const require = createRequire(import.meta.url);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const lojasMod = require(join(RAIZ, "scripts/frota/lojas.cjs"));
const gerador = require(join(RAIZ, "scripts/frota/lojas-nos-workflows.cjs"));

const SCRIPT_REL = "scripts/frota/cadastro-da-loja.mjs";
const ARQUIVOS_COPIADOS = [
  SCRIPT_REL,
  "scripts/frota/lojas.cjs",
  "scripts/frota/lojas-nos-workflows.cjs",
  "scripts/frota/lojas.json",
  "scripts/frota/canais-de-backend.json",
  "scripts/frota/politica.json",
];
const OITO_WORKFLOWS = [
  "aplicar-migrations.yml",
  "conferir-banco-da-loja.yml",
  "publicar-functions.yml",
  "instalar-chave-da-loja.yml",
  "medir-auth-da-loja.yml",
  "ativar-email-do-login.yml",
  "ativar-google-do-login.yml",
  "login-da-loja.yml",
];

// A loja INVENTADA: slug, ref e nome que não existem em lugar nenhum.
const NOVA = "loja-da-ana";
const REF_NOVA = "qwertyuiopasdfghjklz";
const NOME_NOVO = "Loja da Ana";
const SEGREDO_NOVO = "SUPABASE_ACCESS_TOKEN_LOJA_DA_ANA";
const CHAVE_PUBLICA = "sb_publishable_exemplo-de-teste_123";
const REF_SAVY = "gnjsrucsmjkajijrakzr";
const REF_CAF = "cafkrminfnokvgjqtkle";
const ARGS_NOVA = ["--loja", NOVA, "--projeto", REF_NOVA, "--nome", NOME_NOVO];

const dec = new TextDecoder();

/** Cópia da árvore mínima: scripts de frota, cadastros, política e workflows. */
function arvore(): string {
  const raiz = Deno.makeTempDirSync({ prefix: "cadastro-da-loja-" });
  const copiar = (rel: string) => {
    const destino = join(raiz, rel);
    Deno.mkdirSync(join(destino, ".."), { recursive: true });
    Deno.copyFileSync(join(RAIZ, rel), destino);
  };
  for (const rel of ARQUIVOS_COPIADOS) copiar(rel);
  for (const e of Deno.readDirSync(join(RAIZ, ".github/workflows")))
    if (e.isFile && e.name.endsWith(".yml"))
      copiar(`.github/workflows/${e.name}`);
  return raiz;
}

/** Todos os arquivos da árvore, caminho relativo → bytes como texto latin1. */
function fotografia(raiz: string): Record<string, string> {
  const foto: Record<string, string> = {};
  const andar = (dir: string, rel: string) => {
    for (const e of Deno.readDirSync(dir)) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory) andar(join(dir, e.name), r);
      else
        foto[r] = Array.from(Deno.readFileSync(join(dir, e.name)))
          .map((b) => String.fromCharCode(b))
          .join("");
    }
  };
  andar(raiz, "");
  return foto;
}

const ler = (raiz: string, rel: string) =>
  Deno.readTextFileSync(join(raiz, rel));

async function cadastrar(raiz: string, args: string[]) {
  const r = await new Deno.Command("node", {
    args: [join(raiz, SCRIPT_REL), ...args],
    cwd: raiz,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    codigo: r.code,
    saida: dec.decode(r.stdout) + dec.decode(r.stderr),
  };
}

async function noArvoreOriginal(fn: (raiz: string) => Promise<void>) {
  const raiz = arvore();
  try {
    await fn(raiz);
  } finally {
    Deno.removeSync(raiz, { recursive: true });
  }
}

/** As guardas que já existem (frota_lojas_test, publicar-release), sobre a árvore. */
async function passaNasGuardas(raiz: string) {
  const cad = lojasMod.carregarLojas(join(raiz, "scripts/frota/lojas.json"));
  const canais = lerCanais(join(raiz, "scripts/frota/canais-de-backend.json"));
  // os dois cadastros concordam (a mesma régua de tests/frota_lojas_test.ts)
  const nomeadas = [
    "send-order-confirmation",
    "calculate-shipping",
    "notify-new-order",
    "send-otp-email",
    "melhor-envio-etiqueta",
    "send-push",
    "credenciais-email",
    "auth-send-email",
  ];
  for (const [ref, c] of Object.entries(canais.canais)) {
    for (const alvo of [c.migrations, c.functions]) {
      const loja = lojasMod.lojaDoProjeto(alvo, cad);
      assert(loja, `canal ${ref}: alvo ${alvo} não está no lojas.json`);
      assertEquals(loja.classe, "assinante");
      assertEquals(loja.ref, ref);
      assertEquals(loja.refDasFunctions, ref);
    }
    assertEquals(
      lojasMod.lojaDoProjeto(c.functions, cad).functionsNomeadas,
      nomeadas.every((n) => c.functionsPublicaveis.includes(n)),
      `canal ${ref}: functionsNomeadas e functionsPublicaveis divergem`,
    );
  }
  // os workflows em sincronia com o cadastro (o gerador de verdade, na árvore)
  const conferir = await new Deno.Command("node", {
    args: [join(raiz, "scripts/frota/lojas-nos-workflows.cjs"), "--conferir"],
    cwd: raiz,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(
    conferir.code,
    0,
    dec.decode(conferir.stdout) + dec.decode(conferir.stderr),
  );
  return { cad, canais };
}

// ---------------------------------------------------------------------------
// 1. Sem --aplicar: nada é escrito
// ---------------------------------------------------------------------------
Deno.test("sem --aplicar: mostra o diff e o SQL e não escreve nenhum byte", async () => {
  await noArvoreOriginal(async (raiz) => {
    const antes = fotografia(raiz);
    const r = await cadastrar(raiz, [
      ...ARGS_NOVA,
      "--chave-publica",
      CHAVE_PUBLICA,
    ]);
    assertEquals(r.codigo, 0, r.saida);
    assertEquals(fotografia(raiz), antes, "o ensaio escreveu na árvore");
    assertStringIncludes(r.saida, `+    "${NOVA}": {`);
    assertStringIncludes(r.saida, `"segredoDoToken": "${SEGREDO_NOVO}"`);
    assertStringIncludes(r.saida, `"${REF_NOVA}": {`);
    assertStringIncludes(r.saida, `- ${NOVA}`);
    assertStringIncludes(r.saida, "INSERT INTO public.frota_lojas");
    assertStringIncludes(r.saida, "ENSAIO");
    assertStringIncludes(r.saida, "--aplicar");
  });
});

// ---------------------------------------------------------------------------
// 2. Com --aplicar: todos os lugares, e as guardas de hoje aceitam
// ---------------------------------------------------------------------------
Deno.test("com --aplicar: a loja entra em lojas.json, canais e nos 8 workflows, e passa nas guardas existentes", async () => {
  await noArvoreOriginal(async (raiz) => {
    const r = await cadastrar(raiz, [...ARGS_NOVA, "--aplicar"]);
    assertEquals(r.codigo, 0, r.saida);

    const bruto = JSON.parse(ler(raiz, "scripts/frota/lojas.json"));
    assertEquals(Object.keys(bruto.lojas).at(-1), NOVA, "entra no fim");
    assertEquals(bruto.lojas[NOVA], {
      ref: REF_NOVA,
      classe: "assinante",
      apelido: NOME_NOVO,
      segredoDoToken: SEGREDO_NOVO,
      functionsNomeadas: true,
    });

    const { cad, canais } = await passaNasGuardas(raiz);
    assertEquals(lojasMod.lojaDoProjeto(NOVA, cad).refDasFunctions, REF_NOVA);
    const savy = canais.canais[REF_SAVY];
    assertEquals(Object.keys(canais.canais).at(-1), REF_NOVA);
    assertEquals(canais.canais[REF_NOVA], {
      nome: NOME_NOVO,
      migrations: NOVA,
      functions: NOVA,
      projetosNoMesmoBanco: [],
      functionsPublicaveis: savy.functionsPublicaveis,
    });

    for (const nome of OITO_WORKFLOWS) {
      const texto = ler(raiz, `.github/workflows/${nome}`);
      const doc = parse(texto);
      const opcoes = (doc.on ?? doc[true]).workflow_dispatch.inputs.projeto
        .options;
      assert(opcoes.includes(NOVA), `${nome}: a loja nova não está no menu`);
      assertStringIncludes(texto, `secrets.${SEGREDO_NOVO}`, nome);
      for (const l of texto.split("\n").filter((x) => x.includes(SEGREDO_NOVO)))
        assertStringIncludes(
          l,
          `inputs.projeto == '${NOVA}' && secrets.${SEGREDO_NOVO}`,
          `${nome}: segredo novo sem a guarda da loja`,
        );
    }
    // Desde o #1923 o mapa do grupo de concorrência guarda só as lojas que
    // dividem banco com outra; loja de banco próprio usa o próprio nome.
    const aplicar = ler(raiz, ".github/workflows/aplicar-migrations.yml");
    assert(
      !aplicar.includes(`"${NOVA}":`),
      "grupo de concorrência: loja de banco próprio não entra no mapa",
    );
    assertStringIncludes(
      aplicar,
      "[inputs.projeto] || inputs.projeto }}",
      "grupo de concorrência por banco cai no próprio nome da loja",
    );
    assertStringIncludes(r.saida, "gravado");
  });
});

// ---------------------------------------------------------------------------
// 3. As lojas que já existem: byte a byte
// ---------------------------------------------------------------------------
/** `depois` é `antes` com UM trecho inserido; devolve o trecho. */
function trechoInserido(antes: string, depois: string): string {
  let i = 0;
  while (i < antes.length && antes[i] === depois[i]) i++;
  const inserido = depois.slice(i, depois.length - (antes.length - i));
  assertEquals(
    depois,
    antes.slice(0, i) + inserido + antes.slice(i),
    "o arquivo mudou fora de um trecho único inserido",
  );
  return inserido;
}

Deno.test("as lojas que já existem ficam byte a byte iguais: o diff fora da loja nova é vazio", async () => {
  await noArvoreOriginal(async (raiz) => {
    const antes = fotografia(raiz);
    const r = await cadastrar(raiz, [...ARGS_NOVA, "--aplicar"]);
    assertEquals(r.codigo, 0, r.saida);
    const depois = fotografia(raiz);

    const mudaram = Object.keys(depois).filter((k) => depois[k] !== antes[k]);
    assertEquals(Object.keys(depois).sort(), Object.keys(antes).sort());
    assertEquals(
      mudaram.sort(),
      [
        "scripts/frota/canais-de-backend.json",
        "scripts/frota/lojas.json",
        ...OITO_WORKFLOWS.map((n) => `.github/workflows/${n}`),
      ].sort(),
      "só os dois cadastros e os 8 workflows podem mudar",
    );

    // lojas.json e canais: UM trecho inserido, que não cita loja existente
    const existentes = ["loja", "sandbox", "ikcous-publicada", "savy"];
    for (const rel of [
      "scripts/frota/lojas.json",
      "scripts/frota/canais-de-backend.json",
    ]) {
      const ins = trechoInserido(antes[rel], depois[rel]);
      for (const x of [...existentes, REF_CAF, REF_SAVY, "IKCOUS", "Savy"])
        assert(!ins.includes(`"${x}"`), `${rel}: o trecho novo cita ${x}`);
      const a = JSON.parse(antes[rel]);
      const d = JSON.parse(depois[rel]);
      const mapaA = a.lojas ?? a.canais;
      const mapaD = d.lojas ?? d.canais;
      for (const k of Object.keys(mapaA))
        assertEquals(JSON.stringify(mapaD[k]), JSON.stringify(mapaA[k]), k);
      // o resto da raiz (comentários, provas de objetos) igual
      for (const k of Object.keys(a))
        if (k !== "lojas" && k !== "canais")
          assertEquals(JSON.stringify(d[k]), JSON.stringify(a[k]), k);
    }

    // o canal novo tem o MESMO texto (formato do biome) que o da Savy, trocando
    // só nome, alvo e projetosNoMesmoBanco (que na Savy já é []), e SEM a linha
    // do enderecoDeReserva: o endereço da Savy é dela (tests/frota_reserva_test.ts
    // reprova endereço declarado por dois canais), e o cadastro não escreve o
    // endereço da loja nova (nem a reserva em politica.json)
    const canaisTxt = depois["scripts/frota/canais-de-backend.json"];
    const bloco = (ref: string) => {
      const ini = canaisTxt.indexOf(`    "${ref}": {`);
      return canaisTxt.slice(ini, canaisTxt.indexOf("\n    }", ini) + 6);
    };
    const linhaDaReservaDaSavy = /\r?\n {6}"enderecoDeReserva": "[^"]*",/;
    assert(linhaDaReservaDaSavy.test(bloco(REF_SAVY)), bloco(REF_SAVY));
    assert(!bloco(REF_NOVA).includes("enderecoDeReserva"), bloco(REF_NOVA));
    assertEquals(
      bloco(REF_NOVA),
      bloco(REF_SAVY)
        .replace(linhaDaReservaDaSavy, "")
        .replace(REF_SAVY, REF_NOVA)
        .replace('"nome": "Savy"', `"nome": "${NOME_NOVO}"`)
        .replaceAll('"savy"', `"${NOVA}"`),
    );

    // workflows: só linhas da loja nova (a cadeia única e o grupo por banco são
    // reescritos com ela); nenhuma linha some além dessas duas
    const GRUPO = "group: banco-da-loja-${{ fromJSON('";
    for (const nome of OITO_WORKFLOWS) {
      const rel = `.github/workflows/${nome}`;
      const a = antes[rel].split("\n");
      const n = depois[rel].split("\n");
      const novas = n.filter((l) => !a.includes(l));
      assert(
        novas.length >= 1 &&
          novas.every(
            (l) =>
              l.includes(SEGREDO_NOVO) ||
              l.trim() === `- ${NOVA}` ||
              (l.includes(GRUPO) && l.includes(`"${NOVA}":"${REF_NOVA}"`)),
          ),
        `${nome}: linhas novas inesperadas:\n${novas.join("\n")}`,
      );
      const sumiram = a.filter((l) => !n.includes(l));
      assert(
        sumiram.every(
          (l) =>
            l.includes("SUPABASE_ACCESS_TOKEN: ${{ inputs.projeto ==") ||
            l.includes(GRUPO),
        ),
        `${nome}: linhas sumiram:\n${sumiram.join("\n")}`,
      );
      // sem a loja nova, o gerador devolve o arquivo de antes
      assertEquals(
        gerador.sincronizar(
          depois[rel],
          lojasMod.carregarLojas(join(RAIZ, "scripts/frota/lojas.json")),
        ),
        antes[rel],
        nome,
      );
    }
  });
});

Deno.test("campo que o cadastro não conhece, nas lojas que já existem, sai byte a byte igual e não vaza para a loja nova", async () => {
  // O próximo campo de canal (como o enderecoDeReserva de 26/11/2026) chega
  // antes de o cadastro saber dele: as lojas existentes não podem perdê-lo, e a
  // loja nova não pode herdar o valor de outra. (lojas.json tem lista FECHADA de
  // campos em lojas.cjs: campo desconhecido ali já é recusa, não entra aqui.)
  await noArvoreOriginal(async (raiz) => {
    const rel = "scripts/frota/canais-de-backend.json";
    const original = ler(raiz, rel);
    const comCampo = original
      .replace(
        /(\r?\n)( {6})"projetosNoMesmoBanco": /g,
        (_m, eol, recuo) =>
          `${eol}${recuo}"campoFuturo": { "x": [1, "dois"] },${eol}${recuo}"projetosNoMesmoBanco": `,
      )
      .replace(/^\{(\r?\n)/, (_m, eol) => `{${eol}  "_campoFuturo": 7,${eol}`);
    const brutoAntes = JSON.parse(comCampo);
    const refsExistentes = Object.keys(brutoAntes.canais);
    assert(refsExistentes.length >= 2);
    for (const r of refsExistentes)
      assertEquals(brutoAntes.canais[r].campoFuturo, { x: [1, "dois"] }, r);
    Deno.writeTextFileSync(join(raiz, rel), comCampo);

    const antes = fotografia(raiz);
    const r = await cadastrar(raiz, [...ARGS_NOVA, "--aplicar"]);
    assertEquals(r.codigo, 0, r.saida);
    const depois = fotografia(raiz);

    const ins = trechoInserido(antes[rel], depois[rel]);
    assert(!ins.includes("campoFuturo"), ins);
    const d = JSON.parse(depois[rel]);
    assertEquals(d._campoFuturo, 7);
    for (const ref of refsExistentes)
      assertEquals(
        JSON.stringify(d.canais[ref]),
        JSON.stringify(brutoAntes.canais[ref]),
        ref,
      );
    assert(!Object.hasOwn(d.canais[REF_NOVA], "campoFuturo"));
    assertEquals(
      depois["scripts/frota/politica.json"],
      antes["scripts/frota/politica.json"],
    );

    // e a segunda rodada continua sem mudar nada
    assertEquals(
      (await cadastrar(raiz, [...ARGS_NOVA, "--aplicar"])).codigo,
      0,
    );
    assertEquals(fotografia(raiz), depois);
  });
});

// ---------------------------------------------------------------------------
// 4. Idempotência e cadastro interrompido no meio
// ---------------------------------------------------------------------------
Deno.test("segunda rodada não muda nada (com e sem --aplicar)", async () => {
  await noArvoreOriginal(async (raiz) => {
    assertEquals(
      (await cadastrar(raiz, [...ARGS_NOVA, "--aplicar"])).codigo,
      0,
    );
    const depois1 = fotografia(raiz);
    const r2 = await cadastrar(raiz, [...ARGS_NOVA, "--aplicar"]);
    assertEquals(r2.codigo, 0, r2.saida);
    assertStringIncludes(r2.saida, "nada a fazer");
    assertEquals(fotografia(raiz), depois1);
    const r3 = await cadastrar(raiz, ARGS_NOVA);
    assertEquals(r3.codigo, 0, r3.saida);
    assertStringIncludes(r3.saida, "nada a fazer");
    assertEquals(fotografia(raiz), depois1);
  });
});

Deno.test("cadastro interrompido no meio (só lojas.json gravado, ou lojas.json e workflows) converge na rodada seguinte", async () => {
  await noArvoreOriginal(async (referencia) => {
    const original = fotografia(referencia);
    await cadastrar(referencia, [...ARGS_NOVA, "--aplicar"]);
    const fim = fotografia(referencia);
    for (const restaurar of [
      // parou depois de lojas.json
      (rel: string) => rel !== "scripts/frota/lojas.json",
      // parou depois dos workflows (falta só o canal)
      (rel: string) => rel === "scripts/frota/canais-de-backend.json",
    ]) {
      await noArvoreOriginal(async (raiz) => {
        await cadastrar(raiz, [...ARGS_NOVA, "--aplicar"]);
        for (const rel of Object.keys(original))
          if (restaurar(rel))
            Deno.writeFileSync(
              join(raiz, rel),
              Uint8Array.from(original[rel], (c) => c.charCodeAt(0)),
            );
        const r = await cadastrar(raiz, [...ARGS_NOVA, "--aplicar"]);
        assertEquals(r.codigo, 0, r.saida);
        assertEquals(fotografia(raiz), fim);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Recusas — e nenhuma escreve
// ---------------------------------------------------------------------------
Deno.test("recusa slug repetido com outro ref, ref que já é de outra loja e a mesma loja com outro nome — sem escrever", async () => {
  await noArvoreOriginal(async (raiz) => {
    const antes = fotografia(raiz);
    const casos = [
      {
        args: ["--loja", "savy", "--projeto", REF_NOVA, "--nome", "Savy"],
        espera: "outro ref",
      },
      {
        args: ["--loja", "sandbox", "--projeto", REF_NOVA, "--nome", "X"],
        espera: "outro ref",
      },
      {
        args: ["--loja", NOVA, "--projeto", REF_SAVY, "--nome", NOME_NOVO],
        espera: "savy",
      },
      {
        args: ["--loja", NOVA, "--projeto", REF_CAF, "--nome", NOME_NOVO],
        espera: "já é",
      },
      {
        // slug novo cujo segredo (SUPABASE_ACCESS_TOKEN_IKCOUS) já é da IKCOUS
        args: ["--loja", "ikcous", "--projeto", REF_NOVA, "--nome", "IKCOUS"],
        espera: "segredo",
      },
      {
        // a Savy com o mesmo ref, mas este comando nunca altera loja existente
        args: ["--loja", "savy", "--projeto", REF_SAVY, "--nome", "Savy Nova"],
        espera: "não altera",
      },
      {
        // a IKCOUS: lojas.json igual (apelido CAF), mas o canal se chama IKCOUS
        args: [
          "--loja",
          "ikcous-publicada",
          "--projeto",
          REF_CAF,
          "--nome",
          "CAF",
        ],
        espera: "não altera",
      },
    ];
    for (const c of casos) {
      for (const extra of [[], ["--aplicar"]]) {
        const r = await cadastrar(raiz, [...c.args, ...extra]);
        assertEquals(r.codigo, 1, `${c.args.join(" ")}: ${r.saida}`);
        assertStringIncludes(r.saida, "RECUSADO");
        assertStringIncludes(r.saida, c.espera);
        assertEquals(fotografia(raiz), antes, c.args.join(" "));
      }
    }
  });
});

Deno.test("recusa a loja já cadastrada com outro ref também depois de um cadastro (a segunda loja não sobrescreve a primeira)", async () => {
  await noArvoreOriginal(async (raiz) => {
    assertEquals(
      (await cadastrar(raiz, [...ARGS_NOVA, "--aplicar"])).codigo,
      0,
    );
    const depois = fotografia(raiz);
    for (const args of [
      [
        "--loja",
        NOVA,
        "--projeto",
        "zzzzzzzzzzzzzzzzzzzz",
        "--nome",
        NOME_NOVO,
      ],
      ["--loja", NOVA, "--projeto", REF_NOVA, "--nome", "Outro Nome"],
      ["--loja", "outra-loja", "--projeto", REF_NOVA, "--nome", "Outra"],
    ]) {
      const r = await cadastrar(raiz, [...args, "--aplicar"]);
      assertEquals(r.codigo, 1, `${args.join(" ")}: ${r.saida}`);
      assertEquals(fotografia(raiz), depois, args.join(" "));
    }
  });
});

Deno.test("recusa slug, ref, nome, domínio e chave fora do formato, e argumento torto — uso errado, sem escrever", async () => {
  await noArvoreOriginal(async (raiz) => {
    const antes = fotografia(raiz);
    const com = (troca: Record<string, string>, extra: string[] = []) => {
      const v = {
        "--loja": NOVA,
        "--projeto": REF_NOVA,
        "--nome": NOME_NOVO,
        ...troca,
      };
      return [...Object.entries(v).flat(), ...extra, "--aplicar"];
    };
    const casos = [
      com({ "--loja": "Loja-Da-Ana" }),
      com({ "--loja": "a" }),
      com({ "--loja": "1loja" }),
      com({ "--loja": "loja_da_ana" }),
      com({ "--loja": "__proto__" }),
      // o nome do segredo teria mais de 24 caracteres depois do prefixo
      com({ "--loja": "uma-loja-com-nome-comprido" }),
      com({ "--projeto": "qwertyuiopasdfghjkl" }),
      com({ "--projeto": "qwertyuiopasdfghjkl1" }),
      com({ "--projeto": "QWERTYUIOPASDFGHJKLZ" }),
      com({ "--nome": "" }),
      com({ "--nome": "Loja d'Ana" }),
      com({ "--nome": "Lojã" }),
      com({}, ["--dominio", "http://lojadaana.com.br"]),
      com({}, ["--dominio", "https://lojadaana.com.br/loja"]),
      com({}, ["--dominio", "https://lojadaana.com.br:8443"]),
      com({}, ["--dominio", "https://lojadaana.com.br/?x=1"]),
      com({}, ["--dominio", "https://localhost"]),
      com({}, ["--chave-publica", "sb_secret_abc"]),
      com({}, ["--chave-publica", "eyJhbGciOiJIUzI1NiJ9.e30.x"]),
      com({}, ["--outra", "x"]),
      com({}, ["--loja", "repetida"]),
      ["--loja", NOVA, "--projeto", REF_NOVA, "--aplicar"],
      ["--loja", NOVA, "--projeto", "--nome", NOME_NOVO],
    ];
    for (const args of casos) {
      const r = await cadastrar(raiz, args);
      assertEquals(r.codigo, 2, `${args.join(" ")}: ${r.saida}`);
      assertEquals(fotografia(raiz), antes, args.join(" "));
    }
  });
});

Deno.test("recusa quando os workflows já estão fora de sincronia com lojas.json (o diff não seria só da loja nova)", async () => {
  await noArvoreOriginal(async (raiz) => {
    const rel = ".github/workflows/medir-auth-da-loja.yml";
    const texto = ler(raiz, rel);
    const torto = texto.replace("          - savy\n", "");
    assert(torto !== texto, "fixture: a linha do menu da savy não foi achada");
    Deno.writeTextFileSync(join(raiz, rel), torto);
    const antes = fotografia(raiz);
    const r = await cadastrar(raiz, [...ARGS_NOVA, "--aplicar"]);
    assertEquals(r.codigo, 1, r.saida);
    assertStringIncludes(r.saida, "fora de sincronia");
    assertEquals(fotografia(raiz), antes);
  });
});

// ---------------------------------------------------------------------------
// 6. O SQL da caderneta: só gerado
// ---------------------------------------------------------------------------
Deno.test("o SQL da linha em frota_lojas: ON CONFLICT (id) DO NOTHING, domínio padrão <slug>.vercel.app ou o --dominio, nunca executado", async () => {
  await noArvoreOriginal(async (raiz) => {
    const padrao = await cadastrar(raiz, [
      ...ARGS_NOVA,
      "--chave-publica",
      CHAVE_PUBLICA,
    ]);
    assertEquals(padrao.codigo, 0, padrao.saida);
    assertStringIncludes(
      padrao.saida,
      [
        "INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key, ativa)",
        `VALUES ('${NOVA}', '${NOME_NOVO}', '${NOVA}.vercel.app', '${REF_NOVA}', 'https://${REF_NOVA}.supabase.co', '${CHAVE_PUBLICA}', true)`,
        "ON CONFLICT (id) DO NOTHING;",
      ].join("\n"),
    );
    // a conferência não lê a chave
    assertStringIncludes(
      padrao.saida,
      `SELECT id, nome, dominio_publico, project_ref, supabase_url, estado FROM public.frota_lojas WHERE id = '${NOVA}' OR project_ref = '${REF_NOVA}' OR dominio_publico = '${NOVA}.vercel.app';`,
    );

    const proprio = await cadastrar(raiz, [
      ...ARGS_NOVA,
      "--dominio",
      "https://Loja.DaAna.com.br/",
      "--chave-publica",
      CHAVE_PUBLICA,
    ]);
    assertEquals(proprio.codigo, 0, proprio.saida);
    assertStringIncludes(proprio.saida, "'loja.daana.com.br'");
    assert(!proprio.saida.includes(".vercel.app'"), proprio.saida);

    // sem a chave pública: os arquivos do repo seguem; o SQL fica pendente
    const semChave = await cadastrar(raiz, ARGS_NOVA);
    assertEquals(semChave.codigo, 0, semChave.saida);
    assert(!semChave.saida.includes("INSERT INTO"), semChave.saida);
    assertStringIncludes(semChave.saida, "--chave-publica");

    // nada de rede nem banco no comando
    const fonte = ler(raiz, SCRIPT_REL);
    for (const proibido of [
      "fetch(",
      "child_process",
      'require("pg")',
      'from "pg"',
    ])
      assert(!fonte.includes(proibido), `o comando usa ${proibido}`);
  });
});

// ---------------------------------------------------------------------------
// 7. Fim de linha
// ---------------------------------------------------------------------------
Deno.test("CRLF é preservado nos dois cadastros e nos workflows", async () => {
  await noArvoreOriginal(async (raiz) => {
    const crlf = [
      "scripts/frota/lojas.json",
      "scripts/frota/canais-de-backend.json",
      ".github/workflows/medir-auth-da-loja.yml",
    ];
    for (const rel of crlf)
      Deno.writeTextFileSync(
        join(raiz, rel),
        ler(raiz, rel).replace(/\r?\n/g, "\r\n"),
      );
    const r = await cadastrar(raiz, [...ARGS_NOVA, "--aplicar"]);
    assertEquals(r.codigo, 0, r.saida);
    for (const rel of crlf) {
      const t = ler(raiz, rel);
      assertStringIncludes(t, NOVA, rel);
      assert(!/[^\r]\n/.test(t), `${rel}: LF solto depois do cadastro`);
    }
    const lf = ler(raiz, "scripts/frota/politica.json");
    assert(!lf.includes("\r"), "arquivo LF ganhou CR");
  });
});
