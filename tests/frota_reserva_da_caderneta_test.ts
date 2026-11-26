// @ts-nocheck
/**
 * scripts/frota/reserva-da-caderneta.mjs — o gravador da reserva da caderneta (plano
 * PLANO-RESERVA-DA-CADERNETA-26-11.md, T8). Todas as dependências são dublês: nenhuma rede, nenhum
 * CLI de verdade, nenhuma store. Domínios, refs e chaves são INVENTADOS.
 *
 * O QUE ESTES TESTES MEDEM:
 *  - só entra ficha estável, HTTP 200, caderneta `hit` e UM ref (nunca `reserva`, `miss` nem erro);
 *  - "igual à atual" compara SÓ a lista de lojas (`hosts`): sha e gerada_em diferentes não gravam
 *    (decisão do sócio: 100 gravações por mês no plano grátis);
 *  - diferente = UM PATCH com `upsert`, o corpo no stdin (`--input -`), nunca no argv; depois relê e
 *    confere byte a byte;
 *  - as recusas (vazia, falta loja obrigatória, mais de 900 KB, entrada fora do formato) não tocam a
 *    Vercel, cada uma com o motivo em português;
 *  - sem `globalConfigId` (null) nada é lido nem gravado, e a saída diz que não está configurada;
 *  - falha por cota tem mensagem própria.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  LIMITE_DE_BYTES,
  canonico,
  classificarEndereco,
  criarVercelApi,
  diferenca,
  enderecosIndeterminados,
  executar,
  gravarReserva,
  lojasObrigatoriasDosCanais,
  montarReserva,
} from "../scripts/frota/reserva-da-caderneta.mjs";

const REF_A = `lojaum${"a".repeat(14)}`;
const REF_B = `lojadois${"b".repeat(12)}`;
const REF_C = `lojatres${"c".repeat(12)}`;
const CHAVE_A = "sb_publishable_teste_loja_um";
const CHAVE_B = "sb_publishable_teste_loja_dois";
const CHAVE_C = "sb_publishable_teste_loja_tres";
// Montado por partes para nenhum detector de segredo confundir o fixture.
const CHAVE_SECRETA_INVENTADA = ["sb", "secret", "inventada"].join("_");
const SHA_1 = "1".repeat(40);
const SHA_2 = "2".repeat(40);
const AGORA = Date.parse("2026-11-26T15:00:00Z");
const ID = "ecfg_inventadoparateste";
const TIME = "team_inventadoparateste";

const politicaBase = (globalConfigId = ID) => ({
  projetoVercel: {
    id: "prj_inventado",
    time: TIME,
    escopo: "escopo-inventado",
  },
  lojasSemBackendGerenciado: [],
  enderecosEsperados: [],
  reservaDaCaderneta: { globalConfigId, chave: "reserva_v1" },
});
const canaisBase = () => ({
  canais: {
    [REF_A]: { nome: "Loja Um" },
    [REF_B]: { nome: "Loja Dois" },
  },
});

function sonda(dominio, opcoes = {}) {
  const {
    status = 200,
    caderneta = "hit",
    refs = [REF_A],
    estavel = true,
    chave = CHAVE_A,
  } = opcoes;
  return {
    dominio,
    versao: null,
    ficha: { status, caderneta, refs, estavel, titulo: "Loja" },
    chavePublica: chave,
    errosPagina: [],
    amostras: [],
  };
}
const inventario = (sondas, completo = true) => ({
  origem: completo ? "vercel" : "reserva",
  completo,
  motivoParcial: completo ? null : "sem --vercel",
  dominios: sondas.map((s) => s.dominio),
  vercel: completo ? { ok: true } : null,
  sondas,
});
const frotaBase = () =>
  inventario([
    sonda("loja-um.exemplo.test"),
    sonda("www.loja-um.exemplo.test"),
    sonda("loja-dois.exemplo.test", { refs: [REF_B], chave: CHAVE_B }),
  ]);
const doc = (hosts, sha = SHA_1, gerada_em = "2026-11-25T10:00:00.000Z") => ({
  v: 1,
  gerada_em,
  sha,
  hosts,
});
const entrada = (ref, k) => ({ u: `https://${ref}.supabase.co`, k });

/**
 * Dublê do `vercel api`: guarda cada chamada (argv e stdin) e simula a store. GET do item devolve
 * {key, value} ou nada (204, item ausente); PATCH aplica o upsert.
 */
