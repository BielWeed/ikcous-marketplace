#!/usr/bin/env node
/* eslint-disable security/detect-object-injection -- as chaves vêm da política versionada (politica.json), do inventário que este script monta e de mapas fechados; nenhuma vem de quem chama. */
/* eslint-disable security/detect-non-literal-fs-filename -- lê a política ao lado do script e os arquivos que o dono passa por --enderecos/--json na linha de comando; não há entrada remota. */
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
// diferentes com o MESMO título => SUSPEITA_ISOLAMENTO (falha), a não ser que o
// BANCO de cada ref confirme o nome: o título que o porteiro serve é montado de
// v_store_config (store_name, store_city, store_state) do banco da loja, então
// a conferência lê essas 3 colunas do banco de cada ref do grupo (1 GET anônimo
// por ref, com a chave PUBLICÁVEL que a própria ficha serve a todo visitante;
// nenhum segredo) e, se CADA endereço serve exatamente o título do próprio
// banco, são lojistas diferentes com o mesmo nome: vira só AVISO. Leitura que
// falha, nome diferente (ex.: título assado do build, ou a identidade de uma
// loja servida com o banco de outra) = SUSPEITA_ISOLAMENTO, como sempre foi.
// (O publicUrl da ficha NÃO serve de âncora aqui: o porteiro o monta com o
// próprio host atendido, então ele sempre "confirma" o endereço sondado.)
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
// INALCANCAVEL > CADERNETA_NA_RESERVA > ENDERECO_ANTIGO > CANONICO_INVALIDO >
// BUILD_DIVERGENTE > ESTADO_INESPERADO > ENCERRADA > ADORMECIDA > OK.
// SAÍDA: 0 só se TUDO está OK (ou fora do ar por decisão: ADORMECIDA/ENCERRADA);
// 1 em qualquer outro caso (inclui pedir --vercel e a consulta falhar); 2 = erro
// de uso. Inventário PARCIAL (sem --vercel) com tudo OK sai 0, mas o relatório
// avisa em voz alta que não é a frota inteira.
//
// LOJA FORA DO AR POR DECISÃO (L8, estado de vida da loja em frota_lojas): o
// porteiro responde "/" com uma página própria — adormecida = HTTP 503 e
// encerrada = HTTP 410, com x-ikcous-porteiro e x-ikcous-estado iguais ao estado
// e x-ikcous-ref = ref Supabase da loja (20 letras minúsculas). SÓ essa
// combinação, igual nas 3 amostras, vira ADORMECIDA/ENCERRADA: o portão não
// exige dela a página de loja, mas o version.json (fora do porteiro) continua
// conferido. Qualquer outra combinação com esses cabeçalhos é ESTADO_INESPERADO,
// e loja de politica.json lojasQueNuncaDormem fora do ar também.
// x-ikcous-caderneta-versao: 1 (porteiro na caderneta antiga, que não conhece o
// estado) vira AVISO no relatório.
//
// CADERNETA NA RESERVA (PLANO-RESERVA-DA-CADERNETA-26-11.md, T10): amostra de
// "/" com x-ikcous-caderneta: reserva = a caderneta central falhou e o porteiro
// abriu a loja pela reserva (Global Config). A loja está no ar, mas NÃO conta
// como loja ativa (`refDaLojaSondada` só aceita hit): CADERNETA_NA_RESERVA
// bloqueia antes do promote e reprova depois. Amostras que diferem SÓ na
// caderneta (hit numa instância, reserva noutra: caches diferentes da MESMA
// loja) não são LOJA_TROCADA; ref, título, HTTP ou publicUrl diferentes, sim.

import { execFile } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

export const GRAVIDADE = [
  "LOJA_TROCADA",
  "SUSPEITA_ISOLAMENTO",
  "INALCANCAVEL",
  "CADERNETA_NA_RESERVA",
  "ENDERECO_ANTIGO",
  "CANONICO_INVALIDO",
  "BUILD_DIVERGENTE",
  "ESTADO_INESPERADO",
  "ENCERRADA",
  "ADORMECIDA",
  "OK",
];

/** Estado de vida (x-ikcous-estado) -> classe; só estes dois são "fora do ar". */
const CLASSE_FORA_DO_AR = Object.freeze({
  adormecida: "ADORMECIDA",
  encerrada: "ENCERRADA",
});
/** Classes que não reprovam a frota: a loja está no ar, ou fora por decisão. */
export const CLASSES_SEM_FALHA = Object.freeze(
  new Set(["OK", ...Object.values(CLASSE_FORA_DO_AR)]),
);
// O HTTP que o porteiro usa para cada estado fora do ar (contrato do L8).
const STATUS_FORA_DO_AR = Object.freeze({ adormecida: 503, encerrada: 410 });
const RE_REF_SUPABASE = /^[a-z]{20}$/;

const RE_SHA = /^[0-9a-f]{40}$/;
const RE_DOMINIO = {
  test: (d) =>
    /^[a-z0-9.-]+$/.test(String(d)) &&
    /^[a-z0-9]/.test(String(d)) &&
    /[a-z0-9]$/.test(String(d)),
};
const AMOSTRAS = 3;

/**
 * Cabeçalhos que o NAVEGADOR manda na primeira abertura de uma página. Com eles
 * o middleware roda no caminho do navegador (o que um pedido "pelado" do script
 * não faz) e devolve `x-ikcous-porteiro`. ATENÇÃO: isto NÃO prova o cartaz
 * pré-impresso. As sondas pedem `/?t=<carimbo>` e `t` não é parâmetro de
 * campanha, então `pedidoPodeTerCartaz` dá `false` e a leitura do banner nem
 * roda (medido em 31/10/2026: `/?t=123` sem cartaz; `/` e `/?utm_source=x`
 * com). Para provar o cartaz seria preciso mandar o carimbo num parâmetro
 * aceito e aceitar a resposta sem `x-ikcous-cartaz`, porque banner com texto,
 * botão ou modelo pronto fica legitimamente sem cartaz. Fica de fora o
 * service worker (`dest=empty`).
 */
export const CABECALHOS_DE_PRIMEIRA_ABERTURA = Object.freeze({
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
});

export const COMO_RECUPERAR = {
  LOJA_TROCADA:
    "PARAR a publicação e voltar com `vercel rollback <deployment anterior>` (um endereço serviu a ficha de OUTRA loja, ou a ficha mudou entre amostras: falha de isolamento).",
  SUSPEITA_ISOLAMENTO:
    "PARAR a publicação e abrir os endereços citados: refs diferentes mostrando o mesmo título, com algum endereço cujo título não é o nome gravado no banco do próprio ref (v_store_config), indicam ficha trocada ou título assado do build. Lojas diferentes com o mesmo nome só passam quando o banco de CADA ref confirma o título servido (aí vira aviso).",
  ENDERECO_ANTIGO:
    "promover o deployment da release com `vercel promote <deployment>` (leva TODOS os domínios de produção de uma vez; não mover endereço por endereço).",
  CANONICO_INVALIDO:
    "NÃO publicar nem promover: o endereço canônico (publicUrl da ficha, cadastro frota_lojas) ou o redirecionamento leva para o lugar errado. Conferir dominio_publico da loja e o porteiro (middleware.ts); corrigir antes de seguir.",
  BUILD_DIVERGENTE:
    "publicar de novo do mesmo SHA, de worktree limpa (version.json fora do contrato do build: campo ausente ou malformado).",
  INALCANCAVEL: "repetir a conferência; persistindo, abrir o endereço.",
  CADERNETA_NA_RESERVA:
    "NÃO promover: a caderneta central (frota_lojas no banco da caderneta) falhou e o porteiro está abrindo a loja pela reserva da caderneta (x-ikcous-caderneta: reserva). Consertar a caderneta (IKCOUS_FROTA_URL/chave da caderneta, banco no ar) e repetir a conferência até o endereço voltar a responder hit.",
  ESTADO_INESPERADO:
    "abrir o endereço: ou ele mudou de papel (declarar em scripts/frota/politica.json, enderecosEsperados), ou é uma loja que perdeu a ficha (caderneta). Se a resposta traz x-ikcous-porteiro/x-ikcous-estado de loja fora do ar, o porteiro saiu do contrato (503 adormecida / 410 encerrada, estado igual, x-ikcous-ref de 20 letras); se é uma loja de lojasQueNuncaDormem, acordá-la no cadastro (frota_lojas.estado) antes de publicar.",
  ENCERRADA:
    "nada a fazer nesta publicação: a loja foi encerrada por decisão (frota_lojas.estado = encerrada) e não recebe a release. Reabrir é decisão do dono, pelo cadastro, depois de conferir a prontidão do backend dela.",
  ADORMECIDA:
    "nada a fazer nesta publicação: a loja está adormecida por decisão (frota_lojas.estado = adormecida) e não recebe a release. Ao acordar (cadastro, só depois da prontidão do backend dela) ela recebe tudo o que saiu enquanto dormia.",
};

