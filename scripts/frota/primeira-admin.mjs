import { createRequire } from "node:module";
/**
 * primeira-admin.mjs — a PRIMEIRA administradora da loja nova pela Management
 * API do Supabase (plano nova-loja, B3, 26/11/2026). Substitui as Telas P0–P3
 * do passo 8 de docs/runbooks/producao-unica-fonte.md (SQL Editor à mão).
 *
 * USO (o e-mail entra SÓ pelo stdin, uma linha):
 *   Read-Host "e-mail da administradora" | node scripts/frota/primeira-admin.mjs --projeto <ref> --loja <slug> [--aplicar]
 *   (Read-Host, nunca o e-mail digitado na linha de comando: a linha vai para o histórico do PowerShell.)
 *   BEGIN ISOLATION LEVEL READ COMMITTED: a guarda de 0 admins depende do snapshot novo DEPOIS da trava
 *   (revisão Opus 26/11); um projeto com default_transaction_isolation=repeatable read deixaria duas rodadas passarem.
 *   --projeto  ref do projeto Supabase da loja (20 letras minúsculas).
 *   --loja     nome da loja no cofre local (é a chave do refresh OAuth da
 *              lojista em scripts/frota/acesso-oauth.mjs).
 *   --aplicar  sem ele, só LÊ o estado e mostra o plano: zero escrita.
 * Saída final: "VEREDITO: SIM|NÃO|INCERTO — ..." (código 0 / 1 / 2).
 *
 * POR QUE ASSIM (o mecanismo está no passo 8 do roteiro): ser administradora
 * é ter `admin` nas DUAS fontes do cargo, public.profiles.role e
 * auth.users.raw_app_meta_data ->> 'role' (is_admin_atual lê as duas). Quem
 * grava a segunda é o gatilho tr_sync_profile_role_to_auth, a partir do
 * UPDATE em profiles. As travas de cargo deixam esse UPDATE passar SÓ na
 * sessão que está no papel `postgres` (GUC `role`): prevent_role_change
 * (is_admin() e is_admin_atual() aceitam `postgres`), papel_so_pelo_definir_
 * cargo (lista de automação de confiança) e ensure_role_protection (sem
 * auth.uid() não age). Por isso `SET LOCAL ROLE postgres` vai na MESMA
 * transação do UPDATE — o mesmo que a Tela P2 faz. Que a Management API
 * aceita esse SET LOCAL ROLE é a prova P5 da T1; se não aceitar, o banco
 * recusa a transação inteira e o veredito é NÃO (nada gravado).
 *
 * O QUE ESTE ARQUIVO GARANTE (tests/frota_primeira_admin_test.ts trava):
 *  - o e-mail nunca sai: nem na saída, nem em erro (só "N caracteres"). Ele
 *    vai ao banco como literal SQL com a aspa dobrada, numa instrução
 *    `SET LOCAL` FORA de qualquer dollar-quote, e o resto do SQL é fixo;
 *    entrada com barra invertida, espaço, controle ou sem arroba é recusada
 *    antes da rede;
 *  - leitura primeiro (read_only), escrita só com --aplicar e só se a leitura
 *    disse "promover"; a escrita é UMA requisição BEGIN…COMMIT cujo DO repete
 *    TODAS as guardas (a leitura é para explicar; a guarda que vale é a de
 *    dentro da transação) e termina na conferência 1,1,1: 1 conta, 1 linha
 *    mudada, 1 administradora no total, com `admin` nas duas fontes;
 *  - rodar de novo é seguro: a mesma pessoa já admin única = SIM sem gravar;
 *    outra admin = NÃO; duas rodadas ao mesmo tempo se enfileiram na trava
 *    pg_advisory_xact_lock e a segunda vê a primeira;
 *  - INCERTO nunca vira SIM: resposta que não é exatamente a esperada, ou
 *    falha sem SQLSTATE (rede, prazo, gateway), é INCERTO.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { criarAcessoOAuth } from "./acesso-oauth.mjs";
import { criarCofreDpapi } from "./cofre-local.mjs";
import { ErroDaGestao, criarClienteGestao } from "./supabase-gestao.mjs";

const require = createRequire(import.meta.url);
const { RE_PROJETO, RE_REF } = require("./lojas.cjs");

const USO =
  'uso: Read-Host "e-mail" | node scripts/frota/primeira-admin.mjs --projeto <ref> --loja <slug> [--aplicar]  (o e-mail entra SÓ pelo stdin)';

export class ErroDaPrimeiraAdmin extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = "ErroDaPrimeiraAdmin";
  }
}

// --------------------------------------------------------------- entrada --

/** Argumentos. Nunca aceita o e-mail aqui (argumento fica no histórico do
 * terminal e na lista de processos). Mensagem de erro sem ecoar o valor. */