function dubleVercel({
  atual = null,
  falhaGet = null,
  falhaPatch = null,
  releituraTrocada = null,
} = {}) {
  const chamadas = [];
  const store = { valor: atual, patches: 0 };
  const rodar = async (comando, args, opcoes = {}) => {
    chamadas.push({ comando, args: [...args], entrada: opcoes.entrada ?? "" });
    const metodo = args[args.indexOf("-X") + 1];
    if (metodo === "GET") {
      if (falhaGet) return falhaGet;
      const valor =
        store.patches > 0 && releituraTrocada !== null
          ? releituraTrocada
          : store.valor;
      if (valor === null) return { codigo: 0, stdout: "", stderr: "" };
      return {
        codigo: 0,
        stdout: JSON.stringify({
          key: "reserva_v1",
          value: valor,
          edgeConfigId: ID,
          createdAt: 1,
          updatedAt: 2,
        }),
        stderr: "",
      };
    }
    if (metodo === "PATCH") {
      if (falhaPatch) return falhaPatch;
      const corpo = JSON.parse(opcoes.entrada);
      store.valor = corpo.items[0].value;
      store.patches++;
      return { codigo: 0, stdout: '{"status":"ok"}', stderr: "" };
    }
    throw new Error(`método inesperado ${metodo}`);
  };
  const api = criarVercelApi({
    rodar,
    cli: { comando: "vercel", prefixo: [] },
  });
  return { api, chamadas, store };
}
const config = {
  configurada: true,
  globalConfigId: ID,
  chave: "reserva_v1",
  time: TIME,
};
const obrigatorias = [
  { ref: REF_A, nome: "Loja Um" },
  { ref: REF_B, nome: "Loja Dois" },
];

// ------------------------------------------------------------------ montarReserva

const frotaMista = () =>
  inventario([
    sonda("loja-um.exemplo.test"),
    sonda("loja-dois.exemplo.test", { refs: [REF_B], chave: CHAVE_B }),
    sonda("caiu-na-reserva.exemplo.test", {
      caderneta: "reserva",
      refs: [REF_C],
      chave: CHAVE_C,
    }),
    sonda("sem-loja.exemplo.test", {
      status: 404,
      caderneta: "miss",
      refs: [],
    }),
    sonda("caderneta-erro.exemplo.test", {
      status: 503,
      caderneta: "erro",
      refs: [],
    }),
    sonda("instavel.exemplo.test", {
      estavel: false,
      refs: [REF_C],
      chave: CHAVE_C,
    }),
    sonda("dois-refs.exemplo.test", { refs: [REF_A, REF_C] }),
    {
      dominio: "nao-respondeu.exemplo.test",
      ficha: null,
      chavePublica: null,
      errosPagina: ["x"],
      amostras: [],
    },
  ]);

Deno.test("montarReserva: só ficha estável 200 hit com UM ref; nunca reserva, miss, erro, instável ou dois refs", () => {
  const r = montarReserva(frotaMista(), { sha: SHA_1, agora: AGORA });
  assertEquals(r, {
    v: 1,
    gerada_em: "2026-11-26T15:00:00.000Z",
    sha: SHA_1,
    hosts: {
      "loja-dois.exemplo.test": entrada(REF_B, CHAVE_B),
      "loja-um.exemplo.test": entrada(REF_A, CHAVE_A),
    },
  });
  // ordem dos hosts determinística (texto igual para frota igual)
  assertEquals(Object.keys(r.hosts), [
    "loja-dois.exemplo.test",
    "loja-um.exemplo.test",
  ]);
});

