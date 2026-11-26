/**
 * segredos-da-loja.mjs — os SEGREDOS que a loja nova precisa, pela Management
 * API do Supabase, sem passo manual (plano nova-loja, B1, 26/11/2026). Fecha os
 * passos 4, 5 e 9 da seção "Loja assinante nova" de
 * docs/runbooks/producao-unica-fonte.md:
 *   - MP_CHAVES_ENCRYPTION_KEY: 32 bytes em base64 (é o que chaveDeCifra, de
 *     supabase/functions/_shared/credenciais-mp.ts, aceita). Sem ela o
 *     cadastro do MP e do Gmail fica "indisponivel";
 *   - RECONCILIACAO_SECRET nas functions e, com o MESMO valor, o
 *     `reconciliacao_secret` do Vault, mais o `reconciliacao_url` (a function
 *     reconciliar-pagamentos DESTA loja): é o que o cron de
 *     20260808000100_reconciliacao.sql lê. Sem os três, o PIX cujo aviso se
 *     perdeu nunca vira pedido pago;
 *   - o par VAPID (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, base64url cru, o
 *     formato de _shared/webpush.ts) e a MESMA pública em
 *     public.store_config.vapid_public_key (linha id = 1), de onde o porteiro
 *     a injeta no front; VAPID_SUBJECT só se quem chama der o contato.
 * MP_ACCESS_TOKEN e MP_WEBHOOK_SECRET NUNCA são criados aqui (NUNCA_CRIADOS):
 * ficam vazios até a lojista ligar o MP no painel.
 *
 * O QUE ESTE ARQUIVO GARANTE (tests/frota_segredos_da_loja_test.ts trava):
 *  - NUNCA SUBSTITUI. Lê antes os NOMES dos secrets (o valor que a API devolve
 *    é um digest e é descartado na hora) e os NOMES do Vault; o que existe
 *    fica e o relatório diz "já existia". O POST /secrets é um upsert, então
 *    o estado é relido IMEDIATAMENTE antes de gravar e, se mudou, nada é
 *    gravado. No banco, a guarda vai DENTRO da transação (nome já no Vault ou
 *    vapid_public_key já preenchida = RAISE = volta tudo);
 *  - GRUPOS INTEIROS: um par só é gravado se as duas metades faltam. Metade de
 *    um par (o secret sem o Vault, a pública sem a privada, a coluna sem o
 *    par) é ESTADO INCOERENTE: aquele grupo não é gravado e o veredito é NÃO.
 *    Não dá para completar a metade que falta: a API não devolve o valor;
 *  - o projeto tem de estar ACTIVE_HEALTHY (pesquisa da T1: SQL antes disso
 *    falha); conferido na leitura e de novo antes da 1ª escrita;
 *  - NENHUM VALOR DE SEGREDO sai daqui: nem em log, nem em erro, nem no
 *    relatório, nem prefixo. Os valores vivem só na memória desta chamada e
 *    nos corpos HTTPS. Erro de baixo nível vira só o nome do tipo; o
 *    ErroDaGestao já nasce sem corpo e sem token (supabase-gestao.mjs);
 *  - sem `aplicar: true` (literal) é PLANO: só leituras, nem gera valor;
 *  - SQL: os literais passam por literalSql (aspa dobrada; NUL, $ e barra
 *    invertida recusados, porque o literal vive dentro de DO $b1$), e a
 *    transação termina com `SELECT true AS gravado`: a database/query devolve
 *    só o ÚLTIMO resultado com linhas (pesquisa T1, P3), e é essa linha que
 *    confirma o COMMIT. Sem ela = ESTADO_DESCONHECIDO.
 *
 * ORDEM DAS ESCRITAS (no máximo DUAS): 1) um POST /secrets com tudo o que é
 * das functions; 2) uma transação no banco com o Vault e a store_config. Se a
 * 2ª falhar depois da 1ª, sobra secret sem a parte do banco: estado que este
 * script NÃO conserta sozinho (seria substituir). O relatório diz quais
 * secrets apagar no painel (loja nova, sem venda) para rodar de novo.
 *
 * VEREDITO: SIM só quando a conferência final (releitura) acha todos os nomes
 * e a vapid_public_key; NÃO quando algo falta ou foi recusado; INCERTO quando
 * uma escrita pode ter sido aplicada sem resposta ou a conferência não leu.
 * INCERTO nunca vira SIM. A saude_da_loja() (se existir) só INFORMA se a
 * reconciliação já rodou: até 10 min depois de gravar é normal não ter rodado.
 *
 * USO: node scripts/frota/segredos-da-loja.mjs --projeto <ref> [--aplicar]
 *        [--vapid-subject mailto:...|https://...]
 * O token vem de SUPABASE_ACCESS_TOKEN (a mesma fonte dos scripts da
 * Management API; no orquestrador nova-loja.mjs é o token OAuth da lojista,
 * passado pelo `cliente`). Nunca é impresso.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ESTADO_DESCONHECIDO,
  ErroDaGestao,
  SemAcesso,
  criarClienteGestao,
} from "./supabase-gestao.mjs";

const require = createRequire(import.meta.url);
const { RE_REF } = require("./lojas.cjs");

/** Os nomes que as functions leem (Deno.env.get) — e os ÚNICOS que este
 * script grava nas functions. */