export function lerArgumentos(argv) {
  const args = { projeto: undefined, loja: undefined, aplicar: false };
  const vistos = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv.at(i);
    if (vistos.has(a)) {
      throw new ErroDaPrimeiraAdmin(`argumento repetido. ${USO}`);
    }
    vistos.add(a);
    if (a === "--aplicar") {
      args.aplicar = true;
    } else if (a === "--projeto" || a === "--loja") {
      const v = argv.at(i + 1);
      i++;
      if (a === "--projeto") {
        if (!(typeof v === "string" && RE_REF.test(v))) {
          throw new ErroDaPrimeiraAdmin(
            `--projeto precisa do ref do projeto (20 letras minúsculas). ${USO}`,
          );
        }
        args.projeto = v;
      } else {
        if (!(typeof v === "string" && RE_PROJETO.test(v))) {
          throw new ErroDaPrimeiraAdmin(
            `--loja precisa do nome da loja no cofre (minúsculas, dígitos e hífen). ${USO}`,
          );
        }
        args.loja = v;
      }
    } else {
      throw new ErroDaPrimeiraAdmin(
        `argumento desconhecido (não impresso; o e-mail vai pelo stdin). ${USO}`,
      );
    }
  }
  if (args.projeto === undefined) {
    throw new ErroDaPrimeiraAdmin(`falta --projeto. ${USO}`);
  }
  if (args.loja === undefined) {
    throw new ErroDaPrimeiraAdmin(`falta --loja. ${USO}`);
  }
  return args;
}

/** Uma parte do e-mail: sem espaço (nenhum, nem Unicode), sem controle, sem
 * barra invertida (assim o literal não depende de standard_conforming_strings)
 * e sem arroba. */
const RE_EMAIL = /^[^\s@\\\p{Cc}]+@[^\s@\\\p{Cc}]+$/u;
const TETO_EMAIL = 254;

/** O e-mail como literal SQL: aspas simples, com a aspa de dentro dobrada.
 * Recusa (sem ecoar) o que não tem forma de e-mail. */
export function literalDoEmail(email) {
  if (
    typeof email !== "string" ||
    email.length > TETO_EMAIL ||
    !RE_EMAIL.test(email)
  ) {
    throw new ErroDaPrimeiraAdmin(
      "o texto recebido não tem forma de e-mail (uma linha, com @, sem espaço nem barra invertida, até 254 caracteres); não é impresso.",
    );
  }
  return `'${email.replaceAll("'", "''")}'`;
}

/** O stdin: uma linha só (espaço em volta e a quebra final saem). */
export function emailDaEntrada(texto) {
  if (typeof texto !== "string") {
    throw new ErroDaPrimeiraAdmin("não recebi o e-mail pelo stdin.");
  }
  const email = texto.replace(/^﻿/, "").trim();
  if (email === "") {
    throw new ErroDaPrimeiraAdmin(
      `stdin vazio: o e-mail entra pelo stdin. ${USO}`,
    );
  }
  literalDoEmail(email);
  return email;
}

// -------------------------------------------------------------------- SQL --