Deno.test("montarReserva: sha e gerada_em são texto NÃO vazio (senão a leitura recusa o documento inteiro)", () => {
  assertThrows(
    () => montarReserva(frotaBase(), { sha: "", agora: AGORA }),
    Error,
    "sha",
  );
  assertThrows(
    () => montarReserva(frotaBase(), { sha: "abc", agora: AGORA }),
    Error,
    "sha",
  );
  assertThrows(
    () => montarReserva(frotaBase(), { sha: SHA_1, agora: Number.NaN }),
    Error,
    "agora",
  );
});

// ------------------------------------------------------------------ diferenca

Deno.test("diferenca: o que entra, o que sai e o que muda; reserva atual ausente = tudo entra", () => {
  const atual = doc({
    "fica.exemplo.test": entrada(REF_A, CHAVE_A),
    "sai.exemplo.test": entrada(REF_B, CHAVE_B),
    "muda-chave.exemplo.test": entrada(REF_C, CHAVE_C),
    "muda-banco.exemplo.test": entrada(REF_A, CHAVE_A),
  });
  const nova = doc(
    {
      "fica.exemplo.test": entrada(REF_A, CHAVE_A),
      "entra.exemplo.test": entrada(REF_B, CHAVE_B),
      "muda-chave.exemplo.test": entrada(REF_C, "sb_publishable_outra_chave"),
      "muda-banco.exemplo.test": entrada(REF_B, CHAVE_A),
    },
    SHA_2,
  );
  assertEquals(diferenca(atual, nova), {
    entram: ["entra.exemplo.test"],
    saem: ["sai.exemplo.test"],
    mudam: ["muda-banco.exemplo.test", "muda-chave.exemplo.test"],
  });
  assertEquals(diferenca(null, nova).entram.length, 4);
  assertEquals(diferenca(null, nova).saem, []);
});

// ------------------------------------------------------------------ gravarReserva

Deno.test("gravarReserva: mesma lista de lojas com sha e gerada_em DIFERENTES não grava (nenhum PATCH)", async () => {
  const nova = montarReserva(frotaBase(), { sha: SHA_2, agora: AGORA });
  const atual = { ...nova, sha: SHA_1, gerada_em: "2026-11-01T00:00:00.000Z" };
  const v = dubleVercel({ atual });
  const r = await gravarReserva({
    nova,
    api: v.api,
    config,
    lojasObrigatorias: obrigatorias,
    indeterminados: [],
  });
  assertEquals(r.ok, true);
  assertEquals(r.estado, "igual");
  assertEquals(v.chamadas.filter((c) => c.args.includes("PATCH")).length, 0);
  assertEquals(v.store.valor, atual, "a store não mudou");
});

Deno.test("gravarReserva: lista diferente = UM PATCH upsert pelo stdin (--input -), sem o corpo no argv; relê e confere", async () => {
  const nova = montarReserva(frotaBase(), { sha: SHA_2, agora: AGORA });
  const atual = doc({ "loja-um.exemplo.test": entrada(REF_A, CHAVE_A) });
  const v = dubleVercel({ atual });
  const r = await gravarReserva({
    nova,
    api: v.api,
    config,
    lojasObrigatorias: obrigatorias,
    indeterminados: [],
  });
  assertEquals(r.ok, true, JSON.stringify(r));
  assertEquals(r.estado, "gravada");
  const patches = v.chamadas.filter((c) => c.args.includes("PATCH"));
  assertEquals(patches.length, 1);
  const p = patches[0];
  assertEquals(p.args, [
    "api",
    `/v1/global-config/${ID}/items?teamId=${TIME}`,
    "-X",
    "PATCH",
    "--input",
    "-",
    "--raw",
  ]);
  // o corpo vai SÓ pelo stdin: nenhum argumento carrega chave, host ou a operação
  for (const a of p.args) {
    assert(
      !a.includes("upsert") &&
        !a.includes("sb_publishable") &&
        !a.includes("exemplo.test"),
      a,
    );
  }
  assertEquals(JSON.parse(p.entrada), {
    items: [{ operation: "upsert", key: "reserva_v1", value: nova }],
  });
  // depois do PATCH, uma releitura do item
  const ultima = v.chamadas.at(-1);
  assertEquals(ultima.args, [
    "api",
    `/v1/global-config/${ID}/item/reserva_v1?teamId=${TIME}`,
    "-X",
    "GET",
    "--raw",
  ]);
  assertEquals(r.diferenca.entram, [
    "loja-dois.exemplo.test",
    "www.loja-um.exemplo.test",
  ]);
});