export const NOMES_NAS_FUNCTIONS = Object.freeze({
  chaveMp: "MP_CHAVES_ENCRYPTION_KEY",
  reconciliacao: "RECONCILIACAO_SECRET",
  vapidPublica: "VAPID_PUBLIC_KEY",
  vapidPrivada: "VAPID_PRIVATE_KEY",
  vapidContato: "VAPID_SUBJECT",
});
/** Os nomes que o cron da reconciliação lê do Vault. */
export const NOMES_NO_VAULT = Object.freeze({
  segredo: "reconciliacao_secret",
  url: "reconciliacao_url",
});
/** Ficam vazios na loja nova: a lojista liga o MP no painel. */
export const NUNCA_CRIADOS = Object.freeze([
  "MP_ACCESS_TOKEN",
  "MP_WEBHOOK_SECRET",
]);

const F = NOMES_NAS_FUNCTIONS;
const V = NOMES_NO_VAULT;
const COLUNA = "store_config.vapid_public_key";
const PRONTO = "ACTIVE_HEALTHY";
const DESCRICAO_NO_VAULT = new Map([
  [
    V.segredo,
    "IKCOUS: o mesmo valor de RECONCILIACAO_SECRET das functions (segredos-da-loja.mjs)",
  ],
  [
    V.url,
    "IKCOUS: a function reconciliar-pagamentos desta loja (segredos-da-loja.mjs)",
  ],
]);
const NOMES_RELEVANTES = Object.values(F);

/** mailto:alguem@dominio ou https://..., sem espaço nem aspa. */
const RE_CONTATO = /^(mailto:[^\s@'"\\$]+@[^\s@'"\\$]+|https:\/\/[^\s'"\\$]+)$/;

export const SQL_ESTADO_DO_BANCO =
  "SELECT to_regclass('vault.secrets') IS NOT NULL AS vault_existe, to_regclass('public.store_config') IS NOT NULL AS store_config_existe, to_regprocedure('public.saude_da_loja()') IS NOT NULL AS saude_existe;";
export const SQL_STORE_CONFIG =
  "SELECT count(*)::int AS linhas, coalesce(bool_or(coalesce(btrim(vapid_public_key), '') <> ''), false) AS tem_vapid FROM public.store_config WHERE id = 1;";
export const SQL_NOMES_NO_VAULT = `SELECT name FROM vault.secrets WHERE name IN ('${V.segredo}', '${V.url}') ORDER BY name;`;
export const SQL_SAUDE = "SELECT public.saude_da_loja() AS saude;";

/** O endereço da function de reconciliação DESTA loja (o mesmo formato de
 * scripts/publicacao/ativar-email-do-login.cjs). */
export function urlDaReconciliacao(ref) {
  if (!(typeof ref === "string" && RE_REF.test(ref))) {
    throw new Error("urlDaReconciliacao: ref inválido.");
  }
  return `https://${ref}.supabase.co/functions/v1/reconciliar-pagamentos`;
}

/**
 * Literal SQL com aspa simples dobrada (standard_conforming_strings, padrão
 * do Postgres). Recusa NUL, `$` (o literal vive dentro de DO $b1$ ... $b1$) e
 * barra invertida. O erro nunca ecoa o texto.
 */
export function literalSql(texto) {
  if (typeof texto !== "string") {
    throw new TypeError("literalSql: só texto.");
  }
  if (/[\0$\\]/.test(texto)) {
    throw new Error(
      "literalSql: NUL, $ ou barra invertida recusados (valor não impresso).",
    );
  }
  return `'${texto.replaceAll("'", "''")}'`;
}

/**
 * A ÚNICA escrita no banco: o Vault e a store_config numa transação, com as
 * guardas DENTRO dela (nome já no Vault ou coluna já preenchida = RAISE =
 * nada fica). Termina com `SELECT true AS gravado` (a linha que confirma o
 * COMMIT). Devolve null se não há nada a gravar.
 *
 * @param {{ vault?: {nome: string, valor: string}[], vapidPublica?: string }} pedido
 */