export function lerPolitica(caminho = path.join(AQUI, "politica.json")) {
  return JSON.parse(readFileSync(caminho, "utf8"));
}

// ---------------------------------------------------------------- HTML

const ENTIDADES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function extrairTitulo(html) {
  if (typeof html !== "string") return null;
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  return m[1]
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(Number.parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(
      /&([a-z]+);/gi,
      (inteiro, nome) => ENTIDADES[nome.toLowerCase()] ?? inteiro,
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function extrairRefsSupabase(html) {
  if (typeof html !== "string") return [];
  const refs = new Set();
  for (const m of html.matchAll(/https:\/\/([a-z]{20})\.supabase\.co/g))
    refs.add(m[1]);
  return [...refs].sort();
}

/**
 * publicUrl da ficha servida pelo porteiro (bloco <script id="ikcous-loja">,
 * campo identidade.publicUrl = dominio_publico do cadastro frota_lojas).
 * null se o bloco não existe, não é JSON ou não traz o campo como texto.
 */
export function extrairPublicUrl(html) {
  if (typeof html !== "string") return null;
  const m = /<script[^>]*\bid="ikcous-loja"[^>]*>([\s\S]*?)<\/script>/.exec(
    html,
  );
  if (!m) return null;
  try {
    const url = JSON.parse(m[1])?.identidade?.publicUrl;
    return typeof url === "string" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Chave PUBLICÁVEL do banco da loja que a ficha serve a todo visitante (bloco
 * <script id="ikcous-loja">, campo conexao.publishableKey). Não é segredo: é a
 * mesma chave que o navegador do cliente usa. null se ausente ou com caractere
 * fora do formato de chave (ela vai num cabeçalho HTTP).
 */
export function extrairChavePublica(html) {
  if (typeof html !== "string") return null;
  const m = /<script[^>]*\bid="ikcous-loja"[^>]*>([\s\S]*?)<\/script>/.exec(
    html,
  );
  if (!m) return null;
  try {
    const chave = JSON.parse(m[1])?.conexao?.publishableKey;
    return typeof chave === "string" && /^[A-Za-z0-9._-]{20,1024}$/.test(chave)
      ? chave
      : null;
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
    p.push(
      `codeVersion ausente ou fora de semver (${JSON.stringify(v?.codeVersion)})`,
    );
  }
  if (!shaValido(v?.codeSha))
    p.push(`codeSha ausente ou fora de 40 hex (${JSON.stringify(v?.codeSha)})`);
  if (
    typeof v?.identityRevision !== "string" ||
    !RE_IDENTIDADE.test(v.identityRevision)
  ) {
    p.push(
      `identityRevision ausente ou fora de 64 hex (${JSON.stringify(v?.identityRevision)})`,
    );
  }
  if (typeof v?.version !== "string") {
    p.push("version ausente");
  } else if (
    p.length === 0 &&
    v.version !==
      `${v.codeVersion}-sha.${v.codeSha.slice(0, 7)}-identity.${v.identityRevision}`
  ) {
    p.push("version não bate com codeVersion + codeSha + identityRevision");
  }
  if (v?.source !== "database")
    p.push(`source=${JSON.stringify(v?.source)}, esperado "database"`);
  if (v?.promotable !== true)
    p.push(
      `promotable=${JSON.stringify(v?.promotable)}, esperado true (booleano)`,
    );
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
  const pedir = (caminho, t, headers = undefined) =>
    fetchImpl(urlDe(modelo, dominio, `${caminho}?t=${t}`), {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      ...(headers ? { headers } : {}),
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
      const res = await pedir(
        "/",
        `${agora}-${i}`,
        CABECALHOS_DE_PRIMEIRA_ABERTURA,
      );
      const html = await res.text();
      return {
        status: res.status,
        caderneta: res.headers.get("x-ikcous-caderneta"),
        // Quem respondeu: o middleware (`ok`/`sem-loja`/...) ou outra coisa.
        porteiro: res.headers.get("x-ikcous-porteiro"),
        // Estado de vida da loja (L8): só na página de loja fora do ar.
        estado: res.headers.get("x-ikcous-estado"),
        refPorteiro: res.headers.get("x-ikcous-ref"),
        // "1" = o porteiro caiu na caderneta antiga (resolver_loja, sem estado).
        cadernetaVersao: res.headers.get("x-ikcous-caderneta-versao"),
        // Destino de um 3xx (a reserva só aceita encaminhamento para loja da
        // frota). Fora de `chaveDaAmostra`: não muda a estabilidade da ficha.
        location: res.headers.get("location"),
        titulo: extrairTitulo(html),
        refs: extrairRefsSupabase(html),
        publicUrl: extrairPublicUrl(html),
        chavePublica: extrairChavePublica(html),
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
      sonda.redirecionamento = {
        status: res.status,
        location: res.headers.get("location"),
        pedido,
      };
    } catch (e) {
      sonda.errosPagina.push(
        `sonda de redirecionamento: ${descreverErroDeRede(e)}`,
      );
    }
  })();
  const [, , ...resultados] = await Promise.all([versao, redirect, ...paginas]);
  // A chave publicável fica na sonda, fora das amostras e da ficha: não entra
  // na comparação de estabilidade nem no --json.
  sonda.chavePublica = null;
  sonda.amostras = resultados
    .filter((r) => !r.erro)
    .map(({ chavePublica, ...a }) => {
      sonda.chavePublica ??= chavePublica;
      return a;
    });
  sonda.errosPagina.push(
    ...resultados.filter((r) => r.erro).map((r) => r.erro),
  );
  if (sonda.amostras.length) {
    const primeira = sonda.amostras[0];
    sonda.ficha = {
      ...primeira,
      estavel: sonda.amostras.every(
        (a) => chaveDaAmostra(a) === chaveDaAmostra(primeira),
      ),
    };
  }
  return sonda;
}

// ---------------------------------------------------------------- referência e contexto

/**
 * A resposta de "/" DIZ ser de loja fora do ar (x-ikcous-porteiro ou
 * x-ikcous-estado = adormecida/encerrada), com qualquer HTTP? Só o que ela
 * alega; quem prova o contrato é `lojaForaDoAr`. Alegar sem provar é
 * ESTADO_INESPERADO.
 */
export function alegaForaDoAr(ficha) {
  if (!ficha) return false;
  return (
    Object.hasOwn(CLASSE_FORA_DO_AR, String(ficha.porteiro)) ||
    Object.hasOwn(CLASSE_FORA_DO_AR, String(ficha.estado))
  );
}

/**
 * Loja fora do ar POR DECISÃO, provada pelo contrato do porteiro em TODAS as
 * amostras de "/": HTTP 503 (adormecida) ou 410 (encerrada), x-ikcous-porteiro
 * = x-ikcous-estado = o estado, e o mesmo x-ikcous-ref de 20 letras minúsculas.
 * Devolve { estado, ref } ou null (qualquer outra combinação).
 */
export function lojaForaDoAr(sonda) {
  const ficha = sonda?.ficha;
  if (!ficha || ficha.estavel === false) return null;
  const amostras =
    Array.isArray(sonda.amostras) && sonda.amostras.length
      ? sonda.amostras
      : [ficha];
  const estado = ficha.estado;
  const ref = ficha.refPorteiro;
  if (!Object.hasOwn(CLASSE_FORA_DO_AR, String(estado))) return null;
  if (typeof ref !== "string" || !RE_REF_SUPABASE.test(ref)) return null;
  const confere = (a) =>
    a.status === STATUS_FORA_DO_AR[estado] &&
    a.porteiro === estado &&
    a.estado === estado &&
    a.refPorteiro === ref;
  return amostras.every(confere) ? { estado, ref } : null;
}

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
    const g = grupos.get(s.versao.codeSha) ?? {
      sha: s.versao.codeSha,
      versoes: new Set(),
      dominios: [],
    };
    g.versoes.add(String(s.versao.codeVersion));
    g.dominios.push(s.dominio);
    grupos.set(s.versao.codeSha, g);
  }
  return [...grupos.values()]
    .map((g) => ({
      sha: g.sha,
      codeVersion: [...g.versoes].join("/"),
      dominios: g.dominios,
    }))
    .sort(
      (a, b) =>
        b.dominios.length - a.dominios.length || a.sha.localeCompare(b.sha),
    );
}

const norm = (s) =>
  String(s ?? "")
    .trim()
    .toLowerCase();

/** Valor de x-ikcous-caderneta quando o porteiro abriu pela reserva (T3). */
const CADERNETA_RESERVA = "reserva";

/**
 * As amostras divergem SÓ na caderneta, entre hit e reserva (uma instância
 * ainda com a ficha, outra já aberta pela reserva)? Então é a MESMA loja e a
 * divergência é a caderneta caindo, não ficha trocada. Qualquer outro campo
 * da comparação de estabilidade (`chaveDaAmostra`: HTTP, título, refs,
 * publicUrl) diferente, ou outra caderneta (erro, miss), continua divergente.
 */
function soACadernetaOscila(amostras) {
  if (amostras.length === 0) return false;
  const semCaderneta = (a) =>
    JSON.stringify([a.status, a.titulo, a.refs, a.publicUrl]);
  const primeira = semCaderneta(amostras[0]);
  return amostras.every(
    (a) =>
      (a.caderneta === "hit" || a.caderneta === CADERNETA_RESERVA) &&
      semCaderneta(a) === primeira,
  );
}

const amostrasDe = (sonda) =>
  Array.isArray(sonda?.amostras) && sonda.amostras.length
    ? sonda.amostras
    : sonda?.ficha
      ? [sonda.ficha]
      : [];

/**
 * A ficha serve uma página de loja que entra nas conferências ENTRE
 * endereços (isolamento cruzado e canônico)? Caderneta hit OU reserva, e
 * estável OU divergindo só na caderneta (`soACadernetaOscila`). A reserva não
 * pode tirar o endereço dessas conferências: senão um LOJA_TROCADA entre
 * endereços some atrás de CADERNETA_NA_RESERVA (revisão Opus da T10).
 */
function fichaDeLojaConferivel(sonda) {
  const f = sonda?.ficha;
  if (!f) return false;
  if (f.caderneta !== "hit" && f.caderneta !== CADERNETA_RESERVA) return false;
  return f.estavel === true || soACadernetaOscila(amostrasDe(sonda));
}

// Fichas comparáveis entre endereços: conferíveis (hit ou reserva), UM ref e título.
function fichasComparaveis(sondas, ignorar) {
  return sondas
    .filter(
      (s) =>
        !ignorar.has(s.dominio) &&
        fichaDeLojaConferivel(s) &&
        s.ficha.refs.length === 1 &&
        s.ficha.titulo,
    )
    .map((s) => ({
      dominio: s.dominio,
      ref: s.ficha.refs[0],
      titulo: norm(s.ficha.titulo),
      tituloOriginal: s.ficha.titulo,
      chavePublica: s.chavePublica ?? null,
    }));
}

/**
 * Isolamento ENTRE endereços, só com o que o porteiro serviu: devolve
 * { [dominio]: [{classe, motivo}] }. `ignorar` = endereços que não são loja.
 *  - mesmo ref com títulos diferentes -> LOJA_TROCADA (quem destoa da maioria);
 *  - refs diferentes com o MESMO título -> SUSPEITA_ISOLAMENTO (todos os
 *    envolvidos), SALVO quando o banco de cada ref confirma o título servido
 *    (`titulosNoBanco`, ver `titulosRepetidos`: aí é aviso, não achado). Sem
 *    `titulosNoBanco` nada se confirma e vale a regra antiga inteira.
 */
export function verificarIsolamentoCruzado(
  sondas,
  ignorar = new Set(),
  titulosNoBanco = {},
) {
  const achados = {};
  const add = (dominio, classe, motivo) => {
    (achados[dominio] ??= []).push({ classe, motivo });
  };
  const fichas = fichasComparaveis(sondas, ignorar);

  const porRef = new Map();
  for (const f of fichas) porRef.set(f.ref, [...(porRef.get(f.ref) ?? []), f]);
  for (const [ref, lista] of porRef) {
    const titulos = new Set(lista.map((f) => f.titulo));
    if (titulos.size < 2) continue;
    const dominante = maioriaEstrita(lista.map((f) => f.titulo));
    for (const f of lista) {
      if (f.titulo !== dominante) {
        add(
          f.dominio,
          "LOJA_TROCADA",
          `ref ${ref} aparece com outro título ("${f.tituloOriginal}") que o de outros endereços da mesma loja`,
        );
      }
    }
  }

  for (const [dominio, lista] of Object.entries(
    titulosRepetidos(sondas, ignorar, titulosNoBanco).suspeitas,
  ))
    for (const a of lista) add(dominio, a.classe, a.motivo);
  return achados;
}

/** Grupos de título repetido em refs diferentes: [{ refs, lista }]. */
function gruposDeTituloRepetido(sondas, ignorar) {
  const porTitulo = new Map();
  for (const f of fichasComparaveis(sondas, ignorar))
    porTitulo.set(f.titulo, [...(porTitulo.get(f.titulo) ?? []), f]);
  return [...porTitulo.values()]
    .map((lista) => ({
      refs: [...new Set(lista.map((f) => f.ref))].sort(),
      lista,
    }))
    .filter((g) => g.refs.length >= 2);
}

/**
 * Refs DIFERENTES com o MESMO título. Com dezenas de lojas, duas lojistas reais
 * com o mesmo nome ("Bella Modas") é normal: o título sozinho não prova ficha
 * trocada. A prova independente do HTML servido é o BANCO de cada ref:
 * `titulosNoBanco` = { [ref]: título montado de v_store_config daquele banco,
 * ou null se a leitura falhou } (`lerTitulosNoBanco`).
 *  - CADA endereço do grupo serve EXATAMENTE o título do banco do próprio ref
 *    -> AVISO (não reprova): só o nome coincide;
 *  - basta UM que não bate (nome de outra loja, título assado do build) ou um
 *    ref sem leitura -> SUSPEITA_ISOLAMENTO em todos (como sempre foi).
 * Devolve { suspeitas: { [dominio]: [{classe, motivo}] }, avisos: { [dominio]: [motivo] } }.
 */
export function titulosRepetidos(
  sondas,
  ignorar = new Set(),
  titulosNoBanco = {},
) {
  const suspeitas = {};
  const avisos = {};
  for (const { refs, lista } of gruposDeTituloRepetido(sondas, ignorar)) {
    const confirmados = lista.every(
      (f) =>
        Object.hasOwn(titulosNoBanco, f.ref) &&
        typeof titulosNoBanco[f.ref] === "string" &&
        titulosNoBanco[f.ref] === f.tituloOriginal,
    );
    for (const f of lista) {
      if (confirmados) {
        (avisos[f.dominio] ??= []).push(
          `o título "${f.tituloOriginal}" se repete em lojas diferentes (refs ${refs.join(", ")}); o banco de cada ref confirma esse nome, então não barra`,
        );
      } else {
        (suspeitas[f.dominio] ??= []).push({
          classe: "SUSPEITA_ISOLAMENTO",
          motivo: `o título "${f.tituloOriginal}" aparece em refs Supabase diferentes (${refs.join(", ")}) e o banco de algum deles não confirma esse nome`,
        });
      }
    }
  }
  return { suspeitas, avisos };
}

/**
 * O título que o porteiro monta da linha de v_store_config (mesma regra de
 * src/config/identidadeNoHtml.ts + parseStoreIdentity de
 * src/lib/storeIdentity.ts): store_name aparado, e " | cidade, UF" quando há.
 * Espaços colapsados como em `extrairTitulo`. null se a linha não serve.
 */
export function tituloDaLinhaDoBanco(linha) {
  if (linha === null || typeof linha !== "object") return null;
  const nome =
    typeof linha.store_name === "string" ? linha.store_name.trim() : "";
  if (!nome) return null;
  const cidade =
    typeof linha.store_city === "string" ? linha.store_city.trim() : "";
  const uf =
    typeof linha.store_state === "string"
      ? linha.store_state.trim().toUpperCase()
      : "";
  const lugar = [cidade, uf].filter(Boolean).join(", ");
  return `${nome}${lugar ? ` | ${lugar}` : ""}`.replace(/\s+/g, " ").trim();
}

/**
 * Lê do BANCO de `ref` o título da loja: 1 GET anônimo em v_store_config (só
 * store_name, store_city, store_state; a mesma view que o porteiro e o
 * navegador do cliente leem), com a chave publicável que a ficha serve.
 * Devolve o título ou null em QUALQUER falha (sem chave, HTTP != 200, linha
 * != 1, nome vazio, rede): null nunca confirma nada (falha fechada).
 */
export async function lerTituloNoBanco(
  ref,
  chave,
  { fetchImpl = fetch, timeoutMs = 15000 } = {},
) {
  if (!RE_REF_SUPABASE.test(String(ref)) || typeof chave !== "string")
    return null;
  const url = `https://${ref}.supabase.co/rest/v1/v_store_config?select=store_name,store_city,store_state&id=eq.1&limit=2`;
  // Chave nova (sb_publishable_...) não é JWT e vai só em apikey; a antiga
  // (anon, JWT) vai também em Authorization, como o supabase-js faz.
  const headers = { apikey: chave, accept: "application/json" };
  if (!chave.startsWith("sb_publishable_"))
    headers.authorization = `Bearer ${chave}`;
  try {
    const res = await fetchImpl(url, {
      cache: "no-store",
      redirect: "error",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const texto = await res.text();
    if (res.status !== 200) return null;
    const linhas = JSON.parse(texto);
    if (!Array.isArray(linhas) || linhas.length !== 1) return null;
    return tituloDaLinhaDoBanco(linhas[0]);
  } catch {
    return null;
  }
}

/**
 * Só para os refs que caem num grupo de título repetido (frota normal = zero
 * leituras): { [ref]: título no banco | null }. A chave de cada ref é a da
 * ficha de um endereço que serve aquele ref; chave de outro projeto dá 401 no
 * banco e vira null (não confirma).
 */
export async function lerTitulosNoBanco(
  sondas,
  ignorar = new Set(),
  opcoes = {},
) {
  const chaves = new Map();
  for (const { lista } of gruposDeTituloRepetido(sondas, ignorar))
    for (const f of lista)
      if (!chaves.get(f.ref)) chaves.set(f.ref, f.chavePublica);
  const titulos = {};
  await Promise.all(
    [...chaves].map(async ([ref, chave]) => {
      titulos[ref] = await lerTituloNoBanco(ref, chave, opcoes);
    }),
  );
  return titulos;
}

/**
 * O endereço CANÔNICO de cada loja é o publicUrl da ficha (dominio_publico do
 * cadastro frota_lojas). Para cada loja com caderneta hit (ou reserva:
 * `fichaDeLojaConferivel`):
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
    if (ignorar.has(s.dominio) || !fichaDeLojaConferivel(s)) continue;
    // Página de loja fora do ar (válida ou não) não serve loja, então não tem
    // canônico a provar: quem a reprova, se for o caso, é `classificar`.
    if (alegaForaDoAr(f)) continue;
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
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/"
    ) {
      add(s.dominio, `publicUrl fora do formato https://host (${f.publicUrl})`);
      continue;
    }
    const destino = porDominio.get(u.host);
    const df = destino?.ficha;
    if (!destino) {
      add(
        s.dominio,
        `publicUrl aponta para ${u.host}, que não é endereço do inventário`,
      );
    } else if (
      !df ||
      df.status !== 200 ||
      (df.caderneta !== "hit" && df.caderneta !== CADERNETA_RESERVA)
    ) {
      // Canônico aberto pela reserva serve a loja: vale aqui; a reserva em si
      // já reprova o PRÓPRIO endereço dele (CADERNETA_NA_RESERVA).
      add(
        s.dominio,
        `publicUrl aponta para ${u.host}, que não responde 200 hit (HTTP ${df?.status ?? "-"}, caderneta ${df?.caderneta ?? "-"})`,
      );
    } else if (
      df.refs.length !== 1 ||
      f.refs.length !== 1 ||
      df.refs[0] !== f.refs[0]
    ) {
      add(
        s.dominio,
        `o canônico ${u.host} serve outra loja (ref ${df.refs.join("+") || "-"}, esperado ${f.refs.join("+") || "-"})`,
      );
    } else {
      canonicos.add(u.host);
    }
  }
  return { achados, canonicos };
}

// Monta o contexto compartilhado (SHA esperado, identidade da maioria, mapa de deployments).
export function montarContexto(
  sondas,
  {
    sha,
    vercel = null,
    ignorarNoCruzamento = new Set(),
    lojasQueNuncaDormem = new Set(),
    titulosNoBanco = {},
  } = {},
) {
  if (!RE_SHA.test(String(sha)))
    throw new Error("--sha precisa ter 40 caracteres hexadecimais");
  const grupos = agruparPorSha(sondas);
  // A referência do grupo sai SÓ de quem está dentro do contrato: campo ausente
  // jamais vira referência (undefined === undefined seria "tudo igual").
  const doGrupo = sondas.filter(
    (s) =>
      s.versao &&
      s.versao.codeSha === sha &&
      problemasDoContrato(s.versao).length === 0,
  );
  const cruzado = verificarIsolamentoCruzado(
    sondas,
    ignorarNoCruzamento,
    titulosNoBanco,
  );
  const canonico = verificarCanonico(sondas, ignorarNoCruzamento);
  for (const [dominio, lista] of Object.entries(canonico.achados))
    (cruzado[dominio] ??= []).push(...lista);
  const ctx = {
    shaEsperado: sha,
    identidadeRef:
      doGrupo.length === 1
        ? doGrupo[0].versao.identityRevision
        : maioriaEstrita(doGrupo.map((s) => s.versao.identityRevision)),
    codeVersionRef:
      doGrupo.length === 1
        ? doGrupo[0].versao.codeVersion
        : maioriaEstrita(doGrupo.map((s) => s.versao.codeVersion)),
    cruzado,
    // Não reprovam: só aparecem no relatório (título repetido entre lojas
    // cujo banco confirma o nome). Fora de `cruzado` de propósito: tudo que
    // está lá vira achado, e achado barra a publicação.
    avisos: titulosRepetidos(sondas, ignorarNoCruzamento, titulosNoBanco)
      .avisos,
    canonicos: canonico.canonicos,
    lojasQueNuncaDormem,
  };
  if (vercel?.ok) {
    const deployments = doGrupo
      .map((s) => vercel.porDominio[s.dominio]?.deploymentId ?? null)
      .filter(Boolean);
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
  const amostrasDaPagina = amostrasDe(sonda);
  const naReserva = amostrasDaPagina.filter(
    (a) => a.caderneta === CADERNETA_RESERVA,
  ).length;

  // 0) A caderneta central caiu e o porteiro abriu pela reserva (T10).
  if (naReserva)
    add(
      "CADERNETA_NA_RESERVA",
      `x-ikcous-caderneta: reserva em ${naReserva} de ${amostrasDaPagina.length} amostras de "/" (HTTP ${ficha?.status ?? "-"}): a caderneta central falhou e o porteiro abriu pela reserva`,
    );

  // 1) A ficha que o porteiro serve.
  if (ficha) {
    if (!ficha.estavel && !soACadernetaOscila(amostrasDaPagina)) {
      const resumo = [
        ...new Set(
          sonda.amostras.map(
            (a) =>
              `${a.caderneta ?? "-"}/${a.titulo ?? "-"}/${a.refs.join("+") || "-"}`,
          ),
        ),
      ].join(" | ");
      add(
        "LOJA_TROCADA",
        `as ${sonda.amostras.length} amostras de "/" divergem (caderneta/título/ref): ${resumo}`,
      );
    }
    const fora = alvo.esperado ? null : lojaForaDoAr(sonda);
    if (fora) {
      add(
        CLASSE_FORA_DO_AR[fora.estado],
        `loja ${fora.estado} por decisão (HTTP ${ficha.status}, x-ikcous-porteiro e x-ikcous-estado: ${fora.estado}, ref ${fora.ref}): não recebe a release`,
      );
      if (ctx.lojasQueNuncaDormem?.has(fora.ref))
        add(
          "ESTADO_INESPERADO",
          `a loja ${fora.ref} está em politica.json lojasQueNuncaDormem e respondeu ${fora.estado}`,
        );
    } else if (!alvo.esperado && alegaForaDoAr(ficha)) {
      add(
        "ESTADO_INESPERADO",
        `resposta de loja fora do ar fora do contrato (HTTP ${ficha.status}, x-ikcous-porteiro ${ficha.porteiro ?? "(ausente)"}, x-ikcous-estado ${ficha.estado ?? "(ausente)"}, x-ikcous-ref ${ficha.refPorteiro ?? "(ausente)"}${ficha.estavel === false ? ", amostras divergentes" : ""}): esperado 503 adormecida ou 410 encerrada, estado igual e ref de 20 letras minúsculas em todas as amostras`,
      );
    } else if (!alvo.esperado) {
      // Na reserva a página é de loja: confere-se como hit (refs, título,
      // HTTP, selo); a reserva em si já virou CADERNETA_NA_RESERVA acima.
      const comPagina =
        ficha.caderneta === "hit" || ficha.caderneta === CADERNETA_RESERVA;
      if (!comPagina) {
        add(
          "ESTADO_INESPERADO",
          `endereço sem ficha de loja (caderneta=${ficha.caderneta ?? "(ausente)"}, HTTP ${ficha.status}) e fora de enderecosEsperados da política`,
        );
      } else {
        const cad = ficha.caderneta;
        if (ficha.refs.length === 0)
          add(
            "LOJA_TROCADA",
            `caderneta ${cad} mas o HTML não traz ref Supabase`,
          );
        else if (ficha.refs.length > 1)
          add(
            "LOJA_TROCADA",
            `caderneta ${cad} com mais de um ref Supabase no HTML (${ficha.refs.join(", ")})`,
          );
        if (!ficha.titulo)
          add("LOJA_TROCADA", `caderneta ${cad} mas a página não tem <title>`);
        if (ficha.status !== 200)
          add(
            "ESTADO_INESPERADO",
            `loja respondeu HTTP ${ficha.status}, esperado 200`,
          );
        // Um 200 de loja SEM o selo do porteiro nao veio do middleware: com o
        // cartaz pre-impresso o caminho de 1a abertura e outro, e o selo e o
        // que prova que ele carregou na borda e nao caiu em silencio.
        else if (ficha.porteiro !== "ok")
          add(
            "ESTADO_INESPERADO",
            `loja respondeu 200 a uma 1a abertura (Sec-Fetch-Dest: document) sem x-ikcous-porteiro: ok (veio ${ficha.porteiro ?? "(ausente)"})`,
          );
      }
    } else if (alvo.esperado === "manutencao") {
      if (ficha.status !== 503)
        add(
          "ESTADO_INESPERADO",
          `esperado manutenção (HTTP 503), veio HTTP ${ficha.status}`,
        );
      if (ficha.caderneta !== "miss")
        add(
          "ESTADO_INESPERADO",
          `caderneta=${ficha.caderneta ?? "(ausente)"}, esperado miss`,
        );
    } else if (alvo.esperado === "redirecionamento") {
      if (ficha.status !== 308)
        add(
          "ESTADO_INESPERADO",
          `esperado redirecionamento (HTTP 308), veio HTTP ${ficha.status}`,
        );
    } else {
      add(
        "ESTADO_INESPERADO",
        `estado esperado desconhecido na política: ${alvo.esperado}`,
      );
    }
  }
  for (const a of ctx.cruzado?.[alvo.dominio] ?? []) add(a.classe, a.motivo);

  // 1b) Redirecionamento: o destino tem de ser o canônico PROVADO PELO CADASTRO
  // (publicUrl de uma ficha servida), com https, o host declarado e o
  // caminho + query da sonda preservados.
  if (alvo.esperado === "redirecionamento") {
    const r = sonda.redirecionamento;
    const falhou = (sonda.errosPagina ?? []).some((e) =>
      e.startsWith("sonda de redirecionamento"),
    );
    if (!alvo.para) {
      add(
        "ESTADO_INESPERADO",
        "política sem o destino (campo para) deste redirecionamento",
      );
    } else if (!r) {
      if (!falhou) add("CANONICO_INVALIDO", "redirecionamento não foi sondado");
    } else if (r.status !== 308) {
      add(
        "ESTADO_INESPERADO",
        `a sonda de redirecionamento respondeu HTTP ${r.status}, esperado 308`,
      );
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
        if (u.protocol !== "https:")
          add("CANONICO_INVALIDO", `Location não é https (${r.location})`);
        if (u.host !== alvo.para)
          add(
            "CANONICO_INVALIDO",
            `Location leva para ${u.host}, esperado ${alvo.para}`,
          );
        if (`${u.pathname}${u.search}` !== r.pedido) {
          add(
            "CANONICO_INVALIDO",
            `Location perde o caminho ou a query (${u.pathname}${u.search}, esperado ${r.pedido})`,
          );
        }
      }
      if (!ctx.canonicos?.has(alvo.para)) {
        add(
          "CANONICO_INVALIDO",
          `o destino ${alvo.para} não é o publicUrl de nenhuma ficha servida (cadastro frota_lojas)`,
        );
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
    for (const p of problemas)
      add("BUILD_DIVERGENTE", `version.json fora do contrato: ${p}`);
    const shaOk =
      shaValido(versao.codeSha) && versao.codeSha === ctx.shaEsperado;
    if (shaValido(versao.codeSha) && !shaOk) {
      add(
        "ENDERECO_ANTIGO",
        `serve ${sha7(versao.codeSha)} (${String(versao.codeVersion)}), esperado ${ctx.shaEsperado.slice(0, 7)}`,
      );
    }
    if (vercel && deployment && vercel.deploymentEsperado !== undefined) {
      if (
        shaOk &&
        vercel.deploymentEsperado &&
        deployment !== vercel.deploymentEsperado
      ) {
        add(
          "BUILD_DIVERGENTE",
          `mesmo SHA servido por outro deployment (${deployment}, esperado ${vercel.deploymentEsperado})`,
        );
      } else if (shaOk && !vercel.deploymentEsperado && vercel.ambiguo) {
        add(
          "BUILD_DIVERGENTE",
          `mesmo SHA servido por deployments diferentes, sem maioria (${deployment})`,
        );
      } else if (
        !shaOk &&
        vercel.deploymentEsperado &&
        deployment !== vercel.deploymentEsperado
      ) {
        add(
          "ENDERECO_ANTIGO",
          `aponta para ${deployment}, não para o deployment esperado ${vercel.deploymentEsperado}`,
        );
      }
    }
    if (shaOk && problemas.length === 0) {
      if (versao.identityRevision !== ctx.identidadeRef) {
        add(
          "BUILD_DIVERGENTE",
          `identityRevision ${String(versao.identityRevision).slice(0, 8)} difere dos demais do mesmo SHA`,
        );
      }
      if (versao.codeVersion !== ctx.codeVersionRef) {
        add(
          "BUILD_DIVERGENTE",
          `codeVersion ${versao.codeVersion} difere dos demais do mesmo SHA`,
        );
      }
    }
  }

  let classe = "OK";
  for (const a of achados) {
    if (GRAVIDADE.indexOf(a.classe) < GRAVIDADE.indexOf(classe))
      classe = a.classe;
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
export function resolverCliVercel({
  env = process.env,
  plataforma = process.platform,
  existe = existsSync,
  node = process.execPath,
} = {}) {
  if (plataforma !== "win32") return { comando: "vercel", prefixo: [] };
  for (const dir of (env.PATH ?? env.Path ?? "").split(";")) {
    if (!dir) continue;
    const js = path.win32.join(dir, "node_modules", "vercel", "dist", "vc.js");
    if (existe(path.win32.join(dir, "vercel.cmd")) && existe(js))
      return { comando: node, prefixo: [js] };
  }
  throw new Error(
    "CLI vercel não encontrado no PATH (procurei vercel.cmd com node_modules/vercel/dist/vc.js ao lado)",
  );
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
            const linha = String(stderr || "")
              .split("\n")
              .map((l) => l.trim())
              .find(Boolean);
            reject(
              new Error(
                `vercel api falhou${linha ? `: ${linha.slice(0, 200)}` : ""}`,
              ),
            );
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
const ehObjeto = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Valida UMA página da lista de aliases. CONTRATO (medido no ar em 06/10/2026:
 * 5 páginas, 454 aliases, todos com projectId do projeto e deploymentId dpl_*):
 *  - `aliases` é ARRAY e `pagination` é OBJETO (next ausente/null = fim);
 *  - todo item tem `alias` texto.
 * Devolve { erro } ou { itens, proximo }. Resposta {} nunca vira "lista vazia".
 */
function lerPaginaDeAliases(resposta) {
  if (!ehObjeto(resposta)) return { erro: "resposta não é um objeto" };
  if (!Array.isArray(resposta.aliases))
    return { erro: "resposta sem `aliases` em array" };
  if (!ehObjeto(resposta.pagination))
    return { erro: "resposta sem `pagination` em objeto" };
  const next = resposta.pagination.next;
  if (
    next !== undefined &&
    next !== null &&
    typeof next !== "number" &&
    typeof next !== "string"
  ) {
    return { erro: "pagination.next fora do formato" };
  }
  if (
    resposta.aliases.some(
      (a) => !ehObjeto(a) || typeof a.alias !== "string" || !a.alias,
    )
  ) {
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
export async function consultarVercel(
  politica,
  extras,
  executor,
  tamanhoDaPagina = 100,
) {
  const { id, time } = politica.projetoVercel;
  // eslint-disable-next-line security/detect-non-literal-regexp -- padrões da política versionada no repositório (aliasesDePreview), revisados por PR.
  const previews = (politica.aliasesDePreview ?? []).map((p) => new RegExp(p));
  const aliasesProjeto = [];
  const vistos = new Set();
  const avisos = [];
  let proximo = null;
  let listaCompleta = true;
  for (let pagina = 0; pagina < 60; pagina++) {
    let resposta;
    try {
      resposta = await executor(
        `/v4/aliases?projectId=${encodeURIComponent(id)}&teamId=${encodeURIComponent(time)}&limit=${tamanhoDaPagina}${proximo ? `&until=${encodeURIComponent(proximo)}` : ""}`,
      );
    } catch (e) {
      if (pagina === 0)
        return {
          ok: false,
          erro: `aliases do projeto não listados: ${e.message}`,
        };
      listaCompleta = false;
      avisos.push(`página ${pagina + 1} dos aliases falhou: ${e.message}`);
      break;
    }
    const lida = lerPaginaDeAliases(resposta);
    if (lida.erro)
      return {
        ok: false,
        erro: `página ${pagina + 1} da lista de aliases fora do contrato: ${lida.erro}`,
      };
    let novos = 0;
    for (const a of lida.itens) {
      if (vistos.has(a.alias)) continue;
      vistos.add(a.alias);
      novos++;
      aliasesProjeto.push({
        alias: a.alias,
        deploymentId:
          typeof a.deploymentId === "string" ? a.deploymentId : null,
        projectId: typeof a.projectId === "string" ? a.projectId : null,
      });
    }
    proximo = lida.proximo;
    if (!proximo) break;
    // `until` da Vercel é "estritamente menor": pedir a próxima página com o
    // próprio `next` PERDE todo alias que empata em createdAt com o último da
    // página (28/10/2026: o alias principal sumiu do inventário). Pedimos
    // `next + 1` (o último item volta repetido, e `vistos` o descarta).
    const numero = Number(proximo);
    if (Number.isFinite(numero)) proximo = numero + 1;
    // Página que só repete o que já veio não avança: não é "completo".
    if (novos === 0) {
      listaCompleta = false;
      avisos.push(`página ${pagina + 1} dos aliases não trouxe nada novo`);
      break;
    }
    if (pagina === 59) listaCompleta = false;
  }
  if (aliasesProjeto.length === 0) {
    return {
      ok: false,
      erro: "o projeto veio com ZERO aliases (tem domínios de produção: lista vazia é falha, não inventário)",
    };
  }
  const invalidos = aliasesProjeto
    .filter((a) => !previews.some((re) => re.test(a.alias)))
    .filter(
      (a) => !RE_DEPLOYMENT.test(String(a.deploymentId)) || a.projectId !== id,
    )
    .map(
      (a) =>
        `${a.alias} (${!RE_DEPLOYMENT.test(String(a.deploymentId)) ? "sem deploymentId dpl_*" : `projectId ${a.projectId ?? "ausente"}`})`,
    );
  if (invalidos.length) {
    return {
      ok: false,
      erro: `alias fora do contrato (sem deploymentId ou de outro projeto): ${invalidos.slice(0, 3).join(", ")}${invalidos.length > 3 ? ` e mais ${invalidos.length - 3}` : ""}`,
    };
  }
  if (!listaCompleta)
    avisos.push(
      "lista de aliases do projeto INCOMPLETA: endereço novo pode estar fora do inventário",
    );

  const porDominio = {};
  for (const a of aliasesProjeto)
    porDominio[a.alias] = { deploymentId: a.deploymentId };

  const faltando = [...new Set(extras)].filter((d) => !(d in porDominio));
  const fila = [...faltando];
  const trabalhador = async () => {
    while (fila.length) {
      const dominio = fila.shift();
      if (!RE_DOMINIO.test(dominio)) continue;
      try {
        const a = await executor(
          `/v4/aliases/${encodeURIComponent(dominio)}?teamId=${encodeURIComponent(time)}`,
        );
        if (
          ehObjeto(a) &&
          a.projectId === id &&
          RE_DEPLOYMENT.test(String(a.deploymentId))
        ) {
          porDominio[dominio] = { deploymentId: a.deploymentId };
        } else {
          porDominio[dominio] = { deploymentId: null };
          avisos.push(
            `${dominio} não é alias deste projeto (ou veio sem deploymentId): deployment não mapeado`,
          );
        }
      } catch (e) {
        porDominio[dominio] = { deploymentId: null };
        avisos.push(
          `${dominio} não é alias do projeto ou não foi lido: ${e.message}`,
        );
      }
    }
  };
  await Promise.all([trabalhador(), trabalhador(), trabalhador()]);

  let producaoOficial;
  try {
    producaoOficial = lerProducaoOficial(
      await executor(
        `/v9/projects/${encodeURIComponent(id)}?teamId=${encodeURIComponent(time)}`,
      ),
    );
  } catch (e) {
    return { ok: false, erro: `produção oficial não lida: ${e.message}` };
  }
  if (!producaoOficial) {
    return {
      ok: false,
      erro: "o projeto veio sem targets.production.id no formato dpl_* (produção oficial desconhecida)",
    };
  }
  return {
    ok: true,
    porDominio,
    producaoOficial,
    aliasesProjeto,
    listaCompleta,
    avisos,
  };
}

// ---------------------------------------------------------------- inventário

export function lerEnderecosDoArquivo(texto) {
  const dominios = [];
  for (const bruta of String(texto).split(/\r?\n/)) {
    const linha = bruta.replace(/#.*$/, "").trim().toLowerCase();
    if (!linha) continue;
    if (!RE_DOMINIO.test(linha))
      throw new Error(`endereço inválido no arquivo --enderecos: ${linha}`);
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
  await Promise.all(
    Array.from({ length: Math.min(concorrencia, itens.length) }, trabalhador),
  );
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
      vercel = await consultarVercel(
        politica,
        obrigatorios,
        executorVercel ?? criarExecutorVercel(),
      );
    } catch (e) {
      vercel = { ok: false, erro: e.message };
    }
  }

  // eslint-disable-next-line security/detect-non-literal-regexp -- padrões da política versionada no repositório (aliasesDePreview), revisados por PR.
  const previews = (politica.aliasesDePreview ?? []).map((p) => new RegExp(p));
  let candidatos;
  let origem;
  let completo;
  let motivoParcial = null;
  if (vercel?.ok) {
    origem = "vercel";
    candidatos = [
      ...vercel.aliasesProjeto
        .map((a) => a.alias)
        .filter((a) => !previews.some((re) => re.test(a))),
      ...obrigatorios,
    ];
    completo = vercel.listaCompleta;
    if (!completo)
      motivoParcial = "a lista de aliases da Vercel veio incompleta";
  } else {
    origem = "reserva";
    candidatos = [...obrigatorios, ...(politica.enderecosDeReserva ?? [])];
    completo = false;
    motivoParcial = pedirVercel
      ? `--vercel falhou: ${vercel?.erro}`
      : "sem --vercel";
  }
  const dominios = [
    ...new Set(candidatos.filter((d) => RE_DOMINIO.test(d))),
  ].sort();
  const redirecionam = new Set(
    politica.enderecosEsperados
      .filter((e) => e.estado === "redirecionamento")
      .map((e) => e.dominio),
  );
  const sondas = await emLotes(dominios, concorrencia, (d) =>
    sondarEndereco(d, {
      modelo,
      timeoutMs,
      fetchImpl,
      agora,
      redirecionamento: redirecionam.has(d),
    }),
  );
  return { origem, completo, motivoParcial, dominios, vercel, sondas };
}

// ---------------------------------------------------------------- relatório

const celula = (s) =>
  String(s ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");

export function montarRelatorio({
  resultados,
  sha,
  grupos,
  inventario,
  vercel,
  vercelPedido,
  politica,
  problemasDeCobertura = [],
}) {
  const linhas = [];
  const ok = resultados.filter((r) => r.classe === "OK").length;
  linhas.push("# Conferência da frota", "");
  linhas.push(`Release esperada: \`${sha}\` (informada com --sha).`, "");
  if (inventario.completo) {
    linhas.push(
      "inventário: COMPLETO (todos os aliases do projeto Vercel, menos os de preview)",
      "",
    );
  } else {
    linhas.push(
      `inventário: PARCIAL (${inventario.motivoParcial}) — NÃO é a frota inteira: endereço fora da lista de reserva não foi conferido.`,
      "",
    );
  }
  const foraDoAr = resultados.filter((r) => r.foraDoAr);
  linhas.push(
    `**Resultado: ${ok} de ${resultados.length} endereços OK${foraDoAr.length ? ` (+ ${foraDoAr.length} fora do ar por decisão)` : ""}.**`,
    "",
  );
  if (problemasDeCobertura.length) {
    linhas.push("## Cobertura da frota — FALHOU", "");
    for (const problema of problemasDeCobertura)
      linhas.push(`- ${celula(problema)}`);
    linhas.push("");
  }
  linhas.push("## Grupos por versão servida", "");
  if (grupos.length === 0)
    linhas.push("- (nenhum endereço respondeu version.json)");
  for (const g of grupos) {
    const marca = g.sha === sha ? " <- release esperada" : "";
    linhas.push(
      `- \`${g.sha.slice(0, 7)}\` (${g.codeVersion}): ${g.dominios.length} endereço(s)${marca}: ${g.dominios.join(", ")}`,
    );
  }
  linhas.push("", "## Endereços", "");
  linhas.push(
    "| Endereço | Loja (ref da ficha) | Classe | Serve | HTTP / caderneta | Deployment | Detalhe |",
  );
  linhas.push("|---|---|---|---|---|---|---|");
  const semBackend = new Map(
    (politica?.lojasSemBackendGerenciado ?? []).map((l) => [l.ref, l.nome]),
  );
  for (const r of resultados) {
    const outras = [...new Set(r.achados.map((a) => a.classe))].filter(
      (c) => c !== r.classe,
    );
    const detalhe = [
      ...r.achados.filter((a) => a.classe === r.classe).map((a) => a.motivo),
      ...(outras.length ? [`(também: ${outras.join(", ")})`] : []),
    ].join("; ");
    const serve = r.versao
      ? `${String(r.versao.codeVersion)} (${sha7(r.versao.codeSha)})`
      : "-";
    const http = r.ficha
      ? `${r.ficha.status} / ${r.ficha.caderneta ?? "-"}`
      : "-";
    const dep = vercel?.ok
      ? (vercel.porDominio[r.dominio]?.deploymentId ?? "-")
      : "-";
    let loja = "-";
    if (r.esperado) loja = `(sem loja: ${r.esperado})`;
    else if (r.ficha?.refs.length)
      loja = r.ficha.refs
        .map((ref) =>
          semBackend.has(ref) ? `${semBackend.get(ref)} [${ref}]` : ref,
        )
        .join(" + ");
    linhas.push(
      `| ${celula(r.dominio)} | ${celula(loja)} | ${r.classe} | ${celula(serve)} | ${celula(http)} | ${celula(dep)} | ${celula(detalhe)} |`,
    );
  }
  linhas.push("", "## Lojas fora do ar por decisão", "");
  if (foraDoAr.length === 0) linhas.push("- nenhuma");
  for (const r of foraDoAr)
    linhas.push(
      `- ${celula(r.dominio)}: ${r.foraDoAr.estado} (ref ${r.foraDoAr.ref}) — não recebe esta release; ao acordar recebe tudo`,
    );
  const antigas = resultados.filter((r) => r.cadernetaAntiga);
  if (antigas.length)
    linhas.push(
      `- AVISO: o porteiro respondeu pela caderneta antiga (x-ikcous-caderneta-versao: 1) em ${antigas.map((r) => celula(r.dominio)).join(", ")}: ali uma loja adormecida ou encerrada aparece como endereço desconhecido, não como fora do ar. Aplicar a migration do estado de vida no banco onde a caderneta mora.`,
    );
  const comAviso = resultados.filter((r) => r.avisos?.length);
  if (comAviso.length) {
    linhas.push("", "## Avisos (não barram a publicação)", "");
    for (const r of comAviso)
      for (const aviso of r.avisos)
        linhas.push(`- AVISO: ${celula(r.dominio)}: ${celula(aviso)}`);
  }
  linhas.push("", "## Endereço -> deployment", "");
  if (!vercelPedido) {
    linhas.push("endereço→deployment: NÃO CONFERIDO (sem --vercel)");
  } else if (!vercel?.ok) {
    linhas.push(
      `endereço→deployment: NÃO CONFERIDO (--vercel falhou: ${vercel?.erro ?? "sem detalhe"})`,
    );
  } else {
    linhas.push(
      "endereço→deployment: conferido pelo CLI vercel (somente leitura).",
    );
    if (vercel.deploymentEsperado) {
      const eOficial =
        vercel.producaoOficial &&
        vercel.deploymentEsperado === vercel.producaoOficial;
      linhas.push(
        `- Deployment da release: \`${vercel.deploymentEsperado}\` — ${eOficial ? "É" : "NÃO É"} a produção oficial do projeto (\`${vercel.producaoOficial ?? "não lida"}\`).`,
      );
    } else if (vercel.deploymentEsperado === null) {
      linhas.push(
        "- Deployment da release: INDEFINIDO (endereços do SHA esperado estão em deployments diferentes, sem maioria).",
      );
    } else {
      linhas.push(
        `- Deployment da release: nenhum endereço serve o SHA esperado. Produção oficial do projeto: \`${vercel.producaoOficial ?? "não lida"}\`.`,
      );
    }
  }
  for (const aviso of vercel?.avisos ?? []) linhas.push(`- AVISO: ${aviso}`);

  const presentes = GRAVIDADE.filter(
    (c) => c !== "OK" && resultados.some((r) => r.classe === c),
  );
  if (presentes.length) {
    linhas.push("", "## Como recuperar", "");
    for (const c of presentes) {
      linhas.push(
        `- **${c}** (${resultados
          .filter((r) => r.classe === c)
          .map((r) => r.dominio)
          .join(", ")}): ${COMO_RECUPERAR[c]}`,
      );
    }
  }
  const fora = politica?.migrationsForaDaRelease ?? [];
  if (fora.length) {
    linhas.push("", "## Política (para quem publica)", "");
    for (const m of fora)
      linhas.push(
        `- Migration ${m.versao} fica FORA da release: ${m.motivo} (conferência: ${m.conferencia}).`,
      );
    if (semBackend.size)
      linhas.push(
        `- Lojas sem backend gerenciado: ${[...semBackend.values()].join(", ")} — ${politica.motivoLojasSemBackendGerenciado ?? ""}`,
      );
  }
  linhas.push("");
  return linhas.join("\n");
}

// ---------------------------------------------------------------- orquestração

/** Ref de uma loja cuja ficha foi lida e identificou um único backend. */
export function refDaLojaSondada(ficha) {
  if (
    ficha?.status !== 200 ||
    ficha.caderneta !== "hit" ||
    !Array.isArray(ficha.refs) ||
    ficha.refs.length !== 1 ||
    ficha.estavel === false
  )
    return null;
  return ficha.refs[0];
}

export function problemasLojasNaoSondadas(lojasObrigatorias, refsSondados) {
  return lojasObrigatorias
    .filter(({ ref }) => !refsSondados.has(ref))
    .map(
      ({ ref, nome }) =>
        `a loja ${nome ?? ref} está cadastrada mas não foi sondada`,
    );
}

export async function conferirFrota(politica, opcoes = {}) {
  const {
    sha,
    pedirVercel = false,
    inventarioPronto = null,
    lojasObrigatorias = [],
    dominiosDeLojasAntes = [],
  } = opcoes;
  if (!RE_SHA.test(String(sha)))
    throw new Error("--sha precisa ter 40 caracteres hexadecimais");
  const inventario =
    inventarioPronto ??
    (await inventariar(politica, { ...opcoes, pedirVercel }));
  const declarados = new Map(
    politica.enderecosEsperados.map((e) => [e.dominio, e]),
  );
  const esperados = new Map([...declarados].map(([d, e]) => [d, e.estado]));
  const ignorarNoCruzamento = new Set(esperados.keys());
  const titulosNoBanco = await lerTitulosNoBanco(
    inventario.sondas,
    ignorarNoCruzamento,
    {
      fetchImpl: opcoes.fetchImpl ?? fetch,
      timeoutMs: opcoes.timeoutMs ?? 15000,
    },
  );
  const { grupos, ctx } = montarContexto(inventario.sondas, {
    sha,
    vercel: inventario.vercel,
    ignorarNoCruzamento,
    titulosNoBanco,
    lojasQueNuncaDormem: new Set(
      (politica.lojasQueNuncaDormem ?? []).map((l) => l.ref),
    ),
  });
  const resultados = inventario.sondas.map((sonda) => {
    const esperado = esperados.get(sonda.dominio) ?? null;
    const { classe, achados } = classificar(
      {
        dominio: sonda.dominio,
        esperado,
        para: declarados.get(sonda.dominio)?.para ?? null,
      },
      sonda,
      ctx,
    );
    return {
      dominio: sonda.dominio,
      esperado,
      classe,
      achados,
      // { estado, ref } da loja fora do ar por decisão (contrato provado), ou null.
      foraDoAr: esperado ? null : lojaForaDoAr(sonda),
      // O porteiro respondeu pela caderneta antiga (sem estado de vida)?
      cadernetaAntiga: (sonda.amostras ?? []).some(
        (a) => a.cadernetaVersao === "1",
      ),
      // Avisos que NÃO reprovam (ficam fora de `achados` e de `classe`).
      avisos: ctx.avisos?.[sonda.dominio] ?? [],
      versao: sonda.versao,
      ficha: sonda.ficha,
      deploymentId: inventario.vercel?.ok
        ? (inventario.vercel.porDominio[sonda.dominio]?.deploymentId ?? null)
        : null,
    };
  });
  const vercelInfo = inventario.vercel?.ok
    ? {
        ...inventario.vercel,
        deploymentEsperado: ctx.vercel?.deploymentEsperado,
      }
    : inventario.vercel;
  // Loja fora do ar por decisão FOI sondada: a resposta dela provou quem é.
  const refsSondados = new Set(
    resultados
      .filter((r) => !declarados.has(r.dominio))
      .map((r) => r.foraDoAr?.ref ?? refDaLojaSondada(r.ficha)),
  );
  const dominiosSondados = new Set(resultados.map((r) => r.dominio));
  const problemasDeCobertura = [
    ...problemasLojasNaoSondadas(lojasObrigatorias, refsSondados),
    ...dominiosDeLojasAntes
      .filter((dominio) => !dominiosSondados.has(dominio))
      .map(
        (dominio) =>
          `${dominio}: endereço de loja sondado antes do promote, mas não depois`,
      ),
  ];
  const ok =
    problemasDeCobertura.length === 0 &&
    resultados.every((r) => CLASSES_SEM_FALHA.has(r.classe)) &&
    (!pedirVercel || (inventario.vercel?.ok === true && inventario.completo));
  const relatorio = montarRelatorio({
    resultados,
    sha,
    grupos,
    inventario,
    vercel: vercelInfo,
    vercelPedido: pedirVercel,
    politica,
    problemasDeCobertura,
  });
  return {
    ok,
    sha,
    inventario: {
      origem: inventario.origem,
      completo: inventario.completo,
      motivoParcial: inventario.motivoParcial,
      dominios: inventario.dominios,
    },
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
      if (!valor || valor.startsWith("--"))
        throw new Error(`${a} exige um valor`);
      args[a.slice(2)] = valor;
    } else throw new Error(`argumento desconhecido: ${a}`);
  }
  if (args.sha === null)
    throw new Error(
      "--sha é obrigatório (sem a release esperada, frota inteira velha daria verde)",
    );
  if (!/^[0-9a-fA-F]{40}$/.test(args.sha))
    throw new Error("--sha precisa ter 40 caracteres hexadecimais");
  args.sha = args.sha.toLowerCase();
  return args;
}

const USO =
  "Uso: node scripts/frota/conferir-frota.mjs --sha <40hex> [--json <arquivo>] [--vercel] [--enderecos <arquivo>]";

// `deps` ({ fetchImpl, executorVercel }) existe só para teste: injeta o I/O.
export async function main(
  argv = process.argv.slice(2),
  env = process.env,
  deps = {},
) {
  let args;
  let extras = [];
  try {
    args = lerArgumentos(argv);
    if (args.enderecos)
      extras = lerEnderecosDoArquivo(readFileSync(args.enderecos, "utf8"));
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
    timeoutMs:
      Number(env.FROTA_TIMEOUT_MS) > 0 ? Number(env.FROTA_TIMEOUT_MS) : 15000,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.executorVercel ? { executorVercel: deps.executorVercel } : {}),
  });
  console.log(resultado.relatorio);
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${resultado.relatorio}\n`);
  if (args.json) {
    const { relatorio, ...estruturado } = resultado;
    writeFileSync(
      args.json,
      `${JSON.stringify({ geradoEm: new Date().toISOString(), ...estruturado }, null, 2)}\n`,
    );
  }
  return resultado.ok ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
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
