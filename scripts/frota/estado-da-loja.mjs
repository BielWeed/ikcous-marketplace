#!/usr/bin/env node
/* eslint-disable security/detect-object-injection -- as chaves vêm de canais-de-backend.json/politica.json versionados e de refs já validados por RE_REF; nenhuma vem de rede. */
/**
 * estado-da-loja.mjs — o ÚNICO jeito de pôr uma loja para dormir, acordá-la ou encerrá-la (plano L8, Lote 4, 26/11/2026).
 *
 * POR QUE IMPRIME SQL EM VEZ DE EXECUTAR: a caderneta de produção (public.frota_lojas) mora no banco de IKCOUS_FROTA_URL (o projeto
 * antigo até a virada de docs/runbooks/caderneta-muda-de-banco.md; depois, o banco da IKCOUS), que só o MCP Supabase da sessão
 * alcança para escrever; nenhum workflow escreve lá. Então quem DECIDE é este comando (confere tudo o que dá para conferir daqui) e quem EXECUTA
 * é a sessão, rodando pelo MCP a ÚNICA instrução impressa. As travas que não dependem deste comando moram no banco
 * (migration 20261470000000: a porta public.frota_mudar_estado e o gatilho de frota_lojas).
 *
 * Uso:
 *   node scripts/frota/estado-da-loja.mjs --ver [--loja <id>]
 *   node scripts/frota/estado-da-loja.mjs --adormecer --loja <id> --ref <ref> --sha <40hex> --motivo "por <nome>: <texto>"
 *   node scripts/frota/estado-da-loja.mjs --acordar --loja <id> --ref <ref> --base <40hex> --sha <40hex> --motivo "por <nome>: <texto>" [--confirmar "REABRIR <id>"]
 *   node scripts/frota/estado-da-loja.mjs --encerrar --loja <id> --ref <ref> --sha <40hex> --motivo "por <nome>: <texto>" --confirmar "ENCERRAR <id>" [--de ativa|adormecida]
 *   node scripts/frota/estado-da-loja.mjs --depois-de-acordar --loja <id> --ref <ref> --sha <o --sha da instrução> --base <a --base da instrução>
 *
 * O que cada um confere ANTES de imprimir:
 *   - todos: politica.json lojasQueNuncaDormem existe, não é vazia e só tem refs de 20 letras (sem ela nada sai, nem o --ver);
 *   - --ver: só um SELECT (nunca supabase_url nem publishable_key) das lojas e das 20 últimas mudanças do histórico;
 *   - os três que mudam: id, ref, sha, base e motivo no formato (o motivo começa com "por <nome>: ", porque o rastro do banco grava
 *     quem = postgres pelo MCP); o ref não é de uma loja que nunca dorme (IKCOUS, Savy); a loja tem canal de backend (ou é só front):
 *     sem canal o --acordar recusaria, então nenhuma das três imprime nada (nunca pôr para dormir o que não se acorda); a confirmação é
 *     a frase exata; --sha é a release que a produção serve AGORA (version.json dos endereços de politica.json enderecosDeReserva, no
 *     contrato de conferir-frota.mjs, todos iguais);
 *   - --acordar: a prontidão DAQUELA loja contra a release atual (a mesma régua do publicar-release.mjs), com a base = a release em que
 *     ela dormiu. Faltando migration, prova de objetos ou function, NÃO imprime a chamada: imprime os comandos de conserto só dela.
 *     Function que falta na loja e que a release NÃO mudou não impede o acordar: a chamada sai, e o comando de publicá-la vai no AVISO.
 * A instrução impressa vale 30 minutos (p_valido_ate); a porta recusa a vencida e a que vale mais de 1 hora.
 *
 * --depois-de-acordar (OBRIGATÓRIO depois de rodar a instrução de acordar): a porta não sabe qual release está no ar (p_sha é só
 * gravado), então uma instrução impressa para a release A e rodada depois que a frota publicou a B acorda a loja servindo a B com o
 * banco pronto só para a A. Este passo lê a release em produção AGORA: igual ao --sha da instrução, a prontidão conferida na
 * impressão vale; diferente, roda a prontidão da loja para a release atual a partir da --base. Não imprime SQL.
 * Saída: 0 = instrução impressa (no --depois-de-acordar: loja pronta para o que está no ar); 1 = recusado ou loja não pronta
 * (inclui falha de rede); 2 = uso errado.
 * Roteiro: docs/runbooks/estado-de-vida-da-loja.md.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  lerPolitica,
  problemasDoContrato,
  validarVersao,
} from "./conferir-frota.mjs";
import {
  comandosDeConserto,
  contextoDaRelease,
  dependenciasReais,
  lerCanais,
  prontidaoDaLoja,
} from "./publicar-release.mjs";

const RE_REF = /^[a-z]{20}$/;
const RE_LOJA = /^[a-z0-9-]{1,64}$/;
const RE_SHA = /^[0-9a-f]{40}$/;
const RE_MOTIVO = /^[\p{L}\p{N} .,:;()/-]{3,200}$/u;
/**
 * O motivo COMEÇA com quem fez: "por <nome>: <motivo>". O rastro do banco grava quem = session_user, que pelo MCP é sempre postgres;
 * sem o nome no motivo, o histórico não diz quem pôs a loja para dormir. Nome de 2 a 41 caracteres (letra no começo e no fim), e
 * pelo menos 3 caracteres de motivo depois dos dois-pontos.
 */
