/* eslint-disable security/detect-object-injection -- as chaves vêm de lojas.json, canais-de-backend.json e config.toml versionados (lidos no commit), de --canal/--projeto já validados por regex e de mapas montados aqui; nenhuma vem de rede. */
/**
 * functions-da-loja.mjs — publica as edge functions de uma loja NOVA pela
 * Management API do Supabase (plano nova-loja, B2, lacuna L1, 26/11/2026).
 * Sem isto nenhuma function chega à loja nova, e sem elas não funcionam o
 * checkout, o PIX, o webhook do Mercado Pago, a reconciliação nem os e-mails.
 *
 *   node scripts/frota/functions-da-loja.mjs --projeto <ref> --canal <loja> [--aplicar [--substituir]]
 *
 * O QUE PUBLICA: exatamente as `functionsPublicaveis` do canal da loja em
 * scripts/frota/canais-de-backend.json, cada uma com o `verify_jwt` do
 * supabase/config.toml — a MESMA fonte do publicar-functions.yml (ali o CLI lê
 * o config.toml e o workflow nunca passa --no-verify-jwt), lida pelo MESMO
 * leitor do portão da release (verifyJwtDoConfig). Os arquivos de cada function
 * são o index.ts e tudo o que ele importa por caminho relativo, transitivo
 * (_shared incluído), pelo MESMO `arquivosEsperados` com que o portão compara o
 * que está no ar; o nome de cada arquivo é o caminho relativo ao projeto
 * ("supabase/functions/_shared/x.ts"), como o `supabase functions deploy
 * --use-api` monta.
 *
 * DE ONDE VEM O CÓDIGO: só do commit APROVADO, o topo de
 * origin/<canais.ramoDaRelease> (o mesmo expected_sha que o portão da release
 * imprime para os workflows), e só se o HEAD local for esse commit. Branch de
 * trabalho, commit não aprovado ou topo ilegível = NÃO antes de qualquer pedido
 * ao Supabase. Tudo é lido do commit (impresso), nunca da árvore de trabalho.
 *
 * SÓ LOJA NOVA: as lojas que já existiam (canais-de-backend.json
 * `functionsSoPeloWorkflow`, nomes do lojas.json) publicam só pelo
 * publicar-functions.yml; este script recusa qualquer uma delas.
 *
 * RECUSA ANTES DE QUALQUER ESCRITA (veredito NÃO) quando as fontes divergem:
 *  - o canal (`--canal`, a chave da loja em lojas.json) não é assinante, não
 *    tem entrada em canais-de-backend.json, ou o ref dele não é o `--projeto`;
 *  - a lista do canal difere do que o workflow aceita para aquela loja (as
 *    cinco financeiras, mais as oito nomeadas se `functionsNomeadas`);
 *  - o workflow passa --no-verify-jwt (o config.toml deixaria de ser a fonte);
 *  - uma publicável não tem verify_jwt explícito no config.toml (nada de
 *    padrão adivinhado: na loja nova não há valor antigo para preservar);
 *  - uma publicável é proibida (PROIBIDAS ou funcoesNaoPublicadas), ou um
 *    arquivo importado não existe no commit.
 *
 * ORDEM: lê o status do projeto (deploy só em ACTIVE_HEALTHY) e a lista de
 * functions; publica UMA por vez e confere cada uma pelo GET /functions (slug
 * presente, ACTIVE, verify_jwt certo) antes da próxima. Uma falha PARA tudo.
 *
 * O QUE JÁ EXISTE: function já no ar, ACTIVE, com o mesmo verify_jwt E o
 * mesmo código do commit é PULADA (rodar duas vezes não republica). O código
 * no ar se compara pelo critério do portão da release (classificarFuncao, o
 * download por `deps.baixarFuncao`); código diferente é REPUBLICADO sem
 * precisar de --substituir (ATUALIZAR, provado pela versão que sobe), e código
 * que não deu para ler nunca é dado como igual: com --aplicar republica, no
 * ensaio é INCERTO (lote 566). Já no ar com verify_jwt diferente
 * ou fora de ACTIVE = conflito, recusa sem escrever nada. `--substituir`
 * (só com `--aplicar`) republica as que já existem, e a republicação só conta
 * quando a `version` no ar passou da de antes (prova de que o código novo
 * entrou). Erro de deploy 5xx ou de rede = a publicação PODE ter acontecido.
 *
 * VEREDITO: SIM (todas no ar, ACTIVE, verify_jwt certo, nada incerto), NÃO
 * (alguma falta ou está errada, com certeza) ou INCERTO (o estado não foi lido,
 * ou uma publicação pode ter acontecido sem confirmação). INCERTO nunca vira
 * SIM. Código de saída: SIM 0, NÃO 1, uso errado 2, INCERTO 3. Sem `--aplicar`
 * é ensaio: imprime o plano (nome e verify_jwt de cada uma), só LÊ a API, e o
 * veredito descreve o estado atual da loja.
 *
 * TOKEN: o access token OAuth da ORG central (modelo de 01/12/2026: a
 * lojista não tem conta no Supabase), renovado pelo acesso-oauth.mjs a partir
 * do cofre DPAPI (a chave do cofre é a `chaveDoCofre` de org-central.json,
 * nunca o nome da loja), a mesma fonte do resto do nova-loja, UMA renovação por
 * execução (tokenComCache: guardado até expiraEm menos a margem). Ele só vive dentro do
 * cliente da gestão e nunca é impresso: as mensagens de erro do cliente não o
 * carregam, e erro de outro tipo sai só pelo nome.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  arquivosEsperados,
  baixadorDeFuncaoPeloCli,
  classificarFuncao,
  verifyJwtDoConfig,
} from "./publicar-release.mjs";
import {
  ESTADO_DESCONHECIDO,
  ErroDaGestao,
  criarClienteGestao,
} from "./supabase-gestao.mjs";

const require = createRequire(import.meta.url);
const { RE_PROJETO, RE_REF, validarCadastro } = require("./lojas.cjs");

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..");

export const CAMINHO_CANAIS = "scripts/frota/canais-de-backend.json";
export const CAMINHO_LOJAS = "scripts/frota/lojas.json";
export const CAMINHO_CONFIG = "supabase/config.toml";
export const CAMINHO_WORKFLOW = ".github/workflows/publicar-functions.yml";

/** Nunca publicadas, aconteça o que acontecer nas outras fontes. A
 * send-order-whatsapp foi despublicada em 11/08/2026 (README dela). */
