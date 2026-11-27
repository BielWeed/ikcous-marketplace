#!/usr/bin/env node
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename -- as chaves indexadas são o slug e o ref já validados por RE_PROJETO/RE_REF (lojas.cjs) e passam por `Object.hasOwn`; os caminhos são os arquivos fixos deste repositório (scripts/frota e .github/workflows), nunca entrada de rede. */
/**
 * cadastro-da-loja.mjs — põe UMA loja assinante nova em todos os arquivos do
 * repositório que listam as lojas (plano nova-loja, B5, 26/11/2026):
 *
 *   1. scripts/frota/lojas.json — a entrada da loja (classe assinante, segredo
 *      SUPABASE_ACCESS_TOKEN_<SLUG>, functionsNomeadas true: decisão S2 do L4b);
 *   2. .github/workflows/*.yml — os blocos LOJAS-SEGREDO*, LOJAS-OPCOES* e
 *      LOJAS-GRUPO-DO-BANCO, regravados pelo GERADOR
 *      (scripts/frota/lojas-nos-workflows.cjs), nunca à mão;
 *   3. scripts/frota/canais-de-backend.json — o canal da loja, com a MESMA
 *      lista de functionsPublicaveis das assinantes de hoje (copiada delas:
 *      se elas divergirem entre si, recusa, porque aí a escolha é de gente);
 *   4. o SQL da linha em public.frota_lojas (a caderneta, no banco antigo) —
 *      só IMPRESSO, nunca executado: quem roda é a sessão, pelo MCP, como em
 *      scripts/frota/estado-da-loja.mjs. Domínio padrão <slug>.vercel.app
 *      (decisão S3 do L4b), ou o --dominio.
 *
 * Uso:
 *   node scripts/frota/cadastro-da-loja.mjs --loja <slug> --projeto <ref> --nome "<apelido>"
 *        [--dominio https://<host>] [--chave-publica sb_publishable_...] [--aplicar]
 *
 * Sem --aplicar é ENSAIO: mostra o diff de cada arquivo e o SQL, e não grava
 * nenhum byte. Com --aplicar grava, nesta ordem: lojas.json, workflows,
 * canais. A ordem é a do lado seguro: até o canal existir, o portão de
 * publicação (publicar-release.mjs) BLOQUEIA a loja pelo nome; um canal sem a
 * loja no lojas.json, ao contrário, quebraria a concordância dos dois cadastros.
 *
 * O QUE ELE GARANTE:
 *   - nunca toca uma loja que já existe: a entrada nova é INSERIDA no texto
 *     (no fim do objeto, com o recuo e o fim de linha do arquivo), e o resto
 *     do arquivo fica byte a byte igual; os workflows mudam só nas linhas que o
 *     gerador escreve para a loja nova;
 *   - tudo é calculado e conferido ANTES da primeira escrita (validarCadastro
 *     de lojas.cjs no cadastro novo, a concordância dos dois cadastros, os
 *     workflows em sincronia); cada arquivo é gravado inteiro (temporário +
 *     rename);
 *   - rodar de novo não muda nada; se uma rodada parar no meio, a seguinte
 *     completa o que falta (cada peça é conferida sozinha);
 *   - recusa (saída 1, nada gravado): o slug já cadastrado com OUTRO ref, ou
 *     com outros campos (este comando não altera loja existente); o ref ou o
 *     segredo já de outra loja; um canal do ref com outro conteúdo; workflows
 *     já fora de sincronia com o lojas.json (o diff não seria só desta loja);
 *   - uso errado (saída 2, nada gravado): argumento desconhecido, repetido ou
 *     sem valor; slug, ref, nome, domínio ou chave fora do formato.
 *
 * O QUE ELE NÃO FAZ: criar o segredo no GitHub (é do dono, com o NOME
 * impresso), abrir PR, falar com rede ou banco.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { RE_PROJETO, RE_REF, validarCadastro, lojaDoProjeto } =
  require("./lojas.cjs");
const {
  sincronizar,
  workflowsComBlocos,
} = require("./lojas-nos-workflows.cjs");
const { carregarOrgCentral } = require("./org-central.cjs");

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..");
const REL_LOJAS = "scripts/frota/lojas.json";
const REL_CANAIS = "scripts/frota/canais-de-backend.json";
const DIR_WORKFLOWS = path.join(RAIZ, ".github", "workflows");

/** O mesmo CHECK de public.frota_lojas.dominio_publico (migration 20261141000000). */
const RE_DOMINIO =
  // eslint-disable-next-line security/detect-unsafe-regex -- é o CHECK da tabela, ancorado; só lê o host de um argumento de linha de comando, já limitado pelo parser de URL.
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
/** A chave PÚBLICA nova do Supabase (src/lib/publicSupabaseKey.ts); nunca sb_secret_. */
const RE_CHAVE_PUBLICA = /^sb_publishable_[A-Za-z0-9_-]+$/;
/** Largura de linha do biome (biome.json), para o JSON inserido sair formatado. */
const LARGURA = 80;