Deno.test("gravarReserva: store sem a chave (204) grava; reserva atual fora do formato também regrava", async () => {
  const nova = montarReserva(frotaBase(), { sha: SHA_1, agora: AGORA });
  const vazia = dubleVercel({ atual: null });
  assertEquals(
    (
      await gravarReserva({
        nova,
        api: vazia.api,
        config,
        lojasObrigatorias: obrigatorias,
        indeterminados: [],
      })
    ).estado,
    "gravada",
  );
  // mesmos hosts, mas cabeçalho fora do formato (v errado): a leitura recusaria o documento inteiro
  const torta = dubleVercel({ atual: { ...nova, v: 2 } });
  const r = await gravarReserva({
    nova,
    api: torta.api,
    config,
    lojasObrigatorias: obrigatorias,
    indeterminados: [],
  });
  assertEquals(r.estado, "gravada");
  assertEquals(torta.store.patches, 1);
});

Deno.test("gravarReserva: releitura diferente byte a byte = falhou (não diz que gravou)", async () => {
  const nova = montarReserva(frotaBase(), { sha: SHA_1, agora: AGORA });
  const v = dubleVercel({
    atual: null,
    releituraTrocada: { ...nova, sha: SHA_2 },
  });
  const r = await gravarReserva({
    nova,
    api: v.api,
    config,
    lojasObrigatorias: obrigatorias,
    indeterminados: [],
  });
  assertEquals(r.ok, false);
  assertEquals(r.estado, "falhou");
  assertStringIncludes(r.motivos.join("\n"), "releitura");
});

Deno.test("gravarReserva: a reserva atual não lida = nenhum PATCH", async () => {
  const nova = montarReserva(frotaBase(), { sha: SHA_1, agora: AGORA });
  const v = dubleVercel({
    falhaGet: { codigo: 1, stdout: "", stderr: "Error: rede caiu\n" },
  });
  const r = await gravarReserva({
    nova,
    api: v.api,
    config,
    lojasObrigatorias: obrigatorias,
    indeterminados: [],
  });
  assertEquals(r.ok, false);
  assertEquals(r.estado, "falhou");
  assertStringIncludes(r.motivos.join("\n"), "reserva atual não lida");
  assertEquals(v.store.patches, 0);
  assertEquals(v.chamadas.filter((c) => c.args.includes("PATCH")).length, 0);
});

// ------------------------------------------------------------------ recusas (nenhuma chamada à Vercel)

async function recusada(nova, lojas = obrigatorias) {
  const v = dubleVercel({ atual: null });
  const r = await gravarReserva({
    nova,
    api: v.api,
    config,
    lojasObrigatorias: lojas,
    indeterminados: [],
  });
  assertEquals(r.ok, false);
  assertEquals(r.estado, "recusada");
  assertEquals(v.chamadas.length, 0, "recusa não fala com a Vercel");
  return r.motivos.join("\n");
}

Deno.test("recusa: reserva vazia", async () => {
  const m = await recusada(doc({}), []);
  assertStringIncludes(m, "reserva vazia");
});

Deno.test("recusa: falta loja obrigatória (canais-de-backend.json), com o nome dela", async () => {
  const nova = montarReserva(inventario([sonda("loja-um.exemplo.test")]), {
    sha: SHA_1,
    agora: AGORA,
  });
  const m = await recusada(nova);
  assertStringIncludes(m, "Loja Dois");
  assertStringIncludes(m, REF_B);
  assertStringIncludes(m, "obrigatória");
});

Deno.test("lojasObrigatoriasDosCanais: todo canal de canais-de-backend.json, menos as lojas sem backend gerenciado", () => {
  const politica = {
    ...politicaBase(),
    lojasSemBackendGerenciado: [{ ref: REF_B }],
  };
  assertEquals(lojasObrigatoriasDosCanais(canaisBase(), politica), [
    { ref: REF_A, nome: "Loja Um" },
  ]);
  assertEquals(
    lojasObrigatoriasDosCanais(canaisBase(), politicaBase()),
    obrigatorias,
  );
});