const RE_AUTOR = /^[Pp]or \p{L}[\p{L}\p{N} .-]{0,39}\p{L}: \S.{2,}$/u;
/** Quanto tempo a instrução impressa vale (a porta recusa acima de 60). */
export const VALIDADE_MINUTOS = 30;
const ACOES = new Set([
  "--ver",
  "--adormecer",
  "--acordar",
  "--encerrar",
  "--depois-de-acordar",
]);
const OPCOES = new Set([
  "--loja",
  "--ref",
  "--sha",
  "--base",
  "--motivo",
  "--confirmar",
  "--de",
]);
/** O que cada ação exige e o que ela aceita (além do que exige). */
const FORMA = {
  ver: { exige: [], aceita: ["loja"] },
  adormecer: { exige: ["loja", "ref", "sha", "motivo"], aceita: [] },
  acordar: {
    exige: ["loja", "ref", "base", "sha", "motivo"],
    aceita: ["confirmar"],
  },
  encerrar: {
    exige: ["loja", "ref", "sha", "motivo", "confirmar"],
    aceita: ["de"],
  },
  "depois-de-acordar": { exige: ["loja", "ref", "sha", "base"], aceita: [] },
};

class UsoErrado extends Error {}

/** Lê e valida a FORMA dos argumentos. Erro aqui é uso errado (saída 2). */
export function lerArgumentos(argv) {
  let acao = null;
  const v = {};
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (ACOES.has(x)) {
      if (acao)
        throw new UsoErrado(
          "uma ação só (--ver, --adormecer, --acordar, --encerrar ou --depois-de-acordar)",
        );
      acao = x.slice(2);
    } else if (OPCOES.has(x)) {
      const valor = argv[++i];
      if (valor === undefined || valor.startsWith("--"))
        throw new UsoErrado(`${x} exige um valor`);
      const nome = x.slice(2);
      if (Object.hasOwn(v, nome)) throw new UsoErrado(`${x} repetido`);
      v[nome] = valor;
    } else throw new UsoErrado(`argumento desconhecido: ${x}`);
  }
  if (!acao)
    throw new UsoErrado(
      "falta a ação (--ver, --adormecer, --acordar, --encerrar ou --depois-de-acordar)",
    );
  const forma = FORMA[acao];
  for (const k of forma.exige)
    if (!Object.hasOwn(v, k)) throw new UsoErrado(`--${acao} exige --${k}`);
  for (const k of Object.keys(v))
    if (!forma.exige.includes(k) && !forma.aceita.includes(k))
      throw new UsoErrado(`--${acao} não aceita --${k}`);
  if (v.loja !== undefined && !RE_LOJA.test(v.loja))
    throw new UsoErrado(
      "--loja: só letras minúsculas, números e hífen (1 a 64)",
    );
  if (v.ref !== undefined && !RE_REF.test(v.ref))
    throw new UsoErrado(
      "--ref: 20 letras minúsculas (o project_ref do Supabase da loja)",
    );
  for (const k of ["sha", "base"])
    if (v[k] !== undefined && !RE_SHA.test(v[k]))
      throw new UsoErrado(`--${k}: 40 caracteres hexadecimais minúsculos`);
  if (v.motivo !== undefined && !RE_MOTIVO.test(v.motivo))
    throw new UsoErrado(
      "--motivo: de 3 a 200 caracteres, só letras, números, espaço e . , : ; ( ) / -",
    );
  if (v.motivo !== undefined && !RE_AUTOR.test(v.motivo))
    throw new UsoErrado(
      '--motivo tem de começar com quem fez, no formato "por <nome>: <motivo>" (ex.: "por Gabriel: assinatura vencida em 20/11"): o rastro do banco grava quem = postgres pelo MCP, e o autor de verdade só fica registrado no motivo',
    );
  if (v.de !== undefined && v.de !== "ativa" && v.de !== "adormecida")
    throw new UsoErrado("--de: ativa ou adormecida");
  return { acao, ...v };
}