/** UMA instrução SELECT, só leitura. Devolve uma linha com contagens e
 * cargos: nenhum id, nenhum e-mail. `admins` = quem é admin em QUALQUER das
 * duas fontes (união por id). */
export function sqlDoDiagnostico(email) {
  const lit = literalDoEmail(email);
  return `WITH alvo AS MATERIALIZED (
  SELECT lower(${lit}) AS email
), contas AS MATERIALIZED (
  SELECT u.id, u.email_confirmed_at IS NOT NULL AS confirmada, u.raw_app_meta_data ->> 'role' AS cargo_login
    FROM auth.users u JOIN alvo ON lower(u.email) = alvo.email
), admins AS MATERIALIZED (
  SELECT p.id FROM public.profiles p WHERE p.role = 'admin'
  UNION
  SELECT u.id FROM auth.users u WHERE u.raw_app_meta_data ->> 'role' = 'admin'
)
SELECT (SELECT count(*) FROM contas)::int AS contas,
       COALESCE((SELECT bool_and(c.confirmada) FROM contas c), false) AS confirmada,
       (SELECT c.cargo_login FROM contas c ORDER BY c.id LIMIT 1) AS cargo_login,
       EXISTS (SELECT 1 FROM contas c JOIN public.profiles p ON p.id = c.id) AS tem_perfil,
       (SELECT p.role FROM contas c JOIN public.profiles p ON p.id = c.id ORDER BY c.id LIMIT 1) AS cargo_perfil,
       (SELECT count(*) FROM admins)::int AS admins,
       EXISTS (SELECT 1 FROM admins a JOIN contas c ON c.id = a.id) AS alvo_admin;`;
}

/** Cada recusa de dentro da transação tem um SQLSTATE próprio (classe IK):
 * o cliente da gestão só deixa sair o SQLSTATE do corpo de erro (o corpo
 * ecoa o SQL, que leva o e-mail). */
const RECUSAS = Object.freeze({
  IKA01:
    "nenhuma conta com esse e-mail nesta loja: ela tem de se cadastrar NA LOJA com esse e-mail (Tela P0 do passo 8); confira também se o --projeto é o da loja certa",
  IKA02:
    "mais de uma conta com esse e-mail nesta loja: pare e avise o programador",
  IKA03:
    "ela ainda não confirmou o e-mail: peça que abra o link de confirmação que chegou no e-mail do cadastro e entre na loja uma vez; depois rode de novo",
  IKA04:
    "a conta existe mas está sem perfil (public.profiles): pare e avise o programador",
  IKA05:
    "a loja já tem outra administradora: daqui em diante quem dá o cargo é o dono da loja, pelo painel (definir_cargo); este comando só cria a PRIMEIRA",
  IKA06:
    "as duas fontes do cargo discordam (login e perfil): decisão do dono do produto, não se mexe aqui",
  IKA07:
    "cargo inesperado na conta (nem cliente nem administradora nas duas fontes): pare e avise o programador",
  IKA08:
    "a conferência 1,1,1 (1 conta, 1 linha mudada, 1 administradora) não fechou",
});

/** A escrita: UMA requisição, SEM `parameters` (com eles o pg-meta usa o
 * protocolo estendido e só aceita uma instrução). O `SET LOCAL ROLE postgres`
 * NÃO é enfeite mesmo com a sessão já sendo `postgres` (pesquisa T1, P5): as
 * travas de cargo leem o GUC `role`, e numa sessão de login direto ele vale
 * `none` — prevent_role_change recusa (tests/banco/definir-cargo-so-o-dono-
 * viva.cjs, "sessão de login direto"). O `lock_timeout` faz a espera da trava
 * virar erro com SQLSTATE (55P03, nada gravado) antes do prazo de ~55 s do
 * pg-meta, que viraria INCERTO. O e-mail entra SÓ na 4ª instrução (SET LOCAL,
 * fora do dollar-quote); o DO o lê por current_setting. O resultado (sem
 * e-mail) volta por um GUC de sessão gravado DENTRO da transação: só existe
 * se ela comitou, e a última instrução, depois do COMMIT, só o lê. */