Deno.test("recusa: mais de 900 KB", async () => {
  assertEquals(LIMITE_DE_BYTES, 900 * 1000);
  const hosts = {
    "loja-um.exemplo.test": entrada(REF_A, CHAVE_A),
    "loja-dois.exemplo.test": entrada(REF_B, CHAVE_B),
  };
  // chave pública longa, válida no formato: ~1 KB por host
  const longa = `sb_publishable_${"x".repeat(1000)}`;
  for (let i = 0; i < 900; i++)
    hosts[`loja-${i}.exemplo.test`] = entrada(REF_C, longa);
  const m = await recusada(doc(hosts));
  assertStringIncludes(m, "900 KB");
});

Deno.test("recusa: entrada que não passa no validarReserva (chave secreta, endereço fora do padrão, host não normalizado)", async () => {
  const base = {
    "loja-um.exemplo.test": entrada(REF_A, CHAVE_A),
    "loja-dois.exemplo.test": entrada(REF_B, CHAVE_B),
  };
  const m1 = await recusada(
    doc({
      ...base,
      "segredo.exemplo.test": entrada(REF_C, CHAVE_SECRETA_INVENTADA),
    }),
  );
  assertStringIncludes(m1, "segredo.exemplo.test");
  const m2 = await recusada(
    doc({
      ...base,
      "outro.exemplo.test": { u: "https://exemplo.test", k: CHAVE_C },
    }),
  );
  assertStringIncludes(m2, "outro.exemplo.test");
  const m3 = await recusada(
    doc({ ...base, "Maiuscula.Exemplo.test": entrada(REF_C, CHAVE_C) }),
  );
  assertStringIncludes(m3, "Maiuscula.Exemplo.test");
  // loja hit cuja ficha não trouxe chave pública: entra no documento e a recusa diz o host
  const nova = montarReserva(
    inventario([
      ...frotaBase().sondas,
      sonda("sem-chave.exemplo.test", { refs: [REF_C], chave: null }),
    ]),
    { sha: SHA_1, agora: AGORA },
  );
  assertStringIncludes(await recusada(nova), "sem-chave.exemplo.test");
});

// ------------------------------------------------------------------ não configurada / cota

Deno.test("não configurada (globalConfigId null): nada é lido nem gravado, e diz por quê", async () => {
  const nova = montarReserva(frotaBase(), { sha: SHA_1, agora: AGORA });
  const v = dubleVercel({ atual: null });
  const r = await gravarReserva({
    nova,
    api: v.api,
    config: {
      configurada: false,
      globalConfigId: null,
      chave: "reserva_v1",
      time: TIME,
    },
    lojasObrigatorias: obrigatorias,
    indeterminados: [],
  });
  assertEquals(r.ok, false);
  assertEquals(r.estado, "nao-configurada");
  assertStringIncludes(r.motivos.join("\n"), "não está configurada");
  assertEquals(v.chamadas.length, 0);
});

Deno.test("cota: PATCH recusado pelo limite de gravações do plano grátis tem mensagem própria", async () => {
  const nova = montarReserva(frotaBase(), { sha: SHA_1, agora: AGORA });
  const v = dubleVercel({
    atual: null,
    falhaPatch: {
      codigo: 1,
      stdout:
        '{"error":{"code":"payment_required","message":"Edge Config writes limit exceeded"}}',
      stderr: "Error: Request failed with status 402\n",
    },
  });
  const r = await gravarReserva({
    nova,
    api: v.api,
    config,
    lojasObrigatorias: obrigatorias,
    indeterminados: [],
  });
  assertEquals(r.ok, false);
  assertEquals(r.estado, "cota");
  assertStringIncludes(r.motivos.join("\n"), "limite de gravações");
  assertStringIncludes(r.motivos.join("\n"), "100");
  // falha que não é cota NÃO vira a mensagem de cota
  const outra = dubleVercel({
    atual: null,
    falhaPatch: {
      codigo: 1,
      stdout: "",
      stderr: "Error: Request failed with status 500\n",
    },
  });
  const r2 = await gravarReserva({
    nova,
    api: outra.api,
    config,
    lojasObrigatorias: obrigatorias,
    indeterminados: [],
  });
  assertEquals(r2.estado, "falhou");
  assert(!r2.motivos.join("\n").includes("limite de gravações"));
});

