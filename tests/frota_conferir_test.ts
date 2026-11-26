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
 *    SUSPEITA_ISOLAMENTO, salvo quando o BANCO de cada ref (v_store_config,
 *    lido com a chave publicável da ficha) confirma o título que CADA
 *    endereço serve: lojistas diferentes com o mesmo nome = AVISO;
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
  COMO_RECUPERAR,
  GRAVIDADE,
  bancoIndisponivel,
  classificar,
  conferirFrota,
  consultarVercel,
  extrairPublicUrl,
  extrairRefsSupabase,
  extrairTitulo,
  inventariar,
  lerEnderecosDoArquivo,
  lerPolitica,
  lerTituloNoBanco,
  main,
  maioriaEstrita,
  montarContexto,
  problemasDoContrato,
  refDaLojaSondada,
  sondarEndereco,
  tituloDaLinhaDoBanco,
  titulosRepetidos,
  verificarCanonico,
  verificarIsolamentoCruzado,
} from "../scripts/frota/conferir-frota.mjs";
import {
  lojasDoInventario,
  problemasAntesDoPromote,
} from "../scripts/frota/publicar-release.mjs";

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
};
const LOJAS = {
  "ickous-marketplace.vercel.app": {
    ref: REF.ikcous,
    titulo: "IKCOUS - imports",
  },
  "savycollection.vercel.app": { ref: REF.savy, titulo: "Savy" },
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
function mundoBase({ comManutencao = false } = {}) {
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
  // Os enderecos de manutencao foram descontinuados e saíram do Vercel: o
  // mundo real não os tem. So entram quando o teste pede (canônico em manutenção).
  if (comManutencao) {
    for (const d of MANUTENCAO) m[d] = { tipo: "manutencao", ...versao };
  }
  m[REDIRECIONA] = { tipo: "redirecionamento", ...versao };
  return m;
}

/** Chave publicável FICTÍCIA do banco de cada ref (a ficha real serve a da loja). */
const CHAVE = (ref) => `chave-publica-de-teste-${ref}`;

/**
 * O banco de cada loja: a linha de v_store_config de onde o porteiro monta o
 * título. Fica FORA do mundo (que é por endereço e é varrido por vários testes).
 */
const BANCOS = {
  [REF.ikcous]: {
    store_name: "IKCOUS - imports",
    store_city: null,
    store_state: null,
  },
  [REF.savy]: { store_name: "Savy", store_city: null, store_state: null },
};

/**
 * Ficha do porteiro: bloco <script id="ikcous-loja"> com identidade.publicUrl e
 * conexao (supabaseUrl + publishableKey do MESMO ref que a página usa), como
 * `montarFicha` (src/hospedagem/porteiro.ts) monta.
 */
const bloco = (publicUrl, ref, chave) =>
  `<script type="application/json" id="ikcous-loja">${JSON.stringify({
    schemaVersion: 2,
    identidade: publicUrl === undefined ? {} : { publicUrl },
    ...(ref
      ? {
          conexao: {
            supabaseUrl: `https://${ref}.supabase.co`,
            publishableKey: chave ?? CHAVE(ref),
          },
        }
      : {}),
  })}</script>`;

const html = (titulo, refs, publicUrl, chave) =>
  `<!doctype html><html><head><title>${titulo}</title>${bloco(publicUrl, refs[0], chave)}</head><body>${refs

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
  if (e.tipo === "foraDoAr") {
    // Página própria do porteiro para loja adormecida/encerrada (contrato do
    // Lote 2 do L8): sem script, sem marca e sem ref Supabase no HTML.
    // `cadernetaDaPagina`: a mesma página servida com a loja aberta pela reserva.
    const headers = { "x-ikcous-caderneta": e.cadernetaDaPagina ?? "hit" };
    if (e.porteiro !== null) headers["x-ikcous-porteiro"] = e.porteiro;
    if (e.estado !== null) headers["x-ikcous-estado"] = e.estado;
    if (e.refPorteiro !== null) headers["x-ikcous-ref"] = e.refPorteiro;
    if (e.cadernetaVersao)
      headers["x-ikcous-caderneta-versao"] = e.cadernetaVersao;
    return {
      status: e.status,
      headers,
      body: "<!DOCTYPE html><html><head><title>Loja fechada</title></head><body><p>Esta loja está fechada no momento.</p></body></html>",
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
  // `cadernetaAlterna`: instâncias com caches diferentes, uma ainda com a
  // ficha (hit) e outra já aberta pela reserva — a MESMA loja.
  const caderneta =
    e.cadernetaAlterna && n % 2 === 1 ? e.cadernetaAlterna : e.caderneta;
  const ref = alterna ? e.alterna.ref : e.ref;
  const titulo = alterna ? e.alterna.titulo : e.titulo;
  const publicUrl = "publicUrl" in e ? e.publicUrl : `https://${dominio}`;
  return {
    status: e.status,
    headers: {
      "x-ikcous-caderneta": caderneta,
      // O selo do middleware; `semSelo` simula uma borda em que ele nao rodou.
      ...(e.semSelo ? {} : { "x-ikcous-porteiro": e.porteiro ?? "ok" }),
      ...(e.cadernetaVersao
        ? { "x-ikcous-caderneta-versao": e.cadernetaVersao }
        : {}),
    },
    body: html(
      titulo,
      e.refsExtras ? [ref, ...e.refsExtras] : [ref],
      publicUrl,
      e.chave,
    ),
  };
}

/**
 * O banco de uma loja respondendo a leitura anônima de v_store_config: 401 sem
 * a chave publicável DAQUELE ref (como o Supabase real), 404 fora da view.
 * `bancos[ref]` = linha | "derruba" | { status } ; ausente = 404.
 */
function responderBanco(bancos, u, init, leituras) {
  const ref = u.hostname.split(".")[0];
  leituras?.push(ref);
  const banco = bancos[ref];
  if (banco === "derruba") return "derruba";
  if (!banco || u.pathname !== "/rest/v1/v_store_config")
    return { status: 404, headers: {}, body: "[]" };
  if (new Headers(init?.headers).get("apikey") !== CHAVE(ref))
    return { status: 401, headers: {}, body: '{"message":"Invalid API key"}' };
  if (banco.status) return { status: banco.status, headers: {}, body: "[]" };
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(banco.linhas ?? [banco]),
  };
}

function fetchFalso(m, { bancos = BANCOS, leituras = null } = {}) {
  const contadores = {};
  return (url, init) => {
    const u = new URL(url);
    const r = u.hostname.endsWith(".supabase.co")
      ? responderBanco(bancos, u, init, leituras)
      : (() => {
          const chave = `${u.hostname}${u.pathname}`;
          const n = (contadores[chave] = (contadores[chave] ?? -1) + 1);
          return responder(m, u.hostname, u.pathname, n, u.search);
        })();
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
    porteiro: "ok",
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
    porteiro: "ok",
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
      sonda(LOJA.dominio, { pagina: { refs: [REF.savy, REF.ikcous] } }),
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
  const a = {
    status: 200,
    caderneta: "hit",
    porteiro: "ok",
    titulo: "Savy",
    refs: [REF.savy],
  };
  const b = { ...a, titulo: "IKCOUS - imports", refs: [REF.ikcous] };
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
      sonda(LOJA.dominio, { amostras: [a, { ...a, refs: [REF.ikcous] }, a] }),
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
    s("c.vercel.app", REF.savy, "IKCOUS - imports"),
  ]);
  assertEquals(Object.keys(r), ["c.vercel.app"]);
  assertEquals(r["c.vercel.app"][0].classe, "LOJA_TROCADA");
  // empate (1 x 1): ninguém é a "loja certa" -> os dois são acusados
  const e = verificarIsolamentoCruzado([
    s("a.vercel.app", REF.savy, "Savy"),
    s("c.vercel.app", REF.savy, "IKCOUS - imports"),
  ]);
  assertEquals(Object.keys(e).sort(), ["a.vercel.app", "c.vercel.app"]);
});

Deno.test("verificarIsolamentoCruzado: refs diferentes com o MESMO título -> SUSPEITA_ISOLAMENTO nos dois", () => {
  const s = (d, ref, titulo) => sonda(d, { pagina: { refs: [ref], titulo } });
  const r = verificarIsolamentoCruzado([
    s("a.vercel.app", REF.savy, "Loja"),
    s("b.vercel.app", REF.ikcous, " loja "),
  ]);
  assertEquals(r["a.vercel.app"][0].classe, "SUSPEITA_ISOLAMENTO");
  assertEquals(r["b.vercel.app"][0].classe, "SUSPEITA_ISOLAMENTO");
  // lojas distintas e coerentes: nada a dizer; endereço ignorado (política) não entra
  assertEquals(
    verificarIsolamentoCruzado([
      s("a.vercel.app", REF.savy, "Savy"),
      s("b.vercel.app", REF.ikcous, "IKCOUS"),
    ]),
    {},
  );
  assertEquals(
    verificarIsolamentoCruzado(
      [
        s("a.vercel.app", REF.savy, "Loja"),
        s("b.vercel.app", REF.ikcous, "Loja"),
      ],
      new Set(["b.vercel.app"]),
    ),
    {},
  );
});

// Título repetido entre refs diferentes: a âncora é o BANCO de cada ref, nunca
// o publicUrl da ficha (o porteiro o monta com o próprio host atendido, então
// ele "confirma" qualquer endereço).
const REF_C = "c".repeat(20);
const sondaComTitulo = (d, ref, titulo) =>
  sonda(d, { pagina: { refs: [ref], titulo } });