export function sqlDaPromocao(email) {
  const lit = literalDoEmail(email);
  return `BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL ROLE postgres;
SET LOCAL lock_timeout = '10s';
SET LOCAL ikcous.primeira_admin_email = ${lit};
DO $primeira_admin$
DECLARE
  v_email text := lower(current_setting('ikcous.primeira_admin_email'));
  v_contas integer;
  v_id uuid;
  v_confirmada boolean;
  v_cargo_login text;
  v_cargo_perfil text;
  v_admins integer;
  v_alvo_admin boolean;
  v_linhas integer := 0;
BEGIN
  PERFORM set_config('ikcous.primeira_admin_resultado', '', false);
  -- Duas rodadas ao mesmo tempo (e-mails diferentes): a segunda espera aqui e,
  -- em READ COMMITTED, as contagens abaixo já veem o que a primeira gravou.
  PERFORM pg_advisory_xact_lock(hashtext('ikcous.primeira_admin'));

  SELECT count(*) INTO v_contas FROM auth.users u WHERE lower(u.email) = v_email;
  IF v_contas = 0 THEN
    RAISE EXCEPTION 'primeira-admin: nenhuma conta' USING ERRCODE = 'IKA01';
  END IF;
  IF v_contas > 1 THEN
    RAISE EXCEPTION 'primeira-admin: conta repetida' USING ERRCODE = 'IKA02';
  END IF;
  SELECT u.id, u.email_confirmed_at IS NOT NULL, u.raw_app_meta_data ->> 'role'
    INTO v_id, v_confirmada, v_cargo_login
    FROM auth.users u WHERE lower(u.email) = v_email;
  IF NOT v_confirmada THEN
    RAISE EXCEPTION 'primeira-admin: e-mail nao confirmado' USING ERRCODE = 'IKA03';
  END IF;
  SELECT p.role INTO v_cargo_perfil FROM public.profiles p WHERE p.id = v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'primeira-admin: sem perfil' USING ERRCODE = 'IKA04';
  END IF;

  SELECT count(*), COALESCE(bool_or(a.id = v_id), false) INTO v_admins, v_alvo_admin
    FROM (SELECT p.id FROM public.profiles p WHERE p.role = 'admin'
          UNION
          SELECT u.id FROM auth.users u WHERE u.raw_app_meta_data ->> 'role' = 'admin') a;
  IF v_admins = 1 AND v_alvo_admin AND v_cargo_login = 'admin' AND v_cargo_perfil = 'admin' THEN
    PERFORM set_config('ikcous.primeira_admin_resultado',
      json_build_object('acao', 'ja_era_admin', 'usuarios', v_contas, 'linhas', 0, 'admins', v_admins)::text, false);
    RETURN;
  END IF;
  IF v_admins > 0 AND (NOT v_alvo_admin OR v_admins > 1) THEN
    RAISE EXCEPTION 'primeira-admin: a loja ja tem administradora' USING ERRCODE = 'IKA05';
  END IF;
  IF v_admins > 0 THEN
    RAISE EXCEPTION 'primeira-admin: as fontes do cargo discordam' USING ERRCODE = 'IKA06';
  END IF;
  IF v_cargo_login IS DISTINCT FROM 'customer' OR v_cargo_perfil IS DISTINCT FROM 'customer' THEN
    RAISE EXCEPTION 'primeira-admin: cargo inesperado' USING ERRCODE = 'IKA07';
  END IF;

  UPDATE public.profiles SET role = 'admin' WHERE id = v_id AND role = 'customer';
  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  SELECT count(*), COALESCE(bool_or(a.id = v_id), false) INTO v_admins, v_alvo_admin
    FROM (SELECT p.id FROM public.profiles p WHERE p.role = 'admin'
          UNION
          SELECT u.id FROM auth.users u WHERE u.raw_app_meta_data ->> 'role' = 'admin') a;
  SELECT count(*) INTO v_contas FROM auth.users u WHERE lower(u.email) = v_email;
  IF v_contas <> 1 OR v_linhas <> 1 OR v_admins <> 1 OR NOT v_alvo_admin OR NOT EXISTS (
    SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id = u.id
     WHERE u.id = v_id AND u.raw_app_meta_data ->> 'role' = 'admin' AND p.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'primeira-admin: conferencia 1,1,1 falhou' USING ERRCODE = 'IKA08';
  END IF;
  PERFORM set_config('ikcous.primeira_admin_resultado',
    json_build_object('acao', 'promovida', 'usuarios', v_contas, 'linhas', v_linhas, 'admins', v_admins)::text, false);
END
$primeira_admin$;
COMMIT;
SELECT current_setting('ikcous.primeira_admin_resultado', true) AS resultado;`;
}