// ------------------------------------------------------------------ linha de comando

function depsDoComando({
  politica = politicaBase(),
  inv = frotaBase(),
  vercel = dubleVercel(),
} = {}) {
  return {
    deps: {
      politica,
      canais: canaisBase(),
      inventariar: async () => inv,
      api: vercel.api,
      agora: () => AGORA,
    },
    vercel,
  };
}

Deno.test("CLI --conferir: só lê e imprime a diferença, nunca PATCH", async () => {
  const { deps, vercel } = depsDoComando({
    vercel: dubleVercel({
      atual: doc({
        "loja-um.exemplo.test": entrada(REF_A, CHAVE_A),
        "velha.exemplo.test": entrada(REF_C, CHAVE_C),
      }),
    }),
  });
  const r = await executar(["--conferir", "--sha", SHA_1], deps);
  assertEquals(r.codigo, 0, r.erros.join("\n"));
  assertEquals(
    vercel.chamadas.filter((c) => c.args.includes("PATCH")).length,
    0,
  );
  const texto = r.saida.join("\n");
  assertStringIncludes(texto, "entra: loja-dois.exemplo.test");
  assertStringIncludes(texto, "sai: velha.exemplo.test");
});

Deno.test("CLI --gravar: grava e sai 0; inventário PARCIAL recusa sem tocar a Vercel", async () => {
  const ok = depsDoComando();
  const r = await executar(["--gravar", "--sha", SHA_1], ok.deps);
  assertEquals(r.codigo, 0, r.erros.join("\n"));
  assertEquals(ok.vercel.store.patches, 1);
  const parcial = depsDoComando({ inv: inventario(frotaBase().sondas, false) });
  const r2 = await executar(["--gravar", "--sha", SHA_1], parcial.deps);
  assertEquals(r2.codigo, 1);
  assertStringIncludes(r2.erros.join("\n"), "PARCIAL");
  assertEquals(parcial.vercel.chamadas.length, 0);
});

Deno.test("CLI: globalConfigId null diz que a reserva não está configurada e não grava", async () => {
  const { deps, vercel } = depsDoComando({ politica: politicaBase(null) });
  const r = await executar(["--gravar", "--sha", SHA_1], deps);
  assertEquals(r.codigo, 1);
  assertStringIncludes(r.erros.join("\n"), "não está configurada");
  assertEquals(vercel.chamadas.length, 0);
});

Deno.test("CLI: uso errado sai 2 (sem ação, duas ações, sha ausente ou inválido)", async () => {
  for (const argv of [
    [],
    ["--conferir", "--gravar", "--sha", SHA_1],
    ["--gravar"],
    ["--gravar", "--sha", "xyz"],
  ]) {
    const { deps, vercel } = depsDoComando();
    const r = await executar(argv, deps);
    assertEquals(r.codigo, 2, argv.join(" "));
    assertEquals(vercel.chamadas.length, 0);
  }
});

Deno.test("politica.json real: reservaDaCaderneta existe, com globalConfigId null e chave reserva_v1", async () => {
  const politica = JSON.parse(
    await Deno.readTextFile("scripts/frota/politica.json"),
  );
  assertEquals(politica.reservaDaCaderneta, {
    globalConfigId: null,
    chave: "reserva_v1",
  });
});

// ------------------------------------------------------------------ endereço indeterminado x definitivo (revisão Opus da T8)