Deno.test("titulosRepetidos: mesmo título com o banco de CADA ref confirmando o nome vira AVISO, não achado", () => {
  const sondas = [
    sondaComTitulo("a.vercel.app", REF.savy, "Bella Modas"),
    sondaComTitulo("a2.vercel.app", REF.savy, "Bella Modas"),
    sondaComTitulo("b.vercel.app", REF.ikcous, "Bella Modas"),
  ];
  const noBanco = { [REF.savy]: "Bella Modas", [REF.ikcous]: "Bella Modas" };
  assertEquals(verificarIsolamentoCruzado(sondas, new Set(), noBanco), {});
  const { suspeitas, avisos } = titulosRepetidos(sondas, new Set(), noBanco);
  assertEquals(suspeitas, {});
  assertEquals(Object.keys(avisos).sort(), [
    "a.vercel.app",
    "a2.vercel.app",
    "b.vercel.app",
  ]);
  assertStringIncludes(avisos["b.vercel.app"][0], "Bella Modas");
  assertStringIncludes(avisos["b.vercel.app"][0], REF.savy);
  assertStringIncludes(avisos["b.vercel.app"][0], REF.ikcous);
});

Deno.test("titulosRepetidos: basta o banco de UM ref não confirmar o título servido para o grupo inteiro seguir SUSPEITA_ISOLAMENTO", () => {
  const sondas = [
    sondaComTitulo("a.vercel.app", REF.savy, "Bella Modas"),
    sondaComTitulo("b.vercel.app", REF.ikcous, "Bella Modas"),
  ];
  const casos = {
    // a identidade da Bella Modas servida com o banco da IKCOUS
    "banco de um ref tem outro nome": {
      [REF.savy]: "Bella Modas",
      [REF.ikcous]: "IKCOUS - imports",
    },
    "leitura do banco falhou (null)": {
      [REF.savy]: "Bella Modas",
      [REF.ikcous]: null,
    },
    "ref sem leitura": { [REF.savy]: "Bella Modas" },
    "sem leitura nenhuma": {},
    "só a caixa difere": {
      [REF.savy]: "Bella Modas",
      [REF.ikcous]: "bella modas",
    },
    "banco com cidade que a página não mostra": {
      [REF.savy]: "Bella Modas",
      [REF.ikcous]: "Bella Modas | Recife, PE",
    },
  };
  for (const [nome, noBanco] of Object.entries(casos)) {
    const r = verificarIsolamentoCruzado(sondas, new Set(), noBanco);
    for (const d of ["a.vercel.app", "b.vercel.app"])
      assertEquals(r[d]?.[0]?.classe, "SUSPEITA_ISOLAMENTO", `${nome}: ${d}`);
    assertEquals(titulosRepetidos(sondas, new Set(), noBanco).avisos, {}, nome);
  }
  // título assado do build igual em todas, cada banco com o próprio nome
  const assado = [
    sondaComTitulo("a.vercel.app", REF.savy, "IKCOUS Marketplace"),
    sondaComTitulo("b.vercel.app", REF.ikcous, "IKCOUS Marketplace"),
    sondaComTitulo("c.vercel.app", REF_C, "IKCOUS Marketplace"),
  ];
  const r = verificarIsolamentoCruzado(assado, new Set(), {
    [REF.savy]: "Savy",
    [REF.ikcous]: "IKCOUS - imports",
    [REF_C]: "Loja C",
  });
  assertEquals(Object.keys(r).sort(), [
    "a.vercel.app",
    "b.vercel.app",
    "c.vercel.app",
  ]);
});

Deno.test("tituloDaLinhaDoBanco: monta o título como o porteiro (nome aparado, ' | cidade, UF')", () => {
  const linha = (o) => ({
    store_name: "Bella Modas",
    store_city: null,
    store_state: null,
    ...o,
  });
  assertEquals(tituloDaLinhaDoBanco(linha({})), "Bella Modas");
  assertEquals(
    tituloDaLinhaDoBanco(
      linha({
        store_name: "  Bella  Modas ",
        store_city: " Recife ",
        store_state: "pe",
      }),
    ),
    "Bella Modas | Recife, PE",
  );
  assertEquals(
    tituloDaLinhaDoBanco(linha({ store_state: "SP" })),
    "Bella Modas | SP",
  );
  assertEquals(
    tituloDaLinhaDoBanco(linha({ store_city: "  ", store_state: "" })),
    "Bella Modas",
  );
  assertEquals(tituloDaLinhaDoBanco(linha({ store_name: "   " })), null);
  assertEquals(tituloDaLinhaDoBanco(linha({ store_name: null })), null);
  assertEquals(tituloDaLinhaDoBanco(null), null);
  assertEquals(tituloDaLinhaDoBanco("x"), null);
});

Deno.test("lerTituloNoBanco: 1 GET anônimo em v_store_config com a chave publicável; qualquer falha = null", async () => {
  const pedidos = [];
  const espia = (bancos) => {
    const f = fetchFalso({}, { bancos });
    return (url, init) => {
      pedidos.push({ url, headers: new Headers(init?.headers) });
      return f(url, init);
    };
  };
  const bella = {
    store_name: "Bella Modas",
    store_city: null,
    store_state: null,
  };
  assertEquals(
    await lerTituloNoBanco(REF.savy, CHAVE(REF.savy), {
      fetchImpl: espia({ [REF.savy]: bella }),
    }),
    "Bella Modas",
  );
  assertEquals(
    pedidos[0].url,
    `https://${REF.savy}.supabase.co/rest/v1/v_store_config?select=store_name,store_city,store_state&id=eq.1&limit=2`,
  );
  // chave antiga (JWT) também vai em Authorization; a nova, só em apikey
  assertEquals(
    pedidos[0].headers.get("authorization"),
    `Bearer ${CHAVE(REF.savy)}`,
  );
  pedidos.length = 0;
  await lerTituloNoBanco(REF.savy, "sb_publishable_testeTESTEteste0123", {
    fetchImpl: espia({ [REF.savy]: bella }),
  });
  assertEquals(pedidos[0].headers.get("authorization"), null);
  assertEquals(
    pedidos[0].headers.get("apikey"),
    "sb_publishable_testeTESTEteste0123",
  );

  const casos = {
    "chave de outro projeto (401)": [REF.savy, CHAVE(REF.ikcous), bella],
    "nenhuma linha": [REF.savy, CHAVE(REF.savy), { linhas: [] }],
    "duas linhas": [REF.savy, CHAVE(REF.savy), { linhas: [bella, bella] }],
    "HTTP 500": [REF.savy, CHAVE(REF.savy), { status: 500 }],
    "rede caiu": [REF.savy, CHAVE(REF.savy), "derruba"],
    "nome vazio": [
      REF.savy,
      CHAVE(REF.savy),
      { store_name: " ", store_city: null, store_state: null },
    ],
  };
  for (const [nome, [ref, chave, banco]] of Object.entries(casos))
    assertEquals(
      await lerTituloNoBanco(ref, chave, {
        fetchImpl: espia({ [REF.savy]: banco }),
      }),
      null,
      nome,
    );
  // sem chave ou ref inválido: nem chega a pedir
  pedidos.length = 0;
  assertEquals(
    await lerTituloNoBanco(REF.savy, null, {
      fetchImpl: espia({ [REF.savy]: bella }),
    }),
    null,
  );
  assertEquals(
    await lerTituloNoBanco("curto", CHAVE(REF.savy), {
      fetchImpl: espia({ [REF.savy]: bella }),
    }),
    null,
  );
  assertEquals(pedidos.length, 0);
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
    inv.dominios.includes(REDIRECIONA),
    "os esperados pela política continuam",
  );
  assert(
    chamadas.some((c) => c.includes("until=1790562712245")),
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
  mundo["savycollection.vercel.app"].alterna = {
    ref: REF.ikcous,
    titulo: "IKCOUS - imports",
  };
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
  });
  const x = r.resultados.find((y) => y.dominio === "savycollection.vercel.app");
  assertEquals(x.classe, "LOJA_TROCADA");
  assertEquals(r.ok, false);
});

Deno.test("conferirFrota: endereço que não responde = INALCANCAVEL; version.json HTTP 500 idem", async () => {
  const mundo = mundoBase();
  mundo["ickous-marketplace.vercel.app"].falha = "derruba";
  mundo["savycollection.vercel.app"].versaoHttp = 500;
  const esperas = [];
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
    // as pausas da nova tentativa, anotadas em vez de dormidas
    esperar: async (ms) => {
      esperas.push(ms);
    },
  });
  const por = Object.fromEntries(
    r.resultados.map((x) => [x.dominio, x.classe]),
  );
  assertEquals(por["ickous-marketplace.vercel.app"], "INALCANCAVEL");
  assertEquals(por["savycollection.vercel.app"], "INALCANCAVEL");
  // só depois de 2 novas tentativas (2 s e 5 s) em cada pedido que tropeçou
  assert(
    esperas.length > 0 && esperas.every((ms) => ms === 2000 || ms === 5000),
  );
});

Deno.test("conferirFrota: loja mostrando a ficha de OUTRA (ref+título de outra loja) é LOJA_TROCADA nos dois", async () => {
  const mundo = mundoBase();
  // IKCOUS passa a servir o ref da savy mas com o próprio título
  mundo["ickous-marketplace.vercel.app"].ref = REF.savy;
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
  });
  const por = Object.fromEntries(
    r.resultados.map((x) => [x.dominio, x.classe]),
  );
  assertEquals(por["ickous-marketplace.vercel.app"], "LOJA_TROCADA");
  assertEquals(por["savycollection.vercel.app"], "LOJA_TROCADA");
});