// ---------------------------------------------------------------- decisão --

const COLUNAS_DO_DIAGNOSTICO = [
  "contas",
  "confirmada",
  "cargo_login",
  "tem_perfil",
  "cargo_perfil",
  "admins",
  "alvo_admin",
];

const inteiroNaoNegativo = (v) => Number.isSafeInteger(v) && v >= 0;
const textoOuNulo = (v) => v === null || typeof v === "string";

function linhaDoDiagnostico(linhas) {
  if (!Array.isArray(linhas) || linhas.length !== 1) return null;
  const l = linhas[0];
  if (l === null || typeof l !== "object" || Array.isArray(l)) return null;
  const chaves = Object.keys(l).sort();
  if (chaves.join(",") !== [...COLUNAS_DO_DIAGNOSTICO].sort().join(","))
    return null;
  if (
    !inteiroNaoNegativo(l.contas) ||
    typeof l.confirmada !== "boolean" ||
    !textoOuNulo(l.cargo_login) ||
    typeof l.tem_perfil !== "boolean" ||
    !textoOuNulo(l.cargo_perfil) ||
    !inteiroNaoNegativo(l.admins) ||
    typeof l.alvo_admin !== "boolean"
  ) {
    return null;
  }
  return l;
}

/**
 * Pura: a linha do diagnóstico → { tipo, mensagem }.
 * tipo: "promover" | "ja_admin" | "recusar" | "incerto". A MESMA ordem de
 * guardas do DO de sqlDaPromocao.
 */
export function decidir(linhas) {
  const l = linhaDoDiagnostico(linhas);
  if (!l) {
    return {
      tipo: "incerto",
      mensagem:
        "a leitura do estado voltou num formato inesperado; nada foi gravado",
    };
  }
  const recusa = (codigo) => ({
    tipo: "recusar",
    mensagem: Reflect.get(RECUSAS, codigo),
  });
  if (l.contas === 0) return recusa("IKA01");
  if (l.contas > 1) return recusa("IKA02");
  if (!l.confirmada) return recusa("IKA03");
  if (!l.tem_perfil) return recusa("IKA04");
  if (
    l.admins === 1 &&
    l.alvo_admin &&
    l.cargo_login === "admin" &&
    l.cargo_perfil === "admin"
  ) {
    return {
      tipo: "ja_admin",
      mensagem: "ela já era admin (a única da loja); nada foi gravado",
    };
  }
  if (l.admins > 0 && (!l.alvo_admin || l.admins > 1)) return recusa("IKA05");
  if (l.admins > 0) return recusa("IKA06");
  if (l.cargo_login !== "customer" || l.cargo_perfil !== "customer") {
    return recusa("IKA07");
  }
  return {
    tipo: "promover",
    mensagem:
      "conta única e confirmada, cliente nas duas fontes do cargo, loja sem administradora",
  };
}

/** A linha final da escrita → "promovida" | "ja_era_admin" | null (null =
 * qualquer coisa fora do exato: INCERTO). */