Deno.test("o endereço que não respondeu NÃO some calado: a gravação é recusada citando o endereço", async () => {
  const inv = frotaMista();
  const indeterminados = enderecosIndeterminados(inv, politicaBase());
  assertEquals(
    indeterminados.map((i) => i.dominio),
    [
      "caderneta-erro.exemplo.test",
      "caiu-na-reserva.exemplo.test",
      "dois-refs.exemplo.test",
      "instavel.exemplo.test",
      "nao-respondeu.exemplo.test",
    ],
  );
  const nova = montarReserva(inv, { sha: SHA_1, agora: AGORA });
  const v = dubleVercel({ atual: null });
  const r = await gravarReserva({
    nova,
    api: v.api,
    config,
    lojasObrigatorias: obrigatorias,
    indeterminados,
  });
  assertEquals(r.estado, "recusada");
  assertStringIncludes(r.motivos.join("\n"), "nao-respondeu.exemplo.test");
  assertStringIncludes(r.motivos.join("\n"), "indeterminado");
  assertEquals(v.chamadas.length, 0, "recusa não fala com a Vercel");
});

Deno.test("o caso do revisor: domínio próprio sem resposta e o .vercel.app da MESMA loja em hit = recusa (loja obrigatória presente não basta)", async () => {
  const inv = inventario([
    {
      dominio: "loja-um.exemplo.test",
      ficha: null,
      chavePublica: null,
      errosPagina: ["timeout", "timeout", "timeout"],
      amostras: [],
    },
    sonda("loja-um.vercel.app"),
    sonda("loja-dois.exemplo.test", { refs: [REF_B], chave: CHAVE_B }),
  ]);
  const { deps, vercel } = depsDoComando({ inv });
  const r = await executar(["--gravar", "--sha", SHA_1], deps);
  assertEquals(r.codigo, 1);
  assertStringIncludes(r.erros.join("\n"), "loja-um.exemplo.test");
  assertEquals(vercel.chamadas.length, 0);
});

Deno.test("gravarReserva sem a lista de indeterminados recusa (fail closed)", async () => {
  const nova = montarReserva(frotaBase(), { sha: SHA_1, agora: AGORA });
  const v = dubleVercel({ atual: null });
  const r = await gravarReserva({
    nova,
    api: v.api,
    config,
    lojasObrigatorias: obrigatorias,
  });
  assertEquals(r.estado, "recusada");
  assertStringIncludes(r.motivos.join("\n"), "indeterminados não informada");
  assertEquals(v.chamadas.length, 0);
});

const foraDoAr = (dominio, estado, status) => {
  const a = {
    status,
    caderneta: null,
    porteiro: estado,
    estado,
    refPorteiro: REF_C,
    refs: [],
    titulo: null,
  };
  return {
    dominio,
    ficha: { ...a, estavel: true },
    chavePublica: null,
    amostras: [a, a, a],
  };
};
const politicaComPreviewEEsperado = () => ({
  ...politicaBase(),
  aliasesDePreview: ["^loja-git-.+.vercel.app$"],
  enderecosEsperados: [
    { dominio: "antigo.exemplo.test", estado: "redirecionamento" },
  ],
});
const tipo = (s, politica = politicaComPreviewEEsperado()) =>
  classificarEndereco(s, politica).tipo;

Deno.test("indeterminado: sem ficha (a sonda não respondeu)", () => {
  assertEquals(
    tipo({ dominio: "x.exemplo.test", ficha: null, amostras: [] }),
    "indeterminado",
  );
});
Deno.test("indeterminado: caderneta erro", () => {
  assertEquals(
    tipo(sonda("x.exemplo.test", { status: 503, caderneta: "erro", refs: [] })),
    "indeterminado",
  );
});
Deno.test("indeterminado: caderneta reserva (o porteiro já caiu na reserva)", () => {
  assertEquals(
    tipo(sonda("x.exemplo.test", { caderneta: "reserva" })),
    "indeterminado",
  );
});
Deno.test("indeterminado: amostras divergentes (instável), mesmo com hit", () => {
  assertEquals(
    tipo(sonda("x.exemplo.test", { estavel: false })),
    "indeterminado",
  );
});
Deno.test("indeterminado: hit com mais de um ref", () => {
  const c = classificarEndereco(
    sonda("x.exemplo.test", { refs: [REF_A, REF_B] }),
    {},
  );
  assertEquals(c.tipo, "indeterminado");
  assertStringIncludes(c.motivo, "2 refs");
});
Deno.test("indeterminado: hit com HTTP que não é 200", () => {
  assertEquals(tipo(sonda("x.exemplo.test", { status: 500 })), "indeterminado");
});
Deno.test("indeterminado: loja que ALEGA estar fora do ar sem o contrato (refs divergentes)", () => {
  const s = foraDoAr("x.exemplo.test", "adormecida", 503);
  s.amostras = [
    s.amostras[0],
    { ...s.amostras[0], refPorteiro: REF_A },
    s.amostras[0],
  ];
  assertEquals(tipo(s), "indeterminado");
});