Deno.test("conferirFrota: dois refs diferentes com o mesmo título = SUSPEITA_ISOLAMENTO", async () => {
  const mundo = mundoBase();
  mundo["ickous-marketplace.vercel.app"].titulo = "Savy";
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
  });
  const por = Object.fromEntries(
    r.resultados.map((x) => [x.dominio, x.classe]),
  );
  assertEquals(por["ickous-marketplace.vercel.app"], "SUSPEITA_ISOLAMENTO");
  assertEquals(por["savycollection.vercel.app"], "SUSPEITA_ISOLAMENTO");
  // o publicUrl é o do próprio endereço (estado real do porteiro): quem barra é
  // o título, não o canônico
  for (const x of r.resultados.filter((y) => !y.esperado))
    assert(!x.achados.some((a) => a.classe === "CANONICO_INVALIDO"));
  assertEquals(r.ok, false);
  assert(problemasAntesDoPromote(r, SHA).length > 0);
});

// Com 30, 300 lojas, duas lojistas reais com o mesmo nome é normal. O banco de
// cada ref confirma o nome que o endereço dele serve: o título repetido vira
// AVISO no relatório e não barra a publicação.
Deno.test("conferirFrota: duas lojas com o MESMO nome, cada endereço servindo o nome do PRÓPRIO banco, não barram a publicação (AVISO)", async () => {
  const mundo = mundoBase();
  mundo["ickous-marketplace.vercel.app"].titulo = "Bella Modas";
  mundo["savycollection.vercel.app"].titulo = "Bella Modas";
  const bella = {
    store_name: "Bella Modas",
    store_city: null,
    store_state: null,
  };
  const leituras = [];
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo, {
      bancos: { [REF.ikcous]: bella, [REF.savy]: bella },
      leituras,
    }),
  });
  for (const d of [
    "ickous-marketplace.vercel.app",
    "savycollection.vercel.app",
  ]) {
    const x = r.resultados.find((y) => y.dominio === d);
    assertEquals(x.classe, "OK", d);
    assertEquals(x.achados, [], d);
    assertEquals(x.avisos.length, 1, d);
    assertStringIncludes(x.avisos[0], "Bella Modas");
  }
  assertEquals(r.ok, true);
  assertStringIncludes(r.relatorio, "AVISO");
  assertStringIncludes(r.relatorio, "Bella Modas");
  // o portão de antes do promote (publicar-release) não acha o que barrar
  assertEquals(problemasAntesDoPromote(r, SHA), []);
  // uma leitura por ref do grupo, nada mais
  assertEquals(leituras.sort(), [REF.ikcous, REF.savy].sort());
});

Deno.test("conferirFrota: frota sem título repetido não lê banco nenhum", async () => {
  const leituras = [];
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundoBase(), { leituras }),
  });
  assertEquals(r.ok, true);
  assertEquals(leituras, []);
  assert(r.resultados.every((x) => x.avisos.length === 0));
});

Deno.test("conferirFrota: a identidade de uma Bella Modas servida com o banco de OUTRA loja barra o grupo inteiro (SUSPEITA_ISOLAMENTO)", async () => {
  const mundo = mundoBase();
  mundo["ickous-marketplace.vercel.app"].titulo = "Bella Modas";
  mundo["savycollection.vercel.app"].titulo = "Bella Modas";
  // terceira loja: o banco dela diz "Loja C", mas o endereço serve "Bella Modas"
  mundo["lojac.vercel.app"] = {
    ...mundo["savycollection.vercel.app"],
    ref: REF_C,
    titulo: "Bella Modas",
  };
  const bella = {
    store_name: "Bella Modas",
    store_city: null,
    store_state: null,
  };
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    enderecosExtras: ["lojac.vercel.app"],
    fetchImpl: fetchFalso(mundo, {
      bancos: {
        [REF.ikcous]: bella,
        [REF.savy]: bella,
        [REF_C]: { store_name: "Loja C", store_city: null, store_state: null },
      },
    }),
  });
  for (const d of [
    "ickous-marketplace.vercel.app",
    "savycollection.vercel.app",
    "lojac.vercel.app",
  ]) {
    const x = r.resultados.find((y) => y.dominio === d);
    assertEquals(x.classe, "SUSPEITA_ISOLAMENTO", d);
    assert(!x.achados.some((a) => a.classe === "CANONICO_INVALIDO"), d);
  }
  assertEquals(r.ok, false);
  assert(problemasAntesDoPromote(r, SHA).length > 0);
});

Deno.test("conferirFrota: título ASSADO do build igual em todas as lojas barra (SUSPEITA_ISOLAMENTO)", async () => {
  const mundo = mundoBase();
  for (const d of [
    "ickous-marketplace.vercel.app",
    "savycollection.vercel.app",
  ])
    mundo[d].titulo = "IKCOUS Marketplace";
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
  });
  const por = Object.fromEntries(
    r.resultados.map((x) => [x.dominio, x.classe]),
  );
  assertEquals(por["ickous-marketplace.vercel.app"], "SUSPEITA_ISOLAMENTO");
  assertEquals(por["savycollection.vercel.app"], "SUSPEITA_ISOLAMENTO");
  assertEquals(r.ok, false);
  assert(problemasAntesDoPromote(r, SHA).length > 0);
});

Deno.test("conferirFrota: duas Bella Modas sem leitura confirmada do banco (falha, chave de outro projeto) continuam barrando", async () => {
  const bella = {
    store_name: "Bella Modas",
    store_city: null,
    store_state: null,
  };
  const casos = {
    "banco fora do ar": { [REF.ikcous]: bella, [REF.savy]: "derruba" },
    "HTTP 500": { [REF.ikcous]: bella, [REF.savy]: { status: 500 } },
  };
  for (const [nome, bancos] of Object.entries(casos)) {
    const mundo = mundoBase();
    mundo["ickous-marketplace.vercel.app"].titulo = "Bella Modas";
    mundo["savycollection.vercel.app"].titulo = "Bella Modas";
    const r = await conferirFrota(POLITICA, {
      sha: SHA,
      fetchImpl: fetchFalso(mundo, { bancos }),
    });
    assertEquals(r.ok, false, nome);
    assertEquals(
      r.resultados.find((y) => y.dominio === "savycollection.vercel.app")
        .classe,
      "SUSPEITA_ISOLAMENTO",
      nome,
    );
  }
  // a ficha da savy serve a chave publicável de OUTRO projeto: o banco recusa
  const mundo = mundoBase();
  mundo["ickous-marketplace.vercel.app"].titulo = "Bella Modas";
  mundo["savycollection.vercel.app"].titulo = "Bella Modas";
  mundo["savycollection.vercel.app"].chave = CHAVE(REF.ikcous);
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo, {
      bancos: { [REF.ikcous]: bella, [REF.savy]: bella },
    }),
  });
  assertEquals(r.ok, false);
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
    const alvo = mundo["savycollection.vercel.app"];
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
    assert(por["savycollection.vercel.app"] !== "OK", `virou OK: ${nome}`);
    assertEquals(r.ok, false, nome);
    assertEquals(
      r.resultados.filter((x) => x.classe !== "OK").map((x) => x.dominio),
      ["savycollection.vercel.app"],
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
      sondaFicha("o.vercel.app", fichaDe(REF.ikcous, "https://o.vercel.app")),
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
  const mundo = mundoBase({ comManutencao: true });
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

Deno.test("consultarVercel: alias com o MESMO createdAt do fim da página não some (empate na fronteira)", async () => {
  // Como a Vercel de verdade: ordem decrescente por createdAt, `until` é "estritamente
  // menor que", pagination.next = createdAt do ÚLTIMO item da página. Em 28/10/2026 o
  // alias principal empatou com o último da 7ª página e o inventário saiu sem a loja.
  const base = [
    ["a.vercel.app", 30],
    ["b.vercel.app", 20],
    ["c.vercel.app", 10],
    ["ickous-marketplace.vercel.app", 10],
  ].map(([alias, createdAt]) => ({
    alias,
    createdAt,
    deploymentId: "dpl_1",
    projectId: PROJETO,
  }));
  const chamadas = [];
  const r = await consultarVercel(
    POLITICA,
    [],
    (c) => {
      if (c.startsWith("/v4/aliases?")) {
        chamadas.push(c);
        const limite = Number(/limit=(\d+)/.exec(c)[1]);
        const ate = /until=(\d+)/.exec(c);
        const itens = base
          .filter((a) => (ate ? a.createdAt < Number(ate[1]) : true))
          .slice(0, limite);
        const cheia = itens.length === limite;
        return Promise.resolve({
          aliases: itens,
          pagination: {
            next: cheia ? itens[itens.length - 1].createdAt : null,
          },
        });
      }
      return Promise.resolve({ targets: { production: { id: "dpl_1" } } });
    },
    3,
  );
  assertEquals(r.ok, true);
  assertEquals(r.listaCompleta, true);
  assert(
    chamadas.some((c) => c.includes("until=11")),
    "pediu a página seguinte com next+1 (empate incluído)",
  );
  const nomes = r.aliasesProjeto.map((a) => a.alias);
  assert(
    nomes.includes("ickous-marketplace.vercel.app"),
    "o alias empatado na fronteira da página tem de entrar no inventário",
  );
  assertEquals(nomes.length, 4, "sem duplicar o item da fronteira");
});

Deno.test("consultarVercel: página que só repete o que já veio = lista incompleta (nunca laço nem 'completo')", async () => {
  // 4 aliases com o MESMO createdAt e página de 3: o next+1 devolve sempre os mesmos.
  const base = ["a", "b", "c", "d"].map((n) => ({
    alias: `${n}.vercel.app`,
    createdAt: 10,
    deploymentId: "dpl_1",
    projectId: PROJETO,
  }));
  let pedidos = 0;
  const r = await consultarVercel(
    POLITICA,
    [],
    (c) => {
      if (c.startsWith("/v4/aliases?")) {
        pedidos++;
        const itens = base.slice(0, 3);
        return Promise.resolve({
          aliases: itens,
          pagination: { next: 10 },
        });
      }
      return Promise.resolve({ targets: { production: { id: "dpl_1" } } });
    },
    3,
  );
  assertEquals(r.ok, true);
  assertEquals(r.listaCompleta, false);
  assert(r.avisos.some((a) => a.includes("nada novo")));
  assertEquals(pedidos, 2, "parou na página sem item novo, sem laço");
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
    assertStringIncludes(r.saida, "3 de 3 endereços OK");
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
    mundo["ickous-marketplace.vercel.app"].ref = REF.savy;
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
    mundo["ickous-marketplace.vercel.app"].alterna = {
      ref: REF.savy,
      titulo: "Savy",
    };
    const r = await rodar(["--sha", SHA], mundo);
    assertEquals(r.codigo, 1);
    assertStringIncludes(r.saida, "divergem");
  },
});

