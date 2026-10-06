// @ts-nocheck
/* eslint-disable security/detect-object-injection -- dublês de teste: as chaves vêm de constantes e mapas fechados do próprio arquivo, nunca de entrada externa. */
/**
 * Conferência central da frota (scripts/frota/conferir-frota.mjs +
 * .github/workflows/frota-conferir.yml). O que este arquivo trava:
 *
 *  - cada classificação, e a PRECEDÊNCIA da mais grave;
 *  - isolamento SEM manifesto de lojas: a loja de cada endereço é o ref da
 *    ficha que o porteiro serve; 3 amostras divergentes = falha; mesmo ref com
 *    títulos diferentes = LOJA_TROCADA; refs diferentes com o mesmo título =
 *    SUSPEITA_ISOLAMENTO;
 *  - inventário: endereço novo que aparece na Vercel entra sozinho; alias de
 *    preview não entra; sem --vercel o inventário é PARCIAL (nunca verde
 *    completo); --vercel que falha reprova;
 *  - --sha é obrigatório (exit 2);
 *  - o script como subprocesso `node` contra um servidor stub local;
 *  - o workflow: sem segredo, contents: read, sem schedule.
 */
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  classificar,
  conferirFrota,
  consultarVercel,
  extrairPublicUrl,
  extrairRefsSupabase,
  extrairTitulo,
  inventariar,
  lerEnderecosDoArquivo,
  lerPolitica,
  main,
  maioriaEstrita,
  montarContexto,
  problemasDoContrato,
  verificarCanonico,
  verificarIsolamentoCruzado,
} from "../scripts/frota/conferir-frota.mjs";

const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const SCRIPT = join(RAIZ, "scripts/frota/conferir-frota.mjs");
const WORKFLOW = join(RAIZ, ".github/workflows/frota-conferir.yml");
const SEM_SANITIZAR = { sanitizeOps: false, sanitizeResources: false };

const SHA = "a1580759629ae0568f76923a0daff6287a21f780";
const SHA_VELHO = "07a12ddd335999c4012054820fedc86e558d98b6";
const IDENT =
  "e624eb93691a856f01918d24c8cea4fecfb03b0c900c5c101c4734c3d4a4495c";

const REF = {
  ikcous: "cafkrminfnokvgjqtkle",
  savy: "gnjsrucsmjkajijrakzr",
  almeida: "cuemaffjmhkebhmghbap",
  brandmeliz: "htblgvlosaihdgckokld",
  space: "bgwpxpcbffxazrxjduns",
};
const LOJAS = {
  "ickous-marketplace.vercel.app": {
    ref: REF.ikcous,
    titulo: "IKCOUS - imports",
  },
  "savycollection.vercel.app": { ref: REF.savy, titulo: "Savy" },
  "almeidastore.vercel.app": { ref: REF.almeida, titulo: "Almeida Store" },
  "brandmeliz.vercel.app": { ref: REF.brandmeliz, titulo: "Brand Meliz" },
  "spacelojadoskit.vercel.app": {
    ref: REF.space,
    titulo: "Space Loja dos Kit",
  },
};
const MANUTENCAO = [
  "savy-collection.vercel.app",
  "loja-savy-collection.vercel.app",
  "teste-frota-a-0911.vercel.app",
  "teste-frota-ikcous-0911.vercel.app",
];
const REDIRECIONA = "ickous-marketplace-gabriels-projects-5a19f6ee.vercel.app";

// ------------------------------------------------------------------ o "ar" simulado

/** Uma descrição por endereço; `responder` devolve o que o porteiro serviria. */
function mundoBase() {
  const m = {};
  const versao = {
    sha: SHA,
    codeVersion: "1.5.18",
    identityRevision: IDENT,
    source: "database",
    promotable: true,
  };
  for (const [d, l] of Object.entries(LOJAS)) {
    m[d] = { tipo: "loja", ...l, caderneta: "hit", status: 200, ...versao };
  }
  for (const d of MANUTENCAO) m[d] = { tipo: "manutencao", ...versao };
  m[REDIRECIONA] = { tipo: "redirecionamento", ...versao };
  return m;
}

/** Ficha do porteiro: bloco <script id="ikcous-loja"> com identidade.publicUrl. */
const bloco = (publicUrl) =>
  `<script type="application/json" id="ikcous-loja">${JSON.stringify({
    schemaVersion: 2,
    identidade: publicUrl === undefined ? {} : { publicUrl },
  })}</script>`;

const html = (titulo, refs, publicUrl) =>
  `<!doctype html><html><head><title>${titulo}</title>${bloco(publicUrl)}</head><body>${refs
    .map((r) => `<script src="https://${r}.supabase.co/x.js"></script>`)
    .join("")}</body></html>`;

/** O `version` que o build gera a partir das partes (contrato do buildStore.mjs). */
const versaoDoBuild = (codeVersion, codeSha, identityRevision) =>
  `${codeVersion}-sha.${String(codeSha).slice(0, 7)}-identity.${identityRevision}`;

/** Resposta do endereço: { status, headers, body } | "trava" | "derruba". */
function responder(m, dominio, caminho, n, busca = "") {
  const e = m[dominio];
  if (!e) return { status: 404, headers: {}, body: "nao existe" };
  if (e.falha === "trava") return "trava";
  if (e.falha === "derruba") return "derruba";
  if (caminho === "/version.json") {
    if (e.versaoHttp)
      return { status: e.versaoHttp, headers: {}, body: "erro" };
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version:
          "version" in e
            ? e.version
            : versaoDoBuild(e.codeVersion, e.sha, e.identityRevision),
        codeVersion: e.codeVersion,
        codeSha: e.sha,
        identityRevision: e.identityRevision,
        source: e.source,
        promotable: e.promotable,
      }),
    };
  }
  if (e.tipo === "manutencao") {
    return {
      status: 503,
      headers: { "x-ikcous-caderneta": "miss" },
      body: "<html><title>Manutencao</title></html>",
    };
  }
  if (e.tipo === "redirecionamento") {
    const headers = { "x-ikcous-caderneta": "hit" };
    if (!e.semLocation) {
      const proto = e.locationProto ?? "https";
      const host = e.locationHost ?? "ickous-marketplace.vercel.app";
      headers.location = `${proto}://${host}${e.perdeCaminho ? "/" : caminho}${e.perdeQuery || e.perdeCaminho ? "" : busca}`;
    }
    return { status: 308, headers, body: "" };
  }
  // loja: amostras alternadas simulam duas instâncias do porteiro com caches diferentes
  const alterna = e.alterna && n % 2 === 1;
  const ref = alterna ? e.alterna.ref : e.ref;
  const titulo = alterna ? e.alterna.titulo : e.titulo;
  const publicUrl = "publicUrl" in e ? e.publicUrl : `https://${dominio}`;
  return {
    status: e.status,
    headers: { "x-ikcous-caderneta": e.caderneta },
    body: html(
      titulo,
      e.refsExtras ? [ref, ...e.refsExtras] : [ref],
      publicUrl,
    ),
  };
}

function fetchFalso(m) {
  const contadores = {};
  return (url) => {
    const u = new URL(url);
    const chave = `${u.hostname}${u.pathname}`;
    const n = (contadores[chave] = (contadores[chave] ?? -1) + 1);
    const r = responder(m, u.hostname, u.pathname, n, u.search);
    if (r === "trava" || r === "derruba")
      return Promise.reject(new TypeError("fetch failed"));
    return Promise.resolve(
      new Response(r.body, { status: r.status, headers: r.headers }),
    );
  };
}

// ------------------------------------------------------------------ funções puras