Deno.test("definitivo: caderneta miss estável (sem-loja)", () => {
  assertEquals(
    tipo(sonda("x.exemplo.test", { status: 404, caderneta: "miss", refs: [] })),
    "definitivo",
  );
});
Deno.test("definitivo: redirecionamento estável (308)", () => {
  assertEquals(
    tipo(sonda("x.vercel.app", { status: 308, caderneta: null, refs: [] })),
    "definitivo",
  );
});
Deno.test("definitivo: alias de preview (politica.json aliasesDePreview)", () => {
  assertEquals(
    tipo({ dominio: "loja-git-ramo.vercel.app", ficha: null, amostras: [] }),
    "definitivo",
  );
});
Deno.test("definitivo: endereço declarado em politica.json enderecosEsperados", () => {
  assertEquals(
    tipo({ dominio: "antigo.exemplo.test", ficha: null, amostras: [] }),
    "definitivo",
  );
});
Deno.test("definitivo: loja adormecida (503 no contrato do porteiro)", () => {
  assertEquals(
    tipo(foraDoAr("x.exemplo.test", "adormecida", 503)),
    "definitivo",
  );
});
Deno.test("definitivo: loja encerrada (410 no contrato do porteiro)", () => {
  assertEquals(
    tipo(foraDoAr("x.exemplo.test", "encerrada", 410)),
    "definitivo",
  );
});
Deno.test("entra: ficha estável 200 hit de um ref", () => {
  assertEquals(classificarEndereco(sonda("x.exemplo.test"), {}), {
    tipo: "entra",
    ref: REF_A,
  });
});

Deno.test("CLI --conferir com endereço indeterminado só AVISA (sai 0, nada gravado)", async () => {
  const inv = inventario([
    ...frotaBase().sondas,
    sonda("x.exemplo.test", { caderneta: "erro", status: 503, refs: [] }),
  ]);
  const { deps, vercel } = depsDoComando({ inv });
  const r = await executar(["--conferir", "--sha", SHA_1], deps);
  assertEquals(r.codigo, 0, r.erros.join("\n"));
  assertStringIncludes(r.saida.join("\n"), "AVISO: o endereço x.exemplo.test");
  assertEquals(vercel.store.patches, 0);
});

// ------------------------------------------------------------------ releitura sem depender da ordem das chaves

Deno.test("releitura com as chaves em OUTRA ordem (cabeçalho, hosts e entradas) = gravada", async () => {
  const nova = montarReserva(frotaBase(), { sha: SHA_1, agora: AGORA });
  const hostsAoContrario = Object.fromEntries(
    Object.entries(nova.hosts)
      .reverse()
      .map(([h, e]) => [h, { k: e.k, u: e.u }]),
  );
  const reordenada = {
    hosts: hostsAoContrario,
    sha: nova.sha,
    gerada_em: nova.gerada_em,
    v: 1,
  };
  assert(
    JSON.stringify(reordenada) !== JSON.stringify(nova),
    "o dublê tem de devolver outra ordem",
  );
  const v = dubleVercel({ atual: null, releituraTrocada: reordenada });
  const r = await gravarReserva({
    nova,
    api: v.api,
    config,
    lojasObrigatorias: obrigatorias,
    indeterminados: [],
  });
  assertEquals(r.estado, "gravada", r.motivos.join("\n"));
  assertEquals(canonico(reordenada), canonico(nova));
  assert(
    canonico({ a: [2, 1] }) !== canonico({ a: [1, 2] }),
    "array mantém a ordem",
  );
});