/** As lojas que nunca dormem, ou o motivo de não confiar na lista (sem ela, nada sai). */
export function refsQueNuncaDormem(politica) {
  const lista = politica?.lojasQueNuncaDormem;
  if (!Array.isArray(lista) || lista.length === 0)
    return {
      erro: "scripts/frota/politica.json não tem lojasQueNuncaDormem (ou está vazia): sem ela não há como provar que a loja não é a IKCOUS ou a Savy",
    };
  const refs = new Set();
  for (const l of lista) {
    if (typeof l?.ref !== "string" || !RE_REF.test(l.ref))
      return {
        erro: `scripts/frota/politica.json lojasQueNuncaDormem tem um ref inválido (${JSON.stringify(l?.ref)})`,
      };
    refs.add(l.ref);
  }
  return { refs };
}

/**
 * A release que a produção serve AGORA: o version.json de CADA endereço de politica.json enderecosDeReserva (os aliases do projeto
 * Vercel que servem a produção), no contrato de conferir-frota.mjs, todos com o mesmo codeSha. Qualquer falha lança (vira recusa).
 */
export async function lerReleaseEmProducao(
  politica,
  { fetchImpl = fetch, agora = Date.now(), timeoutMs = 15000 } = {},
) {
  const enderecos = politica?.enderecosDeReserva;
  if (!Array.isArray(enderecos) || enderecos.length === 0)
    throw new Error(
      "scripts/frota/politica.json não tem enderecosDeReserva: sem endereço de produção para ler o version.json",
    );
  const shas = new Set();
  for (const dominio of enderecos) {
    if (typeof dominio !== "string" || !/^[a-z0-9.-]+$/.test(dominio))
      throw new Error(
        `endereço de produção inválido em politica.json: ${JSON.stringify(dominio)}`,
      );
    let res;
    try {
      res = await fetchImpl(`https://${dominio}/version.json?t=${agora}`, {
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new Error(
        `version.json de ${dominio} não lido (${e?.message ?? e})`,
      );
    }
    if (res.status !== 200)
      throw new Error(
        `version.json de ${dominio} respondeu HTTP ${res.status}`,
      );
    const v = validarVersao(await res.text());
    if (v.erro) throw new Error(`${dominio}: ${v.erro}`);
    const problemas = problemasDoContrato(v.versao);
    if (problemas.length)
      throw new Error(
        `${dominio}: version.json fora do contrato (${problemas.join("; ")})`,
      );
    shas.add(v.versao.codeSha);
  }
  if (shas.size !== 1)
    throw new Error(
      `a produção serve mais de uma release (${[...shas].join(", ")}): espere a publicação terminar`,
    );
  return [...shas][0];
}

/** Literal SQL de texto (aspas simples dobradas) ou null. Os valores já passaram pelos formatos acima. */
export function literal(valor) {
  if (valor === null || valor === undefined) return "null";
  const s = String(valor);
  if (s.includes("\0")) throw new Error("valor com caractere nulo");
  return `'${s.replaceAll("'", "''")}'`;
}

/** A instrução --ver: só leitura, nunca a URL nem a chave do banco da loja. */
export function sqlDeVer(loja) {
  const filtroLoja = loja ? ` where fl.id = ${literal(loja)}` : "";
  const filtroHist = loja ? ` where hi.loja_id = ${literal(loja)}` : "";
  const lojas =
    "select coalesce(json_agg(json_build_object('id', fl.id, 'nome', fl.nome, 'dominio_publico', fl.dominio_publico, 'project_ref', fl.project_ref, 'ativa', fl.ativa, 'estado', fl.estado, 'estado_desde', fl.estado_desde, 'estado_sha', fl.estado_sha) order by fl.id), '[]'::json)";
  const ultimas =
    "select hi.id, hi.loja_id, hi.project_ref, hi.de, hi.para, hi.sha, hi.motivo, hi.quem, hi.em";
  return `select (${lojas} from public.frota_lojas fl${filtroLoja}) as lojas, (select coalesce(json_agg(h order by h.id desc), '[]'::json) from (${ultimas} from public.frota_estado_historico hi${filtroHist} order by hi.id desc limit 20) h) as historico;`;
}

/** A ÚNICA instrução que muda o estado: a porta, com argumentos nomeados. */
export function sqlDaPorta({
  loja,
  ref,
  de,
  para,
  sha,
  base,
  motivo,
  confirmacao,
  validoAte,
}) {
  const argumentos = [
    `p_id => ${literal(loja)}`,
    `p_ref => ${literal(ref)}`,
    `p_de => ${literal(de)}`,
    `p_para => ${literal(para)}`,
    `p_sha => ${literal(sha)}`,
    `p_base => ${literal(base)}`,
    `p_motivo => ${literal(motivo)}`,
    `p_confirmacao => ${literal(confirmacao)}`,
    `p_valido_ate => ${literal(validoAte)}::timestamptz`,
  ].join(", ");
  return `select * from public.frota_mudar_estado(${argumentos});`;
}

/**
 * Decide e devolve { codigo, saida[], erros[] } sem escrever em lugar nenhum. `deps`:
 *   politica, canais, agora() (ms), lerReleaseEmProducao(politica) → sha, depsDaRelease() → as dependências do publicar-release.mjs
 *   (listarMigrationsNoSha, listarFuncoesNoSha, lerArquivoNoSha, topoDoRamo, arvoreIgual, migrationList, listarFuncoes, baixarFuncao,
 *   listarRuns, logDoRun).
 */
export async function executar(argv, deps) {
  const saida = [];
  const erros = [];
  const recusa = (motivo) => {
    erros.push(`RECUSADO: ${motivo}`);
    return { codigo: 1, saida, erros };
  };
  let a;
  try {
    a = lerArgumentos(argv);
  } catch (e) {
    if (!(e instanceof UsoErrado)) throw e;
    erros.push(e.message, USO);
    return { codigo: 2, saida, erros };
  }
  const nunca = refsQueNuncaDormem(deps.politica);
  if (nunca.erro) return recusa(nunca.erro);

  if (a.acao === "ver") {
    saida.push(sqlDeVer(a.loja));
    erros.push(
      "Só leitura: rode pelo MCP no banco onde a caderneta de produção mora.",
    );
    return { codigo: 0, saida, erros };
  }

  if (nunca.refs.has(a.ref))
    return recusa(
      `o ref ${a.ref} é de uma loja que nunca dorme (politica.json lojasQueNuncaDormem): IKCOUS e Savy ficam sempre ativas`,
    );
  if (a.acao === "depois-de-acordar") return depoisDeAcordar(a, deps);
  // Nunca pôr para dormir (nem encerrar) uma loja que o --acordar recusaria por falta de canal: ela ficaria fora do ar mesmo pagando.
  const semVolta = semCaminhoDeVolta(a, deps);
  if (semVolta) {
    erros.push(semVolta);
    return { codigo: 1, saida, erros };
  }
  let de;
  let para;
  let confirmacao = null;
  if (a.acao === "adormecer") {
    de = "ativa";
    para = "adormecida";
  } else if (a.acao === "encerrar") {
    if (a.confirmar !== `ENCERRAR ${a.loja}`)
      return recusa(
        `encerrar exige --confirmar "ENCERRAR ${a.loja}" (e a ordem ESCRITA do dono)`,
      );
    de = a.de ?? "adormecida";
    para = "encerrada";
    confirmacao = a.confirmar;
  } else {
    if (a.confirmar !== undefined && a.confirmar !== `REABRIR ${a.loja}`)
      return recusa(
        `reabrir uma loja encerrada exige --confirmar "REABRIR ${a.loja}"`,
      );
    de = a.confirmar === undefined ? "adormecida" : "encerrada";
    para = "ativa";
    confirmacao = a.confirmar ?? null;
  }

  let emProducao;
  try {
    emProducao = await deps.lerReleaseEmProducao(deps.politica);
  } catch (e) {
    return recusa(`não deu para ler a release em produção: ${e.message}`);
  }
  if (emProducao !== a.sha)
    return recusa(
      `--sha ${a.sha} não é a release que a produção serve agora (${emProducao})`,
    );

  if (a.acao === "acordar") {
    const pronta = await conferirProntidao(a, deps, erros, saida);
    if (!pronta) return { codigo: 1, saida, erros };
  }

  const validoAte = new Date(
    deps.agora() + VALIDADE_MINUTOS * 60000,
  ).toISOString();
  saida.push(
    sqlDaPorta({
      loja: a.loja,
      ref: a.ref,
      de,
      para,
      sha: a.sha,
      base: a.acao === "acordar" ? a.base : null,
      motivo: a.motivo,
      confirmacao,
      validoAte,
    }),
  );
  const posAcordar =
    a.acao === "acordar"
      ? ` OBRIGATÓRIO logo depois de rodar: ${comandoDepoisDeAcordar(a)} (se a release em produção mudou desde agora, ele confere o banco da loja para a nova; saída 1 = a loja está no ar com o banco atrasado).`
      : "";
  erros.push(
    `Instrução válida até ${validoAte}: rode pelo MCP no banco onde a caderneta de produção mora. Depois, em 60 s, confira o endereço da loja (docs/runbooks/estado-de-vida-da-loja.md).${posAcordar}`,
  );
  return { codigo: 0, saida, erros };
}

/** O passo pós-acordar com os argumentos exatos da instrução (os valores já passaram pelos formatos de lerArgumentos). */
export function comandoDepoisDeAcordar({ loja, ref, sha, base }) {
  return `node scripts/frota/estado-da-loja.mjs --depois-de-acordar --loja ${loja} --ref ${ref} --sha ${sha} --base ${base}`;
}

/**
 * --depois-de-acordar: a release em produção AGORA contra a da instrução (--sha). Igual: a prontidão conferida na impressão vale.
 * Diferente: a prontidão da loja para a release atual, a partir da --base (a mesma conferirProntidao do --acordar). Toda leitura que
 * falha é falha (saída 1), nunca "OK": a loja já está no ar.
 */
async function depoisDeAcordar(a, deps) {
  const saida = [];
  const erros = [];
  const critico = (texto, oQueFazer, shaNoAr) =>
    `CRÍTICO: a loja ${a.loja} (${a.ref}) está no ar e ${texto}. Clientes podem estar vendo a loja quebrada AGORA. ${oQueFazer}; se não resolver logo, ponha a loja para dormir de novo: node scripts/frota/estado-da-loja.mjs --adormecer --loja ${a.loja} --ref ${a.ref} --sha ${shaNoAr} --motivo "por <seu nome>: banco atrasado depois de acordar"`;
  let emProducao;
  try {
    emProducao = await deps.lerReleaseEmProducao(deps.politica);
  } catch (e) {
    erros.push(
      critico(
        `não deu para ler a release em produção (${e.message}): não há como provar que o banco dela está pronto para o que está no ar`,
        "Rode este comando de novo em 1 minuto, até sair OK",
        "<codeSha no ar>",
      ),
    );
    return { codigo: 1, saida, erros };
  }
  if (emProducao === a.sha) {
    erros.push(
      `OK: a produção ainda serve ${a.sha}, a release da instrução de acordar: a prontidão conferida quando a instrução foi impressa vale.`,
    );
    return { codigo: 0, saida, erros };
  }
  const daProntidao = [];
  const pronta = await conferirProntidao(
    { ...a, sha: emProducao },
    deps,
    daProntidao,
    saida,
    { jaNoAr: true },
  );
  if (pronta) {
    erros.push(
      ...daProntidao,
      `AVISO: a release em produção mudou de ${a.sha} (a da instrução de acordar) para ${emProducao}, e o banco da loja ${a.loja} (${a.ref}) está pronto para a ${emProducao}. OK.`,
    );
    return { codigo: 0, saida, erros };
  }
  erros.push(
    critico(
      `serve a release ${emProducao}, mas o banco dela só foi conferido para a ${a.sha} (a da instrução de acordar) e NÃO está provado pronto para a ${emProducao}`,
      "Faça o conserto abaixo (um passo por vez) e rode este comando de novo até sair OK",
      emProducao,
    ),
    ...daProntidao,
  );
  return { codigo: 1, saida, erros };
}

/** A loja só tem front (politica.json lojasSemBackendGerenciado): sem prontidão de banco, como no publicar-release. */
function soFront(a, deps) {
  return (deps.politica.lojasSemBackendGerenciado ?? []).some(
    (l) => l?.ref === a.ref,
  );
}

/**
 * A razão (linha de erro) pela qual o --acordar recusaria esta loja ANTES de olhar o banco dela — hoje, só a falta de canal de backend —
 * ou null. As três ações que mudam usam ESTA função: o que não se acorda também não se põe para dormir nem se encerra.
 */
export function semCaminhoDeVolta(a, deps) {
  if (soFront(a, deps)) return null;
  if (deps.canais?.canais?.[a.ref]) return null;
  return `RECUSADO: a loja ${a.loja} (${a.ref}) não tem canal de backend em scripts/frota/canais-de-backend.json: sem canal não há como conferir nem consertar o banco dela, e uma loja que não se acorda não se põe para dormir nem se encerra (cadastre o canal antes)`;
}

/**
 * --acordar: a loja só volta se estiver pronta para a release atual, com base = a release em que dormiu. `jaNoAr` (--depois-de-acordar):
 * a mesma régua, com o texto de quem já está no ar (o caminho é consertar o banco ou adormecê-la, não "acordar de novo").
 */
async function conferirProntidao(
  a,
  deps,
  erros,
  saida,
  { jaNoAr = false } = {},
) {
  const canais = deps.canais;
  if (soFront(a, deps)) {
    erros.push(
      `${a.ref} está em politica.json lojasSemBackendGerenciado: só front, sem prontidão de banco (como no publicar-release).`,
    );
    return true;
  }
  const canal = canais?.canais?.[a.ref];
  const semVolta = semCaminhoDeVolta(a, deps);
  if (semVolta) {
    erros.push(semVolta);
    return false;
  }
  try {
    const d = deps.depsDaRelease();
    const ctx = await contextoDaRelease({
      sha: a.sha,
      politica: deps.politica,
      canais,
      deps: d,
    });
    const loja = {
      ref: a.ref,
      titulo: `${canal.nome ?? a.loja} [${a.loja}]`,
      dominios: [],
      shasServidos: [a.base],
    };
    const pront = await prontidaoDaLoja(loja, canal, {
      sha: a.sha,
      deps: d,
      requeridas: ctx.requeridas,
      funcoesDoSha: ctx.funcoesDoSha,
      verifyJwt: ctx.verifyJwt,
      canais,
      agora: deps.agora(),
      topo: ctx.topo,
    });
    const naoProntas = pront.funcoes.filter((f) => f.estado === "NAO_PRONTA");
    if (pront.problemas.length === 0 && naoProntas.length === 0) {
      // Function que FALTA na loja e que a release não mudou (DERIVA_ANTIGA com `ausente`): não impede o acordar, mas sem este aviso
      // ela nunca ganhava comando (o conserto só saía para loja NÃO pronta). Vai para o stderr, nunca para a saída: o stdout continua
      // sendo a UMA instrução que se roda pelo MCP. Os comandos são os de comandosDeConserto (só impressos, com as mesmas travas de
      // banco pronto, topo lido e canal que publica); quando nenhuma linha é comando, o texto não promete um.
      const ausentes = pront.funcoes
        .filter((f) => f.estado === "DERIVA_ANTIGA" && f.ausente === true)
        .map((f) => f.nome);
      if (ausentes.length) {
        const cmds = comandosDeConserto(loja, pront, canal, ctx.ctxConserto);
        erros.push(
          `AVISO: a loja ${a.loja} (${a.ref}) não tem as functions ${ausentes.join(", ")} publicadas. A release não as mudou, então elas não impedem o acordar. ${cmds.some((l) => l.startsWith("gh ")) ? "Para publicá-las (só impresso, nada foi executado; linha com # não é comando):" : "Nenhuma tem comando de publicar daqui; o motivo:"}`,
          ...cmds,
        );
      }
      return true;
    }
    erros.push(
      jaNoAr
        ? `NÃO PRONTA: a loja ${a.loja} (${a.ref}) JÁ está no ar servindo a ${a.sha}, e o banco dela (conferido desde a ${a.base}) não está pronto para essa release. O caminho é consertar o banco (os comandos abaixo, um passo por vez, rodando este comando de novo até sair OK) ou pôr a loja para dormir de novo com o --adormecer acima.`
        : `NÃO PRONTA: a loja ${a.loja} (${a.ref}) dormiu na release ${a.base} e não está pronta para a ${a.sha}. Nada foi impresso para o banco da caderneta; primeiro o conserto abaixo (um passo por vez), depois rode este comando de novo.`,
      ...pront.problemas.map((p) => `- ${p}`),
      ...naoProntas.map((f) => `- function ${f.nome}: ${f.motivo}`),
      ...ctx.problemas.map((p) => `- ${p.alvo}: ${p.motivo}`),
    );
    saida.push(...comandosDeConserto(loja, pront, canal, ctx.ctxConserto));
    return false;
  } catch (e) {
    erros.push(
      jaNoAr
        ? `FALHOU: a prontidão da loja ${a.loja} não foi lida (${e?.message ?? e}): a loja JÁ está no ar e nada prova que o banco dela está pronto; rode este comando de novo ou ponha a loja para dormir com o --adormecer acima`
        : `RECUSADO: a prontidão da loja ${a.loja} não foi lida (${e?.message ?? e}): sem ela a loja não acorda`,
    );
    return false;
  }
}

const USO = [
  "Uso:",
  "  node scripts/frota/estado-da-loja.mjs --ver [--loja <id>]",
  '  node scripts/frota/estado-da-loja.mjs --adormecer --loja <id> --ref <ref> --sha <40hex> --motivo "por <nome>: <texto>"',
  '  node scripts/frota/estado-da-loja.mjs --acordar --loja <id> --ref <ref> --base <40hex> --sha <40hex> --motivo "por <nome>: <texto>" [--confirmar "REABRIR <id>"]',
  '  node scripts/frota/estado-da-loja.mjs --encerrar --loja <id> --ref <ref> --sha <40hex> --motivo "por <nome>: <texto>" --confirmar "ENCERRAR <id>" [--de ativa|adormecida]',
  "  node scripts/frota/estado-da-loja.mjs --depois-de-acordar --loja <id> --ref <ref> --sha <o --sha da instrução> --base <a --base da instrução>",
].join("\n");

/** As dependências reais: política e canais do disco, version.json pela rede, prontidão pelos CLIs (só se --acordar pedir). */
export function dependenciasDoComando() {
  const politica = lerPolitica();
  return {
    politica,
    canais: lerCanais(),
    agora: () => Date.now(),
    lerReleaseEmProducao: (p) => lerReleaseEmProducao(p),
    depsDaRelease: () => dependenciasReais(),
  };
}

export async function main(argv = process.argv.slice(2), deps = undefined) {
  let r;
  try {
    r = await executar(argv, deps ?? dependenciasDoComando());
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
  main().then(
    (c) => {
      process.exitCode = c;
    },
    (e) => {
      console.error(`erro inesperado: ${e?.message ?? e}`);
      process.exitCode = 1;
    },
  );
}