export const PROIBIDAS = Object.freeze(["send-order-whatsapp"]);

/** Quantas leituras do GET /functions conferem uma function recém-publicada. */
export const TENTATIVAS_DE_CONFERIR = 3;
const ESPERA_ENTRE_CONFERENCIAS_MS = 2000;

const RE_NOME_FUNCAO = /^[a-z][a-z0-9-]{0,62}$/;

export const VEREDITOS = Object.freeze({
  SIM: "SIM",
  NAO: "NAO",
  INCERTO: "INCERTO",
});
const CODIGO_DO_VEREDITO = { SIM: 0, NAO: 1, INCERTO: 3 };

class UsoErrado extends Error {}
class Recusa extends Error {}

// ------------------------------------------------------------------ argumentos

/** Lê e valida a FORMA dos argumentos. Erro aqui é uso errado (saída 2). */
export function lerArgumentos(argv) {
  const v = { aplicar: false, substituir: false };
  const vistos = new Set();
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (vistos.has(x)) throw new UsoErrado(`${x} repetido`);
    vistos.add(x);
    if (x === "--aplicar") v.aplicar = true;
    else if (x === "--substituir") v.substituir = true;
    else if (x === "--projeto" || x === "--canal") {
      const valor = argv[++i];
      if (valor === undefined || valor.startsWith("--"))
        throw new UsoErrado(`${x} exige um valor`);
      v[x.slice(2)] = valor;
    } else throw new UsoErrado(`argumento desconhecido: ${x}`);
  }
  if (v.projeto === undefined)
    throw new UsoErrado("--projeto <ref> é obrigatório");
  if (v.canal === undefined)
    throw new UsoErrado("--canal <loja> é obrigatório");
  if (!RE_REF.test(v.projeto))
    throw new UsoErrado(
      "--projeto: 20 letras minúsculas (o project_ref do Supabase da loja)",
    );
  if (!RE_PROJETO.test(v.canal))
    throw new UsoErrado(
      "--canal: a chave da loja em scripts/frota/lojas.json (minúsculas, dígitos e hífen)",
    );
  if (v.substituir && !v.aplicar)
    throw new UsoErrado("--substituir só vale junto com --aplicar");
  return v;
}

// ------------------------------------------------------------------ fontes

function exigirTexto(ler, caminho) {
  const t = ler(caminho);
  if (typeof t !== "string" || t === "")
    throw new Recusa(`${caminho} não foi lido no commit`);
  return t;
}

function exigirJson(ler, caminho) {
  try {
    return JSON.parse(exigirTexto(ler, caminho));
  } catch (e) {
    if (e instanceof Recusa) throw e;
    throw new Recusa(`${caminho} não é JSON válido`);
  }
}

/** O workflow sem as linhas de comentário (o cabeçalho CITA --no-verify-jwt). */
function semComentarios(yaml) {
  return yaml
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

/**
 * O que publicar-functions.yml aceita para uma loja ASSINANTE: o `case` que
 * vem logo depois de `if [ "$CLIENTE" = "sim" ]`, primeiro ramo as cinco
 * financeiras, segundo as nomeadas (que só valem com functionsNomeadas). Se o
 * bloco não tiver exatamente essa forma, recusa: lista lida pela metade é pior
 * que lista nenhuma.
 */
export function aceitasPeloWorkflow(yaml) {
  const texto = semComentarios(yaml);
  const m =
    /if \[ "\$CLIENTE" = "sim" \]; then[ \t]*\r?\n[ \t]*case "\$n" in[ \t]*\r?\n[ \t]*([a-z0-9|-]+)\)[ \t]*;;[ \t]*\r?\n[ \t]*([a-z0-9|-]+)\)[ \t]*\r?\n/.exec(
      texto,
    );
  if (!m)
    throw new Recusa(
      `${CAMINHO_WORKFLOW}: não achei o case das lojas assinantes na forma esperada (financeiras; nomeadas)`,
    );
  const lista = (g) => g.split("|").filter(Boolean);
  return {
    financeiras: lista(m[1]),
    nomeadas: lista(m[2]),
    passaNoVerifyJwt: /--no-verify-jwt/.test(texto),
  };
}