function resultadoDaEscrita(linhas) {
  if (!Array.isArray(linhas) || linhas.length !== 1) return null;
  const l = linhas[0];
  if (l === null || typeof l !== "object" || Array.isArray(l)) return null;
  if (Object.keys(l).join(",") !== "resultado") return null;
  if (typeof l.resultado !== "string" || l.resultado === "") return null;
  let r;
  try {
    r = JSON.parse(l.resultado);
  } catch {
    return null;
  }
  if (r === null || typeof r !== "object" || Array.isArray(r)) return null;
  if (Object.keys(r).sort().join(",") !== "acao,admins,linhas,usuarios")
    return null;
  if (r.usuarios !== 1 || r.admins !== 1) return null;
  if (r.acao === "promovida" && r.linhas === 1) return "promovida";
  if (r.acao === "ja_era_admin" && r.linhas === 0) return "ja_era_admin";
  return null;
}

// ------------------------------------------------------------ execução --

const SIM = (m) => ({ codigo: 0, linha: `VEREDITO: SIM — ${m}` });
const NAO = (m) => ({ codigo: 1, linha: `VEREDITO: NÃO — ${m}` });
const INCERTO = (m) => ({ codigo: 2, linha: `VEREDITO: INCERTO — ${m}` });

/** Mensagem de erro que pode ir à tela: só a nossa e a do cliente da gestão
 * (que já é escrita sem token e sem corpo de resposta). Qualquer outra
 * (cofre, rede crua) sai só pelo nome. */
function mensagemSegura(e) {
  if (e instanceof ErroDaGestao || e instanceof ErroDaPrimeiraAdmin) {
    return e.message;
  }
  const nome = e?.name;
  return typeof nome === "string" && /^[A-Za-z]{1,40}$/.test(nome)
    ? `falha do tipo ${nome} (detalhe não impresso)`
    : "falha sem detalhe imprimível";
}

/** O erro da escrita → veredito. Só um erro do PRÓPRIO Postgres (SQLSTATE no
 * corpo) prova que o COMMIT não rodou; o resto é INCERTO. */
function vereditoDoErroDaEscrita(e) {
  const sqlstate =
    e instanceof ErroDaGestao && e.codigo === "HTTP" ? e.sqlstate : undefined;
  if (typeof sqlstate !== "string") {
    return INCERTO(
      `a resposta não diz se a transação comitou (${mensagemSegura(e)}). Rode de novo SEM --aplicar para ler o estado (repetir é seguro: a mesma pessoa já admin dá SIM sem gravar)`,
    );
  }
  if (Object.hasOwn(RECUSAS, sqlstate)) {
    return NAO(
      `${Reflect.get(RECUSAS, sqlstate)} (o banco recusou por dentro da transação, SQLSTATE ${sqlstate}: nada foi gravado)`,
    );
  }
  if (sqlstate === "42501" || sqlstate === "P0001") {
    return NAO(
      `o banco recusou a transação (SQLSTATE ${sqlstate}): provavelmente o SET LOCAL ROLE postgres não valeu por esta API (prova P5 da T1) e a trava de cargo barrou o UPDATE. Nada foi gravado; não improvise outro caminho, volte a decisão ao programador`,
    );
  }
  if (sqlstate === "55P03") {
    return NAO(
      "outra rodada deste comando segurava a trava da loja há mais de 10 s (SQLSTATE 55P03); nada foi gravado. Espere e rode de novo",
    );
  }
  return NAO(
    `o banco recusou a transação (SQLSTATE ${sqlstate}); nada foi gravado`,
  );
}

/**
 * Lógica inteira, sem processo: devolve { codigo, saida, erros }.
 * deps: { lerEntrada(): Promise<string>, obterToken({loja}): Promise<string>,
 *         fetch?, prazoMs? }.
 */