Deno.test({
  // No processo (main), contra o MESMO stub HTTP: um subprocesso dormiria de
  // verdade as pausas da nova tentativa (2 s + 5 s); aqui `esperar` é falso.
  name: "main contra o stub HTTP: endereço que não responde -> INALCANCAVEL, exit 1, sem dormir as pausas",
  ...SEM_SANITIZAR,
  async fn() {
    const mundo = mundoBase();
    mundo["savycollection.vercel.app"].falha = "trava";
    const stub = subirStub(mundo);
    const esperas = [];
    const logs = [];
    const antes = console.log;
    console.log = (...a) => logs.push(a.join(" "));
    let codigo;
    try {
      codigo = await main(
        ["--sha", SHA],
        {
          FROTA_URL_MODELO: `${stub.base}/{dominio}`,
          FROTA_TIMEOUT_MS: "800",
          GITHUB_STEP_SUMMARY: "",
        },
        { esperar: async (ms) => void esperas.push(ms) },
      );
    } finally {
      console.log = antes;
      await stub.parar();
    }
    const saida = logs.join("\n");
    assertEquals(codigo, 1);
    assertStringIncludes(saida, "INALCANCAVEL");
    assertStringIncludes(saida, "timeout");
    // as pausas foram pedidas (houve nova tentativa), mas não dormidas
    assert(esperas.includes(2000) && esperas.includes(5000), `${esperas}`);
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
  assertEquals(POLITICA.lojasSemBackendGerenciado, []);
  assertEquals(POLITICA.enderecosDeReserva, Object.keys(LOJAS));
  assertStringIncludes(POLITICA.motivoLojasSemBackendGerenciado, "16/10/2026");
  // Os 4 enderecos de manutencao foram descontinuados (dono, 12/10/2026) e
  // saíram do projeto Vercel: a política não os declara mais, senão a
  // conferência os sondaria, leria 404 e bloquearia a release.
  assertEquals(
    POLITICA.enderecosEsperados.filter((e) => e.estado === "manutencao"),
    [],
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

// ------------------------------------------------- cartaz pre-impresso (lote B)

Deno.test("sondarEndereco: as amostras de '/' vao com Sec-Fetch-Dest: document e Sec-Fetch-Mode: navigate; version.json, nao", async () => {
  const pedidos = [];
  const fetchImpl = (url, init) => {
    const u = new URL(url);
    pedidos.push({ caminho: u.pathname, headers: init?.headers ?? null });
    return Promise.resolve(
      u.pathname === "/version.json"
        ? new Response("{}", { status: 200 })
        : new Response(html("Savy", [REF.savy], "https://savy.example"), {
            status: 200,
            headers: {
              "x-ikcous-caderneta": "hit",
              "x-ikcous-porteiro": "ok",
            },
          }),
    );
  };
  const s = await sondarEndereco("savycollection.vercel.app", {
    fetchImpl,
    amostras: 3,
  });
  const paginas = pedidos.filter((p) => p.caminho === "/");
  assertEquals(paginas.length, 3);
  for (const p of paginas)
    assertEquals(p.headers, {
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
    });
  assertEquals(
    pedidos.find((p) => p.caminho === "/version.json")?.headers,
    null,
  );
  // O selo do middleware chega na ficha.
  assertEquals(s.ficha.porteiro, "ok");
});

Deno.test("classificar: loja 200 em 1a abertura SEM x-ikcous-porteiro: ok e ESTADO_INESPERADO (o middleware nao rodou), nunca OK", () => {
  for (const porteiro of [null, undefined, "", "sem-loja", "discorda", "OK"]) {
    const r = classificar(
      LOJA,
      sonda(LOJA.dominio, { pagina: { porteiro } }),
      CTX,
    );
    assertEquals(r.classe, "ESTADO_INESPERADO", `porteiro=${porteiro}`);
    assertStringIncludes(r.achados[0].motivo, "x-ikcous-porteiro");
  }
  // O caso saudavel continua OK.
  assertEquals(classificar(LOJA, sonda(LOJA.dominio), CTX).classe, "OK");
});

Deno.test("conferirFrota: uma loja que responde 200 sem o selo do porteiro reprova a frota", async () => {
  const mundo = mundoBase();
  mundo["savycollection.vercel.app"].semSelo = true;
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
  });
  assertEquals(r.ok, false);
  const por = Object.fromEntries(
    r.resultados.map((x) => [x.dominio, x.classe]),
  );
  assertEquals(por["savycollection.vercel.app"], "ESTADO_INESPERADO");
  assertEquals(por["ickous-marketplace.vercel.app"], "OK");
  assertStringIncludes(r.relatorio, "x-ikcous-porteiro");
});

// ------------------------------------------ L8 lote 3: loja fora do ar por decisão
// Contrato do porteiro (Lote 2 do L8): adormecida = 503 + x-ikcous-porteiro:
// adormecida; encerrada = 410 + x-ikcous-porteiro: encerrada; as duas com
// x-ikcous-estado igual e x-ikcous-ref (20 letras minúsculas). O portão só
// exige quem está ATIVA; qualquer outra combinação continua reprovando.

const DORMINDO = "loja-dormindo.example";
const REF_DORMINDO = "zzzzzzzzzzzzzzzzzzzz";

/** Página de "/" que o porteiro serve para uma loja fora do ar. */
const paginaForaDoAr = (estado, extra = {}) => ({
  status: estado === "encerrada" ? 410 : 503,
  caderneta: "hit",
  porteiro: estado,
  estado,
  refPorteiro: REF_DORMINDO,
  titulo: "Loja fechada",
  refs: [],
  publicUrl: null,
  ...extra,
});

const LOJA_DORMINDO = { dominio: DORMINDO, esperado: null };

function mundoComDormindo(extra = {}) {
  const mundo = mundoBase();
  mundo[DORMINDO] = {
    ...mundo["savycollection.vercel.app"],
    tipo: "foraDoAr",
    status: 503,
    porteiro: "adormecida",
    estado: "adormecida",
    refPorteiro: REF_DORMINDO,
    ...extra,
  };
  return mundo;
}

Deno.test("L8 sondarEndereco: lê x-ikcous-estado, x-ikcous-ref e x-ikcous-caderneta-versao de cada amostra de '/'", async () => {
  const mundo = mundoComDormindo({ cadernetaVersao: "2" });
  const s = await sondarEndereco(DORMINDO, { fetchImpl: fetchFalso(mundo) });
  assertEquals(s.amostras.length, 3);
  for (const a of s.amostras) {
    assertEquals(a.status, 503);
    assertEquals(a.porteiro, "adormecida");
    assertEquals(a.estado, "adormecida");
    assertEquals(a.refPorteiro, REF_DORMINDO);
    assertEquals(a.cadernetaVersao, "2");
  }
  assertEquals(s.ficha.estado, "adormecida");
  assertEquals(s.ficha.refPorteiro, REF_DORMINDO);
  // Loja ativa sem os cabeçalhos novos: os campos ficam null (nunca "").
  const ativa = await sondarEndereco("savycollection.vercel.app", {
    fetchImpl: fetchFalso(mundo),
  });
  assertEquals(ativa.ficha.estado, null);
  assertEquals(ativa.ficha.refPorteiro, null);
  assertEquals(ativa.ficha.cadernetaVersao, null);
});

Deno.test("L8 classificar: adormecida (503) = ADORMECIDA e encerrada (410) = ENCERRADA, sem nenhum outro achado", () => {
  for (const [estado, classe] of [
    ["adormecida", "ADORMECIDA"],
    ["encerrada", "ENCERRADA"],
  ]) {
    const r = classificar(
      LOJA_DORMINDO,
      sonda(DORMINDO, { pagina: paginaForaDoAr(estado) }),
      CTX,
    );
    assertEquals(r.classe, classe, JSON.stringify(r.achados));
    assertEquals(
      r.achados.map((a) => a.classe),
      [classe],
      JSON.stringify(r.achados),
    );
    assertStringIncludes(r.achados[0].motivo, estado);
    assertStringIncludes(r.achados[0].motivo, REF_DORMINDO);
  }
});

Deno.test("L8 classificar: qualquer outra combinação de status/porteiro/estado/ref continua ESTADO_INESPERADO (nunca ADORMECIDA/ENCERRADA nem OK)", () => {
  const casos = {
    "503 com porteiro encerrada": {
      porteiro: "encerrada",
      estado: "encerrada",
    },
    "410 com porteiro adormecida": {
      status: 410,
      porteiro: "adormecida",
      estado: "adormecida",
    },
    "porteiro e estado discordam": { estado: "encerrada" },
    "sem x-ikcous-estado": { estado: null },
    "sem x-ikcous-porteiro (só o estado)": { porteiro: null },
    "estado ativa": { estado: "ativa" },
    "sem x-ikcous-ref": { refPorteiro: null },
    "ref com 19 letras": { refPorteiro: "z".repeat(19) },
    "ref com 21 letras": { refPorteiro: "z".repeat(21) },
    "ref com maiúscula": { refPorteiro: `Z${"z".repeat(19)}` },
    "ref com dígito": { refPorteiro: `1${"z".repeat(19)}` },
    "ref vazio": { refPorteiro: "" },
    "status 500": { status: 500 },
    "status 200": { status: 200 },
  };
  for (const [nome, extra] of Object.entries(casos)) {
    const r = classificar(
      LOJA_DORMINDO,
      sonda(DORMINDO, { pagina: paginaForaDoAr("adormecida", extra) }),
      CTX,
    );
    assertEquals(
      r.classe,
      "ESTADO_INESPERADO",
      `${nome}: ${JSON.stringify(r.achados)}`,
    );
    assert(
      !r.achados.some(
        (a) => a.classe === "ADORMECIDA" || a.classe === "ENCERRADA",
      ),
      nome,
    );
  }
});

Deno.test("L8 classificar: amostras que discordam (uma adormecida, outra encerrada; ou ref diferente) nunca viram fora do ar", () => {
  const misturadas = classificar(
    LOJA_DORMINDO,
    sonda(DORMINDO, {
      amostras: [
        paginaForaDoAr("adormecida"),
        paginaForaDoAr("encerrada"),
        paginaForaDoAr("adormecida"),
      ],
    }),
    CTX,
  );
  assert(
    !["OK", "ADORMECIDA", "ENCERRADA"].includes(misturadas.classe),
    misturadas.classe,
  );
  const refDiferente = classificar(
    LOJA_DORMINDO,
    sonda(DORMINDO, {
      amostras: [
        paginaForaDoAr("adormecida"),
        paginaForaDoAr("adormecida", { refPorteiro: "y".repeat(20) }),
        paginaForaDoAr("adormecida"),
      ],
    }),
    CTX,
  );
  assertEquals(refDiferente.classe, "ESTADO_INESPERADO");
});

Deno.test("L8 classificar: a loja ativa com 503 banco-indisponivel continua reprovando (não é fora do ar por decisão)", () => {
  const r = classificar(
    LOJA,
    sonda(LOJA.dominio, {
      pagina: {
        status: 503,
        porteiro: "banco-indisponivel",
        titulo: "Loja em manutenção",
        refs: [],
      },
    }),
    CTX,
  );
  assert(!["OK", "ADORMECIDA", "ENCERRADA"].includes(r.classe), r.classe);
  // Nem quando um cabeçalho de estado aparece sem o porteiro certo.
  const r2 = classificar(
    LOJA,
    sonda(LOJA.dominio, {
      pagina: paginaForaDoAr("adormecida", { porteiro: "banco-indisponivel" }),
    }),
    CTX,
  );
  assertEquals(r2.classe, "ESTADO_INESPERADO");
});

Deno.test("L8 classificar: loja fora do ar ainda é conferida na versão (SHA velho = ENDERECO_ANTIGO, que é mais grave)", () => {
  const r = classificar(
    LOJA_DORMINDO,
    sonda(DORMINDO, {
      pagina: paginaForaDoAr("adormecida"),
      versao: { codeSha: SHA_VELHO },
    }),
    CTX,
  );
  assertEquals(r.classe, "ENDERECO_ANTIGO");
  assert(r.achados.some((a) => a.classe === "ADORMECIDA"));
});

Deno.test("L8 classificar: loja da lista lojasQueNuncaDormem fora do ar = ESTADO_INESPERADO", () => {
  const ctx = { ...CTX, lojasQueNuncaDormem: new Set([REF_DORMINDO]) };
  for (const estado of ["adormecida", "encerrada"]) {
    const r = classificar(
      LOJA_DORMINDO,
      sonda(DORMINDO, { pagina: paginaForaDoAr(estado) }),
      ctx,
    );
    assertEquals(r.classe, "ESTADO_INESPERADO", estado);
    assert(
      r.achados.some((a) => a.motivo.includes("lojasQueNuncaDormem")),
      JSON.stringify(r.achados),
    );
  }
});

Deno.test("L8 GRAVIDADE: ADORMECIDA e ENCERRADA ficam entre ESTADO_INESPERADO e OK, e toda classe ruim tem COMO_RECUPERAR", () => {
  const i = (c) => GRAVIDADE.indexOf(c);
  assert(i("ENCERRADA") > i("ESTADO_INESPERADO"));
  assert(i("ADORMECIDA") > i("ESTADO_INESPERADO"));
  assert(i("ENCERRADA") < i("OK"));
  assert(i("ADORMECIDA") < i("OK"));
  assertEquals(GRAVIDADE.at(-1), "OK");
  for (const c of GRAVIDADE.filter((c) => c !== "OK"))
    assert(typeof COMO_RECUPERAR[c] === "string" && COMO_RECUPERAR[c], c);
});

Deno.test("L8 verificarCanonico: página de loja fora do ar (sem publicUrl) não vira CANONICO_INVALIDO", () => {
  const s = sonda(DORMINDO, { pagina: paginaForaDoAr("adormecida") });
  assertEquals(verificarCanonico([s]).achados, {});
});

Deno.test("L8 conferirFrota: loja adormecida não reprova a frota, conta como sondada e aparece em 'Lojas fora do ar por decisão'", async () => {
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundoComDormindo()),
    enderecosExtras: [DORMINDO],
    lojasObrigatorias: [
      { ref: REF.ikcous, nome: "IKCOUS" },
      { ref: REF.savy, nome: "Savy" },
      { ref: REF_DORMINDO, nome: "Loja Dormindo" },
    ],
  });
  const por = Object.fromEntries(
    r.resultados.map((x) => [x.dominio, x.classe]),
  );
  assertEquals(por[DORMINDO], "ADORMECIDA");
  assertEquals(por["savycollection.vercel.app"], "OK");
  assertEquals(r.ok, true, r.relatorio);
  assert(!r.relatorio.includes("não foi sondada"), r.relatorio);
  assertStringIncludes(r.relatorio, "## Lojas fora do ar por decisão");
  assertStringIncludes(
    r.relatorio,
    `- ${DORMINDO}: adormecida (ref ${REF_DORMINDO})`,
  );
  const fora = r.resultados.find((x) => x.dominio === DORMINDO).foraDoAr;
  assertEquals(fora, { estado: "adormecida", ref: REF_DORMINDO });
});