export function sqlDoBanco({ vault = [], vapidPublica } = {}) {
  const corpo = [];
  for (const item of vault) {
    if (!DESCRICAO_NO_VAULT.has(item?.nome)) {
      throw new Error("sqlDoBanco: nome de Vault fora da lista branca.");
    }
    const nome = literalSql(item.nome);
    corpo.push(
      `  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = ${nome}) THEN`,
      `    RAISE EXCEPTION 'B1_JA_EXISTE: o Vault já tem %; nada foi substituído.', ${nome};`,
      "  END IF;",
      `  PERFORM vault.create_secret(${literalSql(item.valor)}, ${nome}, ${literalSql(DESCRICAO_NO_VAULT.get(item.nome))});`,
    );
  }
  if (vapidPublica !== undefined) {
    corpo.push(
      `  UPDATE public.store_config SET vapid_public_key = ${literalSql(vapidPublica)} WHERE id = 1 AND (vapid_public_key IS NULL OR btrim(vapid_public_key) = '');`,
      "  IF NOT FOUND THEN",
      "    RAISE EXCEPTION 'B1_VAPID_JA_EXISTE: a coluna vapid_public_key já está preenchida (ou falta a linha id = 1); nada foi substituído.';",
      "  END IF;",
    );
  }
  if (corpo.length === 0) return null;
  return [
    "BEGIN;",
    "DO $b1$",
    "BEGIN",
    ...corpo,
    "END",
    "$b1$;",
    "COMMIT;",
    "SELECT true AS gravado;",
    "",
  ].join("\n");
}

/** Valores novos, de crypto forte. VAPID: P-256, pública = ponto sem
 * compressão (65 bytes, 0x04 + X + Y) e privada = escalar d (32 bytes), os dois
 * em base64url cru — o formato que jwkDoParVapidCru (_shared/webpush.ts) lê. */
export function gerarValores() {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = privateKey.export({ format: "jwk" });
  const publica = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]);
  return {
    chaveMp: randomBytes(32).toString("base64"),
    reconciliacao: randomBytes(32).toString("hex"),
    vapidPublica: publica.toString("base64url"),
    vapidPrivada: jwk.d,
  };
}

/** Formato de cada valor gerado (barra gerador quebrado ANTES de gravar). */
function valoresValidos(v) {
  if (v === null || typeof v !== "object") return false;
  const { chaveMp, reconciliacao, vapidPublica, vapidPrivada } = v;
  if (!(typeof chaveMp === "string" && /^[A-Za-z0-9+/]{43}=$/.test(chaveMp)))
    return false;
  if (
    !(typeof reconciliacao === "string" && /^[0-9a-f]{64}$/.test(reconciliacao))
  )
    return false;
  if (
    !(
      typeof vapidPublica === "string" &&
      /^[A-Za-z0-9_-]{87}$/.test(vapidPublica)
    )
  )
    return false;
  const publica = Buffer.from(vapidPublica, "base64url");
  if (publica.length !== 65 || publica[0] !== 0x04) return false;
  if (
    !(
      typeof vapidPrivada === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(vapidPrivada)
    )
  )
    return false;
  return Buffer.from(vapidPrivada, "base64url").length === 32;
}

/** Nome do tipo do erro, só se for um identificador simples. */
function nomeSeguro(e) {
  const nome = e?.name;
  return typeof nome === "string" && /^[A-Za-z]{1,40}$/.test(nome)
    ? nome
    : "erro";
}

/** O texto de um erro que pode ir para o relatório: o ErroDaGestao nasce sem
 * token e sem corpo; qualquer outro erro vira só o nome do tipo. */
function descrever(e) {
  if (e instanceof ErroDaGestao) return String(e.message).slice(0, 400);
  return `erro inesperado (${nomeSeguro(e)})`;
}

/** Falha de ESCRITA: "NÃO" só quando é certo que nada foi aplicado. */
function gravidadeDaFalha(e) {
  if (e instanceof SemAcesso) return "NÃO";
  if (e instanceof ErroDaGestao) {
    if (e.codigo === "PEDIDO_INVALIDO") return "NÃO";
    if (
      e.codigo === "HTTP" &&
      Number.isInteger(e.status) &&
      e.status >= 400 &&
      e.status < 500 &&
      e.status !== 408
    )
      return "NÃO";
  }
  return "INCERTO";
}