function mesmoConjunto(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

/**
 * Monta o plano a partir do repositório (`ler(caminho)` devolve o texto do
 * arquivo no commit, ou null). Puro: nenhuma rede. Lança Recusa em qualquer
 * divergência entre as fontes.
 *
 * @returns {{ nome: string, verifyJwt: boolean, entrypoint: string,
 *   arquivos: { caminho: string, conteudo: string }[] }[]}
 */
export function montarPlano({ projeto, canal }, ler) {
  let cadastro;
  try {
    cadastro = validarCadastro(exigirJson(ler, CAMINHO_LOJAS));
  } catch (e) {
    if (e instanceof Recusa) throw e;
    throw new Recusa(`${CAMINHO_LOJAS} inválido (${e?.message ?? "erro"})`);
  }
  const loja = Object.hasOwn(cadastro.lojas, canal)
    ? cadastro.lojas[canal]
    : null;
  if (!loja) throw new Recusa(`a loja ${canal} não está em ${CAMINHO_LOJAS}`);
  if (loja.classe !== "assinante")
    throw new Recusa(`a loja ${canal} não é assinante (classe ${loja.classe})`);
  if (loja.refDasFunctions !== projeto)
    throw new Recusa(
      `a loja ${canal} publica functions em ${loja.refDasFunctions}, não em ${projeto} (fontes divergem)`,
    );

  const canais = exigirJson(ler, CAMINHO_CANAIS);
  // Loja que já existia publica só pelo workflow (expected_sha do run): a
  // lista explícita mora nos canais, e cada nome dela tem de ser uma loja do
  // cadastro — lista ausente ou torta recusa (falha fechada).
  const existentes = canais?.functionsSoPeloWorkflow;
  if (
    !Array.isArray(existentes) ||
    existentes.length === 0 ||
    !existentes.every(
      (n) => typeof n === "string" && Object.hasOwn(cadastro.lojas, n),
    )
  )
    throw new Recusa(
      `${CAMINHO_CANAIS}: functionsSoPeloWorkflow ausente, vazia ou com loja fora de ${CAMINHO_LOJAS}`,
    );
  if (existentes.includes(canal))
    throw new Recusa(
      `a loja ${canal} já existe: as functions dela sobem só pelo ${CAMINHO_WORKFLOW} (expected_sha do run aprovado), nunca por este script de loja nova`,
    );
  const entrada =
    canais?.canais && Object.hasOwn(canais.canais, projeto)
      ? canais.canais[projeto]
      : null;
  if (!entrada)
    throw new Recusa(
      `${projeto} não tem canal em ${CAMINHO_CANAIS} (o cadastro da loja vem antes)`,
    );
  if (entrada.functions !== canal)
    throw new Recusa(
      `o canal de ${projeto} em ${CAMINHO_CANAIS} publica por "${entrada.functions}", não por "${canal}" (fontes divergem)`,
    );
  const publicaveis = entrada.functionsPublicaveis;
  if (
    !Array.isArray(publicaveis) ||
    publicaveis.length === 0 ||
    !publicaveis.every(
      (n) => typeof n === "string" && RE_NOME_FUNCAO.test(n),
    ) ||
    new Set(publicaveis).size !== publicaveis.length
  )
    throw new Recusa(
      `functionsPublicaveis de ${projeto} vazia, repetida ou com nome inválido`,
    );
  const naoPublicadas = Array.isArray(canais.funcoesNaoPublicadas)
    ? canais.funcoesNaoPublicadas
    : [];
  const proibidas = publicaveis.filter(
    (n) => PROIBIDAS.includes(n) || naoPublicadas.includes(n),
  );
  if (proibidas.length)
    throw new Recusa(
      `o canal lista function proibida: ${proibidas.join(", ")} — nunca se publica`,
    );

  const wf = aceitasPeloWorkflow(exigirTexto(ler, CAMINHO_WORKFLOW));
  if (wf.passaNoVerifyJwt)
    throw new Recusa(
      `${CAMINHO_WORKFLOW} passa --no-verify-jwt: o config.toml deixou de ser a fonte do verify_jwt (fontes divergem)`,
    );
  const aceitas = [
    ...wf.financeiras,
    ...(loja.functionsNomeadas ? wf.nomeadas : []),
  ];
  if (!mesmoConjunto(aceitas, publicaveis)) {
    const soCanal = publicaveis.filter((n) => !aceitas.includes(n));
    const soWf = aceitas.filter((n) => !publicaveis.includes(n));
    throw new Recusa(
      `canal e workflow divergem para ${canal}: só no canal [${soCanal.join(", ")}], só no workflow [${soWf.join(", ")}]`,
    );
  }

  const verifyJwt = verifyJwtDoConfig(exigirTexto(ler, CAMINHO_CONFIG));
  const plano = [];
  for (const nome of publicaveis) {
    if (!Object.hasOwn(verifyJwt, nome))
      throw new Recusa(
        `${nome} sem verify_jwt explícito em ${CAMINHO_CONFIG} (a loja nova não tem valor antigo para preservar)`,
      );
    const mapa = arquivosEsperados(nome, (c) => {
      const t = ler(c);
      return typeof t === "string" ? t : null;
    });
    const faltam = [...mapa].filter(([, v]) => v === null).map(([c]) => c);
    if (faltam.length)
      throw new Recusa(
        `${nome}: arquivo importado não existe no commit: ${faltam.join(", ")}`,
      );
    const entrypoint = `supabase/functions/${nome}/index.ts`;
    plano.push({
      nome,
      verifyJwt: verifyJwt[nome],
      entrypoint,
      arquivos: [...mapa].map(([caminho, conteudo]) => ({
        caminho,
        conteudo,
      })),
    });
  }
  return plano;
}

// ------------------------------------------------------------------ rede

/** Mensagem segura de um erro: a do cliente da gestão (sem token por
 * contrato), ou só o nome do erro. */
function mensagemSegura(e) {
  if (e instanceof ErroDaGestao) return e.message;
  const nome = e?.name;
  return typeof nome === "string" && /^[A-Za-z]{1,40}$/.test(nome)
    ? `erro ${nome}`
    : "erro";
}

/** GET /functions como Map slug → { status, verify_jwt, version }. */
async function listarNoAr(cliente, ref) {
  const lista = await cliente.pedir("funcoes", { ref });
  if (!Array.isArray(lista))
    throw new ErroDaGestao(
      "Gestão Supabase: GET /functions não devolveu uma lista.",
      { codigo: ESTADO_DESCONHECIDO },
    );
  const mapa = new Map();
  for (const f of lista) {
    if (f && typeof f.slug === "string")
      mapa.set(f.slug, {
        status: f.status,
        verify_jwt: f.verify_jwt,
        version: Number.isSafeInteger(f.version) ? f.version : null,
      });
  }
  return mapa;
}

/**
 * Erro de deploy que NÃO prova que nada foi gravado: prazo/rede (o cliente já
 * devolve ESTADO_DESCONHECIDO) ou 5xx (502/504 do gateway podem chegar depois
 * de o Supabase ter aceitado; 500 pode ter gravado pela metade). 4xx, 401/403
 * e pedido inválido são recusa certa: nada entrou.
 */
function deployIncerto(e) {
  if (e?.codigo === ESTADO_DESCONHECIDO) return true;
  return Number.isInteger(e?.status) && e.status >= 500;
}

function estaCerta(noAr, item) {
  return (
    noAr !== undefined &&
    noAr.status === "ACTIVE" &&
    noAr.verify_jwt === item.verifyJwt
  );
}

/**
 * Confere UMA function recém-publicada: OK, ERRADA (com certeza) ou INCERTA.
 * `versaoAntes` (só na substituição): o código novo só conta como entrado se
 * a versão no ar passou dela — sem isso, um 201 que não trocou nada passaria
 * por "conferida" porque a antiga já estava ACTIVE com o mesmo verify_jwt.
 */
async function conferirUma(cliente, ref, item, esperar, versaoAntes) {
  for (let t = 1; t <= TENTATIVAS_DE_CONFERIR; t++) {
    let mapa;
    try {
      mapa = await listarNoAr(cliente, ref);
    } catch (e) {
      return { estado: "INCERTA", motivo: mensagemSegura(e) };
    }
    const noAr = mapa.get(item.nome);
    if (noAr && noAr.verify_jwt !== item.verifyJwt)
      return {
        estado: "ERRADA",
        motivo: `no ar com verify_jwt=${noAr.verify_jwt}, o certo é ${item.verifyJwt}`,
      };
    const versaoNova =
      versaoAntes === undefined ||
      (noAr?.version !== null &&
        noAr?.version !== undefined &&
        noAr.version > versaoAntes);
    if (estaCerta(noAr, item) && versaoNova) return { estado: "OK" };
    if (t < TENTATIVAS_DE_CONFERIR) await esperar(ESPERA_ENTRE_CONFERENCIAS_MS);
  }
  return {
    estado: "INCERTA",
    motivo:
      versaoAntes === undefined
        ? `não apareceu ACTIVE no GET /functions depois de ${TENTATIVAS_DE_CONFERIR} leituras`
        : `a versão no ar não passou de ${versaoAntes} depois de ${TENTATIVAS_DE_CONFERIR} leituras: o código novo não está provado`,
  };
}

// ------------------------------------------------------------------ commit

const RE_SHA = /^[0-9a-f]{40}$/;
const RE_RAMO = /^[A-Za-z0-9._/-]{1,200}$/;

/**
 * O commit de onde o código sai: o topo de origin/<ramoDaRelease> — o mesmo
 * que o portão da release (publicar-release.mjs, contextoDaRelease/topoDoRamo)
 * usa como expected_sha dos workflows — e SÓ se o HEAD local for esse commit.
 * Branch de trabalho, commit não aprovado ou topo ilegível = Recusa, antes de
 * qualquer pedido ao Supabase. O ramo vem do canais-de-backend.json do HEAD;
 * com HEAD == topo, é o mesmo arquivo do commit aprovado.
 *
 * git: { head(): Promise<sha>, topoDoRamo(ramo): Promise<sha>, ler(sha, caminho) }
 */
async function commitAprovado(git) {
  let head;
  try {
    head = String(await git.head()).trim();
  } catch (e) {
    throw new Recusa(`HEAD local não lido (${mensagemSegura(e)})`);
  }
  if (!RE_SHA.test(head)) throw new Recusa("HEAD local não lido");
  const ramo = exigirJson(
    (c) => git.ler(head, c),
    CAMINHO_CANAIS,
  )?.ramoDaRelease;
  if (typeof ramo !== "string" || !RE_RAMO.test(ramo))
    throw new Recusa(`${CAMINHO_CANAIS}: ramoDaRelease ausente ou inválido`);
  let topo;
  try {
    topo = String(await git.topoDoRamo(ramo)).trim();
  } catch (e) {
    throw new Recusa(
      `topo de origin/${ramo} não lido (${mensagemSegura(e)}): sem commit aprovado, nada se publica`,
    );
  }
  if (!RE_SHA.test(topo)) throw new Recusa(`topo de origin/${ramo} não lido`);
  if (head !== topo)
    throw new Recusa(
      `o HEAD local (${head}) não é o topo de origin/${ramo} (${topo}): só o commit aprovado da release publica. Faça checkout de ${topo} e rode de novo.`,
    );
  return topo;
}

// ------------------------------------------------------------------ execução

/**
 * @param {string[]} argv
 * @param {{
 *   ler: (caminho: string) => string | null,
 *   sha?: string,
 *   cliente?: ReturnType<typeof criarClienteGestao>,
 *   criarCliente?: (canal: string) => ReturnType<typeof criarClienteGestao>,
 *   esperar?: (ms: number) => Promise<void>,
 * }} deps
 * @returns {Promise<{ codigo: number, veredito: string | null,
 *   saida: string[], erros: string[] }>}
 */
export async function executar(argv, deps) {
  const saida = [];
  const erros = [];
  const fim = (veredito, motivo) => {
    const rotulo = veredito === VEREDITOS.NAO ? "NÃO" : veredito;
    saida.push(`VEREDITO: ${rotulo} — ${motivo}`);
    return { codigo: CODIGO_DO_VEREDITO[veredito], veredito, saida, erros };
  };

  let args;
  try {
    args = lerArgumentos(argv);
  } catch (e) {
    if (!(e instanceof UsoErrado)) throw e;
    erros.push(`uso errado: ${e.message}`);
    erros.push(
      "uso: node scripts/frota/functions-da-loja.mjs --projeto <ref> --canal <loja> [--aplicar [--substituir]]",
    );
    return { codigo: 2, veredito: null, saida, erros };
  }
  const { projeto: ref, canal, aplicar, substituir } = args;
  const modo = aplicar ? "APLICAR" : "ENSAIO (nada é gravado)";
  saida.push(`functions da loja ${canal} (${ref}) — ${modo}`);

  let plano;
  try {
    const topo = await commitAprovado(deps.git);
    saida.push(`fonte: commit ${topo} (o topo do ramo da release)`);
    plano = montarPlano({ projeto: ref, canal }, (c) => deps.git.ler(topo, c));
  } catch (e) {
    if (!(e instanceof Recusa)) throw e;
    erros.push(`RECUSADO: ${e.message}`);
    return fim(VEREDITOS.NAO, "fontes recusadas, nada publicado");
  }
  saida.push(`plano: ${plano.length} functions`);

  const cliente = deps.cliente ?? deps.criarCliente(canal);
  const esperar =
    deps.esperar ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)));

  // 1. o projeto aceita deploy?
  let statusProjeto;
  try {
    statusProjeto = (await cliente.pedir("projeto", { ref }))?.status;
  } catch (e) {
    erros.push(`status do projeto não lido: ${mensagemSegura(e)}`);
    for (const it of plano)
      saida.push(`  - ${it.nome} verify_jwt=${it.verifyJwt} → ?`);
    return fim(VEREDITOS.INCERTO, "o estado do projeto não foi lido");
  }
  const saudavel = statusProjeto === "ACTIVE_HEALTHY";
  saida.push(
    `projeto ${ref}: ${typeof statusProjeto === "string" ? statusProjeto : "(sem status)"}`,
  );

  // 2. o que já está no ar
  let noAr;
  try {
    noAr = await listarNoAr(cliente, ref);
  } catch (e) {
    erros.push(`functions no ar não lidas: ${mensagemSegura(e)}`);
    for (const it of plano)
      saida.push(`  - ${it.nome} verify_jwt=${it.verifyJwt} → ?`);
    return fim(
      VEREDITOS.INCERTO,
      "a lista de functions do projeto não foi lida",
    );
  }

  const acoes = [];
  const conflitos = [];
  const naoConferidas = [];
  for (const it of plano) {
    const viva = noAr.get(it.nome);
    let acao;
    let porque = "";
    if (viva === undefined) acao = "PUBLICAR";
    else if (substituir) acao = "SUBSTITUIR";
    else if (estaCerta(viva, it)) {
      // no ar e com o verify_jwt certo: o CÓDIGO decide (lote 566; antes
      // pulava sem olhar, e a release nova nunca chegava à loja)
      const c = await codigoNoAr(deps.baixarFuncao, ref, it);
      if (c.estado === "EM_DIA") acao = "PULAR";
      else if (c.estado === "DIFERE") {
        acao = "ATUALIZAR";
        porque = ` (código no ar difere do commit: ${c.motivo})`;
      } else {
        // sem ler o código não há prova de que é o do commit: com --aplicar
        // republica (a versão que sobe prova a troca); no ensaio, INCERTO
        acao = aplicar ? "ATUALIZAR" : "NAO_CONFERIDA";
        porque = ` (código no ar não conferido: ${c.motivo})`;
        if (!aplicar) naoConferidas.push(`${it.nome}: ${c.motivo}`);
      }
    } else {
      acao = "CONFLITO";
      conflitos.push(
        `${it.nome}: já no ar (status ${viva.status}, verify_jwt=${viva.verify_jwt}), o certo é ACTIVE com verify_jwt=${it.verifyJwt}; para republicar use --substituir`,
      );
    }
    // SUBSTITUIR e ATUALIZAR: a versão de antes é a régua de que o código
    // novo entrou; sem versão legível no ar, nada prova a troca (Infinity =
    // nunca prova).
    const versaoAntes =
      acao === "SUBSTITUIR" || acao === "ATUALIZAR"
        ? (viva.version ?? Number.POSITIVE_INFINITY)
        : undefined;
    acoes.push({ item: it, acao, versaoAntes });
    saida.push(
      `  - ${it.nome} verify_jwt=${it.verifyJwt} arquivos=${it.arquivos.length} → ${acao}${porque}`,
    );
  }
  const sobram = [...noAr.keys()].filter(
    (s) => !plano.some((it) => it.nome === s),
  );
  if (sobram.length)
    saida.push(
      `aviso: no ar e fora do canal (não mexo): ${sobram.sort().join(", ")}`,
    );
  for (const c of conflitos) erros.push(`CONFLITO: ${c}`);

  const aFazer = acoes.filter(
    (a) =>
      a.acao === "PUBLICAR" ||
      a.acao === "SUBSTITUIR" ||
      a.acao === "ATUALIZAR",
  );

  if (!aplicar) {
    if (!saudavel)
      erros.push(
        `o projeto não está ACTIVE_HEALTHY (${statusProjeto}): o deploy seria recusado`,
      );
    if (conflitos.length)
      return fim(VEREDITOS.NAO, "ENSAIO: há conflito com o que está no ar");
    if (aFazer.length)
      return fim(
        VEREDITOS.NAO,
        `ENSAIO: faltam ${aFazer.length} de ${plano.length} (ausentes ou com o código no ar diferente do commit); rode com --aplicar para publicar`,
      );
    if (naoConferidas.length) {
      for (const n of naoConferidas) erros.push(`NÃO CONFERIDA: ${n}`);
      return fim(
        VEREDITOS.INCERTO,
        `ENSAIO: ${naoConferidas.length} de ${plano.length} no ar sem o código conferido (o download falhou): não digo que são as do commit`,
      );
    }
    return fim(
      VEREDITOS.SIM,
      "ENSAIO: todas já estão no ar, ACTIVE, com o verify_jwt certo e o código do commit",
    );
  }

  if (!saudavel) {
    erros.push(
      `o projeto ${ref} está ${statusProjeto ?? "sem status"}, não ACTIVE_HEALTHY: o Supabase só aceita deploy em projeto pronto. Espere ele terminar de subir e rode de novo.`,
    );
    return fim(VEREDITOS.NAO, "projeto fora de ACTIVE_HEALTHY, nada publicado");
  }
  if (conflitos.length)
    return fim(VEREDITOS.NAO, "conflito com o que está no ar, nada publicado");

  // 3. uma por vez, conferindo cada uma antes da próxima
  let incerto = false;
  let parouEm = -1;
  for (let i = 0; i < aFazer.length; i++) {
    const { item, versaoAntes } = aFazer[i];
    if (PROIBIDAS.includes(item.nome)) {
      // defesa em profundidade: montarPlano já recusou antes
      erros.push(`RECUSADO: ${item.nome} é proibida`);
      parouEm = i;
      break;
    }
    try {
      await cliente.implantarFuncao(ref, {
        slug: item.nome,
        metadata: {
          entrypoint_path: item.entrypoint,
          verify_jwt: item.verifyJwt,
          name: item.nome,
        },
        arquivos: item.arquivos,
      });
    } catch (e) {
      erros.push(`FALHOU ${item.nome}: ${mensagemSegura(e)}`);
      if (deployIncerto(e)) incerto = true;
      parouEm = i;
      break;
    }
    const c = await conferirUma(cliente, ref, item, esperar, versaoAntes);
    if (c.estado !== "OK") {
      erros.push(`${item.nome} publicada mas não conferida: ${c.motivo}`);
      if (c.estado === "ERRADA")
        return fim(VEREDITOS.NAO, `${item.nome} ficou errada no ar; parei`);
      incerto = true;
      parouEm = i;
      break;
    }
    saida.push(`publicada e conferida: ${item.nome}`);
  }

  if (parouEm >= 0) {
    const naoTentadas = aFazer.length - parouEm - 1;
    if (naoTentadas > 0 || !incerto)
      return fim(
        VEREDITOS.NAO,
        `parei em ${aFazer[parouEm].item.nome}; ${naoTentadas} nem foram tentadas`,
      );
    return fim(
      VEREDITOS.INCERTO,
      `${aFazer[parouEm].item.nome} pode ter sido publicada sem confirmação: confira o GET /functions antes de repetir`,
    );
  }

  // 4. conferência final de TODAS (as puladas inclusive)
  let final;
  try {
    final = await listarNoAr(cliente, ref);
  } catch (e) {
    erros.push(`conferência final não lida: ${mensagemSegura(e)}`);
    return fim(VEREDITOS.INCERTO, "a conferência final não foi lida");
  }
  const erradas = plano.filter((it) => !estaCerta(final.get(it.nome), it));
  if (erradas.length) {
    for (const it of erradas)
      erros.push(`${it.nome}: não está ACTIVE com verify_jwt=${it.verifyJwt}`);
    return fim(
      VEREDITOS.NAO,
      `${erradas.length} de ${plano.length} não conferem no ar`,
    );
  }
  return fim(
    VEREDITOS.SIM,
    `as ${plano.length} functions do canal estão no ar, ACTIVE, com o verify_jwt do config.toml e o código do commit`,
  );
}