Deno.test("extrairTitulo e extrairRefsSupabase", () => {
  assertEquals(
    extrairTitulo("<head><TITLE>  IKCOUS &amp; Cia\n - imports </TITLE>"),
    "IKCOUS & Cia - imports",
  );
  assertEquals(extrairTitulo("<html></html>"), null);
  const h = `https://${REF.savy}.supabase.co/a https://${REF.ikcous}.supabase.co/b https://${REF.savy}.supabase.co/c https://curto.supabase.co https://${"a".repeat(25)}.supabase.co`;
  assertEquals(extrairRefsSupabase(h), [REF.ikcous, REF.savy].sort());
  assertEquals(extrairRefsSupabase("sem nada"), []);
});

Deno.test("maioriaEstrita: empate e vazio não têm maioria", () => {
  assertEquals(maioriaEstrita(["a", "a", "b"]), "a");
  assertEquals(maioriaEstrita(["a", "b"]), null);
  assertEquals(maioriaEstrita([]), null);
});

const CTX = {
  shaEsperado: SHA,
  identidadeRef: IDENT,
  codeVersionRef: "1.5.18",
  cruzado: {},
  canonicos: new Set(["ickous-marketplace.vercel.app"]),
};

function ficha(amostras) {
  const k = (p) => JSON.stringify([p.status, p.caderneta, p.titulo, p.refs]);
  return amostras.length
    ? {
        ...amostras[0],
        estavel: amostras.every((a) => k(a) === k(amostras[0])),
      }
    : null;
}
function sonda(dominio, o = {}) {
  const base = {
    status: 200,
    caderneta: "hit",
    titulo: "Savy",
    refs: [REF.savy],
  };
  const amostras =
    o.amostras ??
    [base, base, base].map((a) => ({ ...a, ...(o.pagina ?? {}) }));
  let versao = null;
  if (o.versao !== null) {
    versao = {
      codeSha: SHA,
      codeVersion: "1.5.18",
      identityRevision: IDENT,
      source: "database",
      promotable: true,
      ...o.versao,
    };
    if (!(o.versao && "version" in o.versao))
      versao.version = versaoDoBuild(
        versao.codeVersion,
        versao.codeSha,
        versao.identityRevision,
      );
  }
  return {
    dominio,
    versao,
    redirecionamento: o.redirecionamento ?? null,
    erroVersao: o.erroVersao ?? null,
    errosPagina: o.errosPagina ?? [],
    amostras,
    ficha: ficha(amostras),
  };
}
const LOJA = { dominio: "savycollection.vercel.app", esperado: null };

Deno.test("classificar: OK quando tudo bate", () => {
  assertEquals(classificar(LOJA, sonda(LOJA.dominio), CTX).classe, "OK");
});

Deno.test("classificar: ENDERECO_ANTIGO (codeSha diferente do esperado)", () => {
  const r = classificar(
    LOJA,
    sonda(LOJA.dominio, {
      versao: { codeSha: SHA_VELHO, codeVersion: "1.5.17" },
    }),
    CTX,
  );
  assertEquals(r.classe, "ENDERECO_ANTIGO");
  assertStringIncludes(r.achados[0].motivo, "07a12dd");
});

Deno.test("classificar: INALCANCAVEL (version.json inválido, página caída, amostra perdida)", () => {
  assertEquals(
    classificar(
      LOJA,
      sonda(LOJA.dominio, {
        versao: null,
        erroVersao: "version.json respondeu HTTP 500",
      }),
      CTX,
    ).classe,
    "INALCANCAVEL",
  );
  assertEquals(
    classificar(
      LOJA,
      sonda(LOJA.dominio, {
        amostras: [],
        errosPagina: ["amostra 1 da página: timeout"],
      }),
      CTX,
    ).classe,
    "INALCANCAVEL",
  );
  // uma amostra perdida entre três basta
  const base = {
    status: 200,
    caderneta: "hit",
    titulo: "Savy",
    refs: [REF.savy],
  };
  assertEquals(
    classificar(
      LOJA,
      sonda(LOJA.dominio, {
        amostras: [base, base],
        errosPagina: ["amostra 3 da página: timeout"],
      }),
      CTX,
    ).classe,
    "INALCANCAVEL",
  );
});

Deno.test("classificar: BUILD_DIVERGENTE (identityRevision/codeVersion válidos mas diferentes dos demais, source, promotable)", () => {
  for (const v of [
    { identityRevision: "f".repeat(64) },
    { codeVersion: "1.5.19" },
    { source: "bundled" },
    { promotable: false },
  ]) {
    assertEquals(
      classificar(LOJA, sonda(LOJA.dominio, { versao: v }), CTX).classe,
      "BUILD_DIVERGENTE",
      JSON.stringify(v),
    );
  }
});

// ---- A) o CONTRATO do version.json vale por endereço, antes de comparar com os outros

const CAMPOS_MALFORMADOS = {
  "codeSha curto": { codeSha: "a1580759" },
  "codeSha com maiúscula": { codeSha: SHA.toUpperCase() },
  "identityRevision com 63 hex": { identityRevision: IDENT.slice(1) },
  "identityRevision com 65 hex": { identityRevision: `${IDENT}0` },
  'codeVersion "1.5" (não é semver)': { codeVersion: "1.5" },
  'codeVersion "01.5.18" (zero à esquerda)': { codeVersion: "01.5.18" },
  "codeVersion número em vez de texto": { codeVersion: 1.5 },
  'promotable "true" (texto)': { promotable: "true" },
  "promotable false": { promotable: false },
  "promotable ausente": { promotable: undefined },
  'source "bundled"': { source: "bundled" },
  "source ausente": { source: undefined },
  "version que não bate com as partes": {
    version: `1.5.18-sha.deadbee-identity.${IDENT}`,
  },
  "version ausente": { version: undefined },
  "identityRevision ausente": { identityRevision: undefined },
  "codeVersion ausente": { codeVersion: undefined },
};

Deno.test("contrato do version.json: cada campo malformado ISOLADO reprova o próprio endereço (BUILD_DIVERGENTE)", () => {
  assertEquals(
    problemasDoContrato(sonda("x.vercel.app").versao),
    [],
    "a versão certa não tem problema",
  );
  for (const [nome, campo] of Object.entries(CAMPOS_MALFORMADOS)) {
    const versao = { ...sonda("x.vercel.app").versao, ...campo };
    assert(
      problemasDoContrato(versao).length > 0,
      `problemasDoContrato deixou passar: ${nome}`,
    );
    const r = classificar(LOJA, { ...sonda(LOJA.dominio), versao }, CTX);
    assert(r.classe !== "OK", `virou OK: ${nome}`);
    assertEquals(r.classe, "BUILD_DIVERGENTE", nome);
  }
});

Deno.test("contrato do version.json: a referência do grupo nunca é undefined (todos sem identityRevision/codeVersion)", () => {
  const semCampos = (d) =>
    sonda(d, {
      versao: {
        identityRevision: undefined,
        codeVersion: undefined,
        version: "x",
      },
    });
  const sondas = ["a.vercel.app", "b.vercel.app", "c.vercel.app"].map(
    semCampos,
  );
  const { ctx } = montarContexto(sondas, { sha: SHA });
  assertEquals(ctx.identidadeRef, null);
  assertEquals(ctx.codeVersionRef, null);
  for (const s of sondas) {
    const r = classificar({ dominio: s.dominio, esperado: null }, s, {
      ...ctx,
      cruzado: {},
    });
    assertEquals(
      r.classe,
      "BUILD_DIVERGENTE",
      "undefined === undefined não pode virar OK",
    );
  }
});

Deno.test("classificar: LOJA_TROCADA quando o HTML da loja tem ref ausente, duplo, ou título vazio", () => {
  assertEquals(
    classificar(LOJA, sonda(LOJA.dominio, { pagina: { refs: [] } }), CTX)
      .classe,
    "LOJA_TROCADA",
  );
  assertEquals(
    classificar(
      LOJA,
      sonda(LOJA.dominio, { pagina: { refs: [REF.savy, REF.almeida] } }),
      CTX,
    ).classe,
    "LOJA_TROCADA",
  );
  assertEquals(
    classificar(LOJA, sonda(LOJA.dominio, { pagina: { titulo: null } }), CTX)
      .classe,
    "LOJA_TROCADA",
  );
});