function foraDoFormato(oque) {
  return new ErroDaGestao(
    `Segredos: resposta de ${oque} fora do formato (não impressa).`,
    { codigo: "FORMATO" },
  );
}

/**
 * O estado, SÓ NOMES e booleanos: status do projeto; nomes dos secrets (o
 * digest que a API devolve junto é descartado aqui); se o Vault, a
 * store_config e a saude_da_loja() existem; nomes no Vault; se a linha id = 1
 * existe e tem chave pública. Fora de ACTIVE_HEALTHY para no status.
 */
export async function lerEstado(cliente, ref) {
  const projeto = await cliente.pedir("projeto", { ref });
  const status =
    typeof projeto?.status === "string" && /^[A-Z_]{1,40}$/.test(projeto.status)
      ? projeto.status
      : "ilegível";
  if (status !== PRONTO) return { pronto: false, status };

  const lista = await cliente.pedir("segredos", { ref });
  if (
    !Array.isArray(lista) ||
    !lista.every((s) => s !== null && typeof s?.name === "string")
  ) {
    throw foraDoFormato("GET /secrets");
  }
  const segredos = new Set(lista.map((s) => s.name));

  const [b, ...resto] = await cliente.consultarBanco(ref, SQL_ESTADO_DO_BANCO);
  if (
    resto.length > 0 ||
    typeof b?.vault_existe !== "boolean" ||
    typeof b?.store_config_existe !== "boolean" ||
    typeof b?.saude_existe !== "boolean"
  ) {
    throw foraDoFormato("estado do banco");
  }

  let storeConfigLinha = false;
  let temVapid = false;
  if (b.store_config_existe) {
    const r = await cliente.consultarBanco(ref, SQL_STORE_CONFIG);
    if (
      r.length !== 1 ||
      !(r[0]?.linhas === 0 || r[0]?.linhas === 1) ||
      typeof r[0]?.tem_vapid !== "boolean"
    ) {
      throw foraDoFormato("store_config");
    }
    storeConfigLinha = r[0].linhas === 1;
    temVapid = r[0].tem_vapid;
  }

  const vault = new Set();
  if (b.vault_existe) {
    const r = await cliente.consultarBanco(ref, SQL_NOMES_NO_VAULT);
    for (const l of r) {
      if (!DESCRICAO_NO_VAULT.has(l?.name)) throw foraDoFormato("Vault");
      vault.add(l.name);
    }
  }

  return {
    pronto: true,
    status,
    segredos,
    vaultExiste: b.vault_existe,
    vault,
    storeConfigLinha,
    temVapid,
    saudeExiste: b.saude_existe,
  };
}

function mesmoEstado(a, b) {
  if (a.pronto !== b.pronto || a.status !== b.status) return false;
  if (!a.pronto) return true;
  return (
    NOMES_RELEVANTES.every((n) => a.segredos.has(n) === b.segredos.has(n)) &&
    Object.values(V).every((n) => a.vault.has(n) === b.vault.has(n)) &&
    a.vaultExiste === b.vaultExiste &&
    a.storeConfigLinha === b.storeConfigLinha &&
    a.temVapid === b.temVapid
  );
}

/**
 * Pura: o que fazer com cada nome. Cada item: {nome, onde, rotulo, acao:
 * "criar"|"ja_existia"|"bloqueado"|"pulado", existe, motivo?, valor?: chave
 * em `valores`, ou "url"/"contato"}.
 */