/**
 * O código no ar de UMA function contra o do commit, pelo MESMO critério do
 * portão da release (publicar-release.mjs, classificarFuncao: os caminhos e
 * o conteúdo, com CRLF igual a LF; sem base, toda diferença conta).
 * `baixarFuncao(ref, nome)` → [{ caminho, conteudo }] (em produção, o
 * download do portão, baixadorDeFuncaoPeloCli). Devolve EM_DIA, DIFERE ou
 * NAO_CONFERIDA (sem baixador, ou download que falhou): só EM_DIA deixa pular.
 */
async function codigoNoAr(baixarFuncao, ref, item) {
  if (typeof baixarFuncao !== "function")
    return {
      estado: "NAO_CONFERIDA",
      motivo: "sem como baixar o código no ar",
    };
  let baixados;
  try {
    const lista = await baixarFuncao(ref, item.nome);
    if (!Array.isArray(lista)) throw new Error("download fora do formato");
    baixados = new Map();
    for (const a of lista) {
      if (typeof a?.caminho !== "string" || typeof a?.conteudo !== "string")
        throw new Error("download fora do formato");
      baixados.set(a.caminho, a.conteudo);
    }
  } catch (e) {
    return {
      estado: "NAO_CONFERIDA",
      motivo: `o download falhou (${mensagemSegura(e)})`,
    };
  }
  const esperados = new Map(item.arquivos.map((a) => [a.caminho, a.conteudo]));
  const c = classificarFuncao(baixados, esperados, null);
  if (c.estado === "EM_DIA") return { estado: "EM_DIA", motivo: "" };
  const lista = c.divergentes.slice(0, 3).join(", ");
  return {
    estado: "DIFERE",
    motivo:
      c.divergentes.length > 3
        ? `${lista} e mais ${c.divergentes.length - 3}`
        : lista,
  };
}

