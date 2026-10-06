#!/usr/bin/env node
// Conferência CENTRAL da frota: torna VISÍVEL quando os endereços do site (um
// projeto Vercel só, várias lojas) deixam de servir a mesma versão, diz o TIPO
// da divergência e como recuperar.
//
// POR QUE EXISTE: em 06/10/2026 a release 1.5.18 ficou só num endereço e 9
// continuaram na 1.5.17 sem NADA avisar. Cada endereço serve /version.json
// (codeSha, identityRevision, codeVersion, source, promotable) e o "porteiro"
// (middleware.ts) responde o cabeçalho X-Ikcous-Caderneta: hit|miss e injeta a
// FICHA da loja (ref do Supabase, título) no HTML.
//
// SEM LISTA DE LOJAS: este script não sabe quem são os clientes. A política
// (scripts/frota/politica.json) só diz o que é regra da casa (quais endereços
// NÃO são loja, quais lojas não têm backend gerenciado, o que fica fora da
// release). O INVENTÁRIO é a lista de aliases do projeto Vercel (--vercel) — a
// lista oficial do que um `vercel promote` vai tocar — e a loja de cada
// endereço é o ref da ficha que o porteiro serve. Endereço novo na Vercel entra
// no inventário sozinho. Sem --vercel (CI) o inventário cai para a lista de
// reserva da política (+ --enderecos) e a saída diz "inventário: PARCIAL".
//
// SÓ LEITURA, SEM DEPENDÊNCIAS (Node 20, ESM). Nenhuma credencial: o único
// opcional que usa conta é o --vercel (CLI `vercel` já logado, local).
//
// USO:
//   node scripts/frota/conferir-frota.mjs --sha <40hex> [--json <arquivo>]
//        [--vercel] [--enderecos <arquivo>]
//
//   --sha        OBRIGATÓRIO: SHA da release esperada. Sem ele é erro de uso
//                (exit 2): frota inteira velha não pode dar verde.
//   --json       grava o resultado estruturado nesse arquivo.
//   --vercel     só local: usa o CLI `vercel` já logado (somente leitura, sem
//                shell). Do projeto lê SÓ targets.production.id e a lista de
//                aliases — o resto (configuração sensível) nunca é impresso.
//   --enderecos  arquivo com um domínio por linha (# comenta) somado ao
//                inventário.
//
// ISOLAMENTO (sem manifesto): 3 amostras de "/" por endereço (o porteiro tem
// cache em memória por instância) com ref e título IGUAIS nas 3; endereço com
// caderneta hit tem UM só ref no HTML; mesmo ref => mesmo título; refs
// diferentes com o MESMO título => SUSPEITA_ISOLAMENTO (falha).
//
// CANÔNICO: o publicUrl da ficha (dominio_publico do cadastro frota_lojas) de
// cada loja tem de ser um endereço do inventário que responde 200 hit e serve
// a mesma loja; o endereço de redirecionamento tem de dar 308 com Location
// https para o host declarado em politica.json ("para"), preservando caminho
// e query (sonda fixa: /produto/frota-conferencia?y=1), e esse host tem de ser
// o publicUrl de uma ficha servida (prova pelo cadastro, não só pela política).
//
// CONTRATO DO version.json (scripts/buildStore.mjs): codeVersion semver,
// codeSha 40 hex, identityRevision 64 hex, version === codeVersion-sha.<7>-
// identity.<64>, source "database", promotable true (booleano). Campo ausente
// ou malformado = BUILD_DIVERGENTE no PRÓPRIO endereço, antes de comparar com
// os outros.
//
// ENV (só para teste): FROTA_URL_MODELO (padrão "https://{dominio}"),
//                      FROTA_TIMEOUT_MS (padrão 15000).
//
// CLASSES (a mais grave vence): LOJA_TROCADA > SUSPEITA_ISOLAMENTO >
// INALCANCAVEL > ENDERECO_ANTIGO > CANONICO_INVALIDO > BUILD_DIVERGENTE >
// ESTADO_INESPERADO > OK.
// SAÍDA: 0 só se TUDO está OK; 1 em qualquer outro caso (inclui pedir --vercel
// e a consulta falhar); 2 = erro de uso. Inventário PARCIAL (sem --vercel) com
// tudo OK sai 0, mas o relatório avisa em voz alta que não é a frota inteira.

import { execFile } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

export const GRAVIDADE = [
  "LOJA_TROCADA",
  "SUSPEITA_ISOLAMENTO",
  "INALCANCAVEL",
  "ENDERECO_ANTIGO",
  "CANONICO_INVALIDO",
  "BUILD_DIVERGENTE",
  "ESTADO_INESPERADO",
  "OK",
];

const RE_SHA = /^[0-9a-f]{40}$/;
const RE_DOMINIO = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const AMOSTRAS = 3;

export const COMO_RECUPERAR = {
  LOJA_TROCADA:
    "PARAR a publicação e voltar com `vercel rollback <deployment anterior>` (um endereço serviu a ficha de OUTRA loja, ou a ficha mudou entre amostras: falha de isolamento).",
  SUSPEITA_ISOLAMENTO:
    "PARAR a publicação e abrir os endereços citados: refs diferentes mostrando o mesmo título indicam ficha trocada; se for legítimo, o título da loja precisa ser distinto.",
  ENDERECO_ANTIGO:
    "promover o deployment da release com `vercel promote <deployment>` (leva TODOS os domínios de produção de uma vez; não mover endereço por endereço).",
  CANONICO_INVALIDO:
    "NÃO publicar nem promover: o endereço canônico (publicUrl da ficha, cadastro frota_lojas) ou o redirecionamento leva para o lugar errado. Conferir dominio_publico da loja e o porteiro (middleware.ts); corrigir antes de seguir.",
  BUILD_DIVERGENTE:
    "publicar de novo do mesmo SHA, de worktree limpa (version.json fora do contrato do build: campo ausente ou malformado).",
  INALCANCAVEL: "repetir a conferência; persistindo, abrir o endereço.",
  ESTADO_INESPERADO:
    "abrir o endereço: ou ele mudou de papel (declarar em scripts/frota/politica.json, enderecosEsperados), ou é uma loja que perdeu a ficha (caderneta).",
};

export function lerPolitica(caminho = path.join(AQUI, "politica.json")) {
  return JSON.parse(readFileSync(caminho, "utf8"));
}