export function planejarSegredos(estado, { vapidContato } = {}) {
  const itens = [];
  const item = (nome, onde, acao, extra = {}) =>
    itens.push({
      nome,
      onde,
      rotulo: onde === "store_config" ? COLUNA : `${onde} ${nome}`,
      acao,
      ...extra,
    });
  const tem = (n) => estado.segredos.has(n);

  // Passo 5: a chave de cifra (sozinha, sem par).
  if (tem(F.chaveMp)) item(F.chaveMp, "functions", "ja_existia");
  else item(F.chaveMp, "functions", "criar", { valor: "chaveMp" });

  // Passo 4: RECONCILIACAO_SECRET e reconciliacao_secret com o MESMO valor.
  const fR = tem(F.reconciliacao);
  const vR = estado.vault.has(V.segredo);
  if (!estado.vaultExiste) {
    const motivo =
      "o Vault (vault.secrets) não existe neste banco; sem ele o cron da reconciliação não tem de onde ler. Nada da reconciliação foi gravado (o secret sozinho viraria metade de um par).";
    item(F.reconciliacao, "functions", "bloqueado", { existe: fR, motivo });
    item(V.segredo, "Vault", "bloqueado", { existe: false, motivo });
    item(V.url, "Vault", "bloqueado", { existe: false, motivo });
  } else {
    if (fR && vR) {
      item(F.reconciliacao, "functions", "ja_existia", {
        nota: "o valor não é comparável pela API: se a reconciliação não rodar em 15 min, procure 401 no log da function",
      });
      item(V.segredo, "Vault", "ja_existia");
    } else if (!fR && !vR) {
      item(F.reconciliacao, "functions", "criar", { valor: "reconciliacao" });
      item(V.segredo, "Vault", "criar", { valor: "reconciliacao" });
    } else {
      const motivo = `estado incoerente: ${fR ? `${F.reconciliacao} existe nas functions e ${V.segredo} falta no Vault` : `${V.segredo} existe no Vault e ${F.reconciliacao} falta nas functions`}. Os dois têm de ter o MESMO valor e a API não devolve o valor de nenhum: nada da dupla foi gravado. Conserto (decisão humana; loja nova, sem venda): apagar o que existe (functions: painel Edge Functions > Secrets; Vault: SQL Editor) e rodar de novo.`;
      item(F.reconciliacao, "functions", "bloqueado", { existe: fR, motivo });
      item(V.segredo, "Vault", "bloqueado", { existe: vR, motivo });
    }
    if (estado.vault.has(V.url)) item(V.url, "Vault", "ja_existia");
    else item(V.url, "Vault", "criar", { valor: "url" });
  }

  // Passo 9: o par VAPID e a MESMA pública na store_config.
  const p = tem(F.vapidPublica);
  const k = tem(F.vapidPrivada);
  const c = estado.temVapid;
  if (!estado.storeConfigLinha) {
    const motivo =
      "public.store_config não tem a linha id = 1 (o banco foi instalado?): sem ela a chave pública não tem onde ficar. Nenhum VAPID foi gravado.";
    item(F.vapidPublica, "functions", "bloqueado", { existe: p, motivo });
    item(F.vapidPrivada, "functions", "bloqueado", { existe: k, motivo });
    item(COLUNA, "store_config", "bloqueado", { existe: false, motivo });
  } else if (p && k && c) {
    item(F.vapidPublica, "functions", "ja_existia");
    item(F.vapidPrivada, "functions", "ja_existia");
    item(COLUNA, "store_config", "ja_existia");
  } else if (!p && !k && !c) {
    item(F.vapidPublica, "functions", "criar", { valor: "vapidPublica" });
    item(F.vapidPrivada, "functions", "criar", { valor: "vapidPrivada" });
    item(COLUNA, "store_config", "criar", { valor: "vapidPublica" });
  } else {
    const motivo =
      p && k
        ? `estado incoerente: o par VAPID já existe nas functions, mas ${COLUNA} está vazia, e a API não devolve a pública do par. Nada foi substituído. Conserto (decisão humana): gravar à mão a pública desse par na coluna (runbook, passo 9), ou apagar os dois VAPID_* no painel e rodar de novo.`
        : !p && !k
          ? `estado incoerente: ${COLUNA} já tem uma chave pública, mas o par não está nas functions. Gerar outro par deixaria a coluna com a pública errada; nada foi substituído. Conserto (decisão humana): instalar o par dessa pública nas functions, ou limpar a coluna e rodar de novo.`
          : `estado incoerente: só metade do par VAPID está nas functions (${p ? F.vapidPublica : F.vapidPrivada}). Nada foi substituído. Conserto (decisão humana): apagar a metade que existe no painel e rodar de novo.`;
    item(F.vapidPublica, "functions", "bloqueado", { existe: p, motivo });
    item(F.vapidPrivada, "functions", "bloqueado", { existe: k, motivo });
    item(COLUNA, "store_config", "bloqueado", { existe: c, motivo });
  }

  if (tem(F.vapidContato)) item(F.vapidContato, "functions", "ja_existia");
  else if (vapidContato !== undefined)
    item(F.vapidContato, "functions", "criar", { valor: "contato" });
  else
    item(F.vapidContato, "functions", "pulado", {
      motivo:
        "sem --vapid-subject; o aviso ao lojista usa um contato de exemplo até alguém gravar o contato da loja (mailto: ou https://)",
    });

  return { itens };
}

/** O que falta para a loja estar pronta (só nomes). Exportada para o
 * `conferir` do nova-loja.mjs usar a MESMA lista. */