Deno.test("classificar: 3 amostras divergentes = LOJA_TROCADA", () => {
  const a = { status: 200, caderneta: "hit", titulo: "Savy", refs: [REF.savy] };
  const b = { ...a, titulo: "Almeida Store", refs: [REF.almeida] };
  const r = classificar(
    LOJA,
    sonda(LOJA.dominio, { amostras: [a, a, b] }),
    CTX,
  );
  assertEquals(r.classe, "LOJA_TROCADA");
  assertStringIncludes(r.achados[0].motivo, "divergem");
  // título igual mas ref diferente numa só amostra também diverge
  assertEquals(
    classificar(
      LOJA,
      sonda(LOJA.dominio, { amostras: [a, { ...a, refs: [REF.almeida] }, a] }),
      CTX,
    ).classe,
    "LOJA_TROCADA",
  );
});

Deno.test("classificar: endereço fora da política sem ficha (miss) é ESTADO_INESPERADO, não loja", () => {
  const r = classificar(
    LOJA,
    sonda(LOJA.dominio, {
      pagina: {
        caderneta: "miss",
        status: 503,
        refs: [],
        titulo: "Manutencao",
      },
    }),
    CTX,
  );
  assertEquals(r.classe, "ESTADO_INESPERADO");
});

Deno.test("classificar: endereço declarado (manutenção 503+miss, redirecionamento 308)", () => {
  const manut = {
    dominio: "savy-collection.vercel.app",
    esperado: "manutencao",
  };
  const ok = { status: 503, caderneta: "miss", titulo: "Manutencao", refs: [] };
  assertEquals(
    classificar(manut, sonda(manut.dominio, { pagina: ok }), CTX).classe,
    "OK",
  );
  assertEquals(
    classificar(
      manut,
      sonda(manut.dominio, { pagina: { ...ok, status: 200 } }),
      CTX,
    ).classe,
    "ESTADO_INESPERADO",
  );
  assertEquals(
    classificar(
      manut,
      sonda(manut.dominio, { pagina: { ...ok, caderneta: "hit" } }),
      CTX,
    ).classe,
    "ESTADO_INESPERADO",
  );
  const redir = {
    dominio: REDIRECIONA,
    esperado: "redirecionamento",
    para: "ickous-marketplace.vercel.app",
  };
  const r308 = { status: 308, caderneta: "hit", titulo: null, refs: [] };
  const pedido = "/produto/frota-conferencia?y=1&t=123";
  const red = (o = {}) => ({
    status: 308,
    location: `https://ickous-marketplace.vercel.app${pedido}`,
    pedido,
    ...o,
  });
  assertEquals(
    classificar(
      redir,
      sonda(redir.dominio, { pagina: r308, redirecionamento: red() }),
      CTX,
    ).classe,
    "OK",
  );
  assertEquals(
    classificar(
      redir,
      sonda(redir.dominio, {
        pagina: { ...r308, status: 200 },
        redirecionamento: red(),
      }),
      CTX,
    ).classe,
    "ESTADO_INESPERADO",
  );
});

// ---- B) o redirecionamento tem de levar ao canônico provado pelo cadastro

Deno.test("classificar: redirecionamento — host errado, sem Location, perde a query/caminho, http, destino fora do cadastro = CANONICO_INVALIDO", () => {
  const redir = {
    dominio: REDIRECIONA,
    esperado: "redirecionamento",
    para: "ickous-marketplace.vercel.app",
  };
  const r308 = { status: 308, caderneta: "hit", titulo: null, refs: [] };
  const pedido = "/produto/frota-conferencia?y=1&t=123";
  const com = (redirecionamento, ctx = CTX) =>
    classificar(
      redir,
      sonda(redir.dominio, { pagina: r308, redirecionamento }),
      ctx,
    );
  const certo = {
    status: 308,
    location: `https://ickous-marketplace.vercel.app${pedido}`,
    pedido,
  };
  assertEquals(com(certo).classe, "OK");
  const casos = {
    "host errado": {
      ...certo,
      location: `https://savycollection.vercel.app${pedido}`,
    },
    "sem Location": { ...certo, location: null },
    "perde a query": {
      ...certo,
      location:
        "https://ickous-marketplace.vercel.app/produto/frota-conferencia",
    },
    "perde o caminho": {
      ...certo,
      location: "https://ickous-marketplace.vercel.app/?y=1&t=123",
    },
    "http em vez de https": {
      ...certo,
      location: `http://ickous-marketplace.vercel.app${pedido}`,
    },
    "Location que não é URL": { ...certo, location: "::::" },
    "host parecido (sufixo)": {
      ...certo,
      location: `https://x-ickous-marketplace.vercel.app${pedido}`,
    },
  };
  for (const [nome, r] of Object.entries(casos))
    assertEquals(com(r).classe, "CANONICO_INVALIDO", nome);
  // a política pode estar certa e o CADASTRO não provar o destino
  assertEquals(
    com(certo, { ...CTX, canonicos: new Set() }).classe,
    "CANONICO_INVALIDO",
  );
  // sonda de redirecionamento com HTTP diferente de 308
  assertEquals(com({ ...certo, status: 200 }).classe, "ESTADO_INESPERADO");
  // política sem o destino
  assertEquals(
    classificar(
      { ...redir, para: null },
      sonda(redir.dominio, { pagina: r308, redirecionamento: certo }),
      CTX,
    ).classe,
    "ESTADO_INESPERADO",
  );
});

Deno.test("classificar: a mais grave vence (LOJA_TROCADA > SUSPEITA > INALCANCAVEL > ANTIGO > CANONICO > BUILD > ESTADO)", () => {
  const ctx = (cruzado) => ({ ...CTX, cruzado });
  const antigo = { codeSha: SHA_VELHO, source: "x" };
  // tudo ao mesmo tempo -> LOJA_TROCADA
  let r = classificar(
    LOJA,
    sonda(LOJA.dominio, {
      versao: antigo,
      erroVersao: "boom",
      pagina: { refs: [] },
    }),
    ctx({}),
  );
  assertEquals(r.classe, "LOJA_TROCADA");
  assert(r.achados.length >= 4, "os outros achados continuam registrados");
  // sem a ficha quebrada -> SUSPEITA_ISOLAMENTO vence INALCANCAVEL
  r = classificar(
    LOJA,
    sonda(LOJA.dominio, { versao: antigo, erroVersao: "boom" }),
    ctx({ [LOJA.dominio]: [{ classe: "SUSPEITA_ISOLAMENTO", motivo: "x" }] }),
  );
  assertEquals(r.classe, "SUSPEITA_ISOLAMENTO");
  // INALCANCAVEL vence ANTIGO
  assertEquals(
    classificar(
      LOJA,
      sonda(LOJA.dominio, { versao: antigo, erroVersao: "boom" }),
      ctx({}),
    ).classe,
    "INALCANCAVEL",
  );
  // ANTIGO vence CANONICO_INVALIDO, que vence BUILD_DIVERGENTE
  const canon = {
    [LOJA.dominio]: [{ classe: "CANONICO_INVALIDO", motivo: "x" }],
  };
  assertEquals(
    classificar(LOJA, sonda(LOJA.dominio, { versao: antigo }), ctx(canon))
      .classe,
    "ENDERECO_ANTIGO",
  );
  assertEquals(
    classificar(
      LOJA,
      sonda(LOJA.dominio, { versao: { source: "x" } }),
      ctx(canon),
    ).classe,
    "CANONICO_INVALIDO",
  );
  assertEquals(
    classificar(LOJA, sonda(LOJA.dominio, { versao: antigo }), ctx({})).classe,
    "ENDERECO_ANTIGO",
  );
  // BUILD vence ESTADO_INESPERADO
  assertEquals(
    classificar(
      LOJA,
      sonda(LOJA.dominio, {
        versao: { promotable: false },
        pagina: { status: 500 },
      }),
      ctx({}),
    ).classe,
    "BUILD_DIVERGENTE",
  );
});