const OPCOES = new Set([
  "--loja",
  "--projeto",
  "--nome",
  "--dominio",
  "--chave-publica",
]);
const EXIGIDAS = ["loja", "projeto", "nome"];

export class UsoErrado extends Error {}
export class Recusa extends Error {}

/** Lê a FORMA dos argumentos. Erro aqui é uso errado (saída 2). */
export function lerArgumentos(argv) {
  const v = {};
  let aplicar = false;
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--aplicar") {
      if (aplicar) throw new UsoErrado("--aplicar repetido");
      aplicar = true;
    } else if (OPCOES.has(x)) {
      const valor = argv[++i];
      if (valor === undefined || valor.startsWith("--"))
        throw new UsoErrado(`${x} exige um valor`);
      const nome = x.slice(2);
      if (Object.hasOwn(v, nome)) throw new UsoErrado(`${x} repetido`);
      v[nome] = valor;
    } else throw new UsoErrado(`argumento desconhecido: ${x}`);
  }
  for (const k of EXIGIDAS)
    if (!Object.hasOwn(v, k)) throw new UsoErrado(`falta --${k}`);
  return { ...v, aplicar };
}

/** `https://Host.com/` → `host.com`; o que não for só um host https é uso errado. */
export function hostDoDominio(texto) {
  let u;
  try {
    u = new URL(texto);
  } catch {
    throw new UsoErrado("--dominio: não é um endereço (https://<host>)");
  }
  if (
    u.protocol !== "https:" ||
    u.username !== "" ||
    u.password !== "" ||
    u.port !== "" ||
    u.pathname !== "/" ||
    u.search !== "" ||
    u.hash !== "" ||
    !/^https:\/\/[^/?#]+\/?$/i.test(texto)
  )
    throw new UsoErrado(
      "--dominio: só https://<host>, sem porta, caminho, ?, # nem usuário",
    );
  const host = u.hostname.toLowerCase();
  if (!RE_DOMINIO.test(host))
    throw new UsoErrado(
      `--dominio: o host ${host} não passa no CHECK de frota_lojas.dominio_publico`,
    );
  return host;
}

/** O nome do segredo do GitHub da loja: SUPABASE_ACCESS_TOKEN_<SLUG em maiúsculas, - vira _>. */
export const segredoDaLoja = (slug) =>
  `SUPABASE_ACCESS_TOKEN_${slug.toUpperCase().replaceAll("-", "_")}`;

/**
 * Confere o FORMATO da loja pedida e devolve a entrada de lojas.json. A régua do
 * apelido e do segredo é a do validarCadastro de verdade (num cadastro só com
 * ela); o que depende das outras lojas fica para planejarCadastro.
 */
export function lojaPedida({ loja, projeto, nome, dominio, chavePublica }) {
  if (!RE_PROJETO.test(loja ?? ""))
    throw new UsoErrado(`--loja fora do formato ${RE_PROJETO}`);
  if (!RE_REF.test(projeto ?? ""))
    throw new UsoErrado(`--projeto (ref) fora do formato ${RE_REF}`);
  const entrada = {
    ref: projeto,
    classe: "assinante",
    apelido: nome,
    segredoDoToken: segredoDaLoja(loja),
    functionsNomeadas: true,
  };
  // A loja cujo segredo DERIVADO é o nome do segredo da org central (a loja
  // `lojas` → SUPABASE_ACCESS_TOKEN_LOJAS): o passo a passo mandaria o dono
  // gravar o token dela POR CIMA do da org e derrubaria todas as lojas da org.
  const org = carregarOrgCentral();
  // e a loja com o nome da chave do cofre da org leria e gravaria a
  // autorização da org inteira como se fosse a dela
  if (loja === org.chaveDoCofre)
    throw new UsoErrado(
      `--loja ${loja}: é o nome da chave do cofre da org central (scripts/frota/org-central.json); a loja leria e gravaria a autorização da org inteira. Escolha outro nome`,
    );
  const segredoDaOrg = org.segredoDoGitHub;
  if (entrada.segredoDoToken === segredoDaOrg)
    throw new UsoErrado(
      `--loja ${loja}: o segredo dela seria ${segredoDaOrg}, que é o NOME do segredo da org central (scripts/frota/org-central.json); gravar o token desta loja nele derrubaria todas as lojas da org. Escolha outro nome`,
    );
  try {
    validarCadastro({ lojas: { [loja]: entrada } });
  } catch (e) {
    throw new UsoErrado(e.message);
  }
  if (chavePublica !== undefined && !RE_CHAVE_PUBLICA.test(chavePublica))
    throw new UsoErrado(
      "--chave-publica: só a chave pública nova do projeto (sb_publishable_…); nunca a secreta",
    );
  return {
    slug: loja,
    ref: projeto,
    nome,
    dominio:
      dominio === undefined ? `${loja}.vercel.app` : hostDoDominio(dominio),
    chavePublica,
    entrada,
  };
}

// ---------------------------------------------------------------------------
// JSON: inserir um membro no fim de um objeto, sem tocar o resto do texto
// ---------------------------------------------------------------------------

/**
 * Onde abre e fecha o objeto que é o valor de `chave` na RAIZ do JSON (um
 * leitor de JSON mínimo, que entende string com escape). Chave ausente,
 * repetida ou que não é objeto = erro.
 */
function objetoDaRaiz(texto, chave) {
  let profundidade = 0;
  let ultimaString = null;
  let chaveAtual = null;
  let achado = null;
  let abre = -1;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"') {
      let j = i + 1;
      while (j < texto.length && texto[j] !== '"')
        j += texto[j] === "\\" ? 2 : 1;
      if (j >= texto.length) throw new Recusa("string sem fim no JSON");
      ultimaString = JSON.parse(texto.slice(i, j + 1));
      i = j;
    } else if (c === ":" && profundidade === 1) {
      chaveAtual = ultimaString;
    } else if (c === "," && profundidade === 1) {
      chaveAtual = null;
    } else if (c === "{" || c === "[") {
      if (profundidade === 1 && chaveAtual === chave) {
        if (abre >= 0 || c !== "{")
          throw new Recusa(`o objeto "${chave}" aparece torto ou repetido`);
        abre = i;
      }
      profundidade++;
    } else if (c === "}" || c === "]") {
      profundidade--;
      if (profundidade === 1 && abre >= 0 && achado === null)
        achado = { abre, fecha: i };
    }
  }
  if (!achado) throw new Recusa(`não achei o objeto "${chave}" na raiz`);
  return achado;
}