Deno.test("L8 conferirFrota: encerrada (410) também passa; sem nenhuma, a seção diz 'nenhuma'", async () => {
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(
      mundoComDormindo({
        status: 410,
        porteiro: "encerrada",
        estado: "encerrada",
      }),
    ),
    enderecosExtras: [DORMINDO],
  });
  assertEquals(r.ok, true, r.relatorio);
  assertStringIncludes(
    r.relatorio,
    `- ${DORMINDO}: encerrada (ref ${REF_DORMINDO})`,
  );
  const limpo = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundoBase()),
  });
  assertEquals(limpo.ok, true, limpo.relatorio);
  assertStringIncludes(
    limpo.relatorio,
    "## Lojas fora do ar por decisão\n\n- nenhuma",
  );
});

Deno.test("L8 conferirFrota: a IKCOUS (politica.json lojasQueNuncaDormem) adormecida reprova a frota", async () => {
  const mundo = mundoBase();
  mundo["ickous-marketplace.vercel.app"] = {
    ...mundo["ickous-marketplace.vercel.app"],
    tipo: "foraDoAr",
    status: 503,
    porteiro: "adormecida",
    estado: "adormecida",
    refPorteiro: REF.ikcous,
  };
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
  });
  assertEquals(r.ok, false);
  const ik = r.resultados.find(
    (x) => x.dominio === "ickous-marketplace.vercel.app",
  );
  assertEquals(ik.classe, "ESTADO_INESPERADO", JSON.stringify(ik.achados));
});

Deno.test("L8 conferirFrota: resposta de loja fora do ar fora do contrato reprova a frota (ESTADO_INESPERADO)", async () => {
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundoComDormindo({ refPorteiro: "curto" })),
    enderecosExtras: [DORMINDO],
  });
  assertEquals(r.ok, false);
  const d = r.resultados.find((x) => x.dominio === DORMINDO);
  assertEquals(d.classe, "ESTADO_INESPERADO", JSON.stringify(d.achados));
  assertEquals(d.foraDoAr, null);
});

Deno.test("L8 conferirFrota: x-ikcous-caderneta-versao: 1 (porteiro na caderneta antiga) gera AVISO no relatório, sem reprovar sozinho", async () => {
  const mundo = mundoBase();
  mundo["savycollection.vercel.app"].cadernetaVersao = "1";
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
  });
  assertEquals(r.ok, true, r.relatorio);
  const aviso = r.relatorio
    .split("\n")
    .find((l) => l.includes("x-ikcous-caderneta-versao: 1"));
  assert(aviso, r.relatorio);
  assertStringIncludes(aviso, "AVISO");
  assertStringIncludes(aviso, "savycollection.vercel.app");
  assert(!aviso.includes("ickous-marketplace.vercel.app,"), aviso);
  const limpo = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundoBase()),
  });
  assert(!limpo.relatorio.includes("x-ikcous-caderneta-versao"));
});