// ------------------------------------------------------------------ produção

/** Leitor do repositório no commit `sha` (git show), com cache. */
function leitorNoCommit(sha) {
  const cache = new Map();
  return (caminho) => {
    if (cache.has(caminho)) return cache.get(caminho);
    let conteudo = null;
    try {
      conteudo = execFileSync(
        "git",
        ["-C", RAIZ, "show", `${sha}:${caminho}`],
        {
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
    } catch {
      conteudo = null;
    }
    cache.set(caminho, conteudo);
    return conteudo;
  };
}

function gitTexto(args) {
  return execFileSync("git", ["-C", RAIZ, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/**
 * O git real. `topoDoRamo` faz o que o topoDoRamo do portão
 * (publicar-release.mjs, dependenciasReais) faz: o SHA de refs/heads/<ramo>
 * no origin (ls-remote, sempre fresco) e, se o commit não estiver aqui, o
 * fetch dele.
 */
/**
 * O SHA de `git ls-remote origin refs/heads/<ramo>` ("<sha>\trefs/heads/<ramo>"),
 * só se a saída tiver UMA linha e ela for exatamente desse ramo; senão null.
 */
export function shaDoLsRemote(texto, ramo) {
  const linhas = String(texto ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (linhas.length !== 1) return null;
  const [sha, nome, ...resto] = linhas[0].split(/\s+/);
  if (resto.length || nome !== `refs/heads/${ramo}` || !RE_SHA.test(sha))
    return null;
  return sha;
}

export function gitReal() {
  const leitores = new Map();
  return {
    head: async () => gitTexto(["rev-parse", "HEAD"]),
    topoDoRamo: async (ramo) => {
      if (!RE_RAMO.test(ramo)) throw new Error("ramo inválido");
      const linha = shaDoLsRemote(
        gitTexto(["ls-remote", "origin", `refs/heads/${ramo}`]),
        ramo,
      );
      if (!linha) throw new Error("ls-remote sem o ramo");
      try {
        gitTexto(["cat-file", "-e", `${linha}^{commit}`]);
      } catch {
        gitTexto(["fetch", "--quiet", "--no-tags", "origin", linha]);
      }
      return linha;
    },
    ler: (sha, caminho) => {
      if (!RE_SHA.test(sha)) return null;
      if (!leitores.has(sha)) leitores.set(sha, leitorNoCommit(sha));
      return leitores.get(sha)(caminho);
    },
  };
}

/** Margem antes do fim do access token: renova antes de ele vencer no meio. */
export const MARGEM_DO_TOKEN_MS = 2 * 60_000;
/** Sem `expiraEm` na renovação, o token vale só isto aqui (palpite curto). */
export const VALIDADE_SEM_PRAZO_MS = 10 * 60_000;

/**
 * Um token por execução: `renovar` (troca o refresh do cofre) só roda de
 * novo quando o access token está a MARGEM_DO_TOKEN_MS do fim. Se o Supabase
 * girar o refresh a cada troca, renovar a cada pedido multiplicaria o risco
 * de perder a autorização; aqui são ~30 pedidos por loja. Pedidos ao mesmo
 * tempo dividem a mesma renovação; renovação que falha não fica guardada.
 */
export function tokenComCache(renovar, { agora = Date.now } = {}) {
  let guardado = null; // { token, valeAte }
  let emVoo = null;
  return async () => {
    if (guardado && agora() < guardado.valeAte) return guardado.token;
    if (!emVoo) {
      emVoo = (async () => {
        const r = await renovar();
        const expira = Number.isFinite(r?.expiraEm)
          ? r.expiraEm - MARGEM_DO_TOKEN_MS
          : agora() + VALIDADE_SEM_PRAZO_MS;
        guardado = { token: r?.accessToken, valeAte: expira };
        return r?.accessToken;
      })().finally(() => {
        emVoo = null;
      });
    }
    return emVoo;
  };
}

/** O cliente da gestão de UMA loja, com o token OAuth dela em cache. */
export function criarClienteDaLoja({ canal, acesso, fetch, agora }) {
  return criarClienteGestao({
    token: tokenComCache(() => acesso.renovar({ slug: canal }), { agora }),
    ...(fetch ? { fetch } : {}),
  });
}

/** As dependências reais: git do commit aprovado, cofre DPAPI com a
 * autorização da ORG central (modelo de 01/12/2026: uma só, sob a
 * `chaveDoCofre` de org-central.json, nunca uma por loja) e o download do
 * código no ar pelo mesmo caminho do portão da release. */
export async function dependenciasDoComando() {
  const { criarCofreDpapi } = await import("./cofre-local.mjs");
  const { criarAcessoOAuth } = await import("./acesso-oauth.mjs");
  const { carregarOrgCentral } = require("./org-central.cjs");
  return {
    git: gitReal(),
    criarCliente: () =>
      criarClienteDaLoja({
        canal: carregarOrgCentral().chaveDoCofre,
        acesso: criarAcessoOAuth({ cofre: criarCofreDpapi() }),
      }),
    baixarFuncao: baixadorDeFuncaoPeloCli(),
  };
}

export async function main(argv = process.argv.slice(2), deps = undefined) {
  let r;
  try {
    r = await executar(argv, deps ?? (await dependenciasDoComando()));
  } catch (e) {
    console.error(`VEREDITO: INCERTO — erro inesperado (${mensagemSegura(e)})`);
    return 3;
  }
  for (const l of r.erros) console.error(l);
  for (const l of r.saida) console.log(l);
  return r.codigo;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().then(
    (c) => {
      process.exitCode = c;
    },
    (e) => {
      console.error(`erro inesperado (${mensagemSegura(e)})`);
      process.exitCode = 3;
    },
  );
}