export function faltandoNo(estado) {
  const falta = [];
  for (const n of [F.chaveMp, F.reconciliacao, F.vapidPublica, F.vapidPrivada])
    if (!estado.segredos.has(n)) falta.push(`functions ${n}`);
  for (const n of Object.values(V))
    if (!estado.vault.has(n)) falta.push(`Vault ${n}`);
  if (!estado.temVapid) falta.push(COLUNA);
  return falta;
}

/** Só INFORMA se a reconciliação já rodou; nunca muda o veredito. */
async function linhaDaSaude(cliente, ref, estado) {
  if (!estado.saudeExiste) {
    return "reconciliação: saude_da_loja() não existe neste banco (falta a migration 20261500000000): não dá para dizer se já rodou.";
  }
  try {
    const r = await cliente.consultarBanco(ref, SQL_SAUDE);
    const idade = r[0]?.saude?.idade_rodada_s;
    if (idade === null || idade === undefined) {
      return "reconciliação: saude_da_loja() diz que ainda não rodou. Até 10 min depois de gravar os segredos é normal (o cron roda de 10 em 10 min); passou de 15 min, confira o passo 4 do runbook.";
    }
    if (typeof idade !== "number" || !Number.isFinite(idade)) {
      return "reconciliação: saude_da_loja() respondeu fora do formato.";
    }
    const s = Math.round(idade);
    return s < 900
      ? `reconciliação: já rodou (última rodada há ${s} s).`
      : `reconciliação: a última rodada foi há ${s} s (mais de 15 min): parada? Confira o passo 4 do runbook.`;
  } catch (e) {
    return `reconciliação: saude_da_loja() não deu para ler (${descrever(e)}).`;
  }
}

/**
 * Lê, planeja e (só com `aplicar === true`) grava. Devolve
 * { veredito: "SIM"|"NÃO"|"INCERTO", linhas: string[], escritas: number }.
 * Nenhuma linha traz valor de segredo.
 *
 * @param {{
 *   cliente: { pedir: Function, consultarBanco: Function },
 *   ref: string,
 *   aplicar?: boolean,
 *   gerar?: () => {chaveMp: string, reconciliacao: string, vapidPublica: string, vapidPrivada: string},
 *   vapidContato?: string,
 * }} opcoes
 */