Deno.test("L8 política: lojasQueNuncaDormem = IKCOUS e Savy, os mesmos refs de canais-de-backend.json", () => {
  const canais = JSON.parse(
    Deno.readTextFileSync(join(RAIZ, "scripts/frota/canais-de-backend.json")),
  );
  const porNome = Object.fromEntries(
    Object.entries(canais.canais).map(([ref, c]) => [c.nome, ref]),
  );
  const refs = (POLITICA.lojasQueNuncaDormem ?? []).map((l) => l.ref).sort();
  assertEquals(refs, [porNome.IKCOUS, porNome.Savy].sort());
  assertEquals(refs, [REF.ikcous, REF.savy].sort());
});

// ------------------------------------------------------------------ T10: loja aberta pela reserva da caderneta
//
// Plano PLANO-RESERVA-DA-CADERNETA-26-11.md, T10. Quando a caderneta central
// falha e não há ficha, o porteiro abre a loja pela reserva e marca a resposta
// com `x-ikcous-caderneta: reserva`. A loja está no ar, mas a caderneta caiu:
// CADERNETA_NA_RESERVA, entre INALCANCAVEL e ENDERECO_ANTIGO, bloqueia antes do
// promote e reprova depois. `reserva` NÃO conta como loja ativa.

const paginaNaReserva = (extra = {}) => ({
  status: 200,
  caderneta: "reserva",
  porteiro: "ok",
  titulo: "Savy",
  refs: [REF.savy],
  ...extra,
});
const paginaHit = () => ({
  status: 200,
  caderneta: "hit",
  porteiro: "ok",
  titulo: "Savy",
  refs: [REF.savy],
});

Deno.test("T10 GRAVIDADE: CADERNETA_NA_RESERVA fica logo abaixo de INALCANCAVEL e logo acima de ENDERECO_ANTIGO, com COMO_RECUPERAR", () => {
  const i = (c) => GRAVIDADE.indexOf(c);
  assert(i("CADERNETA_NA_RESERVA") >= 0, "a classe existe");
  assertEquals(i("CADERNETA_NA_RESERVA"), i("INALCANCAVEL") + 1);
  assertEquals(i("ENDERECO_ANTIGO"), i("CADERNETA_NA_RESERVA") + 1);
  assertStringIncludes(COMO_RECUPERAR.CADERNETA_NA_RESERVA, "caderneta");
});

Deno.test("T10 classificar: loja servida pela reserva (200, x-ikcous-caderneta: reserva) = CADERNETA_NA_RESERVA, não OK nem 'sem ficha de loja'", () => {
  const r = classificar(
    LOJA,
    sonda(LOJA.dominio, { pagina: paginaNaReserva() }),
    CTX,
  );
  assertEquals(r.classe, "CADERNETA_NA_RESERVA", JSON.stringify(r.achados));
  assert(
    !r.achados.some((a) => a.motivo.includes("sem ficha de loja")),
    JSON.stringify(r.achados),
  );
  assertStringIncludes(
    r.achados.find((a) => a.classe === "CADERNETA_NA_RESERVA").motivo,
    "reserva",
  );
});

Deno.test("T10 classificar: na reserva vence ENDERECO_ANTIGO; INALCANCAVEL vence a reserva", () => {
  const velho = classificar(
    LOJA,
    sonda(LOJA.dominio, {
      pagina: paginaNaReserva(),
      versao: { codeSha: SHA_VELHO, codeVersion: "1.5.17" },
    }),
    CTX,
  );
  assertEquals(velho.classe, "CADERNETA_NA_RESERVA");
  assert(velho.achados.some((a) => a.classe === "ENDERECO_ANTIGO"));
  const semVersao = classificar(
    LOJA,
    sonda(LOJA.dominio, {
      pagina: paginaNaReserva(),
      versao: null,
      erroVersao: "version.json: timeout",
    }),
    CTX,
  );
  assertEquals(semVersao.classe, "INALCANCAVEL");
  assert(semVersao.achados.some((a) => a.classe === "CADERNETA_NA_RESERVA"));
});

Deno.test("T10 classificar: as amostras só oscilam entre hit e reserva (MESMA loja) = CADERNETA_NA_RESERVA, nunca LOJA_TROCADA", () => {
  for (const amostras of [
    [paginaHit(), paginaNaReserva(), paginaHit()],
    [paginaNaReserva(), paginaHit(), paginaHit()],
  ]) {
    const r = classificar(LOJA, sonda(LOJA.dominio, { amostras }), CTX);
    assertEquals(r.classe, "CADERNETA_NA_RESERVA", JSON.stringify(r.achados));
    assert(
      !r.achados.some((a) => a.classe === "LOJA_TROCADA"),
      JSON.stringify(r.achados),
    );
  }
});

Deno.test("T10 classificar: hit e reserva com ref, título ou HTTP DIFERENTES continua LOJA_TROCADA", () => {
  for (const outra of [
    paginaNaReserva({ refs: [REF.ikcous] }),
    paginaNaReserva({ titulo: "IKCOUS - imports" }),
    paginaNaReserva({ status: 503 }),
  ]) {
    const r = classificar(
      LOJA,
      sonda(LOJA.dominio, { amostras: [paginaHit(), outra, paginaHit()] }),
      CTX,
    );
    assertEquals(r.classe, "LOJA_TROCADA", JSON.stringify(r.achados));
  }
  // `erro` não é a reserva: oscilar hit/erro segue sendo amostra divergente.
  const comErro = classificar(
    LOJA,
    sonda(LOJA.dominio, {
      amostras: [
        paginaHit(),
        paginaHit(),
        { ...paginaHit(), caderneta: "erro" },
      ],
    }),
    CTX,
  );
  assertEquals(comErro.classe, "LOJA_TROCADA", JSON.stringify(comErro.achados));
});

Deno.test("T10 classificar: página da reserva com dois refs ou sem título continua LOJA_TROCADA", () => {
  const doisRefs = classificar(
    LOJA,
    sonda(LOJA.dominio, {
      pagina: paginaNaReserva({ refs: [REF.savy, REF.ikcous] }),
    }),
    CTX,
  );
  assertEquals(
    doisRefs.classe,
    "LOJA_TROCADA",
    JSON.stringify(doisRefs.achados),
  );
  const semTitulo = classificar(
    LOJA,
    sonda(LOJA.dominio, { pagina: paginaNaReserva({ titulo: null }) }),
    CTX,
  );
  assertEquals(
    semTitulo.classe,
    "LOJA_TROCADA",
    JSON.stringify(semTitulo.achados),
  );
});

Deno.test("T10 classificar: endereço esperado (redirecionamento) que responde pela reserva também é CADERNETA_NA_RESERVA", () => {
  const r = classificar(
    { dominio: REDIRECIONA, esperado: "redirecionamento", para: null },
    sonda(REDIRECIONA, {
      pagina: { status: 308, caderneta: "reserva", titulo: null, refs: [] },
    }),
    CTX,
  );
  assert(
    r.achados.some((a) => a.classe === "CADERNETA_NA_RESERVA"),
    JSON.stringify(r.achados),
  );
});

Deno.test("T10 reserva NÃO conta como loja ativa: refDaLojaSondada null e o publicar-release a lista como 'não é loja legível'", () => {
  const s = sonda(LOJA.dominio, { pagina: paginaNaReserva() });
  assertEquals(refDaLojaSondada(s.ficha), null);
  const { lojas, problemas } = lojasDoInventario(
    { completo: true, vercel: { ok: true }, sondas: [s] },
    { enderecosEsperados: [] },
  );
  assertEquals(lojas, []);
  assert(
    problemas.some(
      (p) => p.includes(LOJA.dominio) && p.includes("caderneta reserva"),
    ),
    JSON.stringify(problemas),
  );
});

Deno.test("T10 problemasAntesDoPromote: CADERNETA_NA_RESERVA bloqueia mesmo escondida atrás de ENDERECO_ANTIGO", () => {
  const r = classificar(
    LOJA,
    sonda(LOJA.dominio, {
      pagina: paginaNaReserva(),
      versao: { codeSha: SHA_VELHO, codeVersion: "1.5.17" },
    }),
    CTX,
  );
  const p = problemasAntesDoPromote(
    {
      resultados: [
        { dominio: LOJA.dominio, ...r, versao: { codeSha: SHA_VELHO } },
      ],
    },
    SHA,
  );
  assertEquals(p.length, 1, JSON.stringify(p));
  assertStringIncludes(p[0], "CADERNETA_NA_RESERVA");
});

Deno.test("T10 conferirFrota: a Savy aberta pela reserva reprova a frota, não conta como sondada e o relatório diz como recuperar", async () => {
  const mundo = mundoBase();
  mundo["savycollection.vercel.app"].caderneta = "reserva";
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
    lojasObrigatorias: [
      { ref: REF.ikcous, nome: "IKCOUS" },
      { ref: REF.savy, nome: "Savy" },
    ],
  });
  assertEquals(r.ok, false, r.relatorio);
  const savy = r.resultados.find(
    (x) => x.dominio === "savycollection.vercel.app",
  );
  assertEquals(
    savy.classe,
    "CADERNETA_NA_RESERVA",
    JSON.stringify(savy.achados),
  );
  assertStringIncludes(r.relatorio, "**CADERNETA_NA_RESERVA**");
  assertStringIncludes(
    r.relatorio,
    "a loja Savy está cadastrada mas não foi sondada",
  );
  const ik = r.resultados.find(
    (x) => x.dominio === "ickous-marketplace.vercel.app",
  );
  assertEquals(ik.classe, "OK", JSON.stringify(ik.achados));
});