// ---------------------------------------------------------------- HTML

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function extrairTitulo(html) {
  if (typeof html !== "string") return null;
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  return m[1]
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (inteiro, nome) => ENTIDADES[nome.toLowerCase()] ?? inteiro)
    .replace(/\s+/g, " ")
    .trim();
}

export function extrairRefsSupabase(html) {
  if (typeof html !== "string") return [];
  const refs = new Set();
  for (const m of html.matchAll(/https:\/\/([a-z]{20})\.supabase\.co/g)) refs.add(m[1]);
  return [...refs].sort();
}

/**
 * publicUrl da ficha servida pelo porteiro (bloco <script id="ikcous-loja">,
 * campo identidade.publicUrl = dominio_publico do cadastro frota_lojas).
 * null se o bloco não existe, não é JSON ou não traz o campo como texto.
 */
export function extrairPublicUrl(html) {
  if (typeof html !== "string") return null;
  const m = /<script[^>]*\bid="ikcous-loja"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try {
    const url = JSON.parse(m[1])?.identidade?.publicUrl;
    return typeof url === "string" ? url : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- sondagem

const RE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RE_IDENTIDADE = /^[a-f0-9]{64}$/;

const shaValido = (sha) => typeof sha === "string" && RE_SHA.test(sha);
const sha7 = (sha) => (shaValido(sha) ? sha.slice(0, 7) : "(sha inválido)");

/**
 * O CONTRATO real do version.json (scripts/buildStore.mjs, função metadata):
 * codeVersion semver, codeSha 40 hex, identityRevision 64 hex,
 * version === `${codeVersion}-sha.${codeSha[0..7]}-identity.${identityRevision}`,
 * source === "database", promotable === true (booleano). Devolve a lista de
 * problemas (vazia = dentro do contrato). Vale POR ENDEREÇO, antes de qualquer
 * comparação entre endereços: campo ausente nunca vira "igual aos outros".
 */
export function problemasDoContrato(v) {
  const p = [];
  if (typeof v?.codeVersion !== "string" || !RE_SEMVER.test(v.codeVersion)) {
    p.push(`codeVersion ausente ou fora de semver (${JSON.stringify(v?.codeVersion)})`);
  }
  if (!shaValido(v?.codeSha)) p.push(`codeSha ausente ou fora de 40 hex (${JSON.stringify(v?.codeSha)})`);
  if (typeof v?.identityRevision !== "string" || !RE_IDENTIDADE.test(v.identityRevision)) {
    p.push(`identityRevision ausente ou fora de 64 hex (${JSON.stringify(v?.identityRevision)})`);
  }
  if (typeof v?.version !== "string") {
    p.push("version ausente");
  } else if (
    p.length === 0 &&
    v.version !== `${v.codeVersion}-sha.${v.codeSha.slice(0, 7)}-identity.${v.identityRevision}`
  ) {
    p.push("version não bate com codeVersion + codeSha + identityRevision");
  }
  if (v?.source !== "database") p.push(`source=${JSON.stringify(v?.source)}, esperado "database"`);
  if (v?.promotable !== true) p.push(`promotable=${JSON.stringify(v?.promotable)}, esperado true (booleano)`);
  return p;
}

/**
 * Lê o texto do version.json. Só "não é JSON / não é objeto" é erro de leitura
 * (INALCANCAVEL); um objeto fora do contrato volta com os valores crus, e
 * quem decide é `problemasDoContrato`.
 */
export function validarVersao(texto) {
  let json;
  try {
    json = JSON.parse(texto);
  } catch {
    return { erro: "version.json não é JSON" };
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return { erro: "version.json não é um objeto" };
  }
  return {
    versao: {
      version: json.version,
      codeVersion: json.codeVersion,
      codeSha: json.codeSha,
      identityRevision: json.identityRevision,
      source: json.source,
      promotable: json.promotable,
    },
  };
}

function urlDe(modelo, dominio, caminho) {
  const base = modelo.replaceAll("{dominio}", dominio).replace(/\/+$/, "");
  return `${base}${caminho}`;
}

function descreverErroDeRede(e) {
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "timeout";
  const causa = e?.cause?.code ?? e?.cause?.message;
  return `erro de rede${causa ? ` (${causa})` : ""}`;
}

const chaveDaAmostra = (p) =>
  JSON.stringify([p.status, p.caderneta, p.titulo, p.refs, p.publicUrl]);

// Caminho + query FIXOS da sonda de redirecionamento: o destino tem de preservar os dois.
export const CAMINHO_DA_SONDA_DE_REDIRECT = "/produto/frota-conferencia";

/**
 * Sonda UM endereço: 1x version.json e AMOSTRAS x "/" (em paralelo, para
 * cair em instâncias diferentes do porteiro). `ficha` resume a página:
 * { status, caderneta, titulo, refs, publicUrl, estavel } (das amostras que
 * responderam). Com `redirecionamento: true` faz também 1 GET em
 * CAMINHO_DA_SONDA_DE_REDIRECT?y=1&t=... e registra status + Location.
 */
export async function sondarEndereco(dominio, opcoes = {}) {
  const {
    modelo = "https://{dominio}",
    fetchImpl = fetch,
    agora = Date.now(),
    timeoutMs = 15000,
    amostras = AMOSTRAS,
    redirecionamento = false,
  } = opcoes;
  const sonda = {
    dominio,
    versao: null,
    erroVersao: null,
    ficha: null,
    errosPagina: [],
    amostras: [],
    redirecionamento: null,
  };
  const pedir = (caminho, t) =>
    fetchImpl(urlDe(modelo, dominio, `${caminho}?t=${t}`), {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  const versao = (async () => {
    try {
      const res = await pedir("/version.json", agora);
      if (res.status !== 200) {
        sonda.erroVersao = `version.json respondeu HTTP ${res.status}`;
        return;
      }
      const v = validarVersao(await res.text());
      if (v.erro) sonda.erroVersao = v.erro;
      else sonda.versao = v.versao;
    } catch (e) {
      sonda.erroVersao = `version.json: ${descreverErroDeRede(e)}`;
    }
  })();
  const paginas = Array.from({ length: amostras }, async (_, i) => {
    try {
      const res = await pedir("/", `${agora}-${i}`);
      const html = await res.text();
      return {
        status: res.status,
        caderneta: res.headers.get("x-ikcous-caderneta"),
        titulo: extrairTitulo(html),
        refs: extrairRefsSupabase(html),
        publicUrl: extrairPublicUrl(html),
      };
    } catch (e) {
      return { erro: `amostra ${i + 1} da página: ${descreverErroDeRede(e)}` };
    }
  });
  const redirect = (async () => {
    if (!redirecionamento) return;
    const pedido = `${CAMINHO_DA_SONDA_DE_REDIRECT}?y=1&t=${agora}`;
    try {
      const res = await fetchImpl(urlDe(modelo, dominio, pedido), {
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      await res.text();
      sonda.redirecionamento = { status: res.status, location: res.headers.get("location"), pedido };
    } catch (e) {
      sonda.errosPagina.push(`sonda de redirecionamento: ${descreverErroDeRede(e)}`);
    }
  })();
  const [, , ...resultados] = await Promise.all([versao, redirect, ...paginas]);
  sonda.amostras = resultados.filter((r) => !r.erro);
  sonda.errosPagina.push(...resultados.filter((r) => r.erro).map((r) => r.erro));
  if (sonda.amostras.length) {
    const primeira = sonda.amostras[0];
    sonda.ficha = {
      ...primeira,
      estavel: sonda.amostras.every((a) => chaveDaAmostra(a) === chaveDaAmostra(primeira)),
    };
  }
  return sonda;
}

// ---------------------------------------------------------------- referência e contexto

// Valor da maioria ESTRITA (> 50%); null se não há (empate ou nenhum).
export function maioriaEstrita(valores) {
  if (valores.length === 0) return null;
  const contagem = new Map();
  for (const v of valores) contagem.set(v, (contagem.get(v) ?? 0) + 1);
  for (const [v, n] of contagem) if (n * 2 > valores.length) return v;
  return null;
}

export function agruparPorSha(sondas) {
  const grupos = new Map();
  for (const s of sondas) {
    if (!s.versao || !shaValido(s.versao.codeSha)) continue;
    const g = grupos.get(s.versao.codeSha) ?? { sha: s.versao.codeSha, versoes: new Set(), dominios: [] };
    g.versoes.add(String(s.versao.codeVersion));
    g.dominios.push(s.dominio);
    grupos.set(s.versao.codeSha, g);
  }
  return [...grupos.values()]
    .map((g) => ({ sha: g.sha, codeVersion: [...g.versoes].join("/"), dominios: g.dominios }))
    .sort((a, b) => b.dominios.length - a.dominios.length || a.sha.localeCompare(b.sha));
}

const norm = (s) => String(s ?? "").trim().toLowerCase();

/**
 * Isolamento ENTRE endereços, só com o que o porteiro serviu: devolve
 * { [dominio]: [{classe, motivo}] }. `ignorar` = endereços que não são loja.
 *  - mesmo ref com títulos diferentes -> LOJA_TROCADA (quem destoa da maioria);
 *  - refs diferentes com o MESMO título -> SUSPEITA_ISOLAMENTO (todos os envolvidos).
 */
export function verificarIsolamentoCruzado(sondas, ignorar = new Set()) {
  const achados = {};
  const add = (dominio, classe, motivo) => {
    (achados[dominio] ??= []).push({ classe, motivo });
  };
  const fichas = sondas
    .filter((s) => !ignorar.has(s.dominio) && s.ficha?.estavel && s.ficha.caderneta === "hit" && s.ficha.refs.length === 1 && s.ficha.titulo)
    .map((s) => ({ dominio: s.dominio, ref: s.ficha.refs[0], titulo: norm(s.ficha.titulo), tituloOriginal: s.ficha.titulo }));

  const porRef = new Map();
  for (const f of fichas) porRef.set(f.ref, [...(porRef.get(f.ref) ?? []), f]);
  for (const [ref, lista] of porRef) {
    const titulos = new Set(lista.map((f) => f.titulo));
    if (titulos.size < 2) continue;
    const dominante = maioriaEstrita(lista.map((f) => f.titulo));
    for (const f of lista) {
      if (f.titulo !== dominante) {
        add(f.dominio, "LOJA_TROCADA", `ref ${ref} aparece com outro título ("${f.tituloOriginal}") que o de outros endereços da mesma loja`);
      }
    }
  }

  const porTitulo = new Map();
  for (const f of fichas) porTitulo.set(f.titulo, [...(porTitulo.get(f.titulo) ?? []), f]);
  for (const [, lista] of porTitulo) {
    const refs = [...new Set(lista.map((f) => f.ref))].sort();
    if (refs.length < 2) continue;
    for (const f of lista) {
      add(f.dominio, "SUSPEITA_ISOLAMENTO", `o título "${f.tituloOriginal}" aparece em refs Supabase diferentes (${refs.join(", ")})`);
    }
  }
  return achados;
}

const hostDe = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

/**
 * O endereço CANÔNICO de cada loja é o publicUrl da ficha (dominio_publico do
 * cadastro frota_lojas). Para cada loja com caderneta hit:
 *  - a ficha tem de trazer publicUrl https, sem caminho, query nem credencial;
 *  - o host dele tem de ser um endereço do inventário que responde 200 hit
 *    (senão o cliente cai num endereço que não serve a loja);
 *  - e esse endereço tem de servir a MESMA loja (mesmo ref Supabase).
 * Devolve { achados: { [dominio]: [{classe, motivo}] }, canonicos: Set<host> }
 * — `canonicos` são os hosts provados pelo cadastro, que o redirecionamento usa.
 */
export function verificarCanonico(sondas, ignorar = new Set()) {
  const achados = {};
  const add = (dominio, motivo) => {
    (achados[dominio] ??= []).push({ classe: "CANONICO_INVALIDO", motivo });
  };
  const porDominio = new Map(sondas.map((s) => [s.dominio, s]));
  const canonicos = new Set();
  for (const s of sondas) {
    const f = s.ficha;
    if (ignorar.has(s.dominio) || !f?.estavel || f.caderneta !== "hit") continue;
    if (!f.publicUrl) {
      add(s.dominio, "ficha sem publicUrl (cadastro sem dominio_publico)");
      continue;
    }
    let u;
    try {
      u = new URL(f.publicUrl);
    } catch {
      add(s.dominio, `publicUrl inválido na ficha (${f.publicUrl})`);
      continue;
    }
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || u.pathname !== "/") {
      add(s.dominio, `publicUrl fora do formato https://host (${f.publicUrl})`);
      continue;
    }
    const destino = porDominio.get(u.host);
    const df = destino?.ficha;
    if (!destino) {
      add(s.dominio, `publicUrl aponta para ${u.host}, que não é endereço do inventário`);
    } else if (!df || df.status !== 200 || df.caderneta !== "hit") {
      add(s.dominio, `publicUrl aponta para ${u.host}, que não responde 200 hit (HTTP ${df?.status ?? "-"}, caderneta ${df?.caderneta ?? "-"})`);
    } else if (df.refs.length !== 1 || f.refs.length !== 1 || df.refs[0] !== f.refs[0]) {
      add(s.dominio, `o canônico ${u.host} serve outra loja (ref ${df.refs.join("+") || "-"}, esperado ${f.refs.join("+") || "-"})`);
    } else {
      canonicos.add(u.host);
    }
  }
  return { achados, canonicos };
}

// Monta o contexto compartilhado (SHA esperado, identidade da maioria, mapa de deployments).
export function montarContexto(sondas, { sha, vercel = null, ignorarNoCruzamento = new Set() } = {}) {
  if (!RE_SHA.test(String(sha))) throw new Error("--sha precisa ter 40 caracteres hexadecimais");
  const grupos = agruparPorSha(sondas);
  // A referência do grupo sai SÓ de quem está dentro do contrato: campo ausente
  // jamais vira referência (undefined === undefined seria "tudo igual").
  const doGrupo = sondas.filter(
    (s) => s.versao && s.versao.codeSha === sha && problemasDoContrato(s.versao).length === 0,
  );
  const cruzado = verificarIsolamentoCruzado(sondas, ignorarNoCruzamento);
  const canonico = verificarCanonico(sondas, ignorarNoCruzamento);
  for (const [dominio, lista] of Object.entries(canonico.achados)) (cruzado[dominio] ??= []).push(...lista);
  const ctx = {
    shaEsperado: sha,
    identidadeRef: doGrupo.length === 1 ? doGrupo[0].versao.identityRevision : maioriaEstrita(doGrupo.map((s) => s.versao.identityRevision)),
    codeVersionRef: doGrupo.length === 1 ? doGrupo[0].versao.codeVersion : maioriaEstrita(doGrupo.map((s) => s.versao.codeVersion)),
    cruzado,
    canonicos: canonico.canonicos,
  };
  if (vercel?.ok) {
    const deployments = doGrupo.map((s) => vercel.porDominio[s.dominio]?.deploymentId ?? null).filter(Boolean);
    const esperado = maioriaEstrita(deployments);
    ctx.vercel = {
      porDominio: vercel.porDominio,
      deploymentEsperado: esperado ?? (deployments.length ? null : undefined),
      ambiguo: new Set(deployments).size > 1 && esperado === null,
    };
  }
  return { grupos, ctx };
}

// ---------------------------------------------------------------- classificação

/**
 * Classifica UM endereço. Devolve { classe, achados: [{classe, motivo}] } —
 * `classe` é a mais grave dos achados (precedência = ordem de GRAVIDADE).
 *
 * alvo : { dominio, esperado: "manutencao"|"redirecionamento"|null } (null = loja)
 * sonda: saída de sondarEndereco
 * ctx  : saída de montarContexto().ctx
 */
export function classificar(alvo, sonda, ctx) {
  const achados = [];
  const add = (classe, motivo) => achados.push({ classe, motivo });
  const { ficha, versao } = sonda;

  // 1) A ficha que o porteiro serve.
  if (ficha) {
    if (!ficha.estavel) {
      const resumo = [...new Set(sonda.amostras.map((a) => `${a.caderneta ?? "-"}/${a.titulo ?? "-"}/${a.refs.join("+") || "-"}`))].join(" | ");
      add("LOJA_TROCADA", `as ${sonda.amostras.length} amostras de "/" divergem (caderneta/título/ref): ${resumo}`);
    }
    if (!alvo.esperado) {
      if (ficha.caderneta !== "hit") {
        add("ESTADO_INESPERADO", `endereço sem ficha de loja (caderneta=${ficha.caderneta ?? "(ausente)"}, HTTP ${ficha.status}) e fora de enderecosEsperados da política`);
      } else {
        if (ficha.refs.length === 0) add("LOJA_TROCADA", "caderneta hit mas o HTML não traz ref Supabase");
        else if (ficha.refs.length > 1) add("LOJA_TROCADA", `caderneta hit com mais de um ref Supabase no HTML (${ficha.refs.join(", ")})`);
        if (!ficha.titulo) add("LOJA_TROCADA", "caderneta hit mas a página não tem <title>");
        if (ficha.status !== 200) add("ESTADO_INESPERADO", `loja respondeu HTTP ${ficha.status}, esperado 200`);
      }
    } else if (alvo.esperado === "manutencao") {
      if (ficha.status !== 503) add("ESTADO_INESPERADO", `esperado manutenção (HTTP 503), veio HTTP ${ficha.status}`);
      if (ficha.caderneta !== "miss") add("ESTADO_INESPERADO", `caderneta=${ficha.caderneta ?? "(ausente)"}, esperado miss`);
    } else if (alvo.esperado === "redirecionamento") {
      if (ficha.status !== 308) add("ESTADO_INESPERADO", `esperado redirecionamento (HTTP 308), veio HTTP ${ficha.status}`);
    } else {
      add("ESTADO_INESPERADO", `estado esperado desconhecido na política: ${alvo.esperado}`);
    }
  }
  for (const a of ctx.cruzado?.[alvo.dominio] ?? []) add(a.classe, a.motivo);

  // 1b) Redirecionamento: o destino tem de ser o canônico PROVADO PELO CADASTRO
  // (publicUrl de uma ficha servida), com https, o host declarado e o
  // caminho + query da sonda preservados.
  if (alvo.esperado === "redirecionamento") {
    const r = sonda.redirecionamento;
    const falhou = (sonda.errosPagina ?? []).some((e) => e.startsWith("sonda de redirecionamento"));
    if (!alvo.para) {
      add("ESTADO_INESPERADO", "política sem o destino (campo para) deste redirecionamento");
    } else if (!r) {
      if (!falhou) add("CANONICO_INVALIDO", "redirecionamento não foi sondado");
    } else if (r.status !== 308) {
      add("ESTADO_INESPERADO", `a sonda de redirecionamento respondeu HTTP ${r.status}, esperado 308`);
    } else if (!r.location) {
      add("CANONICO_INVALIDO", "308 sem cabeçalho Location");
    } else {
      let u = null;
      try {
        u = new URL(r.location);
      } catch {
        add("CANONICO_INVALIDO", `Location inválido (${r.location})`);
      }
      if (u) {
        if (u.protocol !== "https:") add("CANONICO_INVALIDO", `Location não é https (${r.location})`);
        if (u.host !== alvo.para) add("CANONICO_INVALIDO", `Location leva para ${u.host}, esperado ${alvo.para}`);
        if (`${u.pathname}${u.search}` !== r.pedido) {
          add("CANONICO_INVALIDO", `Location perde o caminho ou a query (${u.pathname}${u.search}, esperado ${r.pedido})`);
        }
      }
      if (!ctx.canonicos?.has(alvo.para)) {
        add("CANONICO_INVALIDO", `o destino ${alvo.para} não é o publicUrl de nenhuma ficha servida (cadastro frota_lojas)`);
      }
    }
  }

  // 2) Alcance.
  if (sonda.erroVersao) add("INALCANCAVEL", sonda.erroVersao);
  for (const e of sonda.errosPagina ?? []) add("INALCANCAVEL", e);

  // 3) Versão servida.
  const vercel = ctx.vercel;
  const deployment = vercel?.porDominio?.[alvo.dominio]?.deploymentId ?? null;
  if (versao) {
    // O contrato vale POR ENDEREÇO, antes de qualquer comparação com os outros.
    const problemas = problemasDoContrato(versao);
    for (const p of problemas) add("BUILD_DIVERGENTE", `version.json fora do contrato: ${p}`);
    const shaOk = shaValido(versao.codeSha) && versao.codeSha === ctx.shaEsperado;
    if (shaValido(versao.codeSha) && !shaOk) {
      add("ENDERECO_ANTIGO", `serve ${sha7(versao.codeSha)} (${String(versao.codeVersion)}), esperado ${ctx.shaEsperado.slice(0, 7)}`);
    }
    if (vercel && deployment && vercel.deploymentEsperado !== undefined) {
      if (shaOk && vercel.deploymentEsperado && deployment !== vercel.deploymentEsperado) {
        add("BUILD_DIVERGENTE", `mesmo SHA servido por outro deployment (${deployment}, esperado ${vercel.deploymentEsperado})`);
      } else if (shaOk && !vercel.deploymentEsperado && vercel.ambiguo) {
        add("BUILD_DIVERGENTE", `mesmo SHA servido por deployments diferentes, sem maioria (${deployment})`);
      } else if (!shaOk && vercel.deploymentEsperado && deployment !== vercel.deploymentEsperado) {
        add("ENDERECO_ANTIGO", `aponta para ${deployment}, não para o deployment esperado ${vercel.deploymentEsperado}`);
      }
    }
    if (shaOk && problemas.length === 0) {
      if (versao.identityRevision !== ctx.identidadeRef) {
        add("BUILD_DIVERGENTE", `identityRevision ${String(versao.identityRevision).slice(0, 8)} difere dos demais do mesmo SHA`);
      }
      if (versao.codeVersion !== ctx.codeVersionRef) {
        add("BUILD_DIVERGENTE", `codeVersion ${versao.codeVersion} difere dos demais do mesmo SHA`);
      }
    }
  }

  let classe = "OK";
  for (const a of achados) {
    if (GRAVIDADE.indexOf(a.classe) < GRAVIDADE.indexOf(classe)) classe = a.classe;
  }
  return { classe, achados };
}

// ---------------------------------------------------------------- Vercel (opcional)

export function lerProducaoOficial(projetoJson) {
  // SÓ este campo. O resto do projeto (env, links, configuração) nunca sai daqui.
  const id = projetoJson?.targets?.production?.id;
  return typeof id === "string" && /^dpl_[A-Za-z0-9]+$/.test(id) ? id : null;
}

/**
 * Como chamar o CLI da Vercel por execFile, SEM shell. No Windows o CLI do npm
 * é o shim `vercel.cmd`, e o Node recusa executar .cmd/.bat sem shell (EINVAL,
 * desde a correção do CVE-2024-27980) — então chama o próprio node com o
 * `vercel/dist/vc.js` instalado ao lado do shim. Os argumentos seguem
 * separados (nada vira texto de shell). Usado pela leitura (`api … -X GET`)
 * e pelo `promote` de scripts/frota/publicar-release.mjs.
 * Devolve { comando, prefixo }.
 */
export function resolverCliVercel({ env = process.env, plataforma = process.platform, existe = existsSync, node = process.execPath } = {}) {
  if (plataforma !== "win32") return { comando: "vercel", prefixo: [] };
  for (const dir of (env.PATH ?? env.Path ?? "").split(";")) {
    if (!dir) continue;
    const js = path.win32.join(dir, "node_modules", "vercel", "dist", "vc.js");
    if (existe(path.win32.join(dir, "vercel.cmd")) && existe(js)) return { comando: node, prefixo: [js] };
  }
  throw new Error("CLI vercel não encontrado no PATH (procurei vercel.cmd com node_modules/vercel/dist/vc.js ao lado)");
}

export function criarExecutorVercel(env = process.env) {
  const { comando, prefixo } = resolverCliVercel({ env });
  return (caminho) =>
    new Promise((resolve, reject) => {
      execFile(
        comando,
        [...prefixo, "api", caminho, "-X", "GET", "--raw"],
        { timeout: 60000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env },
        (erro, stdout, stderr) => {
          if (erro) {
            const linha = String(stderr || "").split("\n").map((l) => l.trim()).find(Boolean);
            reject(new Error(`vercel api falhou${linha ? `: ${linha.slice(0, 200)}` : ""}`));
            return;
          }
          const limpo = String(stdout)
            .split("\n")
            .filter((l) => !/^<claude-code-hint\b/.test(l))
            .join("\n");
          try {
            resolve(JSON.parse(limpo));
          } catch {
            // Mensagem fixa de propósito: o erro do JSON.parse cita um pedaço do texto.
            reject(new Error("vercel api respondeu algo que não é JSON"));
          }
        },
      );
    });
}

const RE_DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/;
const ehObjeto = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Valida UMA página da lista de aliases. CONTRATO (medido no ar em 06/10/2026:
 * 5 páginas, 454 aliases, todos com projectId do projeto e deploymentId dpl_*):
 *  - `aliases` é ARRAY e `pagination` é OBJETO (next ausente/null = fim);
 *  - todo item tem `alias` texto.
 * Devolve { erro } ou { itens, proximo }. Resposta {} nunca vira "lista vazia".
 */
function lerPaginaDeAliases(resposta) {
  if (!ehObjeto(resposta)) return { erro: "resposta não é um objeto" };
  if (!Array.isArray(resposta.aliases)) return { erro: "resposta sem `aliases` em array" };
  if (!ehObjeto(resposta.pagination)) return { erro: "resposta sem `pagination` em objeto" };
  const next = resposta.pagination.next;
  if (next !== undefined && next !== null && typeof next !== "number" && typeof next !== "string") {
    return { erro: "pagination.next fora do formato" };
  }
  if (resposta.aliases.some((a) => !ehObjeto(a) || typeof a.alias !== "string" || !a.alias)) {
    return { erro: "item de `aliases` sem `alias` em texto" };
  }
  return { itens: resposta.aliases, proximo: next ?? null };
}

/**
 * Lista TODOS os aliases do projeto (paginando por pagination.next), lê a
 * produção oficial e resolve o deployment dos `extras` que não vieram na lista.
 * `executor(caminho)` devolve o JSON já lido. Nunca lança: { ok:false, erro }.
 *
 * CONTRATO (quebra = ok:false, nunca "lista vazia" nem "completo"):
 *  - cada página: `aliases` array + `pagination` objeto;
 *  - o projeto tem domínios de produção: ZERO aliases é falha;
 *  - cada alias do inventário (fora os de preview) tem deploymentId dpl_* e
 *    projectId === politica.projetoVercel.id. A PROVA de que o alias é do
 *    projeto é o campo projectId que a própria listagem por projeto devolve em
 *    cada item (medido: 454 de 454); alias sem projectId também reprova;
 *  - produção oficial: targets.production.id existe e é dpl_*.
 * Falha de REDE numa página depois da primeira só deixa a lista INCOMPLETA
 * (ok:true, listaCompleta:false): o inventário sai PARCIAL e quem publica
 * tem de recusar.
 */
export async function consultarVercel(politica, extras, executor) {
  const { id, time } = politica.projetoVercel;
  const previews = (politica.aliasesDePreview ?? []).map((p) => new RegExp(p));
  const aliasesProjeto = [];
  const avisos = [];
  let proximo = null;
  let listaCompleta = true;
  for (let pagina = 0; pagina < 60; pagina++) {
    let resposta;
    try {
      resposta = await executor(
        `/v4/aliases?projectId=${encodeURIComponent(id)}&teamId=${encodeURIComponent(time)}&limit=100${proximo ? `&until=${encodeURIComponent(proximo)}` : ""}`,
      );
    } catch (e) {
      if (pagina === 0) return { ok: false, erro: `aliases do projeto não listados: ${e.message}` };
      listaCompleta = false;
      avisos.push(`página ${pagina + 1} dos aliases falhou: ${e.message}`);
      break;
    }
    const lida = lerPaginaDeAliases(resposta);
    if (lida.erro) return { ok: false, erro: `página ${pagina + 1} da lista de aliases fora do contrato: ${lida.erro}` };
    for (const a of lida.itens) {
      aliasesProjeto.push({
        alias: a.alias,
        deploymentId: typeof a.deploymentId === "string" ? a.deploymentId : null,
        projectId: typeof a.projectId === "string" ? a.projectId : null,
      });
    }
    proximo = lida.proximo;
    if (!proximo) break;
    if (pagina === 59) listaCompleta = false;
  }
  if (aliasesProjeto.length === 0) {
    return { ok: false, erro: "o projeto veio com ZERO aliases (tem domínios de produção: lista vazia é falha, não inventário)" };
  }
  const invalidos = aliasesProjeto
    .filter((a) => !previews.some((re) => re.test(a.alias)))
    .filter((a) => !RE_DEPLOYMENT.test(String(a.deploymentId)) || a.projectId !== id)
    .map((a) => `${a.alias} (${!RE_DEPLOYMENT.test(String(a.deploymentId)) ? "sem deploymentId dpl_*" : `projectId ${a.projectId ?? "ausente"}`})`);
  if (invalidos.length) {
    return { ok: false, erro: `alias fora do contrato (sem deploymentId ou de outro projeto): ${invalidos.slice(0, 3).join(", ")}${invalidos.length > 3 ? ` e mais ${invalidos.length - 3}` : ""}` };
  }
  if (!listaCompleta) avisos.push("lista de aliases do projeto INCOMPLETA: endereço novo pode estar fora do inventário");

  const porDominio = {};
  for (const a of aliasesProjeto) porDominio[a.alias] = { deploymentId: a.deploymentId };

  const faltando = [...new Set(extras)].filter((d) => !(d in porDominio));
  const fila = [...faltando];
  const trabalhador = async () => {
    while (fila.length) {
      const dominio = fila.shift();
      if (!RE_DOMINIO.test(dominio)) continue;
      try {
        const a = await executor(`/v4/aliases/${encodeURIComponent(dominio)}?teamId=${encodeURIComponent(time)}`);
        if (ehObjeto(a) && a.projectId === id && RE_DEPLOYMENT.test(String(a.deploymentId))) {
          porDominio[dominio] = { deploymentId: a.deploymentId };
        } else {
          porDominio[dominio] = { deploymentId: null };
          avisos.push(`${dominio} não é alias deste projeto (ou veio sem deploymentId): deployment não mapeado`);
        }
      } catch (e) {
        porDominio[dominio] = { deploymentId: null };
        avisos.push(`${dominio} não é alias do projeto ou não foi lido: ${e.message}`);
      }
    }
  };
  await Promise.all([trabalhador(), trabalhador(), trabalhador()]);

  let producaoOficial;
  try {
    producaoOficial = lerProducaoOficial(
      await executor(`/v9/projects/${encodeURIComponent(id)}?teamId=${encodeURIComponent(time)}`),
    );
  } catch (e) {
    return { ok: false, erro: `produção oficial não lida: ${e.message}` };
  }
  if (!producaoOficial) {
    return { ok: false, erro: "o projeto veio sem targets.production.id no formato dpl_* (produção oficial desconhecida)" };
  }
  return { ok: true, porDominio, producaoOficial, aliasesProjeto, listaCompleta, avisos };
}

// ---------------------------------------------------------------- inventário

export function lerEnderecosDoArquivo(texto) {
  const dominios = [];
  for (const bruta of String(texto).split(/\r?\n/)) {
    const linha = bruta.replace(/#.*$/, "").trim().toLowerCase();
    if (!linha) continue;
    if (!RE_DOMINIO.test(linha)) throw new Error(`endereço inválido no arquivo --enderecos: ${linha}`);
    dominios.push(linha);
  }
  return dominios;
}

async function emLotes(itens, concorrencia, fn) {
  const resultados = new Array(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      resultados[i] = await fn(itens[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concorrencia, itens.length) }, trabalhador));
  return resultados;
}

/**
 * Inventaria a frota: descobre os endereços e sonda cada um (ficha + version.json).
 * Reutilizável por quem for orquestrar a publicação (todo I/O é injetável:
 * fetchImpl, executorVercel). Com `pedirVercel`, a fonte é a lista de aliases do
 * projeto (sem os de preview); sem ele, a lista de reserva da política e o
 * inventário sai PARCIAL. Nunca lança por falha do Vercel: devolve vercel.ok=false.
 */
export async function inventariar(politica, opcoes = {}) {
  const {
    pedirVercel = false,
    enderecosExtras = [],
    executorVercel = null,
    modelo = "https://{dominio}",
    timeoutMs = 15000,
    fetchImpl = fetch,
    agora = Date.now(),
    concorrencia = 6,
  } = opcoes;
  const esperados = politica.enderecosEsperados.map((e) => e.dominio);
  const obrigatorios = [...esperados, ...enderecosExtras];

  let vercel = null;
  if (pedirVercel) {
    try {
      vercel = await consultarVercel(politica, obrigatorios, executorVercel ?? criarExecutorVercel());
    } catch (e) {
      vercel = { ok: false, erro: e.message };
    }
  }

  const previews = (politica.aliasesDePreview ?? []).map((p) => new RegExp(p));
  let candidatos;
  let origem;
  let completo;
  let motivoParcial = null;
  if (vercel?.ok) {
    origem = "vercel";
    candidatos = [
      ...vercel.aliasesProjeto.map((a) => a.alias).filter((a) => !previews.some((re) => re.test(a))),
      ...obrigatorios,
    ];
    completo = vercel.listaCompleta;
    if (!completo) motivoParcial = "a lista de aliases da Vercel veio incompleta";
  } else {
    origem = "reserva";
    candidatos = [...obrigatorios, ...(politica.enderecosDeReserva ?? [])];
    completo = false;
    motivoParcial = pedirVercel ? `--vercel falhou: ${vercel?.erro}` : "sem --vercel";
  }
  const dominios = [...new Set(candidatos.filter((d) => RE_DOMINIO.test(d)))].sort();
  const redirecionam = new Set(politica.enderecosEsperados.filter((e) => e.estado === "redirecionamento").map((e) => e.dominio));
  const sondas = await emLotes(dominios, concorrencia, (d) =>
    sondarEndereco(d, { modelo, timeoutMs, fetchImpl, agora, redirecionamento: redirecionam.has(d) }),
  );
  return { origem, completo, motivoParcial, dominios, vercel, sondas };
}

// ---------------------------------------------------------------- relatório

const celula = (s) => String(s ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");

export function montarRelatorio({ resultados, sha, grupos, inventario, vercel, vercelPedido, politica }) {
  const linhas = [];
  const ok = resultados.filter((r) => r.classe === "OK").length;
  linhas.push("# Conferência da frota", "");
  linhas.push(`Release esperada: \`${sha}\` (informada com --sha).`, "");
  if (inventario.completo) {
    linhas.push("inventário: COMPLETO (todos os aliases do projeto Vercel, menos os de preview)", "");
  } else {
    linhas.push(`inventário: PARCIAL (${inventario.motivoParcial}) — NÃO é a frota inteira: endereço fora da lista de reserva não foi conferido.`, "");
  }
  linhas.push(`**Resultado: ${ok} de ${resultados.length} endereços OK.**`, "");
  linhas.push("## Grupos por versão servida", "");
  if (grupos.length === 0) linhas.push("- (nenhum endereço respondeu version.json)");
  for (const g of grupos) {
    const marca = g.sha === sha ? " <- release esperada" : "";
    linhas.push(`- \`${g.sha.slice(0, 7)}\` (${g.codeVersion}): ${g.dominios.length} endereço(s)${marca}: ${g.dominios.join(", ")}`);
  }
  linhas.push("", "## Endereços", "");
  linhas.push("| Endereço | Loja (ref da ficha) | Classe | Serve | HTTP / caderneta | Deployment | Detalhe |");
  linhas.push("|---|---|---|---|---|---|---|");
  const semBackend = new Map((politica?.lojasSemBackendGerenciado ?? []).map((l) => [l.ref, l.nome]));
  for (const r of resultados) {
    const outras = [...new Set(r.achados.map((a) => a.classe))].filter((c) => c !== r.classe);
    const detalhe = [
      ...r.achados.filter((a) => a.classe === r.classe).map((a) => a.motivo),
      ...(outras.length ? [`(também: ${outras.join(", ")})`] : []),
    ].join("; ");
    const serve = r.versao ? `${String(r.versao.codeVersion)} (${sha7(r.versao.codeSha)})` : "-";
    const http = r.ficha ? `${r.ficha.status} / ${r.ficha.caderneta ?? "-"}` : "-";
    const dep = vercel?.ok ? (vercel.porDominio[r.dominio]?.deploymentId ?? "-") : "-";
    let loja = "-";
    if (r.esperado) loja = `(sem loja: ${r.esperado})`;
    else if (r.ficha?.refs.length) loja = r.ficha.refs.map((ref) => (semBackend.has(ref) ? `${semBackend.get(ref)} [${ref}]` : ref)).join(" + ");
    linhas.push(`| ${celula(r.dominio)} | ${celula(loja)} | ${r.classe} | ${celula(serve)} | ${celula(http)} | ${celula(dep)} | ${celula(detalhe)} |`);
  }
  linhas.push("", "## Endereço -> deployment", "");
  if (!vercelPedido) {
    linhas.push("endereço→deployment: NÃO CONFERIDO (sem --vercel)");
  } else if (!vercel?.ok) {
    linhas.push(`endereço→deployment: NÃO CONFERIDO (--vercel falhou: ${vercel?.erro ?? "sem detalhe"})`);
  } else {
    linhas.push("endereço→deployment: conferido pelo CLI vercel (somente leitura).");
    if (vercel.deploymentEsperado) {
      const eOficial = vercel.producaoOficial && vercel.deploymentEsperado === vercel.producaoOficial;
      linhas.push(`- Deployment da release: \`${vercel.deploymentEsperado}\` — ${eOficial ? "É" : "NÃO É"} a produção oficial do projeto (\`${vercel.producaoOficial ?? "não lida"}\`).`);
    } else if (vercel.deploymentEsperado === null) {
      linhas.push("- Deployment da release: INDEFINIDO (endereços do SHA esperado estão em deployments diferentes, sem maioria).");
    } else {
      linhas.push(`- Deployment da release: nenhum endereço serve o SHA esperado. Produção oficial do projeto: \`${vercel.producaoOficial ?? "não lida"}\`.`);
    }
  }
  for (const aviso of vercel?.avisos ?? []) linhas.push(`- AVISO: ${aviso}`);

  const presentes = GRAVIDADE.filter((c) => c !== "OK" && resultados.some((r) => r.classe === c));
  if (presentes.length) {
    linhas.push("", "## Como recuperar", "");
    for (const c of presentes) {
      linhas.push(`- **${c}** (${resultados.filter((r) => r.classe === c).map((r) => r.dominio).join(", ")}): ${COMO_RECUPERAR[c]}`);
    }
  }
  const fora = politica?.migrationsForaDaRelease ?? [];
  if (fora.length) {
    linhas.push("", "## Política (para quem publica)", "");
    for (const m of fora) linhas.push(`- Migration ${m.versao} fica FORA da release: ${m.motivo} (conferência: ${m.conferencia}).`);
    if (semBackend.size) linhas.push(`- Lojas sem backend gerenciado: ${[...semBackend.values()].join(", ")} — ${politica.motivoLojasSemBackendGerenciado ?? ""}`);
  }
  linhas.push("");
  return linhas.join("\n");
}

// ---------------------------------------------------------------- orquestração

export async function conferirFrota(politica, opcoes = {}) {
  const { sha, pedirVercel = false, inventarioPronto = null } = opcoes;
  if (!RE_SHA.test(String(sha))) throw new Error("--sha precisa ter 40 caracteres hexadecimais");
  const inventario = inventarioPronto ?? (await inventariar(politica, { ...opcoes, pedirVercel }));
  const declarados = new Map(politica.enderecosEsperados.map((e) => [e.dominio, e]));
  const esperados = new Map([...declarados].map(([d, e]) => [d, e.estado]));
  const { grupos, ctx } = montarContexto(inventario.sondas, {
    sha,
    vercel: inventario.vercel,
    ignorarNoCruzamento: new Set(esperados.keys()),
  });
  const resultados = inventario.sondas.map((sonda) => {
    const esperado = esperados.get(sonda.dominio) ?? null;
    const { classe, achados } = classificar(
      { dominio: sonda.dominio, esperado, para: declarados.get(sonda.dominio)?.para ?? null },
      sonda,
      ctx,
    );
    return {
      dominio: sonda.dominio,
      esperado,
      classe,
      achados,
      versao: sonda.versao,
      ficha: sonda.ficha,
      deploymentId: inventario.vercel?.ok ? (inventario.vercel.porDominio[sonda.dominio]?.deploymentId ?? null) : null,
    };
  });
  const vercelInfo = inventario.vercel?.ok
    ? { ...inventario.vercel, deploymentEsperado: ctx.vercel?.deploymentEsperado }
    : inventario.vercel;
  const ok =
    resultados.every((r) => r.classe === "OK") && (!pedirVercel || (inventario.vercel?.ok === true && inventario.completo));
  const relatorio = montarRelatorio({
    resultados,
    sha,
    grupos,
    inventario,
    vercel: vercelInfo,
    vercelPedido: pedirVercel,
    politica,
  });
  return {
    ok,
    sha,
    inventario: { origem: inventario.origem, completo: inventario.completo, motivoParcial: inventario.motivoParcial, dominios: inventario.dominios },
    grupos,
    resultados,
    vercel: vercelInfo,
    relatorio,
  };
}

function lerArgumentos(argv) {
  const args = { sha: null, json: null, vercel: false, enderecos: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vercel") args.vercel = true;
    else if (a === "--sha" || a === "--json" || a === "--enderecos") {
      const valor = argv[++i];
      if (!valor || valor.startsWith("--")) throw new Error(`${a} exige um valor`);
      args[a.slice(2)] = valor;
    } else throw new Error(`argumento desconhecido: ${a}`);
  }
  if (args.sha === null) throw new Error("--sha é obrigatório (sem a release esperada, frota inteira velha daria verde)");
  if (!/^[0-9a-fA-F]{40}$/.test(args.sha)) throw new Error("--sha precisa ter 40 caracteres hexadecimais");
  args.sha = args.sha.toLowerCase();
  return args;
}

const USO = "Uso: node scripts/frota/conferir-frota.mjs --sha <40hex> [--json <arquivo>] [--vercel] [--enderecos <arquivo>]";

// `deps` ({ fetchImpl, executorVercel }) existe só para teste: injeta o I/O.
export async function main(argv = process.argv.slice(2), env = process.env, deps = {}) {
  let args;
  let extras = [];
  try {
    args = lerArgumentos(argv);
    if (args.enderecos) extras = lerEnderecosDoArquivo(readFileSync(args.enderecos, "utf8"));
  } catch (e) {
    console.error(`${e.message}\n${USO}`);
    return 2;
  }
  const politica = lerPolitica();
  const resultado = await conferirFrota(politica, {
    sha: args.sha,
    pedirVercel: args.vercel,
    enderecosExtras: extras,
    modelo: env.FROTA_URL_MODELO || "https://{dominio}",
    timeoutMs: Number(env.FROTA_TIMEOUT_MS) > 0 ? Number(env.FROTA_TIMEOUT_MS) : 15000,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.executorVercel ? { executorVercel: deps.executorVercel } : {}),
  });
  console.log(resultado.relatorio);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${resultado.relatorio}\n`);
  if (args.json) {
    const { relatorio, ...estruturado } = resultado;
    writeFileSync(args.json, `${JSON.stringify({ geradoEm: new Date().toISOString(), ...estruturado }, null, 2)}\n`);
  }
  return resultado.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(
    (codigo) => {
      process.exitCode = codigo;
    },
    (e) => {
      console.error(`erro inesperado: ${e.message}`);
      process.exitCode = 2;
    },
  );
}