Deno.test("verificarIsolamentoCruzado: mesmo ref com títulos diferentes -> LOJA_TROCADA (quem destoa da maioria)", () => {
  const s = (d, ref, titulo) => sonda(d, { pagina: { refs: [ref], titulo } });
  const r = verificarIsolamentoCruzado([
    s("a.vercel.app", REF.savy, "Savy"),
    s("b.vercel.app", REF.savy, "Savy"),
    s("c.vercel.app", REF.savy, "Almeida Store"),
  ]);
  assertEquals(Object.keys(r), ["c.vercel.app"]);
  assertEquals(r["c.vercel.app"][0].classe, "LOJA_TROCADA");
  // empate (1 x 1): ninguém é a "loja certa" -> os dois são acusados
  const e = verificarIsolamentoCruzado([
    s("a.vercel.app", REF.savy, "Savy"),
    s("c.vercel.app", REF.savy, "Almeida Store"),
  ]);
  assertEquals(Object.keys(e).sort(), ["a.vercel.app", "c.vercel.app"]);
});

Deno.test("verificarIsolamentoCruzado: refs diferentes com o MESMO título -> SUSPEITA_ISOLAMENTO nos dois", () => {
  const s = (d, ref, titulo) => sonda(d, { pagina: { refs: [ref], titulo } });
  const r = verificarIsolamentoCruzado([
    s("a.vercel.app", REF.savy, "Loja"),
    s("b.vercel.app", REF.almeida, " loja "),
  ]);
  assertEquals(r["a.vercel.app"][0].classe, "SUSPEITA_ISOLAMENTO");
  assertEquals(r["b.vercel.app"][0].classe, "SUSPEITA_ISOLAMENTO");
  // lojas distintas e coerentes: nada a dizer; endereço ignorado (política) não entra
  assertEquals(
    verificarIsolamentoCruzado([
      s("a.vercel.app", REF.savy, "Savy"),
      s("b.vercel.app", REF.almeida, "Almeida"),
    ]),
    {},
  );
  assertEquals(
    verificarIsolamentoCruzado(
      [
        s("a.vercel.app", REF.savy, "Loja"),
        s("b.vercel.app", REF.almeida, "Loja"),
      ],
      new Set(["b.vercel.app"]),
    ),
    {},
  );
});

Deno.test("montarContexto exige --sha de 40 hex (sem referência por maioria)", () => {
  let erro = null;
  try {
    montarContexto([], {});
  } catch (e) {
    erro = e;
  }
  assert(erro, "sem sha tem de lançar");
  const { ctx } = montarContexto(
    [
      sonda("a.vercel.app"),
      sonda("b.vercel.app"),
      sonda("c.vercel.app", { versao: { identityRevision: "x" } }),
    ],
    { sha: SHA },
  );
  assertEquals(ctx.identidadeRef, IDENT);
});

Deno.test("lerEnderecosDoArquivo: comentários, linhas vazias e domínio inválido", () => {
  assertEquals(
    lerEnderecosDoArquivo(
      "# loja nova\nNova.vercel.app  # fim\n\n  outra.vercel.app\r\n",
    ),
    ["nova.vercel.app", "outra.vercel.app"],
  );
  let erro = null;
  try {
    lerEnderecosDoArquivo("ok.vercel.app\nhttps://x.com/a b");
  } catch (e) {
    erro = e;
  }
  assert(erro);
});

// ------------------------------------------------------------------ inventário e orquestração (I/O injetado)

const POLITICA = lerPolitica();

const PROJETO = POLITICA.projetoVercel.id;

function executorFalso({
  novoAlias = "loja-nova-0610.vercel.app",
  falha = false,
} = {}) {
  const chamadas = [];
  const exec = (caminho) => {
    chamadas.push(caminho);
    if (falha)
      return Promise.reject(new Error("vercel api falhou: not logged in"));
    if (caminho.startsWith("/v4/aliases?projectId=")) {
      if (caminho.includes("until=")) {
        return Promise.resolve({
          aliases: [
            { alias: novoAlias, deploymentId: "dpl_NOVO", projectId: PROJETO },
          ],
          pagination: { next: null },
        });
      }
      return Promise.resolve({
        aliases: [
          {
            alias: "ickous-marketplace.vercel.app",
            deploymentId: "dpl_NOVO",
            projectId: PROJETO,
          },
          {
            alias:
              "ickous-marketplace-git-fix-abc-gabriels-projects-5a19f6ee.vercel.app",
            deploymentId: "dpl_PREVIEW",
            projectId: PROJETO,
          },
          {
            alias: "savycollection.vercel.app",
            deploymentId: "dpl_VELHO",
            projectId: PROJETO,
          },
        ],
        pagination: { next: 1790562712244 },
      });
    }
    if (caminho.startsWith("/v9/projects/")) {
      return Promise.resolve({
        targets: { production: { id: "dpl_VELHO" } },
        env: [{ key: "K", value: "SEGREDO-DE-TESTE" }],
        link: { token: "SEGREDO-DE-TESTE" },
      });
    }
    if (caminho.startsWith("/v4/aliases/"))
      return Promise.resolve({ deploymentId: "dpl_VELHO", projectId: PROJETO });
    return Promise.reject(new Error(`caminho inesperado ${caminho}`));
  };
  return { exec, chamadas };
}

Deno.test("inventariar --vercel: endereço novo na Vercel entra sozinho; preview fica de fora; pagina", async () => {
  const mundo = mundoBase();
  mundo["loja-nova-0610.vercel.app"] = {
    tipo: "loja",
    ref: "aaaaaaaaaaaaaaaaaaaa",
    titulo: "Loja Nova",
    caderneta: "hit",
    status: 200,
    sha: SHA,
    codeVersion: "1.5.18",
    identityRevision: IDENT,
    source: "database",
    promotable: true,
  };
  const { exec, chamadas } = executorFalso();
  const inv = await inventariar(POLITICA, {
    pedirVercel: true,
    executorVercel: exec,
    fetchImpl: fetchFalso(mundo),
  });
  assertEquals(inv.origem, "vercel");
  assertEquals(inv.completo, true);
  assert(
    inv.dominios.includes("loja-nova-0610.vercel.app"),
    "o endereço novo não estava em lugar nenhum e tem de entrar",
  );
  assert(
    !inv.dominios.some((d) => d.includes("-git-")),
    "alias de preview não é loja",
  );
  assert(
    inv.dominios.includes("savy-collection.vercel.app"),
    "os esperados pela política continuam",
  );
  assert(
    chamadas.some((c) => c.includes("until=1790562712244")),
    "seguiu a paginação",
  );
  assertEquals(inv.vercel.producaoOficial, "dpl_VELHO");
  assert(
    !JSON.stringify(inv.vercel).includes("SEGREDO-DE-TESTE"),
    "nada do JSON cru do projeto sai de consultarVercel",
  );
  const sondaNova = inv.sondas.find(
    (s) => s.dominio === "loja-nova-0610.vercel.app",
  );
  assertEquals(sondaNova.ficha.refs, ["aaaaaaaaaaaaaaaaaaaa"]);
});