/** Um valor JSON no estilo do biome: objeto sempre aberto; lista numa linha se couber. */
function emJson(valor, recuo, larguraAntes, eol) {
  if (Array.isArray(valor)) {
    const itens = valor.map((x) => JSON.stringify(x));
    const numaLinha = `[${itens.join(", ")}]`;
    // + 1: a vírgula que segue o valor
    if (larguraAntes + numaLinha.length + 1 <= LARGURA) return numaLinha;
    const dentro = `${recuo}  `;
    return `[${eol}${itens.map((x) => dentro + x).join(`,${eol}`)}${eol}${recuo}]`;
  }
  if (valor !== null && typeof valor === "object") {
    const dentro = `${recuo}  `;
    const membros = Object.entries(valor).map(([k, v]) => {
      const cabeca = `${dentro}${JSON.stringify(k)}: `;
      return cabeca + emJson(v, dentro, cabeca.length, eol);
    });
    return `{${eol}${membros.join(`,${eol}`)}${eol}${recuo}}`;
  }
  return JSON.stringify(valor);
}

/** O texto com `"chave": valor` acrescentado no fim do objeto `raiz`. */
export function inserirMembro(texto, raiz, chave, valor) {
  const eol = texto.includes("\r\n") ? "\r\n" : "\n";
  const { abre, fecha } = objetoDaRaiz(texto, raiz);
  const inicioDaLinha = texto.lastIndexOf("\n", fecha) + 1;
  const recuoDoFecha = /^[ \t]*/.exec(texto.slice(inicioDaLinha, fecha))[0];
  const recuo = `${recuoDoFecha}  `;
  const cabeca = `${recuo}${JSON.stringify(chave)}: `;
  const membro = cabeca + emJson(valor, recuo, cabeca.length, eol);
  let fim = fecha - 1;
  while (/\s/.test(texto[fim])) fim--;
  if (fim === abre)
    // objeto vazio: o membro entra sozinho
    return `${texto.slice(0, abre + 1)}${eol}${membro}${eol}${recuoDoFecha}${texto.slice(fecha)}`;
  return `${texto.slice(0, fim + 1)},${eol}${membro}${texto.slice(fim + 1)}`;
}