Deno.test("T10 conferirFrota: instâncias divergentes (uma hit, outra na reserva) da MESMA loja = CADERNETA_NA_RESERVA, não LOJA_TROCADA", async () => {
  const mundo = mundoBase();
  mundo["savycollection.vercel.app"].cadernetaAlterna = "reserva";
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
  });
  assertEquals(r.ok, false, r.relatorio);
  const savy = r.resultados.find(
    (x) => x.dominio === "savycollection.vercel.app",
  );
  assertEquals(
    savy.classe,
    "CADERNETA_NA_RESERVA",
    JSON.stringify(savy.achados),
  );
});

// ------------------------------------------------------------------ T10 (revisão Opus): a reserva NÃO tira o endereço da conferência ENTRE endereços
//
// Amostras hit + reserva ficam `estavel=false` (a caderneta está na chave da
// amostra). Se a conferência entre endereços (mesmo ref com outro título,
// canônico) só aceitasse ficha estável hit, o endereço sumiria dela e o
// LOJA_TROCADA que manda o rollback viraria só CADERNETA_NA_RESERVA.

const REF_X = "xqxqxqxqxqxqxqxqxqxq";
const TRIO = ["a.loja-x.example", "b.loja-x.example", "c.loja-x.example"];

function mundoDoTrio(c = {}) {
  const mundo = mundoBase();
  const base = mundo["savycollection.vercel.app"];
  mundo[TRIO[0]] = { ...base, ref: REF_X, titulo: "Loja A" };
  mundo[TRIO[1]] = { ...base, ref: REF_X, titulo: "Loja A" };
  mundo[TRIO[2]] = { ...base, ref: REF_X, titulo: "Loja ZZ", ...c };
  return mundo;
}
async function classeDoC(c) {
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundoDoTrio(c)),
    enderecosExtras: TRIO,
  });
  return r.resultados.find((x) => x.dominio === TRIO[2]);
}

Deno.test("T10b controle: só hit, c.com com o mesmo ref e outro título = LOJA_TROCADA", async () => {
  const c = await classeDoC({});
  assertEquals(c.classe, "LOJA_TROCADA", JSON.stringify(c.achados));
});

Deno.test("T10b (1) amostras misturadas hit + reserva em c.com com outro título continua LOJA_TROCADA", async () => {
  const c = await classeDoC({ cadernetaAlterna: "reserva" });
  assertEquals(c.classe, "LOJA_TROCADA", JSON.stringify(c.achados));
  assert(
    c.achados.some((a) => a.classe === "CADERNETA_NA_RESERVA"),
    JSON.stringify(c.achados),
  );
});

Deno.test("T10b (2) ficha toda na reserva com título divergente de outro endereço do mesmo ref = LOJA_TROCADA", async () => {
  const c = await classeDoC({ caderneta: "reserva" });
  assertEquals(c.classe, "LOJA_TROCADA", JSON.stringify(c.achados));
});

Deno.test("T10b (3) legítimo: tudo igual e a caderneta oscilando (ou toda na reserva) = só CADERNETA_NA_RESERVA", async () => {
  for (const extra of [
    { cadernetaAlterna: "reserva" },
    { caderneta: "reserva" },
  ]) {
    const c = await classeDoC({ titulo: "Loja A", ...extra });
    assertEquals(
      c.classe,
      "CADERNETA_NA_RESERVA",
      `${JSON.stringify(extra)} ${JSON.stringify(c.achados)}`,
    );
    assert(
      !c.achados.some((a) => a.classe === "LOJA_TROCADA"),
      JSON.stringify(c.achados),
    );
  }
});

Deno.test("T10b canônico: ficha na reserva também tem o publicUrl conferido; canônico servido pela reserva vale", async () => {
  const fora = await classeDoC({
    titulo: "Loja A",
    caderneta: "reserva",
    publicUrl: "https://nao-inventariado.example",
  });
  assert(
    fora.achados.some((a) => a.classe === "CANONICO_INVALIDO"),
    JSON.stringify(fora.achados),
  );
  const mundo = mundoDoTrio({ titulo: "Loja A" });
  mundo[TRIO[0]].publicUrl = `https://${TRIO[2]}`;
  mundo[TRIO[2]].caderneta = "reserva";
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
    enderecosExtras: TRIO,
  });
  const a = r.resultados.find((x) => x.dominio === TRIO[0]);
  assertEquals(a.classe, "OK", JSON.stringify(a.achados));
});

// ------------------------------------------------------------------ banco da loja fora do ar
// O porteiro conhece a loja (caderneta hit), mas o banco Supabase DELA não
// respondeu (projeto pausado ou incidente) e não há ficha guardada: ele responde
// 503 com `x-ikcous-porteiro: banco-indisponivel` e um HTML sem marca nem ref
// (src/hospedagem/porteiro.ts, respostaManutencao). Antes, isso virava
// LOJA_TROCADA + ESTADO_INESPERADO + CANONICO_INVALIDO, e o relatório nunca
// dizia que o problema era o banco. Agora é UMA classe própria, que só nasce do
// trio exato (503 + o marcador + caderneta hit), sem cabeçalho de estado de vida.

/** A página que `respostaManutencao("banco-indisponivel", "hit")` serve. */
const paginaBancoFora = (extra = {}) => ({
  status: 503,
  caderneta: "hit",
  porteiro: "banco-indisponivel",
  estado: null,
  refPorteiro: null,
  titulo: "Loja em manutenção",
  refs: [],
  publicUrl: null,
  ...extra,
});

Deno.test("banco fora: 503 + x-ikcous-porteiro banco-indisponivel + caderneta hit = BANCO_INDISPONIVEL, e SÓ ele (nem LOJA_TROCADA, nem ESTADO_INESPERADO, nem CANONICO_INVALIDO)", () => {
  const s = sonda(LOJA.dominio, { pagina: paginaBancoFora() });
  const ctx = montarContexto([s], { sha: SHA }).ctx;
  const r = classificar(LOJA, s, ctx);
  assertEquals(r.classe, "BANCO_INDISPONIVEL", JSON.stringify(r.achados));
  assertEquals(
    r.achados.map((a) => a.classe),
    ["BANCO_INDISPONIVEL"],
    JSON.stringify(r.achados),
  );
  assertStringIncludes(r.achados[0].motivo, "banco");
  assertStringIncludes(r.achados[0].motivo, "banco-indisponivel");
});

Deno.test("banco fora: sem o trio exato NÃO é BANCO_INDISPONIVEL (o 503 da Vercel, o 503 de outro motivo, a caderneta fora, o 500, o 200)", () => {
  const casos = {
    "503 da Vercel, sem o marcador": { porteiro: null },
    "503 sem-loja": { porteiro: "sem-loja" },
    "503 html-indisponivel": { porteiro: "html-indisponivel" },
    "marcador com outro texto": { porteiro: "Banco-Indisponivel" },
    "caderneta erro (a caderneta é que caiu)": { caderneta: "erro" },
    "caderneta ausente": { caderneta: "ausente" },
    "sem x-ikcous-caderneta": { caderneta: null },
    "status 500": { status: 500 },
    "status 502": { status: 502 },
    "status 200": { status: 200 },
    "com x-ikcous-estado": { estado: "adormecida" },
    "com x-ikcous-ref": { refPorteiro: "z".repeat(20) },
    "com ref Supabase no HTML": { refs: [REF.savy] },
  };
  for (const [nome, extra] of Object.entries(casos)) {
    const r = classificar(
      LOJA,
      sonda(LOJA.dominio, { pagina: paginaBancoFora(extra) }),
      CTX,
    );
    assert(
      !r.achados.some((a) => a.classe === "BANCO_INDISPONIVEL"),
      `${nome}: ${JSON.stringify(r.achados)}`,
    );
    assert(r.classe !== "OK", nome);
  }
});

Deno.test("banco fora: amostras que discordam (uma 503 banco-indisponivel, outra 200 com a loja) NUNCA viram BANCO_INDISPONIVEL", () => {
  const r = classificar(
    LOJA,
    sonda(LOJA.dominio, {
      amostras: [
        paginaBancoFora(),
        {
          status: 200,
          caderneta: "hit",
          porteiro: "ok",
          titulo: "Savy",
          refs: [REF.savy],
        },
        paginaBancoFora(),
      ],
    }),
    CTX,
  );
  assert(
    !r.achados.some((a) => a.classe === "BANCO_INDISPONIVEL"),
    JSON.stringify(r.achados),
  );
  assertEquals(r.classe, "LOJA_TROCADA");
});

Deno.test("banco fora: endereço declarado na política (manutenção/redirecionamento) não vira BANCO_INDISPONIVEL", () => {
  const r = classificar(
    { dominio: "x.example", esperado: "manutencao" },
    sonda("x.example", { pagina: paginaBancoFora() }),
    CTX,
  );
  assert(
    !r.achados.some((a) => a.classe === "BANCO_INDISPONIVEL"),
    JSON.stringify(r.achados),
  );
});

Deno.test("banco fora: versão velha no mesmo endereço continua aparecendo (ENDERECO_ANTIGO, mais grave)", () => {
  const r = classificar(
    LOJA,
    sonda(LOJA.dominio, {
      pagina: paginaBancoFora(),
      versao: { codeSha: SHA_VELHO },
    }),
    CTX,
  );
  assertEquals(r.classe, "ENDERECO_ANTIGO");
  assert(r.achados.some((a) => a.classe === "BANCO_INDISPONIVEL"));
});