Deno.test("conferirFrota --vercel: o novo no ar, 'antigo' em outro deployment, produção oficial nomeada; relatório sem segredo", async () => {
  // como em 06/10/2026: a release só no endereço da IKCOUS; o resto na versão anterior
  const mundo = mundoBase();
  for (const [d, e] of Object.entries(mundo)) {
    if (d !== "ickous-marketplace.vercel.app")
      Object.assign(e, { sha: SHA_VELHO, codeVersion: "1.5.17" });
  }
  const { exec } = executorFalso({
    novoAlias: "ickous-marketplace.vercel.app",
  });
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    pedirVercel: true,
    executorVercel: exec,
    fetchImpl: fetchFalso(mundo),
  });
  const por = Object.fromEntries(
    r.resultados.map((x) => [x.dominio, x.classe]),
  );
  assertEquals(por["ickous-marketplace.vercel.app"], "OK");
  assertEquals(por["savycollection.vercel.app"], "ENDERECO_ANTIGO");
  assertEquals(r.ok, false);
  assertStringIncludes(r.relatorio, "inventário: COMPLETO");
  assertStringIncludes(r.relatorio, "NÃO É a produção oficial");
  assertStringIncludes(r.relatorio, "vercel promote");
  assert(!r.relatorio.includes("SEGREDO-DE-TESTE"));
  assert(!JSON.stringify(r).includes("SEGREDO-DE-TESTE"));
});

Deno.test("conferirFrota --vercel que falha: inventário PARCIAL, 'NÃO CONFERIDO', ok=false mesmo com tudo verde", async () => {
  const { exec } = executorFalso({ falha: true });
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    pedirVercel: true,
    executorVercel: exec,
    fetchImpl: fetchFalso(mundoBase()),
  });
  assertEquals(
    r.resultados.every((x) => x.classe === "OK"),
    true,
  );
  assertEquals(r.ok, false);
  assertStringIncludes(r.relatorio, "inventário: PARCIAL");
  assertStringIncludes(
    r.relatorio,
    "endereço→deployment: NÃO CONFERIDO (--vercel falhou",
  );
});

Deno.test("conferirFrota sem --vercel: tudo OK mas o relatório declara PARCIAL e deployment NÃO CONFERIDO", async () => {
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundoBase()),
  });
  assertEquals(
    r.resultados.every((x) => x.classe === "OK"),
    true,
  );
  assertStringIncludes(r.relatorio, "inventário: PARCIAL (sem --vercel)");
  assertStringIncludes(
    r.relatorio,
    "endereço→deployment: NÃO CONFERIDO (sem --vercel)",
  );
  assertEquals(r.inventario.completo, false);
});

Deno.test("conferirFrota: frota INTEIRA velha não dá verde (por isso --sha é obrigatório)", async () => {
  const mundo = mundoBase();
  for (const e of Object.values(mundo))
    Object.assign(e, { sha: SHA_VELHO, codeVersion: "1.5.17" });
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
  });
  assertEquals(r.ok, false);
  assertEquals(
    r.resultados.every((x) => x.classe === "ENDERECO_ANTIGO"),
    true,
  );
  let erro = null;
  try {
    await conferirFrota(POLITICA, { fetchImpl: fetchFalso(mundo) });
  } catch (e) {
    erro = e;
  }
  assert(erro, "sem sha a função recusa");
});

Deno.test("conferirFrota: 3 amostras divergentes da página = falha de isolamento", async () => {
  const mundo = mundoBase();
  mundo["brandmeliz.vercel.app"].alterna = {
    ref: REF.space,
    titulo: "Space Loja dos Kit",
  };
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
  });
  const x = r.resultados.find((y) => y.dominio === "brandmeliz.vercel.app");
  assertEquals(x.classe, "LOJA_TROCADA");
  assertEquals(r.ok, false);
});

Deno.test("conferirFrota: endereço que não responde = INALCANCAVEL; version.json HTTP 500 idem", async () => {
  const mundo = mundoBase();
  mundo["almeidastore.vercel.app"].falha = "derruba";
  mundo["brandmeliz.vercel.app"].versaoHttp = 500;
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
  });
  const por = Object.fromEntries(
    r.resultados.map((x) => [x.dominio, x.classe]),
  );
  assertEquals(por["almeidastore.vercel.app"], "INALCANCAVEL");
  assertEquals(por["brandmeliz.vercel.app"], "INALCANCAVEL");
});

Deno.test("conferirFrota: loja mostrando a ficha de OUTRA (ref+título de outra loja) é LOJA_TROCADA nos dois", async () => {
  const mundo = mundoBase();
  // almeida passa a servir o ref da savy mas com o próprio título
  mundo["almeidastore.vercel.app"].ref = REF.savy;
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
  });
  const por = Object.fromEntries(
    r.resultados.map((x) => [x.dominio, x.classe]),
  );
  assertEquals(por["almeidastore.vercel.app"], "LOJA_TROCADA");
  assertEquals(por["savycollection.vercel.app"], "LOJA_TROCADA");
});

Deno.test("conferirFrota: dois refs diferentes com o mesmo título = SUSPEITA_ISOLAMENTO", async () => {
  const mundo = mundoBase();
  mundo["almeidastore.vercel.app"].titulo = "Savy";
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
  });
  const por = Object.fromEntries(
    r.resultados.map((x) => [x.dominio, x.classe]),
  );
  assertEquals(por["almeidastore.vercel.app"], "SUSPEITA_ISOLAMENTO");
  assertEquals(por["savycollection.vercel.app"], "SUSPEITA_ISOLAMENTO");
});

// ---- A) contrato do version.json, de ponta a ponta (sonda -> classificação)

Deno.test("A) TODOS os endereços sem identityRevision e codeVersion: nenhum OK, ok=false", async () => {
  const mundo = mundoBase();
  for (const e of Object.values(mundo))
    Object.assign(e, {
      identityRevision: undefined,
      codeVersion: undefined,
      version: "x",
    });
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
  });
  assertEquals(r.ok, false);
  assertEquals(
    r.resultados.filter((x) => x.classe === "OK").length,
    0,
    "nenhum endereço pode dar OK",
  );
  assertEquals(
    r.resultados.every((x) => x.classe === "BUILD_DIVERGENTE"),
    true,
  );
});

Deno.test("A) cada campo malformado isolado, num endereço só, reprova SÓ aquele endereço", async () => {
  for (const [nome, campo] of Object.entries(CAMPOS_MALFORMADOS)) {
    const mundo = mundoBase();
    const alvo = mundo["brandmeliz.vercel.app"];
    // o campo vai para o JSON como o build o serviria (undefined some do JSON)
    Object.assign(alvo, {
      ...("codeSha" in campo ? { sha: campo.codeSha } : {}),
      ...("codeVersion" in campo ? { codeVersion: campo.codeVersion } : {}),
      ...("identityRevision" in campo
        ? { identityRevision: campo.identityRevision }
        : {}),
      ...("source" in campo ? { source: campo.source } : {}),
      ...("promotable" in campo ? { promotable: campo.promotable } : {}),
      ...("version" in campo ? { version: campo.version } : {}),
    });
    if ("version" in campo && campo.version === undefined)
      alvo.version = undefined;
    const r = await conferirFrota(POLITICA, {
      sha: SHA,
      fetchImpl: fetchFalso(mundo),
    });
    const por = Object.fromEntries(
      r.resultados.map((x) => [x.dominio, x.classe]),
    );
    assert(por["brandmeliz.vercel.app"] !== "OK", `virou OK: ${nome}`);
    assertEquals(r.ok, false, nome);
    assertEquals(
      r.resultados.filter((x) => x.classe !== "OK").map((x) => x.dominio),
      ["brandmeliz.vercel.app"],
      nome,
    );
  }
});

// ---- B) canônico pelo cadastro (publicUrl da ficha) e redirecionamento