// ---------------------------------------------------------------------------
// O plano: tudo calculado e conferido antes da primeira escrita
// ---------------------------------------------------------------------------

const mesmoJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function lerTexto(raiz, rel) {
  return fs.readFileSync(path.join(raiz, rel), "utf8");
}

function lerJson(texto, rel) {
  try {
    return JSON.parse(texto);
  } catch {
    throw new Recusa(`${rel} não é JSON`);
  }
}

function validado(bruto, quando) {
  try {
    return validarCadastro(bruto);
  } catch (e) {
    throw new Recusa(`${quando}: ${e.message}`);
  }
}

/** A lista de functionsPublicaveis das assinantes de hoje (todas iguais, ou recusa). */
function functionsDasAssinantes(canais, cadastro, refNovo) {
  const listas = [];
  for (const [ref, c] of Object.entries(canais)) {
    if (ref === refNovo) continue;
    const l = lojaDoProjeto(c.functions, cadastro);
    if (l?.classe === "assinante" && l.functionsNomeadas === true)
      listas.push([l.projeto, c.functionsPublicaveis]);
  }
  if (listas.length === 0)
    throw new Recusa(
      "nenhuma loja assinante com functionsNomeadas tem canal para servir de modelo",
    );
  const [, modelo] = listas[0];
  const divergentes = listas.filter(([, x]) => !mesmoJson(x, modelo));
  if (!Array.isArray(modelo) || divergentes.length > 0)
    throw new Recusa(
      `as lojas assinantes não têm a mesma lista de functionsPublicaveis (${listas.map(([p]) => p).join(", ")}): qual vale para a loja nova é decisão, não cópia`,
    );
  return [...modelo];
}

/**
 * Devolve { mudancas: [{rel, antes, depois}], pedido } — mudancas na ordem de
 * gravação (lojas.json, workflows, canais). Vazio = a loja já está cadastrada
 * igual em todos os lugares. Lança Recusa sem ter gravado nada.
 */