export async function executar(argv, deps) {
  const saida = [];
  const erros = [];
  const fim = (v) => {
    saida.push(v.linha);
    return { codigo: v.codigo, saida, erros };
  };

  let args;
  let email;
  try {
    args = lerArgumentos(argv);
    saida.push(
      `primeira-admin: projeto ${args.projeto} (loja ${args.loja}), ${args.aplicar ? "COM --aplicar" : "sem --aplicar: só leitura"}`,
    );
    email = emailDaEntrada(await deps.lerEntrada());
  } catch (e) {
    erros.push(`RECUSADO: ${mensagemSegura(e)}`);
    return fim(NAO("nada foi feito (entrada recusada)"));
  }
  saida.push(`e-mail recebido (${email.length} caracteres)`);

  let cliente;
  try {
    const token = await deps.obterToken({ loja: args.loja });
    cliente = criarClienteGestao({
      token,
      fetch: deps.fetch,
      ...(deps.prazoMs ? { prazoMs: deps.prazoMs } : {}),
    });
  } catch (e) {
    erros.push(`sem acesso: ${mensagemSegura(e)}`);
    return fim(
      INCERTO(
        "não consegui o acesso à conta da lojista (cofre/autorização); nada foi lido nem gravado",
      ),
    );
  }

  let decisao;
  try {
    const linhas = await cliente.consultarBanco(
      args.projeto,
      sqlDoDiagnostico(email),
      { somenteLeitura: true },
    );
    decisao = decidir(linhas);
  } catch (e) {
    erros.push(`leitura: ${mensagemSegura(e)}`);
    return fim(INCERTO("não consegui ler o estado da loja; nada foi gravado"));
  }

  if (decisao.tipo === "incerto") return fim(INCERTO(decisao.mensagem));
  if (decisao.tipo === "ja_admin") return fim(SIM(decisao.mensagem));
  if (decisao.tipo === "recusar") {
    return fim(NAO(`${decisao.mensagem}. Nada foi gravado`));
  }

  saida.push(`diagnóstico: ${decisao.mensagem}`);
  saida.push(
    "plano: UMA transação (BEGIN; SET LOCAL ROLE postgres; guardas; UPDATE public.profiles SET role='admin' nessa conta; conferência 1,1,1; COMMIT)",
  );
  if (!args.aplicar) {
    return fim(
      NAO(
        "ela ainda não é administradora; nada foi gravado. Para gravar, rode o mesmo comando com --aplicar",
      ),
    );
  }

  let linhas;
  try {
    linhas = await cliente.consultarBanco(args.projeto, sqlDaPromocao(email));
  } catch (e) {
    return fim(vereditoDoErroDaEscrita(e));
  }
  const r = resultadoDaEscrita(linhas);
  if (r === "promovida") {
    return fim(
      SIM(
        "ela agora é a administradora da loja (conferência 1,1,1 fechou dentro da transação). Ela precisa SAIR e ENTRAR de novo na loja para o painel abrir",
      ),
    );
  }
  if (r === "ja_era_admin") {
    return fim(SIM("ela já era admin (a única da loja); nada foi gravado"));
  }
  return fim(
    INCERTO(
      "a escrita respondeu num formato inesperado: não dá para afirmar que gravou. Rode de novo SEM --aplicar para ler o estado",
    ),
  );
}

// -------------------------------------------------------------- processo --

async function lerStdin() {
  const pedacos = [];
  for await (const p of process.stdin) pedacos.push(p);
  return Buffer.concat(pedacos).toString("utf8");
}

/** O token pela mesma fonte do resto da frota: refresh OAuth da lojista no
 * cofre DPAPI, renovado agora. O token fica só em memória. */
async function obterTokenDoCofre({ loja }) {
  const acesso = criarAcessoOAuth({ cofre: criarCofreDpapi() });
  const { accessToken } = await acesso.renovar({ slug: loja });
  return accessToken;
}

export async function main(argv = process.argv.slice(2), deps = undefined) {
  const r = await executar(
    argv,
    deps ?? { lerEntrada: lerStdin, obterToken: obterTokenDoCofre },
  );
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
    () => {
      // a exceção crua pode carregar o que não se imprime
      console.error("VEREDITO: INCERTO — erro inesperado (não impresso)");
      process.exitCode = 2;
    },
  );
}