Deno.test("extrairPublicUrl: lê identidade.publicUrl do bloco da ficha; ausente/quebrado = null", () => {
  assertEquals(
    extrairPublicUrl(
      html("T", [REF.savy], "https://savycollection.vercel.app"),
    ),
    "https://savycollection.vercel.app",
  );
  assertEquals(extrairPublicUrl(html("T", [REF.savy], undefined)), null);
  assertEquals(extrairPublicUrl("<html></html>"), null);
  assertEquals(
    extrairPublicUrl('<script id="ikcous-loja">{quebrado</script>'),
    null,
  );
  assertEquals(
    extrairPublicUrl(
      '<script id="ikcous-loja">{"identidade":{"publicUrl":42}}</script>',
    ),
    null,
  );
});

const fichaDe = (ref, publicUrl, extra = {}) => ({
  status: 200,
  caderneta: "hit",
  titulo: "T",
  refs: [ref],
  publicUrl,
  estavel: true,
  ...extra,
});
const sondaFicha = (dominio, ficha) => ({
  dominio,
  ficha,
  amostras: [ficha],
  errosPagina: [],
  versao: null,
  erroVersao: null,
});

Deno.test("verificarCanonico: publicUrl fora do inventário, que não responde 200 hit, ausente, mal formado ou que serve outra loja = CANONICO_INVALIDO", () => {
  const ok = [
    sondaFicha("a.vercel.app", fichaDe(REF.savy, "https://a.vercel.app")),
    sondaFicha("b.vercel.app", fichaDe(REF.savy, "https://a.vercel.app")),
  ];
  const certo = verificarCanonico(ok);
  assertEquals(certo.achados, {});
  assertEquals([...certo.canonicos], ["a.vercel.app"]);

  const casos = {
    "host fora do inventário": [
      sondaFicha(
        "a.vercel.app",
        fichaDe(REF.savy, "https://fantasma.vercel.app"),
      ),
    ],
    "canônico em manutenção (503 miss)": [
      sondaFicha("a.vercel.app", fichaDe(REF.savy, "https://m.vercel.app")),
      sondaFicha(
        "m.vercel.app",
        fichaDe(REF.savy, "https://m.vercel.app", {
          status: 503,
          caderneta: "miss",
          refs: [],
        }),
      ),
    ],
    "canônico que serve outra loja": [
      sondaFicha("a.vercel.app", fichaDe(REF.savy, "https://o.vercel.app")),
      sondaFicha("o.vercel.app", fichaDe(REF.almeida, "https://o.vercel.app")),
    ],
    "ficha sem publicUrl": [
      sondaFicha("a.vercel.app", fichaDe(REF.savy, null)),
    ],
    "publicUrl sem https": [
      sondaFicha("a.vercel.app", fichaDe(REF.savy, "http://a.vercel.app")),
    ],
    "publicUrl com caminho": [
      sondaFicha(
        "a.vercel.app",
        fichaDe(REF.savy, "https://a.vercel.app/loja"),
      ),
    ],
    "publicUrl que não é URL": [
      sondaFicha("a.vercel.app", fichaDe(REF.savy, "::::")),
    ],
  };
  for (const [nome, sondas] of Object.entries(casos)) {
    const r = verificarCanonico(sondas);
    assertEquals(
      r.achados["a.vercel.app"]?.[0]?.classe,
      "CANONICO_INVALIDO",
      nome,
    );
  }
  // endereço que não é loja (política) não entra na verificação
  assertEquals(
    verificarCanonico(
      casos["host fora do inventário"],
      new Set(["a.vercel.app"]),
    ).achados,
    {},
  );
});

Deno.test("B) conferirFrota: o ar saudável, com a sonda de redirecionamento, dá OK (e o canônico é provado pelo cadastro)", async () => {
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundoBase()),
  });
  assertEquals(
    r.resultados.every((x) => x.classe === "OK"),
    true,
    JSON.stringify(r.resultados.filter((x) => x.classe !== "OK")),
  );
});

Deno.test("B) conferirFrota: 308 para host errado / sem Location / que perde a query / em http = CANONICO_INVALIDO", async () => {
  const casos = {
    "host errado": { locationHost: "savycollection.vercel.app" },
    "sem Location": { semLocation: true },
    "perde a query": { perdeQuery: true },
    "perde o caminho": { perdeCaminho: true },
    http: { locationProto: "http" },
  };
  for (const [nome, defeito] of Object.entries(casos)) {
    const mundo = mundoBase();
    Object.assign(mundo[REDIRECIONA], defeito);
    const r = await conferirFrota(POLITICA, {
      sha: SHA,
      fetchImpl: fetchFalso(mundo),
    });
    const x = r.resultados.find((y) => y.dominio === REDIRECIONA);
    assertEquals(x.classe, "CANONICO_INVALIDO", nome);
    assertEquals(r.ok, false, nome);
    assertEquals(r.resultados.filter((y) => y.classe !== "OK").length, 1, nome);
  }
});

Deno.test("B) conferirFrota: publicUrl de uma loja apontando para host fora do inventário = CANONICO_INVALIDO nela", async () => {
  const mundo = mundoBase();
  mundo["savycollection.vercel.app"].publicUrl =
    "https://savy-fantasma.vercel.app";
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
  });
  const x = r.resultados.find((y) => y.dominio === "savycollection.vercel.app");
  assertEquals(x.classe, "CANONICO_INVALIDO");
  assertStringIncludes(x.achados[0].motivo, "savy-fantasma.vercel.app");
  assertStringIncludes(r.relatorio, "CANONICO_INVALIDO");
});

Deno.test("B) conferirFrota: o canônico existe mas está em manutenção (não responde 200 hit) = CANONICO_INVALIDO", async () => {
  const mundo = mundoBase();
  mundo["savycollection.vercel.app"].publicUrl =
    "https://savy-collection.vercel.app";
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
  });
  assertEquals(
    r.resultados.find((y) => y.dominio === "savycollection.vercel.app").classe,
    "CANONICO_INVALIDO",
  );
});

Deno.test("B) conferirFrota: o destino do redirecionamento deixa de ser provado pelo cadastro (ficha do canônico some) = CANONICO_INVALIDO", async () => {
  const mundo = mundoBase();
  mundo["ickous-marketplace.vercel.app"].publicUrl = null; // sem publicUrl na ficha
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
  });
  const por = Object.fromEntries(
    r.resultados.map((x) => [x.dominio, x.classe]),
  );
  assertEquals(por[REDIRECIONA], "CANONICO_INVALIDO");
  assertEquals(por["ickous-marketplace.vercel.app"], "CANONICO_INVALIDO");
});

// ---- contrato da resposta da Vercel: nunca "lista vazia" nem "completo" por resposta malformada

const ALIAS_BOM = (alias, extra = {}) => ({
  alias,
  deploymentId: "dpl_ABC123",
  projectId: PROJETO,
  ...extra,
});
const PROJETO_BOM = { targets: { production: { id: "dpl_ABC123" } } };

/** Executor falso com respostas fixas: pagina1 (e pagina2 se pagina1 tiver next) + projeto. */
function executorDe({ pagina1, pagina2, projeto = PROJETO_BOM }) {
  return (caminho) => {
    if (caminho.startsWith("/v4/aliases?projectId=")) {
      return Promise.resolve(caminho.includes("until=") ? pagina2 : pagina1);
    }
    if (caminho.startsWith("/v9/projects/")) return Promise.resolve(projeto);
    if (caminho.startsWith("/v4/aliases/"))
      return Promise.resolve(ALIAS_BOM("x"));
    return Promise.reject(new Error(`caminho inesperado ${caminho}`));
  };
}
const FIM = { next: null };
const BOA = {
  aliases: [ALIAS_BOM("ickous-marketplace.vercel.app")],
  pagination: FIM,
};