export function planejarCadastro(pedido, raiz = RAIZ) {
  const { slug, ref, nome, entrada } = pedido;
  const dirWorkflows =
    raiz === RAIZ ? DIR_WORKFLOWS : path.join(raiz, ".github", "workflows");

  // 1. lojas.json
  const lojasTexto = lerTexto(raiz, REL_LOJAS);
  const lojasBruto = lerJson(lojasTexto, REL_LOJAS);
  validado(lojasBruto, "o lojas.json de hoje já é inválido");
  const lojas = lojasBruto.lojas;
  let lojasDepois = lojasTexto;
  if (Object.hasOwn(lojas, slug)) {
    const existente = lojas[slug];
    if (existente?.ref !== ref)
      throw new Recusa(
        `a loja ${slug} já está cadastrada com outro ref (${existente?.ref}); um slug, um banco`,
      );
    if (!mesmoJson(existente, entrada))
      throw new Recusa(
        `a loja ${slug} já está cadastrada com campos diferentes (${JSON.stringify(existente)}); este comando não altera loja existente`,
      );
  } else {
    const doRef = Object.keys(lojas).filter((p) => lojas[p]?.ref === ref);
    if (doRef.length > 0)
      throw new Recusa(
        `o ref ${ref} já é da loja ${doRef.join(" e ")} (um banco, uma loja)`,
      );
    const doSegredo = Object.keys(lojas).filter(
      (p) => lojas[p]?.segredoDoToken === entrada.segredoDoToken,
    );
    if (doSegredo.length > 0)
      throw new Recusa(
        `o segredo ${entrada.segredoDoToken} já é da loja ${doSegredo.join(" e ")} (um segredo por loja): escolha outro slug`,
      );
    lojasDepois = inserirMembro(lojasTexto, "lojas", slug, entrada);
  }
  const lojasNovo = lerJson(lojasDepois, REL_LOJAS);
  const cadNovo = validado(lojasNovo, "o lojas.json com a loja nova");
  const semANova = { ...lojasNovo, lojas: { ...lojasNovo.lojas } };
  delete semANova.lojas[slug];
  const cadAntes = validado(semANova, "o lojas.json sem a loja nova");
  // o que foi inserido é exatamente a entrada, e o resto continua igual
  if (
    !mesmoJson(lojasNovo.lojas[slug], entrada) ||
    !mesmoJson(semANova, { ...lojasBruto, lojas: omitir(lojas, slug) }) ||
    Object.keys(lojasNovo.lojas).at(-1) !==
      (Object.hasOwn(lojas, slug) ? Object.keys(lojas).at(-1) : slug)
  )
    throw new Recusa("a inserção em lojas.json não saiu como planejada");

  // 2. canais-de-backend.json
  const canaisTexto = lerTexto(raiz, REL_CANAIS);
  const canaisBruto = lerJson(canaisTexto, REL_CANAIS);
  const canais = canaisBruto.canais ?? {};
  const outrosDaLoja = Object.entries(canais).filter(
    ([r, c]) => r !== ref && (c?.migrations === slug || c?.functions === slug),
  );
  if (outrosDaLoja.length > 0)
    throw new Recusa(
      `a loja ${slug} já é alvo do canal ${outrosDaLoja.map(([r]) => r).join(" e ")}`,
    );
  const canal = {
    nome,
    migrations: slug,
    functions: slug,
    projetosNoMesmoBanco: [],
    functionsPublicaveis: functionsDasAssinantes(canais, cadAntes, ref),
  };
  let canaisDepois = canaisTexto;
  if (Object.hasOwn(canais, ref)) {
    if (!mesmoJson(canais[ref], canal))
      throw new Recusa(
        `o canal ${ref} já existe com outro conteúdo (${canais[ref]?.nome}); este comando não altera canal existente`,
      );
  } else {
    canaisDepois = inserirMembro(canaisTexto, "canais", ref, canal);
    const novo = lerJson(canaisDepois, REL_CANAIS);
    if (
      !mesmoJson(novo.canais[ref], canal) ||
      !mesmoJson(
        { ...novo, canais: omitir(novo.canais, ref) },
        { ...canaisBruto, canais },
      )
    )
      throw new Recusa(
        "a inserção em canais-de-backend.json não saiu como planejada",
      );
  }
  // a concordância dos dois cadastros (tests/frota_lojas_test.ts), já com a nova
  for (const [r, c] of Object.entries(lerJson(canaisDepois, REL_CANAIS).canais))
    for (const alvo of [c.migrations, c.functions]) {
      const l = lojaDoProjeto(alvo, cadNovo);
      if (l?.classe !== "assinante" || l.ref !== r || l.refDasFunctions !== r)
        throw new Recusa(
          `o canal ${r} aponta para ${alvo}, que não é a loja assinante desse ref no lojas.json`,
        );
    }

  // 3. workflows, pelo gerador
  const workflows = [];
  for (const arquivo of workflowsComBlocos(dirWorkflows)) {
    const antes = fs.readFileSync(arquivo, "utf8");
    if (
      sincronizar(antes, cadAntes) !== antes &&
      sincronizar(antes, cadNovo) !== antes
    )
      throw new Recusa(
        `${path.basename(arquivo)} já está fora de sincronia com o lojas.json: o diff não seria só da loja nova (rode node scripts/frota/lojas-nos-workflows.cjs --conferir e resolva antes)`,
      );
    const depois = sincronizar(antes, cadNovo);
    if (depois !== antes)
      workflows.push({
        rel: path.relative(raiz, arquivo).split(path.sep).join("/"),
        antes,
        depois,
      });
  }

  const mudancas = [
    { rel: REL_LOJAS, antes: lojasTexto, depois: lojasDepois },
    ...workflows,
    { rel: REL_CANAIS, antes: canaisTexto, depois: canaisDepois },
  ].filter((m) => m.antes !== m.depois);
  return { mudancas, pedido };
}