export async function instalarSegredos({
  cliente,
  ref,
  aplicar,
  gerar = gerarValores,
  vapidContato,
} = {}) {
  const ehAplicar = aplicar === true;
  const linhas = [];
  let escritas = 0;
  const fim = (veredito) => ({ veredito, linhas, escritas });

  if (!(typeof ref === "string" && RE_REF.test(ref))) {
    linhas.push(
      "RECUSADO: --projeto inválido (esperado 20 letras minúsculas).",
    );
    return fim("NÃO");
  }
  if (
    vapidContato !== undefined &&
    !(
      typeof vapidContato === "string" &&
      vapidContato.length <= 200 &&
      RE_CONTATO.test(vapidContato)
    )
  ) {
    linhas.push(
      "RECUSADO: --vapid-subject tem de ser mailto:alguem@dominio ou https://... (sem espaço nem aspa). Nada foi lido nem gravado.",
    );
    return fim("NÃO");
  }

  let antes;
  try {
    antes = await lerEstado(cliente, ref);
  } catch (e) {
    linhas.push(
      `FALHOU ao ler o estado da loja: ${descrever(e)} Nada foi gravado.`,
    );
    return fim("INCERTO");
  }
  if (!antes.pronto) {
    linhas.push(
      `RECUSADO: o projeto ${ref} está ${antes.status}, não ${PRONTO}. SQL antes disso falha; espere o projeto ficar pronto e rode de novo. Nada foi gravado.`,
    );
    return fim("NÃO");
  }

  const { itens } = planejarSegredos(antes, { vapidContato });
  const aCriar = itens.filter((i) => i.acao === "criar");
  const resultado = new Map(); // item -> "gravado" | "nao_gravado" | "desconhecido" | "nao_enviado"
  let gravidade = null; // pior falha de escrita: "NÃO" | "INCERTO"

  if (ehAplicar && aCriar.length > 0) {
    // Releitura IMEDIATAMENTE antes de gravar: o POST /secrets é upsert.
    let agora;
    try {
      agora = await lerEstado(cliente, ref);
    } catch (e) {
      linhas.push(
        `FALHOU ao reler o estado antes de gravar: ${descrever(e)} Nada foi gravado.`,
      );
      return fim("INCERTO");
    }
    if (!mesmoEstado(antes, agora)) {
      linhas.push(
        `RECUSADO: o estado da loja mudou entre o plano e a escrita (outro processo, ou alguém no painel; projeto ${agora.status}). Nada foi gravado: rode de novo.`,
      );
      return fim("NÃO");
    }

    const precisaGerar = aCriar.some(
      (i) => i.valor !== "url" && i.valor !== "contato",
    );
    const valores = precisaGerar ? gerar() : null;
    if (precisaGerar && !valoresValidos(valores)) {
      linhas.push(
        "FALHOU: o gerador devolveu valor fora do formato esperado (não impresso). Nada foi gravado.",
      );
      return fim("NÃO");
    }
    const valorDe = (i) =>
      i.valor === "url"
        ? urlDaReconciliacao(ref)
        : i.valor === "contato"
          ? vapidContato
          : Reflect.get(valores, i.valor);

    const nasFunctions = aCriar.filter((i) => i.onde === "functions");
    const noBanco = aCriar.filter((i) => i.onde !== "functions");

    if (nasFunctions.length > 0) {
      try {
        escritas += 1;
        await cliente.pedir("segredos", {
          ref,
          metodo: "POST",
          corpo: nasFunctions.map((i) => ({ name: i.nome, value: valorDe(i) })),
        });
        for (const i of nasFunctions) resultado.set(i, "gravado");
      } catch (e) {
        gravidade = gravidadeDaFalha(e);
        for (const i of nasFunctions)
          resultado.set(
            i,
            gravidade === "NÃO" ? "nao_gravado" : "desconhecido",
          );
        for (const i of noBanco) resultado.set(i, "nao_enviado");
        linhas.push(
          gravidade === "NÃO"
            ? `FALHOU: o POST dos secrets foi recusado (${descrever(e)}). Nada foi gravado nas functions nem no banco.`
            : `ESTADO DESCONHECIDO: o POST dos secrets pode ter sido aplicado sem resposta (${descrever(e)}). O banco NÃO foi chamado. Confira a lista de secrets antes de rodar de novo: se eles estiverem lá sem o Vault, a reconciliação e o VAPID ficam incoerentes e a releitura vai dizer o conserto.`,
        );
      }
    }

    if (gravidade === null && noBanco.length > 0) {
      const sql = sqlDoBanco({
        vault: noBanco
          .filter((i) => i.onde === "Vault")
          .map((i) => ({ nome: i.nome, valor: valorDe(i) })),
        vapidPublica: noBanco.some((i) => i.onde === "store_config")
          ? valores.vapidPublica
          : undefined,
      });
      try {
        escritas += 1;
        const r = await cliente.consultarBanco(ref, sql);
        if (!(r.length === 1 && r[0]?.gravado === true)) {
          throw new ErroDaGestao(
            "Segredos: a transação do banco voltou sem a linha de confirmação (gravado).",
            { codigo: ESTADO_DESCONHECIDO },
          );
        }
        for (const i of noBanco) resultado.set(i, "gravado");
      } catch (e) {
        gravidade = gravidadeDaFalha(e);
        for (const i of noBanco)
          resultado.set(
            i,
            gravidade === "NÃO" ? "nao_gravado" : "desconhecido",
          );
        const soltos = nasFunctions
          .filter((i) => i.valor !== "chaveMp" && i.valor !== "contato")
          .map((i) => i.nome);
        linhas.push(
          gravidade === "NÃO"
            ? `FALHOU: o banco recusou a transação (${descrever(e)}); ela voltou inteira, nada do Vault nem da store_config ficou.`
            : `ESTADO DESCONHECIDO: a transação do banco pode ter sido aplicada sem resposta (${descrever(e)}). Confira o Vault e a store_config antes de rodar de novo.`,
        );
        if (soltos.length > 0) {
          linhas.push(
            `ATENÇÃO: os secrets ${soltos.join(", ")} foram gravados nesta rodada e a parte do banco não. Este script não completa nem substitui (a API não devolve o valor). Conserto (decisão humana; loja nova, sem venda): apagar esses secrets no painel (Edge Functions > Secrets) e rodar de novo.`,
          );
        }
      }
    }
  }

  // O relatório, item por item (só nomes).
  for (const i of itens) {
    if (i.acao === "ja_existia") {
      linhas.push(
        `${i.rotulo}: já existia (mantido, nunca substituído)${i.nota ? `; ${i.nota}` : ""}.`,
      );
    } else if (i.acao === "bloqueado") {
      linhas.push(
        `${i.rotulo}: ${i.existe ? "já existia" : "falta"} — BLOQUEADO: ${i.motivo}`,
      );
    } else if (i.acao === "pulado") {
      linhas.push(`${i.rotulo}: não gravado (${i.motivo}).`);
    } else if (!ehAplicar) {
      linhas.push(`${i.rotulo}: falta — criaria (rode com --aplicar).`);
    } else {
      const r = resultado.get(i);
      linhas.push(
        r === "gravado"
          ? `${i.rotulo}: gravado.`
          : r === "desconhecido"
            ? `${i.rotulo}: ESTADO DESCONHECIDO (pode ter sido gravado).`
            : r === "nao_enviado"
              ? `${i.rotulo}: não enviado (a escrita anterior falhou).`
              : `${i.rotulo}: não gravado (recusado).`,
      );
    }
  }

  // Conferência: relê quando gravou (ou tentou); senão o estado lido vale.
  let depois = antes;
  if (escritas > 0) {
    try {
      depois = await lerEstado(cliente, ref);
    } catch (e) {
      linhas.push(
        `FALHOU a conferência final (${descrever(e)}): sem ela não digo SIM.`,
      );
      return fim("INCERTO");
    }
    if (!depois.pronto) {
      linhas.push(
        `FALHOU a conferência final: o projeto está ${depois.status}, não ${PRONTO}.`,
      );
      return fim("INCERTO");
    }
  }
  const falta = faltandoNo(depois);
  linhas.push(
    falta.length === 0
      ? "conferência: todos os nomes existem (functions, Vault e store_config)."
      : `conferência: falta ${falta.join(", ")}.`,
  );
  linhas.push(await linhaDaSaude(cliente, ref, depois));

  if (gravidade === "INCERTO") return fim("INCERTO");
  return fim(falta.length === 0 ? "SIM" : "NÃO");
}