const CASOS_DE_VERCEL_FORA_DO_CONTRATO = {
  "resposta {} na 1ª página": { pagina1: {} },
  "resposta null": { pagina1: null },
  "aliases que não é array": { pagina1: { aliases: "x", pagination: FIM } },
  "sem pagination": { pagina1: { aliases: [ALIAS_BOM("a.vercel.app")] } },
  "pagination que não é objeto": {
    pagina1: { aliases: [ALIAS_BOM("a.vercel.app")], pagination: "fim" },
  },
  "página 2 malformada": {
    pagina1: { aliases: [ALIAS_BOM("a.vercel.app")], pagination: { next: 7 } },
    pagina2: {},
  },
  "página 2 sem pagination": {
    pagina1: { aliases: [ALIAS_BOM("a.vercel.app")], pagination: { next: 7 } },
    pagina2: { aliases: [] },
  },
  "lista vazia": { pagina1: { aliases: [], pagination: FIM } },
  "alias de outro projeto": {
    pagina1: {
      aliases: [
        ALIAS_BOM("a.vercel.app"),
        ALIAS_BOM("b.vercel.app", { projectId: "prj_OUTRO" }),
      ],
      pagination: FIM,
    },
  },
  "alias sem projectId": {
    pagina1: {
      aliases: [ALIAS_BOM("a.vercel.app", { projectId: undefined })],
      pagination: FIM,
    },
  },
  "alias sem deploymentId": {
    pagina1: {
      aliases: [
        ALIAS_BOM("a.vercel.app"),
        ALIAS_BOM("b.vercel.app", { deploymentId: undefined }),
      ],
      pagination: FIM,
    },
  },
  "alias com deploymentId malformado": {
    pagina1: {
      aliases: [ALIAS_BOM("a.vercel.app", { deploymentId: "xyz" })],
      pagination: FIM,
    },
  },
  "item sem texto em alias": {
    pagina1: {
      aliases: [{ deploymentId: "dpl_A", projectId: PROJETO }],
      pagination: FIM,
    },
  },
  "produção oficial ausente ({})": { pagina1: BOA, projeto: {} },
  "produção oficial sem id": {
    pagina1: BOA,
    projeto: { targets: { production: {} } },
  },
  "produção oficial malformada": {
    pagina1: BOA,
    projeto: { targets: { production: { id: "dpl_" } } },
  },
  "produção oficial que não é texto": {
    pagina1: BOA,
    projeto: { targets: { production: { id: 7 } } },
  },
};

Deno.test("contrato da Vercel: cada resposta fora do contrato = vercel.ok=false (consultarVercel)", async () => {
  assertEquals(
    (await consultarVercel(POLITICA, [], executorDe({ pagina1: BOA }))).ok,
    true,
    "controle: a resposta boa passa",
  );
  for (const [nome, caso] of Object.entries(CASOS_DE_VERCEL_FORA_DO_CONTRATO)) {
    const r = await consultarVercel(POLITICA, [], executorDe(caso));
    assertEquals(r.ok, false, nome);
    assert(typeof r.erro === "string" && r.erro.length > 0, nome);
  }
});

Deno.test("contrato da Vercel: o preview de outro formato não derruba o inventário, mas o alias de produção malformado sim", async () => {
  const preview = {
    alias: "ickous-marketplace-git-x-gabriels-projects-5a19f6ee.vercel.app",
    deploymentId: null,
    projectId: "prj_QUALQUER",
  };
  const r = await consultarVercel(
    POLITICA,
    [],
    executorDe({
      pagina1: {
        aliases: [ALIAS_BOM("a.vercel.app"), preview],
        pagination: FIM,
      },
    }),
  );
  assertEquals(r.ok, true);
});

Deno.test("contrato da Vercel: inventário NÃO completo e conferirFrota.ok=false com a frota inteira saudável (todos os casos)", async () => {
  for (const [nome, caso] of Object.entries(CASOS_DE_VERCEL_FORA_DO_CONTRATO)) {
    const r = await conferirFrota(POLITICA, {
      sha: SHA,
      pedirVercel: true,
      executorVercel: executorDe(caso),
      fetchImpl: fetchFalso(mundoBase()),
    });
    assertEquals(r.vercel.ok, false, nome);
    assertEquals(r.inventario.completo, false, nome);
    assertEquals(r.inventario.origem, "reserva", nome);
    assertEquals(r.ok, false, nome);
    assertStringIncludes(r.relatorio, "inventário: PARCIAL");
    assertStringIncludes(r.relatorio, "--vercel falhou");
  }
});

Deno.test("contrato da Vercel: main sai com 1 em cada resposta fora do contrato (e com 0 na boa e completa)", async () => {
  const antes = console.log;
  console.log = () => {};
  try {
    // controle: Vercel boa + frota saudável + inventário completo = 0
    const bom = executorDe({
      pagina1: {
        aliases: [...Object.keys(mundoBase()).map((d) => ALIAS_BOM(d))],
        pagination: FIM,
      },
      projeto: PROJETO_BOM,
    });
    assertEquals(
      await main(
        ["--sha", SHA, "--vercel"],
        { GITHUB_STEP_SUMMARY: "" },
        { fetchImpl: fetchFalso(mundoBase()), executorVercel: bom },
      ),
      0,
    );
    for (const [nome, caso] of Object.entries(
      CASOS_DE_VERCEL_FORA_DO_CONTRATO,
    )) {
      const codigo = await main(
        ["--sha", SHA, "--vercel"],
        { GITHUB_STEP_SUMMARY: "" },
        {
          fetchImpl: fetchFalso(mundoBase()),
          executorVercel: executorDe(caso),
        },
      );
      assertEquals(codigo, 1, nome);
    }
  } finally {
    console.log = antes;
  }
});

Deno.test("consultarVercel: falha na 1ª página = ok:false; falha depois = lista incompleta (inventário PARCIAL)", async () => {
  assertEquals(
    (await consultarVercel(POLITICA, [], () => Promise.reject(new Error("x"))))
      .ok,
    false,
  );
  let n = 0;
  const r = await consultarVercel(POLITICA, [], (c) => {
    if (c.startsWith("/v4/aliases?")) {
      return ++n === 1
        ? Promise.resolve({
            aliases: [
              {
                alias: "a.vercel.app",
                deploymentId: "dpl_1",
                projectId: PROJETO,
              },
            ],
            pagination: { next: 5 },
          })
        : Promise.reject(new Error("429"));
    }
    return Promise.resolve({ targets: { production: { id: "dpl_1" } } });
  });
  assertEquals(r.ok, true);
  assertEquals(r.listaCompleta, false);
  assert(r.avisos.some((a) => a.includes("INCOMPLETA")));
});

// ------------------------------------------------------------------ o script como subprocesso, contra um stub HTTP

function subirStub(mundo) {
  const contadores = {};
  const srv = Deno.serve(
    { port: 0, hostname: "127.0.0.1", onListen() {} },
    async (req) => {
      const u = new URL(req.url);
      const [, dominio, ...resto] = u.pathname.split("/");
      const caminho = `/${resto.join("/")}`;
      const chave = `${dominio}${caminho}`;
      const n = (contadores[chave] = (contadores[chave] ?? -1) + 1);
      const r = responder(mundo, dominio, caminho, n, u.search);
      if (r === "trava") {
        await new Promise((ok) =>
          req.signal.addEventListener("abort", () => ok(null)),
        );
        return new Response("", { status: 499 });
      }
      return new Response(r.body, { status: r.status, headers: r.headers });
    },
  );
  return {
    base: `http://127.0.0.1:${srv.addr.port}`,
    parar: () => srv.shutdown(),
  };
}