function omitir(objeto, chave) {
  const copia = { ...objeto };
  delete copia[chave];
  return copia;
}

/** Grava cada arquivo inteiro (temporário + rename), na ordem do plano. */
export function gravar(mudancas, raiz = RAIZ) {
  const gravados = [];
  for (const m of mudancas) {
    const destino = path.join(raiz, m.rel);
    const temporario = `${destino}.cadastro-${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporario, m.depois);
      fs.renameSync(temporario, destino);
    } catch (e) {
      fs.rmSync(temporario, { force: true });
      throw new Error(
        `falhou ao gravar ${m.rel} (${e.message}); já gravados: ${gravados.join(", ") || "nenhum"}. Rodar de novo completa o que falta.`,
      );
    }
    gravados.push(m.rel);
  }
  return gravados;
}

// ---------------------------------------------------------------------------
// Saída: diff por linhas e o SQL da caderneta
// ---------------------------------------------------------------------------

/** Diff de linhas (prefixo/sufixo comuns + LCS no miolo), em trechos com 2 linhas de contexto. */
export function diffDeLinhas(antes, depois) {
  const a = antes.split(/\r?\n/);
  const b = depois.split(/\r?\n/);
  let ini = 0;
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++;
  let fa = a.length;
  let fb = b.length;
  while (fa > ini && fb > ini && a[fa - 1] === b[fb - 1]) {
    fa--;
    fb--;
  }
  const ma = a.slice(ini, fa);
  const mb = b.slice(ini, fb);
  const ops = a.slice(0, ini).map((l) => [" ", l]);
  if (ma.length * mb.length > 4_000_000) {
    for (const l of ma) ops.push(["-", l]);
    for (const l of mb) ops.push(["+", l]);
  } else {
    const lcs = Array.from({ length: ma.length + 1 }, () =>
      new Array(mb.length + 1).fill(0),
    );
    for (let i = ma.length - 1; i >= 0; i--)
      for (let j = mb.length - 1; j >= 0; j--)
        lcs[i][j] =
          ma[i] === mb[j]
            ? lcs[i + 1][j + 1] + 1
            : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < ma.length || j < mb.length) {
      if (i < ma.length && j < mb.length && ma[i] === mb[j]) {
        ops.push([" ", ma[i++]]);
        j++;
      } else if (
        i < ma.length &&
        (j === mb.length || lcs[i + 1][j] >= lcs[i][j + 1])
      )
        ops.push(["-", ma[i++]]);
      else ops.push(["+", mb[j++]]);
    }
  }
  for (const l of a.slice(fa)) ops.push([" ", l]);
  // trechos: cada mudança com 2 linhas de contexto; trechos próximos se juntam
  const CONTEXTO = 2;
  const mudou = ops.map(([s]) => s !== " ");
  const linhas = [];
  let k = 0;
  while (k < ops.length) {
    if (!mudou[k]) {
      k++;
      continue;
    }
    let inicio = Math.max(0, k - CONTEXTO);
    let fim = k;
    while (fim < ops.length) {
      let prox = fim + 1;
      while (prox < ops.length && !mudou[prox]) prox++;
      if (prox < ops.length && prox - fim <= 2 * CONTEXTO + 1) fim = prox;
      else break;
    }
    const ate = Math.min(ops.length, fim + CONTEXTO + 1);
    const linhaAntes =
      ops.slice(0, inicio).filter(([s]) => s !== "+").length + 1;
    linhas.push(`@@ linha ${linhaAntes} @@`);
    for (; inicio < ate; inicio++)
      linhas.push(`${ops[inicio][0]}${ops[inicio][1]}`);
    k = ate;
  }
  return linhas;
}

const literal = (s) => `'${String(s).replaceAll("'", "''")}'`;

/** O SQL da linha da loja em public.frota_lojas (a caderneta). Só texto: nunca executado aqui. */
export function sqlDaCaderneta({ slug, nome, dominio, ref, chavePublica }) {
  const valores = [
    slug,
    nome,
    dominio,
    ref,
    `https://${ref}.supabase.co`,
    chavePublica,
  ].map(literal);
  const insert = [
    "INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key, ativa)",
    `VALUES (${valores.join(", ")}, true)`,
    "ON CONFLICT (id) DO NOTHING;",
  ].join("\n");
  const conferir = `SELECT id, nome, dominio_publico, project_ref, supabase_url, estado FROM public.frota_lojas WHERE id = ${literal(slug)} OR project_ref = ${literal(ref)} OR dominio_publico = ${literal(dominio)};`;
  return { insert, conferir };
}

function textoDoSql(pedido) {
  if (pedido.chavePublica === undefined)
    return [
      "",
      "SQL da caderneta (public.frota_lojas): PENDENTE — falta --chave-publica (a chave pública sb_publishable_… do projeto da loja, coluna publishable_key NOT NULL). Rode de novo com ela para imprimir o INSERT.",
    ];
  const { insert, conferir } = sqlDaCaderneta(pedido);
  return [
    "",
    "SQL da caderneta (public.frota_lojas, no banco da caderneta, pelo MCP; este comando NÃO o executa).",
    "Nasce estado = ativa (o padrão; o gatilho recusa outro estado no INSERT). Uma instrução só:",
    "",
    insert,
    "",
    "Conferência depois (só leitura; esperado: UMA linha, com estes valores e estado ativa; outra linha = id, ref ou domínio já usados por outra loja, PARE):",
    "",
    conferir,
  ];
}

const USO = [
  "Uso:",
  '  node scripts/frota/cadastro-da-loja.mjs --loja <slug> --projeto <ref> --nome "<apelido>"',
  "       [--dominio https://<host>] [--chave-publica sb_publishable_...] [--aplicar]",
].join("\n");

/** Roda o comando. Devolve { codigo, saida[], erros[] }; nunca chama process.exit. */
export function executar(argv, raiz = RAIZ) {
  const saida = [];
  let args;
  let pedido;
  try {
    args = lerArgumentos(argv);
    pedido = lojaPedida({
      loja: args.loja,
      projeto: args.projeto,
      nome: args.nome,
      dominio: args.dominio,
      chavePublica: args["chave-publica"],
    });
  } catch (e) {
    if (e instanceof UsoErrado)
      return { codigo: 2, saida, erros: [`USO ERRADO: ${e.message}`, USO] };
    throw e;
  }
  let plano;
  try {
    plano = planejarCadastro(pedido, raiz);
  } catch (e) {
    if (e instanceof Recusa)
      return {
        codigo: 1,
        saida,
        erros: [`RECUSADO: ${e.message}. Nada foi gravado.`],
      };
    throw e;
  }
  saida.push(
    `cadastro-da-loja: ${pedido.slug} (ref ${pedido.ref}, "${pedido.nome}"), domínio ${pedido.dominio}, segredo ${pedido.entrada.segredoDoToken}, functionsNomeadas true`,
  );
  if (plano.mudancas.length === 0) {
    saida.push(
      `nada a fazer: a loja ${pedido.slug} já está cadastrada igual em lojas.json, canais-de-backend.json e nos workflows.`,
    );
  } else {
    for (const m of plano.mudancas)
      saida.push(
        "",
        `--- ${m.rel}`,
        `+++ ${m.rel}`,
        ...diffDeLinhas(m.antes, m.depois),
      );
    saida.push("");
    if (args.aplicar) {
      for (const rel of gravar(plano.mudancas, raiz))
        saida.push(`gravado: ${rel}`);
    } else {
      saida.push(
        `ENSAIO: nada foi gravado (${plano.mudancas.length} arquivo(s) mudariam). Para gravar, o mesmo comando com --aplicar.`,
      );
    }
  }
  saida.push(...textoDoSql(pedido));
  saida.push(
    "",
    `Depois: o dono cria no GitHub o segredo com o NOME ${pedido.entrada.segredoDoToken} (o valor nunca passa por aqui); PR com revisão Opus (mexe em credencial e no portão de publicação).`,
  );
  return { codigo: 0, saida, erros: [] };
}

export function main(argv = process.argv.slice(2)) {
  let r;
  try {
    r = executar(argv);
  } catch (e) {
    console.error(`RECUSADO: erro inesperado: ${e?.message ?? e}`);
    return 1;
  }
  for (const l of r.erros) console.error(l);
  for (const l of r.saida) console.log(l);
  return r.codigo;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = main();
}