Deno.test("banco fora: GRAVIDADE tem BANCO_INDISPONIVEL abaixo do isolamento, e o COMO_RECUPERAR manda restaurar o banco, nunca voltar a frota", () => {
  const i = (c) => GRAVIDADE.indexOf(c);
  assert(i("BANCO_INDISPONIVEL") > 0, "BANCO_INDISPONIVEL fora da GRAVIDADE");
  assert(i("BANCO_INDISPONIVEL") > i("LOJA_TROCADA"));
  assert(i("BANCO_INDISPONIVEL") > i("SUSPEITA_ISOLAMENTO"));
  assert(i("BANCO_INDISPONIVEL") < i("OK"));
  const texto = COMO_RECUPERAR.BANCO_INDISPONIVEL;
  assert(typeof texto === "string" && texto, "sem COMO_RECUPERAR");
  assertStringIncludes(texto, "Restore project");
  assertStringIncludes(texto, "acordar-projeto.mjs");
  assertStringIncludes(texto, "estado-da-loja.mjs --adormecer");
  assert(!texto.includes("vercel rollback"), texto);
});

Deno.test("banco fora: verificarCanonico não cobra publicUrl da página de banco fora do ar", () => {
  const s = sonda(LOJA.dominio, { pagina: paginaBancoFora() });
  assertEquals(verificarCanonico([s]).achados, {});
});

Deno.test("banco fora: problemasAntesDoPromote BLOQUEIA o endereço com BANCO_INDISPONIVEL (a loja não é pulada)", () => {
  const p = problemasAntesDoPromote(
    {
      resultados: [
        {
          dominio: LOJA.dominio,
          classe: "BANCO_INDISPONIVEL",
          achados: [
            { classe: "BANCO_INDISPONIVEL", motivo: "banco fora do ar" },
          ],
          versao: { codeSha: SHA_VELHO },
        },
      ],
    },
    SHA,
  );
  assertEquals(p.length, 1, JSON.stringify(p));
  assertStringIncludes(p[0], `${LOJA.dominio}: BANCO_INDISPONIVEL`);
});

Deno.test("banco fora: conferirFrota reprova, diz em português que o banco caiu e não chama a loja de 'não sondada' nem de LOJA_TROCADA", async () => {
  const mundo = mundoBase();
  mundo["savycollection.vercel.app"] = {
    ...mundo["savycollection.vercel.app"],
    tipo: "foraDoAr",
    status: 503,
    porteiro: "banco-indisponivel",
    estado: null,
    refPorteiro: null,
  };
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
    lojasObrigatorias: [
      { ref: REF.ikcous, nome: "IKCOUS" },
      { ref: REF.savy, nome: "Savy" },
    ],
  });
  assertEquals(r.ok, false, r.relatorio);
  const savy = r.resultados.find(
    (x) => x.dominio === "savycollection.vercel.app",
  );
  assertEquals(savy.classe, "BANCO_INDISPONIVEL", JSON.stringify(savy.achados));
  assertEquals(
    savy.achados.map((a) => a.classe),
    ["BANCO_INDISPONIVEL"],
  );
  assert(!r.relatorio.includes("LOJA_TROCADA"), r.relatorio);
  assert(!r.relatorio.includes("CANONICO_INVALIDO"), r.relatorio);
  assert(!r.relatorio.includes("não foi sondada"), r.relatorio);
  assert(!r.relatorio.includes("vercel rollback"), r.relatorio);
  assertStringIncludes(r.relatorio, "banco");
  assertStringIncludes(r.relatorio, "Savy");
  assertStringIncludes(r.relatorio, "Restore project");
  // A loja que não apareceu continua na cobertura estruturada (quem publica decide).
  assertEquals(
    r.cobertura.lojasNaoSondadas.map((l) => l.ref),
    [REF.savy],
  );
});

// ------------------------------------------------------------------ banco fora COM a caderneta na reserva
// Os dois incidentes juntos: a caderneta central caiu, o porteiro abriu a loja
// pela reserva (`caderneta = "reserva"` já está decidido ANTES de ler o banco
// da loja) e o banco dela também não respondeu. O porteiro serve o MESMO 503
// banco-indisponivel, só que com `x-ikcous-caderneta: reserva`. São as duas
// classes, nunca LOJA_TROCADA (que manda `vercel rollback`).

const paginaBancoForaNaReserva = () =>
  paginaBancoFora({ caderneta: "reserva" });

Deno.test("banco fora na reserva: 503 banco-indisponivel com caderneta reserva nas 3 amostras = CADERNETA_NA_RESERVA + BANCO_INDISPONIVEL, sem LOJA_TROCADA nem ESTADO_INESPERADO", () => {
  const s = sonda(LOJA.dominio, { pagina: paginaBancoForaNaReserva() });
  assertEquals(bancoIndisponivel(s), true);
  const r = classificar(LOJA, s, CTX);
  assertEquals(
    r.achados.map((a) => a.classe),
    ["CADERNETA_NA_RESERVA", "BANCO_INDISPONIVEL"],
    JSON.stringify(r.achados),
  );
  assertEquals(r.classe, "CADERNETA_NA_RESERVA");
  const banco = r.achados.find((a) => a.classe === "BANCO_INDISPONIVEL");
  assertStringIncludes(banco.motivo, "reserva");
});

Deno.test("banco fora na reserva: amostras que oscilam entre hit e reserva com o MESMO 503 são a mesma loja (as duas classes)", () => {
  for (const amostras of [
    [paginaBancoFora(), paginaBancoForaNaReserva(), paginaBancoFora()],
    [paginaBancoForaNaReserva(), paginaBancoFora(), paginaBancoFora()],
  ]) {
    const s = sonda(LOJA.dominio, { amostras });
    assertEquals(bancoIndisponivel(s), true, JSON.stringify(amostras));
    const r = classificar(LOJA, s, CTX);
    assertEquals(
      r.achados.map((a) => a.classe),
      ["CADERNETA_NA_RESERVA", "BANCO_INDISPONIVEL"],
      JSON.stringify(r.achados),
    );
  }
  // Oscilar com a caderneta `erro` (a caderneta é que caiu, sem reserva) não vale.
  const comErro = sonda(LOJA.dominio, {
    amostras: [
      paginaBancoFora(),
      paginaBancoFora({ caderneta: "erro" }),
      paginaBancoFora(),
    ],
  });
  assertEquals(bancoIndisponivel(comErro), false);
});

Deno.test("banco fora na reserva: os controles não mudam (hit + banco fora = só BANCO_INDISPONIVEL; reserva + 200 = só CADERNETA_NA_RESERVA)", () => {
  const hit = classificar(
    LOJA,
    sonda(LOJA.dominio, { pagina: paginaBancoFora() }),
    CTX,
  );
  assertEquals(
    hit.achados.map((a) => a.classe),
    ["BANCO_INDISPONIVEL"],
    JSON.stringify(hit.achados),
  );
  const reserva = classificar(
    LOJA,
    sonda(LOJA.dominio, { pagina: paginaNaReserva() }),
    CTX,
  );
  assertEquals(
    reserva.achados.map((a) => a.classe),
    ["CADERNETA_NA_RESERVA"],
    JSON.stringify(reserva.achados),
  );
});

Deno.test("banco fora na reserva: verificarCanonico não cobra publicUrl e o publicar-release a põe em bancoFora (bloqueio com o motivo do banco)", () => {
  const s = sonda(LOJA.dominio, { pagina: paginaBancoForaNaReserva() });
  assertEquals(verificarCanonico([s]).achados, {});
  const { lojas, bancoFora, problemas } = lojasDoInventario(
    { completo: true, vercel: { ok: true }, sondas: [s] },
    { enderecosEsperados: [] },
  );
  assertEquals(lojas, []);
  assertEquals(bancoFora, [LOJA.dominio]);
  assertEquals(problemas, []);
});

Deno.test("banco fora na reserva: conferirFrota reprova com as duas classes e o relatório não manda vercel rollback nem fala em LOJA_TROCADA", async () => {
  const mundo = mundoBase();
  mundo["savycollection.vercel.app"] = {
    ...mundo["savycollection.vercel.app"],
    tipo: "foraDoAr",
    status: 503,
    porteiro: "banco-indisponivel",
    estado: null,
    refPorteiro: null,
    cadernetaDaPagina: "reserva",
  };
  const r = await conferirFrota(POLITICA, {
    sha: SHA,
    fetchImpl: fetchFalso(mundo),
    lojasObrigatorias: [
      { ref: REF.ikcous, nome: "IKCOUS" },
      { ref: REF.savy, nome: "Savy" },
    ],
  });
  assertEquals(r.ok, false, r.relatorio);
  const savy = r.resultados.find(
    (x) => x.dominio === "savycollection.vercel.app",
  );
  assertEquals(
    savy.achados.map((a) => a.classe),
    ["CADERNETA_NA_RESERVA", "BANCO_INDISPONIVEL"],
    JSON.stringify(savy.achados),
  );
  assert(!r.relatorio.includes("vercel rollback"), r.relatorio);
  assert(!r.relatorio.includes("LOJA_TROCADA"), r.relatorio);
  assert(!r.relatorio.includes("CANONICO_INVALIDO"), r.relatorio);
  // A classe da linha é a reserva (mais grave); o banco aparece junto.
  assertStringIncludes(r.relatorio, "(também: BANCO_INDISPONIVEL)");
  assertStringIncludes(
    r.relatorio,
    "o banco está fora do ar em savycollection",
  );
  // "Como recuperar" traz o conserto de CADA classe do endereço.
  const comoRecuperar = r.relatorio.split("## Como recuperar")[1] ?? "";
  assertStringIncludes(
    comoRecuperar,
    "**CADERNETA_NA_RESERVA** (savycollection.vercel.app)",
  );
  assertStringIncludes(
    comoRecuperar,
    "**BANCO_INDISPONIVEL** (savycollection.vercel.app)",
  );
  assertStringIncludes(comoRecuperar, "Restore project");
});