async function rodar(args, mundo, extraEnv = {}) {
  const stub = subirStub(mundo);
  try {
    const r = await new Deno.Command("node", {
      args: [SCRIPT, ...args],
      cwd: RAIZ,
      env: {
        FROTA_URL_MODELO: `${stub.base}/{dominio}`,
        FROTA_TIMEOUT_MS: "800",
        GITHUB_STEP_SUMMARY: "",
        ...extraEnv,
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const dec = new TextDecoder();
    return {
      codigo: r.code,
      saida: dec.decode(r.stdout),
      erro: dec.decode(r.stderr),
    };
  } finally {
    await stub.parar();
  }
}

Deno.test({
  name: "script: sem --sha é erro de uso (exit 2), nada é sondado",
  ...SEM_SANITIZAR,
  async fn() {
    const r = await rodar([], mundoBase());
    assertEquals(r.codigo, 2);
    assertStringIncludes(r.erro, "--sha é obrigatório");
    const r2 = await rodar(["--sha", "abc"], mundoBase());
    assertEquals(r2.codigo, 2);
  },
});

Deno.test({
  name: "script: tudo OK -> exit 0, mas o inventário sem --vercel é declarado PARCIAL",
  ...SEM_SANITIZAR,
  async fn() {
    const r = await rodar(["--sha", SHA], mundoBase());
    assertEquals(r.codigo, 0, r.saida + r.erro);
    assertStringIncludes(r.saida, "inventário: PARCIAL (sem --vercel)");
    assertStringIncludes(r.saida, "10 de 10 endereços OK");
    assertStringIncludes(
      r.saida,
      "endereço→deployment: NÃO CONFERIDO (sem --vercel)",
    );
  },
});

Deno.test({
  name: "script: um endereço com SHA antigo -> ENDERECO_ANTIGO, exit 1, e diz como recuperar",
  ...SEM_SANITIZAR,
  async fn() {
    const mundo = mundoBase();
    mundo["savycollection.vercel.app"] = {
      ...mundo["savycollection.vercel.app"],
      sha: SHA_VELHO,
      codeVersion: "1.5.17",
    };
    const r = await rodar(["--sha", SHA], mundo);
    assertEquals(r.codigo, 1);
    assertStringIncludes(r.saida, "ENDERECO_ANTIGO");
    assertStringIncludes(r.saida, "vercel promote");
    assertStringIncludes(r.saida, "(1.5.17): 1 endereço(s)");
  },
});

Deno.test({
  name: "script: loja com a ficha de outra loja -> LOJA_TROCADA, exit 1, manda voltar com rollback",
  ...SEM_SANITIZAR,
  async fn() {
    const mundo = mundoBase();
    mundo["almeidastore.vercel.app"].ref = REF.savy;
    const r = await rodar(["--sha", SHA], mundo);
    assertEquals(r.codigo, 1);
    assertStringIncludes(r.saida, "LOJA_TROCADA");
    assertStringIncludes(r.saida, "vercel rollback");
  },
});

Deno.test({
  name: "script: 3 amostras divergentes -> LOJA_TROCADA, exit 1",
  ...SEM_SANITIZAR,
  async fn() {
    const mundo = mundoBase();
    mundo["spacelojadoskit.vercel.app"].alterna = {
      ref: REF.savy,
      titulo: "Savy",
    };
    const r = await rodar(["--sha", SHA], mundo);
    assertEquals(r.codigo, 1);
    assertStringIncludes(r.saida, "divergem");
  },
});

Deno.test({
  name: "script: endereço que não responde -> INALCANCAVEL, exit 1",
  ...SEM_SANITIZAR,
  async fn() {
    const mundo = mundoBase();
    mundo["brandmeliz.vercel.app"].falha = "trava";
    const r = await rodar(["--sha", SHA], mundo);
    assertEquals(r.codigo, 1);
    assertStringIncludes(r.saida, "INALCANCAVEL");
    assertStringIncludes(r.saida, "timeout");
  },
});

Deno.test({
  name: "script: --enderecos soma um endereço ao inventário; --json grava o estruturado",
  ...SEM_SANITIZAR,
  async fn() {
    const mundo = mundoBase();
    mundo["loja-nova-0610.vercel.app"] = {
      tipo: "loja",
      ref: "aaaaaaaaaaaaaaaaaaaa",
      titulo: "Loja Nova",
      caderneta: "hit",
      status: 200,
      sha: SHA_VELHO,
      codeVersion: "1.5.17",
      identityRevision: IDENT,
      source: "database",
      promotable: true,
    };
    const dir = await Deno.makeTempDir();
    try {
      const lista = join(dir, "enderecos.txt");
      const json = join(dir, "saida.json");
      await Deno.writeTextFile(
        lista,
        "# a loja nova\nloja-nova-0610.vercel.app\n",
      );
      const r = await rodar(
        ["--sha", SHA, "--enderecos", lista, "--json", json],
        mundo,
      );
      assertEquals(r.codigo, 1);
      assertStringIncludes(r.saida, "loja-nova-0610.vercel.app");
      const estruturado = JSON.parse(await Deno.readTextFile(json));
      assertEquals(estruturado.ok, false);
      assertEquals(estruturado.inventario.completo, false);
      assertEquals(
        estruturado.resultados.find(
          (x) => x.dominio === "loja-nova-0610.vercel.app",
        ).classe,
        "ENDERECO_ANTIGO",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

// ------------------------------------------------------------------ o workflow

Deno.test("workflow frota-conferir: sem segredo, contents: read, sem schedule, sha obrigatório e validado", () => {
  const yaml = Deno.readTextFileSync(WORKFLOW);
  const semComentario = yaml
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  assert(
    !yaml.includes("secrets."),
    "o workflow não pode referenciar secrets.",
  );
  assert(
    !/^\s*schedule:/m.test(semComentario),
    "sem agendamento (o ramo padrão é develop, parado)",
  );
  assertStringIncludes(semComentario, "permissions:\n  contents: read");
  assert(!/contents:\s*write/.test(semComentario));
  assertStringIncludes(semComentario, "workflow_dispatch:");
  assert(
    /sha:\s*\n\s+description:[^\n]*\n\s+required: true/.test(semComentario),
    "sha é input obrigatório",
  );
  assertStringIncludes(semComentario, "[a-fA-F0-9]{40}");
  assertStringIncludes(semComentario, 'node-version: "20"');
  assertStringIncludes(semComentario, "node scripts/frota/conferir-frota.mjs");
  assert(
    !semComentario.includes("--vercel"),
    "o CI não tem o CLI da Vercel logado",
  );
  // as entradas chegam por env, nunca interpoladas no shell
  assert(!/run:[^\n]*\$\{\{\s*inputs\./.test(semComentario));
  assertStringIncludes(yaml, "LIMITE");
  assertStringIncludes(yaml, "develop");
});

Deno.test("política: só política (sem lista de clientes por release) e com o que o dono decidiu", () => {
  assertEquals(POLITICA.projetoVercel.id, "prj_JMNo9fA1kfDS7pxalOjhVaEr7QKY");
  assertEquals(
    POLITICA.lojasSemBackendGerenciado.map((l) => l.ref).sort(),
    [REF.almeida, REF.brandmeliz, REF.space].sort(),
  );
  assertEquals(
    POLITICA.enderecosEsperados
      .filter((e) => e.estado === "manutencao")
      .map((e) => e.dominio)
      .sort(),
    [...MANUTENCAO].sort(),
  );
  assertEquals(
    POLITICA.enderecosEsperados.find((e) => e.estado === "redirecionamento")
      .dominio,
    REDIRECIONA,
  );
  assertEquals(
    POLITICA.enderecosEsperados.find((e) => e.estado === "redirecionamento")
      .para,
    "ickous-marketplace.vercel.app",
  );
  assertEquals(POLITICA.migrationsForaDaRelease[0].versao, "20261201000000");
  assertEquals(
    POLITICA.migrationsForaDaRelease[0].conferencia,
    "8f-conferir-201",
  );
  assert(!("lojas" in POLITICA), "o inventário não vem de uma lista de lojas");
});