// ─── o comando ──────────────────────────────────────────────────────────────

const USO =
  "Uso: node scripts/frota/segredos-da-loja.mjs --projeto <ref> [--aplicar] [--vapid-subject mailto:...|https://...]\n(token em SUPABASE_ACCESS_TOKEN; sem --aplicar só lê e mostra o plano)";

function lerArgumentos(argv) {
  const a = { aplicar: false };
  const vistos = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv.at(i);
    if (vistos.has(arg)) return null;
    vistos.add(arg);
    if (arg === "--aplicar") a.aplicar = true;
    else if (arg === "--projeto" || arg === "--vapid-subject") {
      const v = argv.at(i + 1);
      if (typeof v !== "string" || v.startsWith("--")) return null;
      if (arg === "--projeto") a.projeto = v;
      else a.vapidContato = v;
      i += 1;
    } else return null;
  }
  return a;
}

const CODIGO = new Map([
  ["SIM", 0],
  ["NÃO", 1],
  ["INCERTO", 2],
]);

/**
 * @param {string[]} argv
 * @param {{ env?: object, fetch?: typeof fetch, gerar?: Function }} deps
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const env = deps.env ?? process.env;
  const a = lerArgumentos(argv);
  if (!a || typeof a.projeto !== "string" || !RE_REF.test(a.projeto)) {
    console.error(`RECUSADO: argumentos inválidos.\n${USO}`);
    return 1;
  }
  const token = String(env.SUPABASE_ACCESS_TOKEN ?? "").trim();
  if (token.length === 0) {
    console.error(
      "RECUSADO: SUPABASE_ACCESS_TOKEN vazio (o token de gestão da conta da loja). Nada foi lido nem gravado.",
    );
    return 1;
  }
  let r;
  try {
    r = await instalarSegredos({
      cliente: criarClienteGestao({
        token,
        fetch: deps.fetch ?? globalThis.fetch,
      }),
      ref: a.projeto,
      aplicar: a.aplicar,
      gerar: deps.gerar ?? gerarValores,
      vapidContato: a.vapidContato,
    });
  } catch (e) {
    console.error(
      `FALHOU: erro inesperado (${nomeSeguro(e)}). Rode sem --aplicar para ver o estado antes de tentar de novo.`,
    );
    console.log(
      `VEREDITO-SEGREDOS-DA-LOJA projeto=${a.projeto} veredito=INCERTO aplicar=${a.aplicar}`,
    );
    return 2;
  }
  for (const l of r.linhas) console.log(l);
  console.log(
    `VEREDITO-SEGREDOS-DA-LOJA projeto=${a.projeto} veredito=${r.veredito === "NÃO" ? "NAO" : r.veredito} aplicar=${a.aplicar}`,
  );
  return CODIGO.get(r.veredito) ?? 2;
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
      console.error(`FALHOU: erro inesperado (${nomeSeguro(e)}).`);
      process.exitCode = 2;
    },
  );
}
