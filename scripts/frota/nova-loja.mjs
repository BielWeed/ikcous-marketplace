#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename -- o estado mora em <pasta>/<slug>.<ext>: a pasta passa por exigirPastaSegura (absoluta, fora do repositório e de qualquer árvore git) e o slug casa RE_PROJETO antes de qualquer acesso ao disco. */
/* eslint-disable security/detect-object-injection -- as chaves indexadas são nomes de passo de PASSOS (lista fechada) ou o slug já conferido por RE_PROJETO, sempre com Object.hasOwn. */
/**
 * nova-loja.mjs — o comando ASSISTIDO que abre uma loja nova passo a passo
 * (plano nova-loja de 26/11/2026, tarefas C1, C2 e C3; o desenho vem do L4b).
 * Nesta versão: abrir, receber, criar-projeto, banco, ficha, segredos,
 * functions, login, primeira-admin, definir-dono e conferir. cadastro, marca e
 * chave-do-plano têm o nome guardado e recusam (NÃO, sem rede): dependem de a
 * release alcançar loja só-OAuth (AGUARDANDO; CACA-PORTAO-LE-LOJA-NOVA).
 *
 *   node scripts/frota/nova-loja.mjs <passo> --loja <slug> [--aplicar] [opções]
 *
 *   abrir          --client-id <id> --redirect <url>   (client_secret pela ENTRADA)
 *   receber        (o código colado pela ENTRADA, nunca por argumento)
 *   criar-projeto  --org <slug da organização da lojista>
 *   banco
 *   ficha          [--nome <apelido>]
 *   segredos       (segredos-da-loja.mjs, B1)
 *   cadastro       (aguardando: cadastrar trava a publicação de todas as lojas)
 *   functions      (functions-da-loja.mjs, B2: só com HEAD == topo da release)
 *   login          (login-da-loja-nova.mjs, B4: domínio <slug>.vercel.app)
 *   marca          (pendente)
 *   chave-do-plano (pendente)
 *   primeira-admin (o e-mail da administradora pela ENTRADA, nunca por argumento)
 *   definir-dono   (a administradora única vira a dona; só loja do nova-loja)
 *   conferir       (só leitura: a lista do que torna a loja pronta)
 *
 * O QUE ESTE ARQUIVO GARANTE (tests/frota_nova_loja_comando_test.ts trava):
 *  - SEM --aplicar NADA sai nem se grava: nenhum fetch (nem o POST do
 *    /oauth/token, que gira o refresh; nem o POST do database/query, que é
 *    POST até para SELECT), nenhuma gravação de cofre, nenhum arquivo de
 *    estado. O ensaio é só leitura do estado LOCAL e diz o que faria;
 *  - cada passo é idempotente e retoma pelo arquivo de ESTADO local:
 *    %LOCALAPPDATA%\ikcous\frota\nova-loja\<slug>.json (fora do repositório,
 *    a mesma regra de pasta do cofre-local). O estado só aceita os campos de
 *    CAMPOS_DO_ESTADO (lista branca conferida ANTES do disco): nunca token,
 *    refresh, código, client_secret, db_pass, e-mail nem chave da loja;
 *  - uma rodada com --aplicar segura a trava <slug>.trava da pasta do estado:
 *    dois comandos da MESMA loja nunca correm juntos (dois criar-projeto
 *    fariam dois POST); o segundo é NÃO sem nenhum fetch. Se a marca da trava
 *    não chega a ser escrita, a própria travar apaga o arquivo que criou (só
 *    se ainda for o dela), como o cofre-local;
 *  - a loja (slug) que não cabe no cadastro (nome de segredo
 *    SUPABASE_ACCESS_TOKEN_<LOJA> com sufixo de até 24, domínio <slug>.vercel.app
 *    sem hífen no fim) é recusada já no abrir, antes de qualquer autorização;
 *  - estado local que não grava DEPOIS do POST do projeto é INCERTO (o projeto
 *    pode ter nascido; a retomada o acha pelo nome), nunca NÃO;
 *  - o access token só existe em memória: cada rodada renova UMA vez pelo
 *    acesso-oauth.mjs, que grava o refresh novo no cofre ANTES de devolver o
 *    access token (e recusa renovação simultânea, mesmo de outro processo);
 *  - criar-projeto PARA se a autorização não cobre EXATAMENTE a organização
 *    informada (a lista de orgs do token tem de ser só ela); procura o projeto
 *    pelo nome ANTES de criar (a resposta de um POST anterior pode ter se
 *    perdido); a senha do banco é gerada forte, gravada SÓ no cofre DPAPI
 *    (%LOCALAPPDATA%\ikcous\frota\banco) ANTES do POST e reaproveitada se o
 *    POST precisar ser repetido; espera ACTIVE_HEALTHY de 10 em 10 s por até
 *    5 min (o mesmo padrão do provider Terraform da Supabase);
 *  - banco chama o instalador-banco.mjs (uma migration por chamada) e só diz
 *    SIM se, relido o banco depois, a fila INTEIRA está no ledger e a marca da
 *    instalação está concluída; envios sem erro com a releitura de conferência
 *    caída = INCERTO (não dá para dizer que não ficou);
 *  - primeira-admin chama o primeira-admin.mjs (B3) com o acesso OAuth desta
 *    rodada: o e-mail entra pela entrada e só vai ao banco (nunca ao estado, à
 *    saída nem à mensagem); a transação do B3 tem o SET LOCAL ROLE postgres
 *    (as travas de cargo leem o GUC role) e repete todas as guardas;
 *  - segredos, functions e login chamam os scripts B com o cliente da gestão
 *    DESTA rodada (o token OAuth renovado do cofre, nunca o
 *    SUPABASE_ACCESS_TOKEN do ambiente) e repassam o veredito deles sem que
 *    INCERTO vire SIM; o B2 só publica com o HEAD no topo do ramo da release
 *    e a recusa dele é repassada como veio. Mensagem de script B que manda
 *    "rodar sem --aplicar" para ler o estado é reescrita para o conferir
 *    (pelo nova-loja, sem --aplicar não se lê nada);
 *  - definir-dono (regra do sócio, 26/11): sem dono e com EXATAMENTE uma
 *    administradora (nas duas fontes do cargo, e-mail confirmado), grava essa
 *    pessoa como dona numa transação (READ COMMITTED, advisory lock, LOCK
 *    TABLE, SET LOCAL ROLE postgres, as guardas de novo, conferência pela
 *    88c) e relê; dona igual = SIM sem gravar; dono diferente, dono que não é
 *    mais admin, 0 ou 2+ admins = NÃO (não troca nem escolhe); leitura que
 *    falha = INCERTO. Nenhum e-mail: a dona é o id que o banco acha. Só em
 *    loja com estado local (criar-projeto e banco SIM) e NUNCA na IKCOUS nem
 *    na Savy (pelo nome e pelo ref: lojas.json e os refs fixos);
 *  - trocar-dono (ainda sem passo; só o SQL e a regra, T1 de 26/11):
 *    sqlDaTroca lê, decidirTroca decide (e-mail da dona de hoje = SIM sem
 *    gravar; recusas IKT01..IKT05 = NÃO; fora do formato = INCERTO) e
 *    sqlTrocarDono troca numa transação com as travas do definir-dono;
 *  - conferir é SÓ LEITURA (GET e database/query read_only; não grava nem o
 *    estado local) e dá SIM, NÃO ou INCERTO por item (functions e login pelos
 *    B2/B4 em ensaio sobre a fachada somenteLeitura; reconciliação DEGRADADA
 *    é NÃO); o geral é SIM só se TODOS forem SIM, e o que ainda não está
 *    ligado aparece como pendente NÃO;
 *  - ficha confere store_config id = 1 (semeada pela migration
 *    20261540000000) e GERA, sem executar, o SQL da linha em frota_lojas e a
 *    entrada de lojas.json para o passo de cadastro (B5);
 *  - veredito de todo passo: SIM, NÃO ou INCERTO. INCERTO nunca vira SIM, e
 *    nenhuma mensagem leva token, código, segredo ou corpo cru de resposta.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { criarAcessoOAuth } from "./acesso-oauth.mjs";
import {
  ErroDoCofre,
  criarCofreDpapi,
  exigirPastaSegura,
  pastaPadraoDoCofre,
} from "./cofre-local.mjs";
import {
  executar as executarFunctions,
  gitReal,
} from "./functions-da-loja.mjs";
import {
  arquivosDoRepo,
  instalar,
  lerEstado,
  lerPrivilegiosPadrao,
  planejarInstalacao,
} from "./instalador-banco.mjs";
import { configurarLoginNovo } from "./login-da-loja-nova.mjs";
import {
  executar as executarPrimeiraAdmin,
  literalDoEmail,
} from "./primeira-admin.mjs";
import {
  SQL_SAUDE,
  faltandoNo,
  instalarSegredos,
  lerEstado as lerEstadoDosSegredos,
} from "./segredos-da-loja.mjs";
import {
  API_GESTAO,
  ESTADO_DESCONHECIDO,
  ErroDaGestao,
  criarClienteGestao,
} from "./supabase-gestao.mjs";

const require = createRequire(import.meta.url);
const {
  CAMINHO_LOJAS,
  RE_PROJETO,
  RE_REF,
  RE_SEGREDO,
  textoSeguro,
  validarCadastro,
} = require("./lojas.cjs");

export const PASSOS = Object.freeze([
  "abrir",
  "receber",
  "criar-projeto",
  "banco",
  "ficha",
  "segredos",
  "cadastro",
  "functions",
  "login",
  "marca",
  "chave-do-plano",
  "primeira-admin",
  "definir-dono",
  "conferir",
]);
/** Passos com o nome guardado e SEM execução (NÃO antes de qualquer rede,
 * trava ou estado): dependem de a release alcançar loja só-OAuth, e isso está
 * com o sócio (CACA-PORTAO-LE-LOJA-NOVA-26-11: o portão de hoje entra nas
 * lojas com o login do dono, que nunca é membro da org da lojista; uma loja
 * cadastrada que ele não lê bloqueia a release de TODAS). */
export const AGUARDANDO = Object.freeze({
  cadastro:
    "cadastrar a loja agora trava a publicação de todas as lojas: aguarda o portão ler loja OAuth (CACA-PORTAO-LE-LOJA-NOVA). Nada foi feito.",
  marca:
    "pendente: a marca (scripts/identidade-bootstrap.mjs) exige a chave de serviço da loja, que a IKCOUS não tem numa loja só-OAuth; e a loja só entra na frota depois do cadastro, que aguarda o portão ler loja OAuth (CACA-PORTAO-LE-LOJA-NOVA). Nada foi feito.",
  "chave-do-plano":
    "pendente: a chave do plano vai pelo instalar-chave-da-loja.yml, que só usa o segredo fixo do repositório e não alcança loja só-OAuth; aguarda a decisão da release para loja OAuth (CACA-PORTAO-LE-LOJA-NOVA). Nada foi feito.",
});
/** As lojas que já vendem: o dono delas é cadastrado pelo dono do produto
 * (docs/runbooks/definir-o-dono-da-loja.md, seção 3.3), nunca por este
 * comando. Recusadas pelo nome e pelo ref (de lojas.json e, de reserva, os
 * fixos abaixo: um lojas.json adulterado não tira a proteção). */
export const LOJAS_PROTEGIDAS = Object.freeze(["ikcous-publicada", "savy"]);
const REFS_PROTEGIDOS = Object.freeze([
  "cafkrminfnokvgjqtkle", // ikcous-publicada (e o legado "loja")
  "gnjsrucsmjkajijrakzr", // savy
]);
/** Os alvos legados de teste (`classe: legado` em lojas.json) nunca são loja
 * aberta pelo nova-loja: o definir-dono os recusa pelo nome, por esta lista
 * fixa (um lojas.json adulterado não tira a proteção) e por toda chave
 * `legado` do lojas.json. */
export const LOJAS_LEGADAS = Object.freeze(["loja", "sandbox"]);
const recusaDoLegado = (nome) =>
  `a loja ${textoSeguro(nome, 40)} é um alvo legado de teste (classe legado em lojas.json): o definir-dono nunca roda nele, só em loja aberta pelo nova-loja. Nada foi feito.`;
export const SIM = "SIM";
export const NAO = "NÃO";
export const INCERTO = "INCERTO";
const VEREDITOS = new Set([SIM, NAO, INCERTO]);

export const REGIAO = "sa-east-1";
export const PRAZO_ATIVO_MS = 5 * 60_000;
export const INTERVALO_CONSULTA_MS = 10_000;
const PRONTO = "ACTIVE_HEALTHY";
/** Estados de que o projeto não sai sozinho (provider Terraform da Supabase,
 * internal/provider/utils.go, lido em 26/11/2026): parar na hora. */
const STATUS_SEM_VOLTA = new Set([
  "INIT_FAILED",
  "REMOVED",
  "GOING_DOWN",
  "INACTIVE",
  "PAUSE_FAILED",
  "RESTORE_FAILED",
]);
export const MARCA_DA_FICHA = "ficha_da_loja_20261540000000";
/** Só leitura: a ficha id = 1, a marca da migration 20261540000000 e o
 * domínio (o cadastro grava o domínio depois). */
export const SQL_FICHA =
  "SELECT (SELECT count(*) FROM public.store_config WHERE id = 1)::int AS ficha, obj_description('public.store_config'::regclass, 'pg_class') AS marca, (SELECT dominio_publico FROM public.store_config WHERE id = 1) AS dominio_publico;";

const RE_ORG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const RE_APELIDO = /^[A-Za-z][A-Za-z0-9 ._-]{0,29}$/;
const RE_STATUS = /^[A-Z_]{1,40}$/;
const RE_PUBLICAVEL = /^sb_publishable_[A-Za-z0-9_-]{8,200}$/;
const RE_LIMITE_GRATIS = /project limit|maximum limits/i;

const VERSAO_ESTADO = 1;
/** Data no formato EXATO de toISOString (o único que este comando grava). */
const ehDataIso = (v) =>
  typeof v === "string" &&
  !Number.isNaN(Date.parse(v)) &&
  new Date(v).toISOString() === v;
const SITUACOES_DO_BANCO = new Set([
  "OK",
  "NADA_A_FAZER",
  "JA_INSTALADA",
  "RECUSADO",
  "FALHOU",
  "ESTADO_DESCONHECIDO",
  "LEITURA",
]);
const inteiro = (v) => Number.isSafeInteger(v) && v >= 0;
/** A lista branca do arquivo de estado: por passo, os ÚNICOS campos além de
 * `veredito` e `em`, cada um com a sua conferência. Nada aqui é segredo. */
export const CAMPOS_DO_ESTADO = Object.freeze({
  abrir: Object.freeze({}),
  receber: Object.freeze({}),
  "criar-projeto": Object.freeze({
    org: (v) => typeof v === "string" && RE_ORG.test(v),
    nome: (v) =>
      typeof v === "string" && /^ikcous-[a-z][a-z0-9-]{1,39}$/.test(v),
    ref: (v) => typeof v === "string" && RE_REF.test(v),
    status: (v) => typeof v === "string" && RE_STATUS.test(v),
    postEm: (v) => ehDataIso(v),
  }),
  banco: Object.freeze({
    situacao: (v) => SITUACOES_DO_BANCO.has(v),
    aplicadas: inteiro,
    total: inteiro,
  }),
  ficha: Object.freeze({}),
  segredos: Object.freeze({}),
  functions: Object.freeze({}),
  login: Object.freeze({}),
  // só o veredito: o e-mail NUNCA entra aqui
  "primeira-admin": Object.freeze({}),
  // só o veredito: nem o id da dona entra aqui
  "definir-dono": Object.freeze({}),
});

export class ErroDoComando extends Error {
  constructor(mensagem, extra = {}) {
    super(mensagem);
    this.name = "ErroDoComando";
    this.codigo = extra.codigo ?? "ERRO";
  }
}

// ─── o estado local ─────────────────────────────────────────────────────────

/** %LOCALAPPDATA%\ikcous\frota\nova-loja (vizinha da pasta do cofre). */
export function pastaPadraoDoEstado(env = process.env) {
  return path.join(path.dirname(pastaPadraoDoCofre(env)), "nova-loja");
}

/** LANÇA se o objeto foge da forma ou da lista branca; não ecoa valor. */
export function conferirEstado(e, slug) {
  const recusa = (o_que) =>
    new ErroDoComando(
      `Estado da loja ${slug}: ${o_que} (nada foi gravado; valores não impressos).`,
      { codigo: "ESTADO_INVALIDO" },
    );
  if (e === null || typeof e !== "object" || Array.isArray(e))
    throw recusa("não é um objeto");
  const raiz = Object.keys(e).sort().join(",");
  if (raiz !== "passos,slug,versao")
    throw recusa("campos de raiz fora da lista");
  if (e.versao !== VERSAO_ESTADO || e.slug !== slug)
    throw recusa("versão ou loja diferente");
  const passos = e.passos;
  if (passos === null || typeof passos !== "object" || Array.isArray(passos))
    throw recusa("passos não é um objeto");
  for (const nome of Object.keys(passos)) {
    if (!Object.hasOwn(CAMPOS_DO_ESTADO, nome))
      throw recusa("passo fora da lista");
    const p = passos[nome];
    if (p === null || typeof p !== "object" || Array.isArray(p))
      throw recusa(`passo ${nome} não é um objeto`);
    const campos = CAMPOS_DO_ESTADO[nome];
    for (const [k, v] of Object.entries(p)) {
      if (k === "veredito") {
        if (!VEREDITOS.has(v)) throw recusa(`veredito inválido em ${nome}`);
      } else if (k === "em") {
        if (!ehDataIso(v)) throw recusa(`data inválida em ${nome}`);
      } else if (!Object.hasOwn(campos, k) || !campos[k](v)) {
        throw recusa(`campo fora da lista branca em ${nome}`);
      }
    }
  }
  return e;
}

/**
 * O estado em disco: <pasta>/<slug>.json, gravado de forma atômica (arquivo
 * novo + rename), e a trava <pasta>/<slug>.trava (criação exclusiva).
 * `abrirArquivo` existe para o teste simular disco que falha.
 */
export function criarEstadoEmArquivo({ pasta, abrirArquivo = open } = {}) {
  const raiz = exigirPastaSegura(pasta ?? pastaPadraoDoEstado());
  const arquivo = (slug, ext) => {
    if (typeof slug !== "string" || !RE_PROJETO.test(slug)) {
      throw new ErroDoComando("Estado: nome de loja inválido.");
    }
    return path.join(raiz, `${slug}.${ext}`);
  };
  return {
    async ler(slug) {
      let texto;
      try {
        texto = await readFile(arquivo(slug, "json"), "utf8");
      } catch (e) {
        if (e?.code === "ENOENT") return null;
        throw new ErroDoComando(
          `Estado: não consegui ler o arquivo da loja ${slug}.`,
        );
      }
      let e;
      try {
        e = JSON.parse(texto);
      } catch {
        e = null;
      }
      try {
        return conferirEstado(e, slug);
      } catch {
        throw new ErroDoComando(
          `Estado: o arquivo ${arquivo(slug, "json")} não está no formato esperado. Confira (ou apague, se a loja ainda não tem projeto) e rode de novo.`,
          { codigo: "ESTADO_INVALIDO" },
        );
      }
    },
    async gravar(slug, e) {
      conferirEstado(e, slug); // ANTES do disco
      await mkdir(raiz, { recursive: true });
      const final = arquivo(slug, "json");
      const temporario = `${final}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        const h = await abrirArquivo(temporario, "wx", 0o600);
        try {
          await h.writeFile(`${JSON.stringify(e, null, 2)}\n`, "utf8");
          await h.sync();
        } finally {
          await h.close();
        }
        await rename(temporario, final);
      } catch {
        await unlink(temporario).catch(() => {});
        throw new ErroDoComando(
          `Estado: não consegui gravar o arquivo da loja ${slug}; o anterior ficou como estava.`,
          { codigo: "ESTADO_NAO_GRAVOU" },
        );
      }
    },
    async travar(slug) {
      const caminho = arquivo(slug, "trava");
      await mkdir(raiz, { recursive: true });
      const marca = `${process.pid} ${new Date().toISOString()} ${randomBytes(8).toString("hex")}`;
      let h;
      try {
        h = await abrirArquivo(caminho, "wx", 0o600);
      } catch (e) {
        if (e?.code === "EEXIST") {
          throw new ErroDoComando(
            `Outro comando da loja ${slug} está rodando (trava ${caminho}). Se nenhum estiver, apague esse arquivo e repita.`,
            { codigo: "TRAVADO" },
          );
        }
        throw new ErroDoComando(
          `Estado: não consegui criar a trava da loja ${slug}.`,
        );
      }
      try {
        try {
          await h.writeFile(marca, "utf8");
        } finally {
          await h.close();
        }
      } catch {
        // O arquivo foi criado por NÓS (o "wx" acima), mas a marca não ficou
        // inteira: sem marca, o liberar() nunca o reconheceria e a loja
        // ficaria travada. Só é apagado se ainda for o nosso (vazio ou com um
        // pedaço do começo da nossa marca); outro conteúdo = alguém apagou o
        // nosso e travou depois, e esse fica. O mesmo do cofre-local; o erro
        // de baixo nível fica de fora (a mensagem dele carrega o caminho).
        let nossaSaiu = false;
        try {
          const atual = await readFile(caminho, "utf8");
          if (marca.startsWith(atual)) await unlink(caminho);
          nossaSaiu = true; // apagada agora, ou o que está lá não é a nossa
        } catch (e) {
          nossaSaiu = e?.code === "ENOENT";
        }
        throw new ErroDoComando(
          nossaSaiu
            ? `Estado: não consegui gravar a trava da loja ${slug}; nada ficou travado e nada foi feito. Repita o comando.`
            : `Estado: não consegui gravar a trava da loja ${slug} nem apagá-la; nada foi feito, e o próximo comando da loja vai dizer qual arquivo apagar.`,
          { codigo: "TRAVA_NAO_GRAVOU" },
        );
      }
      let solta = false;
      return async () => {
        if (solta) return;
        solta = true;
        const atual = await readFile(caminho, "utf8").catch(() => null);
        if (atual === marca) await unlink(caminho).catch(() => {});
      };
    },
  };
}

function estadoNovo(slug) {
  return { versao: VERSAO_ESTADO, slug, passos: {} };
}

/** Lê, junta os campos no passo e grava (com a data). */
async function registrar(d, slug, passo, campos, { apagar = [] } = {}) {
  const e = (await d.estado.ler(slug)) ?? estadoNovo(slug);
  e.passos[passo] = {
    ...(e.passos[passo] ?? {}),
    ...campos,
    em: new Date(d.agora()).toISOString(),
  };
  for (const p of apagar) delete e.passos[p];
  await d.estado.gravar(slug, e);
}

// ─── peças comuns ───────────────────────────────────────────────────────────

const b64url = (buf) =>
  Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function nomeSeguro(e) {
  const n = e?.name;
  return typeof n === "string" && /^[A-Za-z]{1,40}$/.test(n) ? n : "erro";
}

const resultado = (veredito, mensagem) => ({ veredito, mensagem });

/** Erro de módulo nosso: a mensagem é sem segredo por construção. Qualquer
 * outro: só o nome. ESTADO_DESCONHECIDO e cofre que não gravou = INCERTO. */
function resultadoDoErro(e) {
  const nosso =
    e instanceof ErroDaGestao ||
    e instanceof ErroDoCofre ||
    e instanceof ErroDoComando;
  const incerto =
    e?.codigo === ESTADO_DESCONHECIDO || e?.codigo === "COFRE_NAO_GRAVOU";
  return resultado(
    incerto ? INCERTO : NAO,
    nosso
      ? e.message
      : `erro inesperado (${nomeSeguro(e)}); a mensagem crua não é impressa.`,
  );
}

/** A fonte do access token da rodada: renova UMA vez (o acesso-oauth grava o
 * refresh novo no cofre antes de devolver) e reaproveita até 1 min antes de
 * vencer. Pedidos simultâneos esperam a mesma renovação. */
function fonteDeToken(acesso, slug, agora) {
  let atual = null;
  let emVoo = null;
  return async () => {
    if (
      atual &&
      (atual.expiraEm === null || agora() < atual.expiraEm - 60_000)
    ) {
      return atual.accessToken;
    }
    emVoo ??= acesso
      .renovar({ slug })
      .then((r) => {
        atual = r;
        return r;
      })
      .finally(() => {
        emVoo = null;
      });
    return (await emVoo).accessToken;
  };
}

/** fetch que só OBSERVA a recusa de POST /v1/projects por limite de projetos
 * grátis (o cliente da gestão não repassa o corpo de erro). Nada é impresso
 * do corpo: só a marca `limite` vira true. */
function fetchQueVeOLimite(fetchFn, sinal) {
  return async (url, init) => {
    const r = await fetchFn(url, init);
    if (
      init?.method === "POST" &&
      String(url) === `${API_GESTAO}/v1/projects` &&
      r.status >= 400 &&
      r.status < 500
    ) {
      try {
        if (RE_LIMITE_GRATIS.test(await r.clone().text())) sinal.limite = true;
      } catch {
        // corpo ilegível: sem marca, cai na mensagem genérica
      }
    }
    return r;
  };
}

function contexto(pedido, d) {
  const slug = pedido.slug;
  const acesso = criarAcessoOAuth({
    cofre: d.cofre,
    fetch: d.fetch,
    agora: d.agora,
  });
  const sinal = { limite: false };
  const token = fonteDeToken(acesso, slug, d.agora);
  const gestao = criarClienteGestao({
    token,
    fetch: fetchQueVeOLimite(d.fetch, sinal),
  });
  return { slug, acesso, gestao, sinal, token };
}

async function lerUmaEntrada(d, pergunta) {
  const t = await d.lerEntrada(pergunta);
  const limpo = typeof t === "string" ? t.trim() : "";
  if (limpo === "") {
    throw new ErroDoComando("A entrada veio vazia; nada foi feito.", {
      codigo: "ENTRADA_VAZIA",
    });
  }
  return limpo;
}

const orgDe = (o) =>
  typeof o?.slug === "string" ? o.slug : typeof o?.id === "string" ? o.id : "";
const projetoEhDaOrg = (p, org) =>
  p?.organization_slug === org || p?.organization_id === org;
const temOrgDeclarada = (p) =>
  typeof p?.organization_slug === "string" ||
  typeof p?.organization_id === "string";
const nomeDoProjeto = (slug) => `ikcous-${slug}`;
const segredoDoToken = (slug) =>
  `SUPABASE_ACCESS_TOKEN_${slug.toUpperCase().replace(/-/g, "_")}`;
/** Até onde o slug cabe no cadastro (lojas.cjs, RE_SEGREDO: sufixo de até 24;
 * o hífen vira sublinhado, um por um). */
export const TETO_DO_SLUG = 24;

/** Por que a loja não cabe no cadastro (null = cabe). O mesmo teste que o
 * cadastroGerado faz no fim, feito no abrir: falhar depois do projeto criado
 * deixaria uma loja que não se cadastra. */
function slugQueNaoCabe(slug) {
  if (!RE_SEGREDO.test(segredoDoToken(slug))) {
    return `a loja ${slug} tem ${slug.length} caracteres e o limite é ${TETO_DO_SLUG}: o cadastro guarda o acesso dela no segredo ${textoSeguro(segredoDoToken(slug), 80)}, que aceita no máximo ${TETO_DO_SLUG} depois de SUPABASE_ACCESS_TOKEN_. Escolha um nome de até ${TETO_DO_SLUG} caracteres (letras minúsculas, dígitos e hífen) e rode abrir de novo; nada foi feito.`;
  }
  // Com o slug em RE_PROJETO (^[a-z][a-z0-9-]{1,39}$), <slug>.vercel.app só
  // reprova no CHECK de frota_lojas.dominio_publico (20261141000000: cada
  // rótulo termina em letra ou dígito) se o slug terminar em hífen.
  if (slug.endsWith("-")) {
    return `o domínio ${slug}.vercel.app não passa no CHECK de frota_lojas (o nome da loja não pode terminar em hífen). Escolha outro nome e rode abrir de novo; nada foi feito.`;
  }
  return null;
}

// ─── abrir ──────────────────────────────────────────────────────────────────

function passosDaLojista(url, slug) {
  return [
    "Mande para a lojista, exatamente nesta ordem:",
    "  1. Entre em https://supabase.com e crie a sua conta (ou entre nela) com o SEU e-mail — o mesmo que vai usar como administradora da loja.",
    "     O plano grátis do Supabase permite 2 projetos ATIVOS POR PESSOA (somando todas as organizações em que ela é dona ou administradora); projeto pausado não conta.",
    "  2. Abra este link no navegador:",
    `     ${url}`,
    '  3. Na tela "Authorize IKCOUS", confira que a organização marcada é a DELA (onde a loja vai morar) e toque em "Authorize".',
    '  4. Na página seguinte aparece um código com o botão "Copiar". Ela copia e manda para a IKCOUS.',
    "  Importante: a conta da IKCOUS NUNCA entra como membro da organização dela; a IKCOUS só usa esta autorização.",
    `Depois, aqui: node scripts/frota/nova-loja.mjs receber --loja ${slug} --aplicar   (cole o código quando ele pedir)`,
  ].join("\n");
}

async function passoAbrir(pedido, d) {
  const { slug, clientId, redirect } = pedido;
  if (!clientId || !redirect) {
    return resultado(
      NAO,
      "abrir precisa de --client-id e --redirect (os do OAuth App de produção da IKCOUS).",
    );
  }
  const { acesso } = contexto(pedido, d);
  const clientSecret = await lerUmaEntrada(
    d,
    "Cole o client_secret do OAuth App da IKCOUS e tecle Enter: ",
  );
  const { url } = await acesso.abrir({
    slug,
    clientId,
    clientSecret,
    redirectUri: redirect,
  });
  // nova autorização pendente: o "receber" anterior deixa de valer
  await registrar(d, slug, "abrir", { veredito: SIM }, { apagar: ["receber"] });
  d.saida.out(passosDaLojista(url, slug));
  return resultado(
    SIM,
    `autorização pendente guardada no cofre da loja ${slug}; o link está acima.`,
  );
}

// ─── receber ────────────────────────────────────────────────────────────────

async function passoReceber(pedido, d) {
  const { slug } = pedido;
  const e = await d.estado.ler(slug);
  if (e?.passos?.abrir?.veredito !== SIM) {
    return resultado(
      NAO,
      `a loja ${slug} não tem autorização aberta: rode abrir --aplicar antes.`,
    );
  }
  const { acesso } = contexto(pedido, d);
  const colado = await lerUmaEntrada(
    d,
    "Cole o código que a lojista mandou (ou o endereço inteiro) e tecle Enter: ",
  );
  let r;
  try {
    r = await acesso.receber({ slug, colado });
  } catch (erro) {
    await registrar(d, slug, "receber", {
      veredito: resultadoDoErro(erro).veredito,
    });
    throw erro;
  }
  await registrar(d, slug, "receber", { veredito: SIM });
  const validade =
    r.expiraEm === null
      ? "validade não informada"
      : `vale até ${new Date(r.expiraEm).toISOString()}`;
  return resultado(
    SIM,
    `autorização recebida; o refresh está no cofre DPAPI (o acesso desta rodada ${validade} e nunca é gravado).`,
  );
}

// ─── criar-projeto ──────────────────────────────────────────────────────────

/** A senha do banco: a que já está no cofre (POST anterior que pode ter
 * falhado) ou uma nova, forte, gravada no cofre ANTES de ser usada. */
async function senhaDoBanco(d, slug) {
  const atual = await d.cofreDoBanco.ler(slug);
  if (typeof atual === "string" && /^[A-Za-z0-9_-]{40,}$/.test(atual)) {
    return atual;
  }
  const nova = b64url(d.aleatorio(32));
  if (nova.length < 40) {
    throw new ErroDoComando(
      "o gerador aleatório não devolveu bytes suficientes para a senha do banco.",
    );
  }
  await d.cofreDoBanco.gravar(slug, nova);
  return nova;
}

async function esperarAtivo(gestao, ref, org, d) {
  const inicio = d.agora();
  for (;;) {
    const p = await gestao.pedir("projeto", { ref });
    const status =
      typeof p?.status === "string" && RE_STATUS.test(p.status)
        ? p.status
        : "ILEGIVEL";
    if (temOrgDeclarada(p) && !projetoEhDaOrg(p, org)) {
      return {
        status,
        ...resultado(
          NAO,
          `PARAR: o projeto ${ref} não é da organização ${org}. Nada foi instalado.`,
        ),
      };
    }
    if (status === PRONTO) {
      return {
        status,
        ...resultado(
          SIM,
          `projeto ${ref} pronto (ACTIVE_HEALTHY) em ${REGIAO}.`,
        ),
      };
    }
    if (STATUS_SEM_VOLTA.has(status)) {
      const explicacao =
        status === "INIT_FAILED"
          ? "o Supabase não conseguiu montar o projeto"
          : status === "REMOVED"
            ? "o projeto foi removido"
            : "o projeto está num estado de que não sai sozinho";
      return {
        status,
        ...resultado(
          NAO,
          `PARAR: ${explicacao} (${status}). Nada foi instalado no banco. O comando não apaga nem recria projeto sozinho: o que fazer com ${ref} é decisão do dono, com a lojista olhando o painel do Supabase.`,
        ),
      };
    }
    if (d.agora() - inicio >= PRAZO_ATIVO_MS) {
      return {
        status,
        ...resultado(
          INCERTO,
          `o projeto ${ref} não ficou ACTIVE_HEALTHY em ${PRAZO_ATIVO_MS / 60_000} min (último status: ${status}). Rode criar-projeto de novo daqui a pouco: a retomada só confere o status, não cria outro projeto.`,
        ),
      };
    }
    await d.dormir(INTERVALO_CONSULTA_MS);
  }
}

const MENSAGEM_LIMITE =
  "PARAR: o Supabase recusou criar o projeto porque a conta da lojista já tem 2 projetos grátis ATIVOS. Esse limite é POR PESSOA (conta todas as organizações em que ela é dona ou administradora), não por organização. O que a lojista faz: no painel do Supabase, pausar (ou apagar, se não usa mais) um projeto grátis que já tem — projeto pausado não conta —, ou criar a loja com outra conta, de outro e-mail. Depois rode criar-projeto de novo.";

/** Depois que o POST do projeto saiu, o estado local que não grava NÃO prova
 * que "nada mudou" (achado da revisão do C1): o projeto pode ter nascido, e
 * quem o acha é a retomada, pelo nome. Antes do POST, a falha do estado
 * continua NÃO (nada saiu). */
async function passoCriarProjeto(pedido, d) {
  const marca = { postSaiu: false };
  try {
    return await criarProjeto(pedido, d, marca);
  } catch (erro) {
    if (marca.postSaiu && erro?.codigo === "ESTADO_NAO_GRAVOU") {
      return resultado(
        INCERTO,
        `${erro.message} Mas o pedido de criação do projeto já tinha saído: o projeto ${nomeDoProjeto(pedido.slug)} PODE ter sido criado. Rode criar-projeto de novo — a retomada procura o projeto pelo nome antes de criar (não cria outro), e a senha do banco no cofre é a mesma.`,
      );
    }
    throw erro;
  }
}

async function criarProjeto(pedido, d, marca) {
  const { slug, org } = pedido;
  if (!org) {
    return resultado(
      NAO,
      "criar-projeto precisa de --org <slug da organização da lojista>.",
    );
  }
  const e = await d.estado.ler(slug);
  const anterior = e?.passos?.["criar-projeto"] ?? {};
  if (anterior.org && anterior.org !== org) {
    return resultado(
      NAO,
      `PARAR: o estado desta loja diz organização ${anterior.org}, e foi pedida ${org}. Nada foi feito.`,
    );
  }
  const nome = nomeDoProjeto(slug);
  const { gestao, sinal } = contexto(pedido, d);

  const orgs = await gestao.pedir("organizacoes");
  const visiveis = Array.isArray(orgs) ? orgs.map(orgDe) : [];
  if (!(visiveis.length === 1 && visiveis[0] === org)) {
    return resultado(
      NAO,
      `PARAR: a autorização tem de cobrir exatamente a organização ${org}, e cobre ${visiveis.length === 0 ? "nenhuma" : visiveis.map((v) => textoSeguro(v, 64)).join(", ")}. Peça para a lojista autorizar de novo escolhendo a organização certa (abrir/receber). Nenhum projeto foi criado.`,
    );
  }

  let ref = anterior.ref;
  if (!ref) {
    const lista = await gestao.pedir("projetos");
    if (!Array.isArray(lista)) {
      return resultado(
        INCERTO,
        "a lista de projetos veio fora do formato; nada foi criado. Rode de novo.",
      );
    }
    const doNome = lista.filter(
      (p) => p?.name === nome && projetoEhDaOrg(p, org),
    );
    if (doNome.length > 1) {
      return resultado(
        NAO,
        `PARAR: há ${doNome.length} projetos chamados ${nome} na organização ${org}; não sei qual é o da loja. Nada foi criado.`,
      );
    }
    if (doNome.length === 1 && RE_REF.test(String(doNome[0].ref))) {
      ref = doNome[0].ref;
      await registrar(d, slug, "criar-projeto", {
        veredito: INCERTO,
        org,
        nome,
        ref,
      });
    } else {
      const dbPass = await senhaDoBanco(d, slug);
      // o estado registra a tentativa ANTES do POST (sem a senha)
      await registrar(d, slug, "criar-projeto", {
        veredito: INCERTO,
        org,
        nome,
        postEm: new Date(d.agora()).toISOString(),
      });
      let criado;
      marca.postSaiu = true;
      try {
        criado = await gestao.pedir("projetos", {
          metodo: "POST",
          corpo: {
            name: nome,
            organization_slug: org,
            db_pass: dbPass,
            region_selection: { type: "specific", code: REGIAO },
          },
        });
      } catch (erro) {
        let r;
        if (sinal.limite) r = resultado(NAO, MENSAGEM_LIMITE);
        else if (erro?.status === 402)
          r = resultado(
            NAO,
            "PARAR: o Supabase recusou com HTTP 402 (fatura atrasada na organização da lojista, ou o plano não comporta o projeto). A lojista confere Billing no painel dela. Nenhum projeto foi criado.",
          );
        else if (
          erro?.codigo === ESTADO_DESCONHECIDO ||
          (Number.isInteger(erro?.status) && erro.status >= 500)
        )
          r = resultado(
            INCERTO,
            `${erro instanceof ErroDaGestao ? erro.message : "a resposta do Supabase não veio"} O projeto PODE ter sido criado: rode criar-projeto de novo — a retomada procura o projeto ${nome} pelo nome antes de criar, e a senha do banco no cofre é a mesma.`,
          );
        else r = resultadoDoErro(erro);
        await registrar(d, slug, "criar-projeto", { veredito: r.veredito });
        return r;
      }
      if (!RE_REF.test(String(criado?.ref))) {
        await registrar(d, slug, "criar-projeto", { veredito: INCERTO });
        return resultado(
          INCERTO,
          `o Supabase aceitou o pedido mas não devolveu um ref legível. Rode criar-projeto de novo: a retomada procura ${nome} pelo nome antes de criar.`,
        );
      }
      ref = criado.ref;
      await registrar(d, slug, "criar-projeto", {
        veredito: INCERTO,
        ref,
        ...(RE_STATUS.test(String(criado.status))
          ? { status: criado.status }
          : {}),
      });
    }
  }

  let espera;
  try {
    espera = await esperarAtivo(gestao, ref, org, d);
  } catch (erro) {
    const r = resultadoDoErro(erro);
    // o projeto existe (ref no estado): falha de leitura nunca é NÃO definitivo
    const v = r.veredito === NAO && erro?.status !== 404 ? INCERTO : r.veredito;
    await registrar(d, slug, "criar-projeto", { veredito: v });
    return resultado(
      v,
      `${r.mensagem} (o projeto ${ref} está no estado local; rode criar-projeto de novo para conferir o status, sem criar outro)`,
    );
  }
  await registrar(d, slug, "criar-projeto", {
    veredito: espera.veredito,
    status: espera.status === "ILEGIVEL" ? "UNKNOWN" : espera.status,
  });
  return resultado(espera.veredito, espera.mensagem);
}

// ─── banco ──────────────────────────────────────────────────────────────────

/** O contrato de erro do instalador: "sql" SÓ para erro do próprio Postgres
 * (HTTP 400 com SQLSTATE no corpo: a transação do envelope voltou inteira).
 * Todo o resto (gateway, 401/403, 5xx, prazo, rede) é estado desconhecido. */
function erroParaOInstalador(e) {
  const msg =
    e instanceof ErroDaGestao || e instanceof ErroDoComando
      ? e.message
      : `falha (${nomeSeguro(e)})`;
  if (
    e instanceof ErroDaGestao &&
    e.codigo === "HTTP" &&
    e.status === 400 &&
    typeof e.sqlstate === "string"
  ) {
    return Object.assign(new Error(msg), { tipo: "sql", codigo: e.sqlstate });
  }
  return Object.assign(new Error(msg), {
    tipo: "transporte",
    codigo: typeof e?.codigo === "string" ? e.codigo : undefined,
  });
}

function clienteDoInstalador(gestao, ref) {
  return {
    async consultar(sql) {
      try {
        return await gestao.consultarBanco(ref, sql);
      } catch (e) {
        throw erroParaOInstalador(e);
      }
    },
  };
}

/** O passo anterior precisa estar SIM (com o ref) no estado local. */
async function projetoPronto(d, slug, exigido) {
  const e = await d.estado.ler(slug);
  const cp = e?.passos?.["criar-projeto"];
  if (cp?.veredito !== SIM || !cp.ref) {
    return {
      falta: `rode criar-projeto --aplicar até dar SIM antes de ${exigido}.`,
    };
  }
  return { estado: e, ref: cp.ref, org: cp.org };
}

async function passoBanco(pedido, d) {
  const { slug } = pedido;
  const pre = await projetoPronto(d, slug, "banco");
  if (pre.falta) return resultado(NAO, pre.falta);
  const { gestao } = contexto(pedido, d);
  const p = await gestao.pedir("projeto", { ref: pre.ref });
  if (p?.status !== PRONTO) {
    const r = resultado(
      INCERTO,
      `o projeto ${pre.ref} não está ACTIVE_HEALTHY agora (${RE_STATUS.test(String(p?.status)) ? p.status : "status ilegível"}); nada foi enviado ao banco. Rode criar-projeto e depois banco de novo.`,
    );
    await registrar(d, slug, "banco", {
      veredito: r.veredito,
      situacao: "LEITURA",
    });
    return r;
  }
  const cliente = clienteDoInstalador(gestao, pre.ref);
  const arquivos = d.arquivos();
  let antes;
  try {
    antes = await lerEstado(cliente);
  } catch (e) {
    const r = resultado(
      INCERTO,
      `não consegui ler o estado do banco (${String(e?.message ?? e).slice(0, 300)}); nada foi enviado.`,
    );
    await registrar(d, slug, "banco", {
      veredito: INCERTO,
      situacao: "LEITURA",
    });
    return r;
  }
  const plano = planejarInstalacao(antes, arquivos);
  const r = await instalar(cliente, plano, { aplicar: true });
  const aplicadas = Array.isArray(r.aplicados) ? r.aplicados.length : 0;
  let veredito;
  let mensagem = r.mensagem;
  let total = Number.isSafeInteger(plano.total) ? plano.total : 0;
  if (["OK", "NADA_A_FAZER", "JA_INSTALADA"].includes(r.estado)) {
    // a conferência da fila INTEIRA: relê o banco e replaneja; só "já
    // instalada" (marca concluída + ledger == fila) é SIM
    let depois;
    try {
      depois = await lerEstado(cliente);
    } catch (e) {
      depois = null;
      veredito = INCERTO;
      mensagem = `${r.mensagem} Mas a releitura do banco falhou (${String(e?.message ?? e).slice(0, 200)}): sem ela não digo SIM. Rode banco de novo.`;
    }
    if (depois) {
      const conf = planejarInstalacao(depois, arquivos);
      total = conf.total;
      if (conf.acao === "ja_instalada") {
        veredito = SIM;
        mensagem = `${r.mensagem} Conferido: as ${conf.total} migrations da fila estão no ledger e a instalação está marcada como concluída.`;
      } else {
        veredito = NAO;
        mensagem = `${r.mensagem} Mas a conferência não fecha: ${conf.motivo}`;
      }
    }
  } else if (
    r.estado === "ESTADO_DESCONHECIDO" ||
    (r.estado === "FALHOU" && r.releituraFalhou === true)
  ) {
    // envio sem resposta, ou envios certos sem a releitura que os confere:
    // pode ter ficado, então não é NÃO (achado da revisão do C1)
    veredito = INCERTO;
  } else {
    veredito = NAO;
  }
  await registrar(d, slug, "banco", {
    veredito,
    situacao: SITUACOES_DO_BANCO.has(r.estado) ? r.estado : "FALHOU",
    aplicadas,
    total,
  });
  return resultado(veredito, mensagem);
}

// ─── ficha ──────────────────────────────────────────────────────────────────

const literal = (v) => `'${String(v).replace(/'/g, "''")}'`;

/** A entrada de lojas.json e o SQL de frota_lojas, só como TEXTO. */
function cadastroGerado({ slug, ref, apelido, publicavel, lojasBrutas }) {
  // o abrir já recusa o slug que não cabe; esta é a mesma conferência de novo
  // (loja aberta antes desta trava existir)
  const dominio = `${slug}.vercel.app`;
  const naoCabe = slugQueNaoCabe(slug);
  if (naoCabe) throw new ErroDoComando(naoCabe);
  const segredo = segredoDoToken(slug);
  const entrada = {
    ref,
    classe: "assinante",
    apelido,
    segredoDoToken: segredo,
    functionsNomeadas: true,
  };
  const bruto = lojasBrutas;
  const jaTem =
    bruto?.lojas && typeof bruto.lojas === "object"
      ? Object.hasOwn(bruto.lojas, slug)
      : false;
  if (jaTem) {
    if (JSON.stringify(bruto.lojas[slug]) !== JSON.stringify(entrada)) {
      throw new ErroDoComando(
        `lojas.json já tem uma loja ${slug} com outros valores; o cadastro decide (nada gerado).`,
      );
    }
  } else {
    try {
      validarCadastro({ ...bruto, lojas: { ...bruto.lojas, [slug]: entrada } });
    } catch (e) {
      throw new ErroDoComando(
        `a entrada gerada não passa na validação de lojas.json: ${String(e?.message ?? e).slice(0, 300)}`,
      );
    }
  }
  const sql = `INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key) VALUES (${[
    slug,
    apelido,
    dominio,
    ref,
    `https://${ref}.supabase.co`,
    publicavel,
  ]
    .map(literal)
    .join(", ")}) ON CONFLICT (id) DO NOTHING;`;
  return {
    sql,
    json: JSON.stringify({ [slug]: entrada }, null, 2),
    jaTem,
  };
}

/** A linha de SQL_FICHA, ou null se veio fora do formato. */
function linhaDaFicha(linhas) {
  const l = Array.isArray(linhas) && linhas.length === 1 ? linhas[0] : null;
  if (
    !l ||
    !Number.isInteger(l.ficha) ||
    !(l.marca === null || typeof l.marca === "string") ||
    !(l.dominio_publico === null || typeof l.dominio_publico === "string")
  ) {
    return null;
  }
  return l;
}

async function passoFicha(pedido, d) {
  const { slug } = pedido;
  const e = await d.estado.ler(slug);
  if (e?.passos?.banco?.veredito !== SIM) {
    return resultado(NAO, "rode banco --aplicar até dar SIM antes da ficha.");
  }
  const pre = await projetoPronto(d, slug, "ficha");
  if (pre.falta) return resultado(NAO, pre.falta);
  const apelido = pedido.nome ?? slug;
  if (!RE_APELIDO.test(apelido)) {
    return resultado(
      NAO,
      "o apelido da loja (o slug, ou --nome) tem de ter até 30 caracteres, começando por letra: passe --nome.",
    );
  }
  const { gestao } = contexto(pedido, d);
  const linhas = await gestao.consultarBanco(pre.ref, SQL_FICHA, {
    somenteLeitura: true,
  });
  const l = linhaDaFicha(linhas);
  if (!l) {
    const r = resultado(INCERTO, "a leitura da ficha voltou fora do formato.");
    await registrar(d, slug, "ficha", { veredito: INCERTO });
    return r;
  }
  if (l.ficha !== 1) {
    await registrar(d, slug, "ficha", { veredito: NAO });
    return resultado(
      NAO,
      "a ficha (public.store_config id = 1) não existe: a migration 20261540000000_a_loja_nova_nasce_com_a_ficha estava na fila do banco? Sem a ficha a loja fica em manutenção (503).",
    );
  }
  if (l.marca !== MARCA_DA_FICHA) {
    await registrar(d, slug, "ficha", { veredito: INCERTO });
    return resultado(
      INCERTO,
      "a ficha id = 1 existe, mas sem a marca da migration 20261540000000 (comentário de store_config): não foi o caminho esperado que a criou. Conferir antes de cadastrar.",
    );
  }
  const chaves = await gestao.pedir("chaves", { ref: pre.ref });
  const publicaveis = Array.isArray(chaves)
    ? chaves
        .filter((k) => k?.type === "publishable")
        .map((k) => k.api_key)
        .filter((v) => typeof v === "string" && RE_PUBLICAVEL.test(v))
    : [];
  if (publicaveis.length !== 1) {
    await registrar(d, slug, "ficha", { veredito: INCERTO });
    return resultado(
      INCERTO,
      `a ficha está certa, mas não achei UMA chave publishable (sb_publishable_…) do projeto ${pre.ref} (achei ${publicaveis.length}); o SQL da caderneta não foi gerado.`,
    );
  }
  const gerado = cadastroGerado({
    slug,
    ref: pre.ref,
    apelido,
    publicavel: publicaveis[0],
    lojasBrutas: d.lojasBrutas(),
  });
  d.saida.out(
    [
      `Ficha conferida: store_config id = 1 com a marca ${MARCA_DA_FICHA}; dominio_publico ${l.dominio_publico === null ? "vazio (o cadastro grava o domínio)" : "já preenchido"}.`,
      "SQL da caderneta (NÃO EXECUTADO; é do passo cadastro, no banco onde a caderneta da frota mora):",
      gerado.sql,
      `Entrada de scripts/frota/lojas.json (NÃO GRAVADA${gerado.jaTem ? "; já está igual no arquivo" : ""}; o cadastro grava e roda lojas-nos-workflows.cjs --escrever):`,
      gerado.json,
    ].join("\n"),
  );
  await registrar(d, slug, "ficha", { veredito: SIM });
  return resultado(
    SIM,
    "ficha conferida; SQL da caderneta e entrada de lojas.json geradas acima, sem executar.",
  );
}

// ─── peças dos passos que chamam os scripts B ───────────────────────────────

/** O domínio da loja nova: o mesmo que o cadastro grava em frota_lojas
 * (cadastroGerado). Só o host, sem https://. */
const dominioDaLoja = (slug) => `${slug}.vercel.app`;

/** Os scripts B, rodados à mão, mandam "rodar de novo SEM --aplicar" para ler
 * o estado. Pelo nova-loja isso não lê nada (sem --aplicar é ENSAIO, 0
 * fetch): quem lê sem gravar aqui é o conferir (achado ANOTADO do C3). */
function semMandarTirarOAplicar(texto, slug) {
  return String(texto).replace(
    /(r)ode de novo sem --aplicar/gi,
    (_t, r) =>
      `${r}ode node scripts/frota/nova-loja.mjs conferir --loja ${slug} --aplicar (só leitura: não grava nada)`,
  );
}

/** Registra o veredito de um passo que PODE ter escrito. Estado que não
 * grava (ou qualquer erro aqui) não desfaz o que o banco fez: SIM sem o
 * estado vira INCERTO, e o resto fica como está. */
async function fecharPasso(d, slug, passo, r, repetir) {
  try {
    await registrar(d, slug, passo, { veredito: r.veredito });
  } catch (erro) {
    return resultado(
      r.veredito === SIM ? INCERTO : r.veredito,
      `${r.mensagem} ${porque(erro)} ${repetir}`,
    );
  }
  return r;
}

// ─── segredos ───────────────────────────────────────────────────────────────

const RE_LINHA_DE_DESTAQUE_DO_B1 =
  /^(FALHOU|RECUSADO|ESTADO DESCONHECIDO|ATENÇÃO|conferência:)/;

/** O B1 (segredos-da-loja.mjs) com o cliente OAuth desta rodada: o token
 * nunca vem do ambiente. Ele relê antes de gravar, nunca substitui e confere
 * por releitura; o veredito dele é repassado (INCERTO nunca vira SIM). */
async function passoSegredos(pedido, d) {
  const { slug } = pedido;
  const e = await d.estado.ler(slug);
  if (e?.passos?.banco?.veredito !== SIM) {
    return resultado(
      NAO,
      "rode banco --aplicar até dar SIM antes dos segredos (o Vault e a store_config moram no banco da loja). Nada foi lido.",
    );
  }
  const pre = await projetoPronto(d, slug, "segredos");
  if (pre.falta) return resultado(NAO, pre.falta);
  const { gestao } = contexto(pedido, d);
  const repetir =
    "Rode segredos de novo: o segredos-da-loja relê antes e nunca substitui o que já existe.";
  let r;
  try {
    r = await instalarSegredos({
      cliente: gestao,
      ref: pre.ref,
      aplicar: true,
    });
  } catch (erro) {
    return await fecharPasso(
      d,
      slug,
      "segredos",
      resultado(
        INCERTO,
        `o segredos-da-loja parou no meio (${porque(erro)}): uma escrita pode ter acontecido.`,
      ),
      repetir,
    );
  }
  const linhas = Array.isArray(r?.linhas) ? r.linhas.map(String) : [];
  for (const l of linhas) d.saida.out(l);
  const veredito = VEREDITOS.has(r?.veredito) ? r.veredito : INCERTO;
  const destaque = linhas.filter(
    (l) => RE_LINHA_DE_DESTAQUE_DO_B1.test(l) || l.includes("BLOQUEADO"),
  );
  const mensagem =
    destaque.length > 0
      ? destaque.join(" ")
      : "o segredos-da-loja não explicou o veredito.";
  return await fecharPasso(
    d,
    slug,
    "segredos",
    resultado(veredito, semMandarTirarOAplicar(mensagem, slug)),
    repetir,
  );
}

// ─── functions ──────────────────────────────────────────────────────────────

/** Veredito do functions-da-loja (B2) → o nosso, com o código de saída que
 * ele tem de ter junto (qualquer desencontro = INCERTO). */
const VEREDITO_DO_B2 = new Map([
  ["SIM", [SIM, 0]],
  ["NAO", [NAO, 1]],
  ["INCERTO", [INCERTO, 3]],
]);

/** O resultado do B2 → { veredito, corpo, antes, erros }. */
function lidoDoB2(r) {
  const par = VEREDITO_DO_B2.get(r?.veredito);
  const saida = Array.isArray(r?.saida) ? r.saida.map(String) : [];
  const erros = Array.isArray(r?.erros) ? r.erros.map(String) : [];
  const m = RE_LINHA_DO_VEREDITO.exec(saida.at(-1) ?? "");
  const veredito = par && m && par[1] === r.codigo ? par[0] : INCERTO;
  return {
    veredito,
    corpo: m
      ? m[1]
      : "o functions-da-loja respondeu fora do formato: não dá para afirmar o que aconteceu.",
    antes: m ? saida.slice(0, -1) : saida,
    erros,
  };
}

/** O B2 com o cliente OAuth desta rodada: só o commit aprovado (HEAD == topo
 * do ramo da release) publica, uma por vez, conferindo cada uma. A recusa
 * dele (HEAD fora do topo, loja fora do cadastro, fontes divergentes) é
 * repassada como veio. */
async function passoFunctions(pedido, d) {
  const { slug } = pedido;
  const pre = await projetoPronto(d, slug, "functions");
  if (pre.falta) return resultado(NAO, pre.falta);
  const { gestao } = contexto(pedido, d);
  const repetir =
    "Rode functions de novo: as que já estão no ar com o verify_jwt certo são puladas.";
  let r;
  try {
    r = await executarFunctions(
      ["--projeto", pre.ref, "--canal", slug, "--aplicar"],
      { git: d.git, cliente: gestao, esperar: d.dormir },
    );
  } catch (erro) {
    return await fecharPasso(
      d,
      slug,
      "functions",
      resultado(
        INCERTO,
        `o functions-da-loja parou no meio (${porque(erro)}): uma publicação pode ter acontecido. Rode conferir --aplicar (só leitura) antes de repetir.`,
      ),
      repetir,
    );
  }
  const l = lidoDoB2(r);
  for (const x of [...l.antes, ...l.erros]) d.saida.out(x);
  const mensagem =
    l.erros.length > 0 ? `${l.corpo} (${l.erros.join("; ")})` : l.corpo;
  return await fecharPasso(
    d,
    slug,
    "functions",
    resultado(l.veredito, semMandarTirarOAplicar(mensagem, slug)),
    repetir,
  );
}

// ─── login ──────────────────────────────────────────────────────────────────

const RE_LINHA_DE_DESTAQUE_DO_B4 =
  /^(FALTA|FALHOU|NÃO MEDIDO|estado|não consegui|a escrita respondeu|o que fazer)/;

/** O que o B4 (login-da-loja-nova.mjs) disse que importa: as faltas, as
 * falhas e o que fazer; sem elas, a última linha (o veredito dele). */
function resumoDoB4(linhas) {
  const destaque = linhas.filter((l) => RE_LINHA_DE_DESTAQUE_DO_B4.test(l));
  return (destaque.length > 0 ? destaque : linhas.slice(-1)).join(" ");
}

/** O B4 com o cliente OAuth desta rodada, no domínio <slug>.vercel.app:
 * endereços do login e o gancho de e-mail preparado DESLIGADO. */
async function passoLogin(pedido, d) {
  const { slug } = pedido;
  const pre = await projetoPronto(d, slug, "login");
  if (pre.falta) return resultado(NAO, pre.falta);
  const { gestao } = contexto(pedido, d);
  const repetir =
    "Rode conferir --aplicar (só leitura) e veja o item login antes de repetir.";
  let r;
  try {
    r = await configurarLoginNovo({
      cliente: gestao,
      ref: pre.ref,
      dominio: dominioDaLoja(slug),
      aplicar: true,
    });
  } catch (erro) {
    return await fecharPasso(
      d,
      slug,
      "login",
      resultado(
        INCERTO,
        `o login-da-loja-nova parou no meio (${porque(erro)}): uma escrita pode ter acontecido.`,
      ),
      repetir,
    );
  }
  const linhas = (Array.isArray(r?.linhas) ? r.linhas : []).map((l) =>
    semMandarTirarOAplicar(l, slug),
  );
  for (const l of linhas) d.saida.out(l);
  const veredito = VEREDITOS.has(r?.veredito) ? r.veredito : INCERTO;
  return await fecharPasso(
    d,
    slug,
    "login",
    resultado(veredito, resumoDoB4(linhas)),
    repetir,
  );
}

// ─── primeira-admin ─────────────────────────────────────────────────────────

/** O código de saída do primeira-admin.mjs (B3) → veredito. */
const VEREDITO_DO_B3 = new Map([
  [0, SIM],
  [1, NAO],
  [2, INCERTO],
]);
const RE_LINHA_DO_VEREDITO = /^VEREDITO: (?:SIM|NÃO|INCERTO) — ([\s\S]*)$/;

/** Defesa na fronteira do comando: o B3 já não imprime o e-mail; se alguma
 * linha o trouxer (qualquer caixa), ela não sai daqui. */
function semOEmail(linhas, email) {
  const alvo = typeof email === "string" ? email.trim().toLowerCase() : "";
  return linhas.map((l) =>
    alvo !== "" && String(l).toLowerCase().includes(alvo)
      ? "(linha omitida: continha o e-mail)"
      : String(l),
  );
}

async function passoPrimeiraAdmin(pedido, d) {
  const { slug } = pedido;
  const e = await d.estado.ler(slug);
  if (e?.passos?.banco?.veredito !== SIM) {
    return resultado(
      NAO,
      "rode banco --aplicar até dar SIM antes da primeira-admin (a conta dela mora no banco da loja). Nada foi lido.",
    );
  }
  const pre = await projetoPronto(d, slug, "primeira-admin");
  if (pre.falta) return resultado(NAO, pre.falta);
  const { token } = contexto(pedido, d);
  // o e-mail só existe nesta variável e no SQL que o B3 manda ao banco
  let email = "";
  const r = await executarPrimeiraAdmin(
    ["--projeto", pre.ref, "--loja", slug, "--aplicar"],
    {
      lerEntrada: async () => {
        const t = await d.lerEntrada(
          "Digite o e-mail da administradora (o mesmo com que ela se cadastrou NA LOJA) e tecle Enter: ",
        );
        email = typeof t === "string" ? t : "";
        return t;
      },
      obterToken: () => token(),
      fetch: d.fetch,
    },
  );
  const saida = semOEmail(Array.isArray(r?.saida) ? r.saida : [], email);
  const erros = semOEmail(Array.isArray(r?.erros) ? r.erros : [], email);
  email = "";
  const final = saida.at(-1) ?? "";
  const m = RE_LINHA_DO_VEREDITO.exec(final);
  const lido = VEREDITO_DO_B3.get(r?.codigo);
  const veredito = m && lido ? lido : INCERTO;
  const corpo = m
    ? m[1]
    : "o primeira-admin respondeu fora do formato: não dá para afirmar o que aconteceu. Rode de novo (é seguro: a mesma pessoa já admin dá SIM sem gravar).";
  for (const l of saida.slice(0, -1))
    d.saida.out(semMandarTirarOAplicar(l, slug));
  // o B3 avulso manda "rodar SEM --aplicar" para ler o estado; aqui quem lê
  // sem gravar é o conferir
  const mensagem = semMandarTirarOAplicar(
    erros.length > 0 ? `${corpo} (${erros.join("; ")})` : corpo,
    slug,
  );
  try {
    await registrar(d, slug, "primeira-admin", { veredito });
  } catch (erro) {
    if (erro?.codigo !== "ESTADO_NAO_GRAVOU") throw erro;
    // o banco pode ter gravado: SIM sem o estado não é SIM
    return resultado(
      veredito === SIM ? INCERTO : veredito,
      `${mensagem}. ${erro.message} Rode primeira-admin de novo: é seguro (a mesma pessoa já admin dá SIM sem gravar).`,
    );
  }
  return resultado(veredito, mensagem);
}

// ─── conferir ───────────────────────────────────────────────────────────────

/** Só leitura: quantas pessoas são admin em QUALQUER das duas fontes do cargo
 * (a mesma união do primeira-admin.mjs) e quantas são admin nas DUAS. Nenhum
 * id, nenhum e-mail. */
export const SQL_ADMINS =
  "SELECT (SELECT count(*) FROM (SELECT p.id FROM public.profiles p WHERE p.role = 'admin' UNION SELECT u.id FROM auth.users u WHERE u.raw_app_meta_data ->> 'role' = 'admin') a)::int AS admins, (SELECT count(*) FROM auth.users u JOIN public.profiles p ON p.id = u.id WHERE p.role = 'admin' AND u.raw_app_meta_data ->> 'role' = 'admin')::int AS nas_duas;";

// ─── definir-dono: o SQL ────────────────────────────────────────────────────

/** Só leitura: a tabela do dono existe (migration 20261383000000)? */
export const SQL_DONO_EXISTE =
  "SELECT to_regclass('public.dono_da_loja') IS NOT NULL AS tabela;";

/** Só leitura, uma linha, nenhum id nem e-mail. `admins` = admin em QUALQUER
 * das duas fontes do cargo (a união do primeira-admin.mjs); `nas_duas` =
 * admin nas DUAS (o que is_admin_atual() e definir_cargo() exigem);
 * `dono_admin` = o critério da consulta 88c: o dono existe em auth.users e é
 * admin em profiles.role e em auth.users (role). */
export const SQL_DONO = `WITH admins AS MATERIALIZED (
  SELECT p.id FROM public.profiles p WHERE p.role = 'admin'
  UNION
  SELECT u.id FROM auth.users u WHERE u.raw_app_meta_data ->> 'role' = 'admin'
), nas_duas AS MATERIALIZED (
  SELECT u.id, u.email_confirmed_at IS NOT NULL AS confirmada
    FROM auth.users u JOIN public.profiles p ON p.id = u.id
   WHERE p.role = 'admin' AND u.raw_app_meta_data ->> 'role' = 'admin'
)
SELECT (SELECT count(*) FROM admins)::int AS admins,
       (SELECT count(*) FROM nas_duas)::int AS nas_duas,
       COALESCE((SELECT bool_and(n.confirmada) FROM nas_duas n), false) AS confirmada,
       (SELECT count(*) FROM public.dono_da_loja)::int AS donos,
       EXISTS (SELECT 1 FROM public.dono_da_loja d JOIN nas_duas n ON n.id = d.user_id) AS dono_admin;`;

/**
 * A escrita: UMA requisição, sem `parameters` e SEM dado de entrada (a dona
 * é o id que o próprio banco acha; nada de e-mail). O DO repete TODAS as
 * guardas da leitura (a leitura explica; a guarda que vale é a de dentro):
 *  - READ COMMITTED + pg_advisory_xact_lock (a MESMA chave do primeira-admin,
 *    para nenhuma promoção correr junto, e a do definir-dono) + LOCK TABLE
 *    dono_da_loja (nem um INSERT/DELETE à mão corre junto); lock_timeout faz a
 *    espera virar erro com SQLSTATE (55P03, nada gravado) antes do prazo do
 *    pg-meta, que viraria INCERTO;
 *  - SET LOCAL ROLE postgres: dono_da_loja não tem gatilho e nenhuma trava
 *    dela lê o GUC role (conferido em 20261383000000 e 20261440000000), mas a
 *    tabela só é escrita pelo dono dela (postgres, "Ninguem de aplicacao
 *    escreve"): o papel fica preso nele, seja qual for o da sessão da API;
 *  - a admin única é travada (FOR SHARE OF p) até o COMMIT, e a conferência
 *    depois do INSERT é o critério da 88c (1 linha, em auth.users, admin nas
 *    duas fontes). O resultado (sem id) volta por um GUC de sessão gravado
 *    DENTRO da transação: só existe se ela comitou.
 * Cada recusa tem SQLSTATE próprio (classe IK, IKD01..IKD07).
 */
export const SQL_DEFINIR_DONO = `BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL ROLE postgres;
SET LOCAL lock_timeout = '10s';
DO $definir_dono$
DECLARE
  v_donos integer;
  v_admins integer;
  v_id uuid;
  v_confirmada boolean;
  v_linhas integer := 0;
BEGIN
  PERFORM set_config('ikcous.definir_dono_resultado', '', false);
  PERFORM pg_advisory_xact_lock(hashtext('ikcous.primeira_admin'));
  PERFORM pg_advisory_xact_lock(hashtext('ikcous.definir_dono'));
  LOCK TABLE public.dono_da_loja IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO v_donos FROM public.dono_da_loja;
  SELECT count(*) INTO v_admins
    FROM (SELECT p.id FROM public.profiles p WHERE p.role = 'admin'
          UNION
          SELECT u.id FROM auth.users u WHERE u.raw_app_meta_data ->> 'role' = 'admin') a;
  IF v_donos > 0 THEN
    IF EXISTS (SELECT 1 FROM public.dono_da_loja d
                 JOIN auth.users u ON u.id = d.user_id
                 JOIN public.profiles p ON p.id = d.user_id
                WHERE p.role = 'admin' AND u.raw_app_meta_data ->> 'role' = 'admin') THEN
      PERFORM set_config('ikcous.definir_dono_resultado',
        json_build_object('acao', 'ja_era_dona', 'donos', v_donos, 'linhas', 0, 'admins', v_admins)::text, false);
      RETURN;
    END IF;
    IF v_admins = 0 THEN
      RAISE EXCEPTION 'definir-dono: o dono nao e mais admin' USING ERRCODE = 'IKD02';
    END IF;
    RAISE EXCEPTION 'definir-dono: a loja ja tem outro dono' USING ERRCODE = 'IKD01';
  END IF;
  IF v_admins = 0 THEN
    RAISE EXCEPTION 'definir-dono: a loja nao tem admin' USING ERRCODE = 'IKD03';
  END IF;
  IF v_admins > 1 THEN
    RAISE EXCEPTION 'definir-dono: mais de uma admin' USING ERRCODE = 'IKD04';
  END IF;
  SELECT u.id, u.email_confirmed_at IS NOT NULL INTO v_id, v_confirmada
    FROM auth.users u JOIN public.profiles p ON p.id = u.id
   WHERE p.role = 'admin' AND u.raw_app_meta_data ->> 'role' = 'admin'
     FOR SHARE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'definir-dono: as fontes do cargo discordam' USING ERRCODE = 'IKD05';
  END IF;
  IF NOT v_confirmada THEN
    RAISE EXCEPTION 'definir-dono: e-mail nao confirmado' USING ERRCODE = 'IKD06';
  END IF;

  INSERT INTO public.dono_da_loja (user_id) VALUES (v_id);
  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  IF v_linhas <> 1 OR (SELECT count(*) FROM public.dono_da_loja) <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.dono_da_loja d
      JOIN auth.users u ON u.id = d.user_id
      JOIN public.profiles p ON p.id = d.user_id
     WHERE d.user_id = v_id AND p.role = 'admin' AND u.raw_app_meta_data ->> 'role' = 'admin'
  ) THEN
    RAISE EXCEPTION 'definir-dono: conferencia da 88c falhou' USING ERRCODE = 'IKD07';
  END IF;
  PERFORM set_config('ikcous.definir_dono_resultado',
    json_build_object('acao', 'gravada', 'donos', 1, 'linhas', v_linhas, 'admins', v_admins)::text, false);
END
$definir_dono$;
COMMIT;
SELECT current_setting('ikcous.definir_dono_resultado', true) AS resultado;`;

// ─── definir-dono: a regra (decisão do sócio, 26/11 tarde) ──────────────────

const TROCAR_E_DA_DONA =
  "trocar de dono é pedido da dona, pela autorização dela (o passo trocar-dono ainda não existe); este comando não troca nem apaga ninguém";

/** Cada recusa de dentro da transação (SQLSTATE IKD..) e a mesma, lida antes. */
const RECUSAS_DO_DONO = Object.freeze({
  IKD01: `a loja já tem dono cadastrado e ele não é a administradora de hoje: ${TROCAR_E_DA_DONA}`,
  IKD02: `o dono cadastrado não é mais administrador nas duas fontes do cargo (e a loja não tem administradora): ${TROCAR_E_DA_DONA}`,
  IKD03:
    "a loja não tem administradora: rode primeira-admin --aplicar antes (a dona é a primeira administradora)",
  IKD04:
    "a loja tem 2 ou mais administradoras: não escolho quem vira dona. Cadastrar o dono nesse caso é decisão do dono do produto",
  IKD05:
    "as duas fontes do cargo discordam (admin em uma e não na outra): decisão do dono do produto, não se mexe aqui",
  IKD06:
    "a administradora ainda não confirmou o e-mail: peça que abra o link de confirmação e entre na loja uma vez; depois rode de novo",
  IKD07:
    "a conferência pelo critério da 88c (1 dono, em auth.users, admin nas duas fontes) não fechou dentro da transação",
});

const COLUNAS_DO_DONO = "admins,confirmada,dono_admin,donos,nas_duas";

/** A linha de SQL_DONO, ou null se veio fora do formato. */
function linhaDoDono(linhas) {
  const l = Array.isArray(linhas) && linhas.length === 1 ? linhas[0] : null;
  if (
    l === null ||
    typeof l !== "object" ||
    Array.isArray(l) ||
    Object.keys(l).sort().join(",") !== COLUNAS_DO_DONO ||
    !inteiro(l.admins) ||
    !inteiro(l.nas_duas) ||
    !inteiro(l.donos) ||
    typeof l.confirmada !== "boolean" ||
    typeof l.dono_admin !== "boolean"
  ) {
    return null;
  }
  return l;
}

/**
 * Pura: a linha de SQL_DONO → { veredito, mensagem, gravar }. A MESMA ordem
 * de guardas do DO de SQL_DEFINIR_DONO. Só `gravar: true` leva à escrita.
 */
export function decidirDono(linhas) {
  const l = linhaDoDono(linhas);
  const nao = (codigo) => ({
    veredito: NAO,
    mensagem: `${Reflect.get(RECUSAS_DO_DONO, codigo)}. Nada foi gravado.`,
    gravar: false,
  });
  if (!l) {
    return {
      veredito: INCERTO,
      mensagem:
        "a leitura do dono e das administradoras voltou fora do formato; nada foi gravado.",
      gravar: false,
    };
  }
  if (l.donos > 1) {
    return {
      veredito: NAO,
      mensagem: `dono_da_loja tem ${l.donos} linhas (fora do desenho: a tabela aceita uma). Nada foi gravado; avise o programador.`,
      gravar: false,
    };
  }
  if (l.donos === 1) {
    if (l.dono_admin) {
      return {
        veredito: SIM,
        mensagem:
          l.admins === 1
            ? "a administradora única já é a dona (critério da 88c: 1 dono, admin nas duas fontes); nada foi gravado."
            : `o dono cadastrado é admin nas duas fontes (critério da 88c), e a loja tem ${l.admins} administradoras; nada foi gravado.`,
        gravar: false,
      };
    }
    return nao(l.admins === 0 ? "IKD02" : "IKD01");
  }
  if (l.admins === 0) return nao("IKD03");
  if (l.admins > 1) {
    return {
      ...nao("IKD04"),
      mensagem: `a loja tem ${l.admins} administradoras: não escolho quem vira dona. Cadastrar o dono nesse caso é decisão do dono do produto. Nada foi gravado.`,
    };
  }
  if (l.nas_duas !== 1) return nao("IKD05");
  if (!l.confirmada) return nao("IKD06");
  return {
    veredito: SIM,
    mensagem:
      "sem dono, e uma administradora só (nas duas fontes do cargo, e-mail confirmado)",
    gravar: true,
  };
}

/** Lê (só leitura) se a tabela existe e, se existe, a linha de SQL_DONO. */
async function lerDono(cliente, ref) {
  const t = await cliente.consultarBanco(ref, SQL_DONO_EXISTE, {
    somenteLeitura: true,
  });
  const tabela =
    Array.isArray(t) && t.length === 1 && typeof t[0]?.tabela === "boolean"
      ? t[0].tabela
      : null;
  if (tabela === null) return { tabela: null };
  if (!tabela) return { tabela: false };
  const linhas = await cliente.consultarBanco(ref, SQL_DONO, {
    somenteLeitura: true,
  });
  return { tabela: true, linhas };
}

const SEM_A_TABELA_DO_DONO =
  "public.dono_da_loja não existe neste banco: a migration 20261383000000_so_o_dono_da_loja_define_cargo estava na fila do banco? Nada foi gravado.";

/** A linha final da escrita → "gravada" | "ja_era_dona" | null (null =
 * qualquer coisa fora do exato: INCERTO). */
function resultadoDoDono(linhas) {
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
  if (Object.keys(r).sort().join(",") !== "acao,admins,donos,linhas")
    return null;
  if (r.donos !== 1 || !inteiro(r.admins)) return null;
  if (r.acao === "gravada" && r.linhas === 1 && r.admins === 1)
    return "gravada";
  if (r.acao === "ja_era_dona" && r.linhas === 0) return "ja_era_dona";
  return null;
}

const REPETIR_O_DONO =
  "Repetir definir-dono --aplicar é seguro: ele lê antes, e a dona já cadastrada dá SIM sem gravar.";

/** O erro da escrita → resultado. Só um erro do PRÓPRIO Postgres (SQLSTATE
 * no corpo) prova que o COMMIT não rodou; o resto é INCERTO. */
function resultadoDoErroDoDono(e) {
  const sqlstate =
    e instanceof ErroDaGestao && e.codigo === "HTTP" ? e.sqlstate : undefined;
  if (typeof sqlstate !== "string") {
    return resultado(
      INCERTO,
      `a resposta não diz se a transação comitou (${porque(e)}). ${REPETIR_O_DONO}`,
    );
  }
  if (Object.hasOwn(RECUSAS_DO_DONO, sqlstate)) {
    return resultado(
      NAO,
      `${Reflect.get(RECUSAS_DO_DONO, sqlstate)} (o banco recusou por dentro da transação, SQLSTATE ${sqlstate}: nada foi gravado).`,
    );
  }
  if (sqlstate === "55P03") {
    return resultado(
      NAO,
      "outro comando segurava a trava do cargo da loja há mais de 10 s (SQLSTATE 55P03); nada foi gravado. Espere e rode de novo.",
    );
  }
  if (sqlstate === "42501") {
    return resultado(
      NAO,
      "o banco recusou a transação por permissão (SQLSTATE 42501): provavelmente o SET LOCAL ROLE postgres não valeu por esta API (prova P5 da T1). Nada foi gravado; não improvise outro caminho, volte a decisão ao programador.",
    );
  }
  return resultado(
    NAO,
    `o banco recusou a transação (SQLSTATE ${sqlstate}); nada foi gravado.`,
  );
}

/** Por que esta loja nunca recebe o definir-dono (null = pode). LANÇA
 * ErroDoComando se lojas.json não deixa conferir. */
function porQueEProtegida(d, slug, ref) {
  const recusa = (qual) =>
    `${qual}: o definir-dono nunca roda nas lojas que já vendem (IKCOUS e Savy); o dono delas é cadastrado pelo dono do produto (docs/runbooks/definir-o-dono-da-loja.md). Nada foi feito.`;
  if (LOJAS_PROTEGIDAS.includes(slug)) return recusa(`a loja ${slug}`);
  if (LOJAS_LEGADAS.includes(slug)) return recusaDoLegado(slug);
  if (REFS_PROTEGIDOS.includes(ref))
    return recusa(`o projeto ${ref} é de uma loja que já vende`);
  let lojas;
  try {
    lojas = d.lojasBrutas()?.lojas;
  } catch {
    lojas = undefined;
  }
  const legivel =
    lojas !== null &&
    typeof lojas === "object" &&
    LOJAS_PROTEGIDAS.every(
      (n) => Object.hasOwn(lojas, n) && RE_REF.test(String(lojas[n]?.ref)),
    );
  if (!legivel) {
    throw new ErroDoComando(
      "não consegui ler scripts/frota/lojas.json (com a IKCOUS e a Savy) para conferir que esta loja não é uma delas; nada foi feito.",
      { codigo: ESTADO_DESCONHECIDO },
    );
  }
  // o próprio nome cadastrado como alvo legado (a entrada dele é pulada abaixo)
  if (
    Object.hasOwn(lojas, slug) &&
    Reflect.get(lojas, slug)?.classe === "legado"
  )
    return recusaDoLegado(slug);
  // toda loja que já está no cadastro com OUTRO nome é loja que já existia
  for (const [nome, l] of Object.entries(lojas)) {
    if (nome === slug) continue;
    if (ref === l?.ref || ref === l?.refDasFunctions) {
      return recusa(`o projeto ${ref} é o da loja ${textoSeguro(nome, 40)}`);
    }
  }
  return null;
}

/** As condições ANTES de qualquer rede: loja aberta pelo nova-loja (estado
 * local com projeto e banco SIM) e que não é IKCOUS/Savy. Devolve
 * { ref } ou { r: resultado }. */
async function preDoDono(d, slug, prefixo = "") {
  const e = await d.estado.ler(slug);
  const cp = e?.passos?.["criar-projeto"];
  if (cp?.veredito !== SIM || !cp.ref) {
    return {
      r: resultado(
        NAO,
        `${prefixo}definir-dono só roda em loja aberta pelo nova-loja: o estado local de ${slug} não tem projeto com criar-projeto SIM. Nada foi feito.`,
      ),
    };
  }
  if (e?.passos?.banco?.veredito !== SIM) {
    return {
      r: resultado(
        NAO,
        `${prefixo}rode banco --aplicar até dar SIM antes do definir-dono. Nada foi lido.`,
      ),
    };
  }
  let protegida;
  try {
    protegida = porQueEProtegida(d, slug, cp.ref);
  } catch (erro) {
    return { r: resultado(INCERTO, `${prefixo}${porque(erro)}`) };
  }
  if (protegida) return { r: resultado(NAO, `${prefixo}${protegida}`) };
  return { ref: cp.ref };
}

async function passoDefinirDono(pedido, d) {
  const { slug } = pedido;
  const pre = await preDoDono(d, slug);
  if (pre.r) return pre.r;
  const { ref } = pre;
  const { gestao } = contexto(pedido, d);
  const fechar = (r) => fecharPasso(d, slug, "definir-dono", r, REPETIR_O_DONO);

  let lido;
  try {
    lido = await lerDono(gestao, ref);
  } catch (erro) {
    return await fechar(
      resultado(
        INCERTO,
        `não consegui ler o dono e as administradoras: ${porque(erro)} Nada foi gravado.`,
      ),
    );
  }
  if (lido.tabela === false)
    return await fechar(resultado(NAO, SEM_A_TABELA_DO_DONO));
  const decisao =
    lido.tabela === null ? decidirDono(null) : decidirDono(lido.linhas);
  if (!decisao.gravar)
    return await fechar(resultado(decisao.veredito, decisao.mensagem));

  d.saida.out(
    `definir-dono: ${decisao.mensagem}. Plano: UMA transação (BEGIN; SET LOCAL ROLE postgres; travas; as guardas de novo; INSERT em dono_da_loja com o id lido no banco; conferência pela 88c; COMMIT).`,
  );
  let linhas;
  try {
    linhas = await gestao.consultarBanco(ref, SQL_DEFINIR_DONO);
  } catch (erro) {
    return await fechar(resultadoDoErroDoDono(erro));
  }
  const acao = resultadoDoDono(linhas);
  if (acao === null) {
    return await fechar(
      resultado(
        INCERTO,
        `a escrita respondeu num formato inesperado: não dá para afirmar que gravou. ${REPETIR_O_DONO}`,
      ),
    );
  }
  // a releitura, fora da transação, pelo mesmo critério da 88c
  let depois;
  try {
    depois = await lerDono(gestao, ref);
  } catch (erro) {
    return await fechar(
      resultado(
        INCERTO,
        `a transação respondeu que ${acao === "gravada" ? "gravou" : "a dona já estava cadastrada"}, mas a releitura caiu (${porque(erro)}): sem ela não digo SIM. ${REPETIR_O_DONO}`,
      ),
    );
  }
  const l = depois.tabela === true ? linhaDoDono(depois.linhas) : null;
  if (!l) {
    return await fechar(
      resultado(
        INCERTO,
        `a releitura do dono voltou fora do formato: sem ela não digo SIM. ${REPETIR_O_DONO}`,
      ),
    );
  }
  if (!(l.donos === 1 && l.dono_admin)) {
    return await fechar(
      resultado(
        NAO,
        "a transação respondeu, mas a releitura não acha 1 dono admin nas duas fontes (critério da 88c): algo mudou junto. Confira antes de repetir.",
      ),
    );
  }
  return await fechar(
    resultado(
      SIM,
      acao === "gravada"
        ? "a administradora única agora é a dona da loja (conferido pelo critério da 88c: 1 dono, em auth.users, admin nas duas fontes). Quem estava com o painel aberto recarrega a página (F5)."
        : "a administradora única já era a dona; nada foi gravado.",
    ),
  );
}

// ─── trocar-dono: o SQL e a regra (plano de fechar a loja nova, T1) ─────────
// Trocar a dona redireciona o dinheiro da loja (as chaves de MP e Gmail passam
// a ser da nova: supabase/functions/_shared/dono-da-loja.ts). O passo que pede
// a autorização da dona e chama isto é a T2/T3; aqui só o SQL e a decisão.

/** Só leitura, UMA instrução, uma linha, nenhum id nem e-mail na resposta.
 * O e-mail entra como literal SQL pelo literalDoEmail do primeira-admin
 * (aspa dobrada; barra invertida, espaço e controle recusados antes de virar
 * SQL). `contas` = quantas contas têm esse e-mail (sem diferenciar
 * maiúsculas); `nova_admin` = essa conta é admin nas DUAS fontes do cargo;
 * `e_a_dona` = essa conta já é a dona cadastrada. */
export function sqlDaTroca(email) {
  const lit = literalDoEmail(email);
  return `WITH alvo AS MATERIALIZED (
  SELECT lower(${lit}) AS email
), contas AS MATERIALIZED (
  SELECT u.id, u.email_confirmed_at IS NOT NULL AS confirmada
    FROM auth.users u JOIN alvo ON lower(u.email) = alvo.email
), nas_duas AS MATERIALIZED (
  SELECT u.id
    FROM auth.users u JOIN public.profiles p ON p.id = u.id
   WHERE p.role = 'admin' AND u.raw_app_meta_data ->> 'role' = 'admin'
)
SELECT (SELECT count(*) FROM public.dono_da_loja)::int AS donos,
       (SELECT count(*) FROM contas)::int AS contas,
       COALESCE((SELECT bool_and(c.confirmada) FROM contas c), false) AS confirmada,
       EXISTS (SELECT 1 FROM contas c JOIN nas_duas n ON n.id = c.id) AS nova_admin,
       EXISTS (SELECT 1 FROM contas c JOIN public.dono_da_loja d ON d.user_id = c.id) AS e_a_dona;`;
}

/**
 * A escrita: UMA requisição, sem `parameters` (a database/query do OAuth não
 * os aceita com várias instruções). O e-mail entra SÓ na 4ª instrução, como
 * literal do literalDoEmail num `SET LOCAL`, FORA do dollar-quote (um e-mail
 * com `$trocar_dono$` não fecha o DO); o DO o lê por current_setting. O resto
 * é o molde do SQL_DEFINIR_DONO, e o DO repete TODAS as guardas da leitura:
 *  - READ COMMITTED + as MESMAS travas do primeira-admin e do definir-dono, na
 *    mesma ordem (os três se enfileiram sem deadlock) + LOCK TABLE
 *    dono_da_loja (nenhum INSERT/DELETE à mão corre junto); lock_timeout
 *    vira 55P03 (nada gravado) antes do prazo do pg-meta;
 *  - SET LOCAL ROLE postgres: a tabela só é escrita pelo dono dela;
 *  - a ordem das guardas: sem dono (IKT01) → mais de um dono, fora do desenho
 *    (IKT05) → 0 ou 2+ contas com o e-mail (IKT04) → a conta já é a dona:
 *    admin nas duas = ja_era_dona SEM escrita, senão IKT02 → a nova não é
 *    admin nas duas fontes (IKT02; a linha dela em profiles fica travada FOR
 *    SHARE até o COMMIT, então um definir_cargo que a rebaixe espera) → e-mail
 *    não confirmado (IKT03);
 *  - DELETE da dona de hoje e INSERT da nova; a conferência é o critério da
 *    88c dentro da transação (1 apagada, 1 inserida, 1 dono, a nova em
 *    auth.users e admin nas duas fontes), senão IKT05 e nada fica.
 * O resultado (sem id nem e-mail) volta por um GUC de sessão gravado DENTRO
 * da transação: só existe se ela comitou. A dona antiga NÃO perde o cargo de
 * admin aqui (tirar é com a nova, pelo definir_cargo).
 */
export function sqlTrocarDono(email) {
  const lit = literalDoEmail(email);
  return `BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL ROLE postgres;
SET LOCAL lock_timeout = '10s';
SET LOCAL ikcous.trocar_dono_email = ${lit};
DO $trocar_dono$
DECLARE
  v_email text := lower(current_setting('ikcous.trocar_dono_email'));
  v_donos integer;
  v_contas integer;
  v_id uuid;
  v_confirmada boolean;
  v_apagadas integer := 0;
  v_linhas integer := 0;
BEGIN
  PERFORM set_config('ikcous.trocar_dono_resultado', '', false);
  PERFORM pg_advisory_xact_lock(hashtext('ikcous.primeira_admin'));
  PERFORM pg_advisory_xact_lock(hashtext('ikcous.definir_dono'));
  LOCK TABLE public.dono_da_loja IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO v_donos FROM public.dono_da_loja;
  IF v_donos = 0 THEN
    RAISE EXCEPTION 'trocar-dono: a loja nao tem dono' USING ERRCODE = 'IKT01';
  END IF;
  IF v_donos > 1 THEN
    RAISE EXCEPTION 'trocar-dono: mais de um dono (fora do desenho)' USING ERRCODE = 'IKT05';
  END IF;
  SELECT count(*) INTO v_contas FROM auth.users u WHERE lower(u.email) = v_email;
  IF v_contas <> 1 THEN
    RAISE EXCEPTION 'trocar-dono: nenhuma ou mais de uma conta com o e-mail' USING ERRCODE = 'IKT04';
  END IF;
  SELECT u.id INTO v_id FROM auth.users u WHERE lower(u.email) = v_email;
  IF EXISTS (SELECT 1 FROM public.dono_da_loja d WHERE d.user_id = v_id) THEN
    IF EXISTS (SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id = u.id
                WHERE u.id = v_id AND p.role = 'admin' AND u.raw_app_meta_data ->> 'role' = 'admin') THEN
      PERFORM set_config('ikcous.trocar_dono_resultado',
        json_build_object('acao', 'ja_era_dona', 'donos', v_donos, 'apagadas', 0, 'linhas', 0)::text, false);
      RETURN;
    END IF;
    RAISE EXCEPTION 'trocar-dono: a dona nao e mais admin nas duas fontes' USING ERRCODE = 'IKT02';
  END IF;
  SELECT u.email_confirmed_at IS NOT NULL INTO v_confirmada
    FROM auth.users u JOIN public.profiles p ON p.id = u.id
   WHERE u.id = v_id AND p.role = 'admin' AND u.raw_app_meta_data ->> 'role' = 'admin'
     FOR SHARE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trocar-dono: a nova nao e admin nas duas fontes' USING ERRCODE = 'IKT02';
  END IF;
  IF NOT v_confirmada THEN
    RAISE EXCEPTION 'trocar-dono: e-mail nao confirmado' USING ERRCODE = 'IKT03';
  END IF;

  DELETE FROM public.dono_da_loja;
  GET DIAGNOSTICS v_apagadas = ROW_COUNT;
  INSERT INTO public.dono_da_loja (user_id) VALUES (v_id);
  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  IF v_apagadas <> 1 OR v_linhas <> 1 OR (SELECT count(*) FROM public.dono_da_loja) <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.dono_da_loja d
      JOIN auth.users u ON u.id = d.user_id
      JOIN public.profiles p ON p.id = d.user_id
     WHERE d.user_id = v_id AND p.role = 'admin' AND u.raw_app_meta_data ->> 'role' = 'admin'
  ) THEN
    RAISE EXCEPTION 'trocar-dono: conferencia da 88c falhou' USING ERRCODE = 'IKT05';
  END IF;
  PERFORM set_config('ikcous.trocar_dono_resultado',
    json_build_object('acao', 'trocada', 'donos', 1, 'apagadas', v_apagadas, 'linhas', v_linhas)::text, false);
END
$trocar_dono$;
COMMIT;
SELECT current_setting('ikcous.trocar_dono_resultado', true) AS resultado;`;
}

/** Cada recusa da troca (SQLSTATE IKT.. de dentro da transação, e a mesma
 * lida antes por decidirTroca). Nenhuma grava nada. */
const RECUSAS_DA_TROCA = Object.freeze({
  IKT01:
    "a loja ainda não tem dona cadastrada: não há o que trocar. A primeira dona entra pelo definir-dono",
  IKT02:
    "a pessoa desse e-mail não é administradora nas duas fontes do cargo (perfil e login): a nova dona tem de ser admin antes, nomeada pela dona de hoje no painel",
  IKT03:
    "a pessoa desse e-mail ainda não confirmou o e-mail: peça que abra o link de confirmação e entre na loja uma vez; depois rode de novo",
  IKT04:
    "o e-mail não aponta para exatamente uma conta desta loja (nenhuma, ou mais de uma): confira o e-mail com a nova dona; se houver duas contas, pare e avise o programador",
  IKT05:
    "a conferência pelo critério da 88c (1 dono, em auth.users, admin nas duas fontes) não fecha: pare e avise o programador",
});

const COLUNAS_DA_TROCA = "confirmada,contas,donos,e_a_dona,nova_admin";

/** A linha de sqlDaTroca, ou null se veio fora do formato. */
function linhaDaTroca(linhas) {
  const l = Array.isArray(linhas) && linhas.length === 1 ? linhas[0] : null;
  if (
    l === null ||
    typeof l !== "object" ||
    Array.isArray(l) ||
    Object.keys(l).sort().join(",") !== COLUNAS_DA_TROCA ||
    !inteiro(l.donos) ||
    !inteiro(l.contas) ||
    typeof l.confirmada !== "boolean" ||
    typeof l.nova_admin !== "boolean" ||
    typeof l.e_a_dona !== "boolean"
  ) {
    return null;
  }
  return l;
}

/**
 * Pura: o retorno de sqlDaTroca → { veredito, mensagem, gravar, codigo }. A
 * MESMA ordem de guardas do DO de sqlTrocarDono. Só `gravar: true` leva à
 * escrita; INCERTO nunca grava nem vira SIM.
 */
export function decidirTroca(linhas) {
  const l = linhaDaTroca(linhas);
  const nao = (codigo) => ({
    veredito: NAO,
    mensagem: `${Reflect.get(RECUSAS_DA_TROCA, codigo)}. Nada foi gravado.`,
    gravar: false,
    codigo,
  });
  if (!l) {
    return {
      veredito: INCERTO,
      mensagem:
        "a leitura da dona e da nova dona voltou fora do formato; nada foi gravado.",
      gravar: false,
      codigo: null,
    };
  }
  if (l.donos === 0) return nao("IKT01");
  if (l.donos > 1) return nao("IKT05");
  if (l.contas !== 1) return nao("IKT04");
  if (l.e_a_dona) {
    if (!l.nova_admin) return nao("IKT02");
    return {
      veredito: SIM,
      mensagem:
        "esse e-mail já é o da dona cadastrada (admin nas duas fontes do cargo); nada foi gravado.",
      gravar: false,
      codigo: null,
    };
  }
  if (!l.nova_admin) return nao("IKT02");
  if (!l.confirmada) return nao("IKT03");
  return {
    veredito: SIM,
    mensagem:
      "a dona de hoje está cadastrada e a nova é admin nas duas fontes do cargo, com e-mail confirmado",
    gravar: true,
    codigo: null,
  };
}

/** A linha final de sqlTrocarDono → "trocada" | "ja_era_dona" | null (null =
 * qualquer coisa fora do exato: INCERTO). */
export function resultadoDaTroca(linhas) {
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
  if (Object.keys(r).sort().join(",") !== "acao,apagadas,donos,linhas")
    return null;
  if (r.donos !== 1) return null;
  if (r.acao === "trocada" && r.apagadas === 1 && r.linhas === 1)
    return "trocada";
  if (r.acao === "ja_era_dona" && r.apagadas === 0 && r.linhas === 0)
    return "ja_era_dona";
  return null;
}

/** O que a loja pronta precisa e este comando ainda não faz: aparece como
 * pendente (NÃO) até o passo ser ligado (os motivos estão em AGUARDANDO). */
const PENDENTES = Object.freeze(Object.keys(AGUARDANDO));
/** Os itens que só se conferem dentro do projeto (GET e SQL read_only). */
const ITENS_DO_PROJETO = Object.freeze([
  "banco",
  "ficha",
  "segredos",
  "reconciliação",
  "functions",
  "login",
  "admin",
  "definir-dono",
]);
const IDADE_MAXIMA_DA_RODADA_S = 900;

/**
 * O veredito do conjunto: SIM só se TODOS os itens forem SIM; algum NÃO = NÃO;
 * o resto (INCERTO, ou qualquer coisa fora de SIM/NÃO/INCERTO) = INCERTO.
 * Lista vazia não é SIM: nada conferido não prova nada.
 */
export function vereditoGeral(itens) {
  if (!Array.isArray(itens) || itens.length === 0) return NAO;
  const vs = itens.map((i) => i?.veredito);
  if (vs.includes(NAO)) return NAO;
  if (vs.every((v) => v === SIM)) return SIM;
  return INCERTO;
}

/** A gestão que só LÊ: pedir só aceita GET e toda consulta vai read_only.
 * O conferir não tem como escrever, nem por engano de quem chama. */
function somenteLeitura(gestao) {
  return Object.freeze({
    async pedir(modelo, opcoes = {}) {
      if ((opcoes?.metodo ?? "GET") !== "GET") {
        throw new ErroDoComando(
          "conferir é só leitura: um pedido de escrita foi recusado antes da rede.",
        );
      }
      return await gestao.pedir(modelo, opcoes);
    },
    async consultarBanco(ref, sql) {
      return await gestao.consultarBanco(ref, sql, { somenteLeitura: true });
    },
  });
}

/** Por que uma leitura falhou, sem segredo (só mensagem de módulo nosso). */
const porque = (erro) => resultadoDoErro(erro).mensagem;

async function conferirNaLoja(pedido, d, ref, org, item) {
  const naoConferidos = (motivo) => {
    for (const n of ITENS_DO_PROJETO) item(n, INCERTO, motivo);
  };
  const { gestao: gestaoCompleta, token } = contexto(pedido, d);
  const leitura = somenteLeitura(gestaoCompleta);
  // o acesso desta rodada antes de tudo, uma vez: se ele falha, as leituras
  // não tentam renovar de novo (cada renovação gira o refresh)
  try {
    await token();
  } catch (erro) {
    item("projeto", INCERTO, `sem acesso à conta da lojista: ${porque(erro)}`);
    naoConferidos("não conferido: sem acesso à conta da lojista.");
    return;
  }

  let p;
  try {
    p = await leitura.pedir("projeto", { ref });
  } catch (erro) {
    item(
      "projeto",
      INCERTO,
      `não consegui ler o projeto ${ref}: ${porque(erro)}`,
    );
    naoConferidos("não conferido: o projeto não foi lido.");
    return;
  }
  if (org && temOrgDeclarada(p) && !projetoEhDaOrg(p, org)) {
    item("projeto", NAO, `o projeto ${ref} não é da organização ${org}.`);
    naoConferidos("não conferido: o projeto não é o desta loja.");
    return;
  }
  const status = RE_STATUS.test(String(p?.status)) ? p.status : null;
  if (status !== PRONTO) {
    item(
      "projeto",
      status === null ? INCERTO : NAO,
      `o projeto ${ref} está ${status ?? "com status ilegível"}, não ACTIVE_HEALTHY.`,
    );
    naoConferidos("não conferido: SQL só com o projeto ACTIVE_HEALTHY.");
    return;
  }
  item("projeto", SIM, `${ref} ACTIVE_HEALTHY.`);

  // banco: o ledger e a marca do instalador, e os privilégios padrão (o mesmo
  // que o instalador exige para dizer JA_INSTALADA)
  try {
    const cliente = clienteDoInstalador(leitura, ref);
    const plano = planejarInstalacao(await lerEstado(cliente), d.arquivos());
    if (plano.acao !== "ja_instalada") {
      item(
        "banco",
        NAO,
        `a instalação não está concluída: ${String(plano.motivo ?? plano.acao).slice(0, 300)}`,
      );
    } else {
      const priv = await lerPrivilegiosPadrao(cliente);
      item(
        "banco",
        priv.faltando === "" ? SIM : NAO,
        priv.faltando === ""
          ? `as ${plano.total} migrations da fila estão no ledger, a instalação está concluída e os privilégios padrão de public batem.`
          : `ledger completo e instalação concluída, mas os privilégios padrão de public não batem (falta: ${String(priv.faltando).slice(0, 200)}).`,
      );
    }
  } catch (erro) {
    item(
      "banco",
      INCERTO,
      `não consegui ler o ledger: ${String(erro?.message ?? erro).slice(0, 300)}`,
    );
  }

  // ficha: store_config id = 1 com a marca da migration 20261540000000
  try {
    const l = linhaDaFicha(await leitura.consultarBanco(ref, SQL_FICHA));
    if (!l)
      item("ficha", INCERTO, "a leitura da ficha voltou fora do formato.");
    else if (l.ficha !== 1)
      item(
        "ficha",
        NAO,
        "public.store_config id = 1 não existe: sem a ficha a loja fica em manutenção (503).",
      );
    else if (l.marca !== MARCA_DA_FICHA)
      item(
        "ficha",
        INCERTO,
        "a ficha id = 1 existe, mas sem a marca da migration 20261540000000: conferir quem a criou.",
      );
    else item("ficha", SIM, "store_config id = 1 com a marca da migration.");
  } catch (erro) {
    item("ficha", INCERTO, `não consegui ler a ficha: ${porque(erro)}`);
  }

  // segredos do B1: só NOMES (o segredos-da-loja descarta o digest que a API
  // devolve junto); a reconciliação vem da saude_da_loja() (plano, L3)
  let seg = null;
  try {
    seg = await lerEstadoDosSegredos(leitura, ref);
    if (!seg.pronto) {
      item(
        "segredos",
        INCERTO,
        `o projeto saiu de ACTIVE_HEALTHY durante a conferência (${textoSeguro(seg.status)}).`,
      );
    } else {
      const falta = faltandoNo(seg);
      item(
        "segredos",
        falta.length === 0 ? SIM : NAO,
        falta.length === 0
          ? "todos os nomes existem (functions, Vault e store_config.vapid_public_key); nenhum valor foi lido."
          : `falta: ${falta.join(", ")} (rode segredos --aplicar: ele grava só o que falta, sem substituir).`,
      );
    }
  } catch (erro) {
    item("segredos", INCERTO, `não consegui ler os nomes: ${porque(erro)}`);
  }
  if (!seg?.pronto) {
    item(
      "reconciliação",
      INCERTO,
      "não conferida: os segredos não foram lidos.",
    );
  } else if (!seg.saudeExiste) {
    item(
      "reconciliação",
      NAO,
      "saude_da_loja() não existe neste banco (falta a migration 20261500000000).",
    );
  } else {
    try {
      const r = await leitura.consultarBanco(ref, SQL_SAUDE);
      const saude = Array.isArray(r) && r.length === 1 ? r[0]?.saude : null;
      const idade = saude?.idade_rodada_s;
      const seguidas = saude?.rodadas_degradadas_seguidas;
      if (saude && idade === null) {
        item(
          "reconciliação",
          NAO,
          "ainda não rodou: o cron roda de 10 em 10 min e precisa dos segredos e da function reconciliar-pagamentos. Rode conferir de novo daqui a 10 min.",
        );
      } else if (
        typeof idade !== "number" ||
        !Number.isFinite(idade) ||
        typeof saude?.degradado !== "boolean"
      ) {
        item(
          "reconciliação",
          INCERTO,
          "saude_da_loja() respondeu fora do formato.",
        );
      } else if (saude.degradado) {
        // rodar não basta: a rodada que falha numa etapa (pagamentos,
        // cancelamentos, estornos, contestações) deixa PIX pago sem virar
        // pedido pago (achado ANTES DE CRESCER da revisão Opus do C3)
        item(
          "reconciliação",
          NAO,
          `rodou há ${Math.round(idade)} s, mas DEGRADADA: alguma etapa falhou (rodadas_degradadas_seguidas: ${inteiro(seguidas) ? seguidas : "ilegível"}). Confira o log da function reconciliar-pagamentos e o passo 4 do runbook.`,
        );
      } else if (idade < IDADE_MAXIMA_DA_RODADA_S) {
        item("reconciliação", SIM, `rodou há ${Math.round(idade)} s.`);
      } else {
        item(
          "reconciliação",
          NAO,
          `a última rodada foi há ${Math.round(idade)} s (mais de 15 min): parada? Confira o passo 4 do runbook.`,
        );
      }
    } catch (erro) {
      item(
        "reconciliação",
        INCERTO,
        `não consegui ler saude_da_loja(): ${porque(erro)}`,
      );
    }
  }

  // functions: o B2 em ENSAIO (só GET; a fachada somenteLeitura nem tem
  // implantarFuncao), com as mesmas fontes e o mesmo commit da publicação
  try {
    const l = lidoDoB2(
      await executarFunctions(["--projeto", ref, "--canal", pedido.slug], {
        git: d.git,
        cliente: leitura,
        esperar: d.dormir,
      }),
    );
    item(
      "functions",
      l.veredito,
      [l.corpo, ...l.erros].join("; ").slice(0, 600),
    );
  } catch (erro) {
    item(
      "functions",
      INCERTO,
      `não consegui conferir as functions: ${porque(erro)}`,
    );
  }

  // login: o B4 sem aplicar (só GET), no domínio da loja
  try {
    const r = await configurarLoginNovo({
      cliente: leitura,
      ref,
      dominio: dominioDaLoja(pedido.slug),
      aplicar: false,
    });
    const linhas = (Array.isArray(r?.linhas) ? r.linhas : []).map(String);
    const v = VEREDITOS.has(r?.veredito) ? r.veredito : INCERTO;
    item(
      "login",
      v,
      v === SIM
        ? `endereços de https://${dominioDaLoja(pedido.slug)} e gancho de e-mail (desligado até o Gmail) conferidos.`
        : resumoDoB4(linhas).slice(0, 600),
    );
  } catch (erro) {
    item("login", INCERTO, `não consegui conferir o login: ${porque(erro)}`);
  }

  // o dono (critério da 88c), lido UMA vez para os itens admin e definir-dono
  let dono;
  try {
    dono = { lido: await lerDono(leitura, ref) };
  } catch (erro) {
    dono = { erro };
  }
  // true/false; null = não deu para ler (nunca vira SIM)
  const donoEAdmin = () => {
    if (dono.lido?.tabela === false) return false;
    const l = dono.lido?.tabela === true ? linhaDoDono(dono.lido.linhas) : null;
    return l === null ? null : l.donos === 1 && l.dono_admin;
  };

  // admin: o dono cadastrado é admin nas duas fontes do cargo (depois do
  // definir-dono, a dona pode ter nomeado outras, e TODAS têm de estar nas
  // duas: admin só numa fonte foi gravada fora da definir_cargo), ou, sem
  // isso, exatamente 1 admin com admin nas duas fontes (antes do definir-dono)
  try {
    const r = await leitura.consultarBanco(ref, SQL_ADMINS);
    const l = Array.isArray(r) && r.length === 1 ? r[0] : null;
    if (!l || !inteiro(l.admins) || !inteiro(l.nas_duas)) {
      item(
        "admin",
        INCERTO,
        "a contagem de administradoras voltou fora do formato.",
      );
    } else if (l.admins === 1 && l.nas_duas === 1) {
      item(
        "admin",
        SIM,
        "1 administradora, com admin nas duas fontes do cargo.",
      );
    } else if (
      l.admins > 1 &&
      l.nas_duas === l.admins &&
      donoEAdmin() === true
    ) {
      item(
        "admin",
        SIM,
        `o dono cadastrado é admin nas duas fontes do cargo (critério da 88c); a loja tem ${l.admins} administradoras (${l.nas_duas} nas duas), nomeadas depois da abertura.`,
      );
    } else if (l.admins > 1 && donoEAdmin() === null) {
      item(
        "admin",
        INCERTO,
        `achei ${l.admins} administradoras e não consegui ler se o dono cadastrado é uma delas: ${dono.erro ? porque(dono.erro) : "a leitura do dono voltou fora do formato."}`,
      );
    } else if (l.admins === 0) {
      item(
        "admin",
        NAO,
        "a loja não tem administradora: rode primeira-admin --aplicar.",
      );
    } else {
      item(
        "admin",
        NAO,
        `esperava 1 administradora com admin nas duas fontes do cargo; achei ${l.admins} (${l.nas_duas} nas duas). Conferir antes de entregar a loja.`,
      );
    }
  } catch (erro) {
    item(
      "admin",
      INCERTO,
      `não consegui contar as administradoras: ${porque(erro)}`,
    );
  }

  // definir-dono: o critério da 88c (1 dono, em auth.users, admin nas duas)
  if (dono.erro) {
    item(
      "definir-dono",
      INCERTO,
      `não consegui ler o dono: ${porque(dono.erro)}`,
    );
  } else {
    const { lido } = dono;
    if (lido.tabela === false) {
      item("definir-dono", NAO, SEM_A_TABELA_DO_DONO);
    } else {
      const l = lido.tabela === true ? linhaDoDono(lido.linhas) : null;
      if (!l)
        item(
          "definir-dono",
          INCERTO,
          "a leitura do dono voltou fora do formato.",
        );
      else if (l.donos === 1 && l.dono_admin)
        item(
          "definir-dono",
          SIM,
          "1 dono cadastrado, admin nas duas fontes do cargo (critério da 88c).",
        );
      else if (l.donos === 0 && decidirDono(lido.linhas).gravar)
        item(
          "definir-dono",
          NAO,
          "sem dono cadastrado: rode definir-dono --aplicar (a administradora única vira a dona).",
        );
      else item("definir-dono", NAO, decidirDono(lido.linhas).mensagem);
    }
  }
}

async function passoConferir(pedido, d) {
  const { slug } = pedido;
  const itens = [];
  const item = (nome, veredito, detalhe) =>
    itens.push({ item: nome, veredito, detalhe });
  const cp = (await d.estado.ler(slug))?.passos?.["criar-projeto"];
  if (cp?.ref) {
    await conferirNaLoja(pedido, d, cp.ref, cp.org, item);
  } else {
    item(
      "projeto",
      NAO,
      "o estado local não tem projeto: rode criar-projeto --aplicar.",
    );
    for (const n of ITENS_DO_PROJETO)
      item(n, NAO, "não conferido: a loja ainda não tem projeto.");
  }
  for (const p of PENDENTES) {
    item(
      p,
      NAO,
      `pendente: passo ${p} ainda não ligado (${Reflect.get(AGUARDANDO, p)})`,
    );
  }
  const veredito = vereditoGeral(itens);
  d.saida.out(
    [
      `Conferência da loja ${slug} (só leitura; nada foi gravado):`,
      ...itens.map((i) => `  [${i.veredito}] ${i.item}: ${i.detalhe}`),
    ].join("\n"),
  );
  const fora = itens.filter((i) => i.veredito !== SIM).map((i) => i.item);
  return {
    ...resultado(
      veredito,
      veredito === SIM
        ? `a loja está pronta: os ${itens.length} itens deram SIM.`
        : `${itens.length - fora.length} de ${itens.length} itens SIM; não SIM: ${fora.join(", ")}.`,
    ),
    itens,
  };
}

// ─── ensaio ─────────────────────────────────────────────────────────────────

const ENSAIO = "ENSAIO (nada gravado nem enviado; rode com --aplicar):";

async function ensaio(pedido, d) {
  const { passo, slug } = pedido;
  const e = await d.estado.ler(slug);
  const passos = e?.passos ?? {};
  if (passo === "abrir") {
    if (!pedido.clientId || !pedido.redirect)
      return resultado(
        NAO,
        `${ENSAIO} abrir precisa de --client-id e --redirect.`,
      );
    return resultado(
      INCERTO,
      `${ENSAIO} leria o client_secret pela entrada, guardaria a autorização pendente (PKCE) no cofre DPAPI e imprimiria o link e os passos da lojista.`,
    );
  }
  if (passo === "receber") {
    if (passos.abrir?.veredito !== SIM)
      return resultado(
        NAO,
        `${ENSAIO} a loja não tem autorização aberta (rode abrir).`,
      );
    return resultado(
      INCERTO,
      `${ENSAIO} leria o código pela entrada, trocaria pelo acesso e gravaria o refresh no cofre DPAPI antes de qualquer uso.`,
    );
  }
  if (passo === "criar-projeto") {
    if (!pedido.org)
      return resultado(NAO, `${ENSAIO} criar-projeto precisa de --org.`);
    const ref = passos["criar-projeto"]?.ref;
    return resultado(
      INCERTO,
      ref
        ? `${ENSAIO} o projeto ${ref} já está no estado local; conferiria a organização ${pedido.org} e esperaria ACTIVE_HEALTHY, sem criar outro.`
        : `${ENSAIO} conferiria que a autorização cobre só a organização ${pedido.org}, procuraria o projeto ${nomeDoProjeto(slug)} pelo nome e, se não houver, criaria em ${REGIAO} com senha forte guardada só no cofre DPAPI; depois esperaria ACTIVE_HEALTHY por até ${PRAZO_ATIVO_MS / 60_000} min.`,
    );
  }
  if (passo === "banco") {
    if (passos["criar-projeto"]?.veredito !== SIM)
      return resultado(NAO, `${ENSAIO} rode criar-projeto até dar SIM antes.`);
    const plano = planejarInstalacao(
      {
        tabelasEmPublic: 0,
        ledgerExiste: false,
        versoesNoLedger: [],
        marca: "ausente",
      },
      d.arquivos(),
    );
    if (plano.acao === "recusar")
      return resultado(NAO, `${ENSAIO} ${plano.motivo}`);
    return resultado(
      INCERTO,
      `${ENSAIO} a fila deste checkout tem ${plano.total} migrations; num banco vazio iriam uma por chamada, cada uma com o registro no ledger na mesma transação; o que já estiver no ledger não é repetido.`,
    );
  }
  if (passo === "ficha") {
    if (passos.banco?.veredito !== SIM)
      return resultado(NAO, `${ENSAIO} rode banco até dar SIM antes.`);
    return resultado(
      INCERTO,
      `${ENSAIO} leria store_config id = 1 (só leitura) e a chave publishable, e geraria o SQL de frota_lojas e a entrada de lojas.json sem executar.`,
    );
  }
  if (passo === "primeira-admin") {
    // nem o e-mail é pedido: sem --aplicar não há o que fazer com ele
    if (passos.banco?.veredito !== SIM)
      return resultado(NAO, `${ENSAIO} rode banco até dar SIM antes.`);
    return resultado(
      INCERTO,
      `${ENSAIO} pediria o e-mail pela entrada, leria a conta e as administradoras (só leitura) e, se a conta for única, confirmada e a loja não tiver administradora, mandaria UMA transação: BEGIN; SET LOCAL ROLE postgres; as guardas de novo; UPDATE do cargo; conferência 1,1,1; COMMIT.`,
    );
  }
  if (passo === "segredos") {
    if (passos.banco?.veredito !== SIM)
      return resultado(NAO, `${ENSAIO} rode banco até dar SIM antes.`);
    return resultado(
      INCERTO,
      `${ENSAIO} leria os NOMES dos secrets e do Vault (nenhum valor) e gravaria só o que falta, sem substituir nada: MP_CHAVES_ENCRYPTION_KEY, RECONCILIACAO_SECRET com o mesmo valor no Vault (e reconciliacao_url), e o par VAPID com a pública em store_config; depois conferiria por releitura.`,
    );
  }
  if (passo === "functions") {
    if (passos["criar-projeto"]?.veredito !== SIM)
      return resultado(NAO, `${ENSAIO} rode criar-projeto até dar SIM antes.`);
    return resultado(
      INCERTO,
      `${ENSAIO} só com o HEAD no topo do ramo da release, publicaria uma por vez as functions do canal da loja (com o verify_jwt do supabase/config.toml), conferindo cada uma no GET /functions; as que já estão certas no ar seriam puladas.`,
    );
  }
  if (passo === "login") {
    if (passos["criar-projeto"]?.veredito !== SIM)
      return resultado(NAO, `${ENSAIO} rode criar-projeto até dar SIM antes.`);
    return resultado(
      INCERTO,
      `${ENSAIO} acertaria site_url e a lista de endereços de volta para https://${dominioDaLoja(slug)} e prepararia o gancho de e-mail DESLIGADO (o segredo gerado na hora nas duas pontas), sem substituir meia configuração.`,
    );
  }
  if (passo === "definir-dono") {
    const pre = await preDoDono(d, slug, `${ENSAIO} `);
    if (pre.r) return pre.r;
    return resultado(
      INCERTO,
      `${ENSAIO} leria (só leitura) o dono e as administradoras do projeto ${pre.ref}; sem dono e com UMA administradora (nas duas fontes do cargo, e-mail confirmado), mandaria UMA transação: BEGIN; SET LOCAL ROLE postgres; travas; as guardas de novo; INSERT em dono_da_loja com o id lido no banco (nenhum e-mail); conferência pela 88c; COMMIT. Dono igual = SIM sem gravar; qualquer outro caso = NÃO.`,
    );
  }
  // conferir
  return resultado(
    INCERTO,
    `${ENSAIO} ${passos["criar-projeto"]?.ref ? `leria (só leitura) o projeto ${passos["criar-projeto"].ref}` : "a loja ainda não tem projeto no estado local; com projeto, leria (só leitura)"}: status, ${ITENS_DO_PROJETO.join(", ")}; e listaria como pendente: ${PENDENTES.join(", ")}.`,
  );
}

// ─── o despachante ──────────────────────────────────────────────────────────

const EXECUTORES = Object.freeze({
  abrir: passoAbrir,
  receber: passoReceber,
  "criar-projeto": passoCriarProjeto,
  banco: passoBanco,
  ficha: passoFicha,
  segredos: passoSegredos,
  functions: passoFunctions,
  login: passoLogin,
  "primeira-admin": passoPrimeiraAdmin,
  "definir-dono": passoDefinirDono,
  conferir: passoConferir,
});

/** As dependências reais só nascem se o chamador não as deu (o teste dá todas). */
function completar(deps) {
  const d = { ...deps };
  d.fetch ??= globalThis.fetch;
  d.agora ??= Date.now;
  d.dormir ??= (ms) => new Promise((ok) => setTimeout(ok, ms));
  d.aleatorio ??= randomBytes;
  d.saida ??= { out: console.log, err: console.error };
  d.lerEntrada ??= lerLinhaDaEntrada;
  d.arquivos ??= () => arquivosDoRepo();
  d.lojasBrutas ??= () => JSON.parse(readFileSync(CAMINHO_LOJAS, "utf8"));
  d.cofre ??= criarCofreDpapi();
  d.cofreDoBanco ??= criarCofreDpapi({
    pasta: path.join(path.dirname(pastaPadraoDoCofre()), "banco"),
  });
  d.estado ??= criarEstadoEmArquivo();
  d.git ??= gitReal();
  return d;
}

/**
 * Roda UM passo. `pedido` = { passo, slug, aplicar, clientId?, redirect?,
 * org?, nome? }. Devolve { passo, veredito, mensagem } (o conferir também
 * `itens`) e imprime a linha do veredito. Nunca lança: erro vira NÃO ou
 * INCERTO com mensagem sem segredo.
 */
export async function executarPasso(pedido, deps = {}) {
  const passo = pedido?.passo;
  let r;
  let d;
  try {
    if (!PASSOS.includes(passo)) {
      r = resultado(NAO, `passo desconhecido: ${textoSeguro(passo)}`);
    } else if (
      typeof pedido.slug !== "string" ||
      !RE_PROJETO.test(pedido.slug)
    ) {
      r = resultado(NAO, "loja inválida (minúsculas, dígitos e hífen).");
    } else if (pedido.org !== undefined && !RE_ORG.test(String(pedido.org))) {
      r = resultado(NAO, "--org fora do formato.");
    } else if (Object.hasOwn(AGUARDANDO, passo)) {
      r = resultado(NAO, Reflect.get(AGUARDANDO, passo));
    } else if (
      passo === "definir-dono" &&
      LOJAS_PROTEGIDAS.includes(pedido.slug)
    ) {
      r = resultado(
        NAO,
        `a loja ${pedido.slug}: o definir-dono nunca roda nas lojas que já vendem (IKCOUS e Savy); o dono delas é cadastrado pelo dono do produto (docs/runbooks/definir-o-dono-da-loja.md). Nada foi feito.`,
      );
    } else if (
      passo === "definir-dono" &&
      LOJAS_LEGADAS.includes(pedido.slug)
    ) {
      r = resultado(NAO, recusaDoLegado(pedido.slug));
    } else if (passo === "abrir" && slugQueNaoCabe(pedido.slug)) {
      r = resultado(NAO, slugQueNaoCabe(pedido.slug));
    }
    if (!r) {
      d = completar(deps);
      if (pedido.aplicar !== true) {
        r = await ensaio(pedido, d);
      } else {
        const liberar = await d.estado.travar(pedido.slug);
        try {
          r = await EXECUTORES[passo](pedido, d);
        } finally {
          await liberar();
        }
      }
    }
  } catch (e) {
    r = resultadoDoErro(e);
  }
  const saida = d?.saida ?? deps.saida ?? { out: console.log };
  saida.out(`[${passo}] ${r.veredito}: ${r.mensagem}`);
  return { passo, ...r };
}

// ─── linha de comando ───────────────────────────────────────────────────────

const OPCOES_COM_VALOR = new Map([
  ["--loja", "slug"],
  ["--client-id", "clientId"],
  ["--redirect", "redirect"],
  ["--org", "org"],
  ["--nome", "nome"],
]);
const POR_ENTRADA =
  "o código, o client_secret e o e-mail da administradora entram pela entrada padrão (cole quando o comando pedir), nunca por argumento";

/** argv sem "node" e sem o caminho do script. LANÇA ErroDoComando (sem ecoar
 * valor nenhum que não seja nome de opção saneado). */
export function lerArgumentos(argv) {
  const [passo, ...resto] = Array.isArray(argv) ? argv : [];
  if (!PASSOS.includes(passo)) {
    throw new ErroDoComando(
      `passo desconhecido: ${textoSeguro(passo)}. Os passos são: ${PASSOS.join(", ")}.`,
      { codigo: "USO" },
    );
  }
  const a = { passo, aplicar: false };
  for (let i = 0; i < resto.length; i++) {
    const t = resto[i];
    if (t === "--aplicar") {
      a.aplicar = true;
    } else if (OPCOES_COM_VALOR.has(t)) {
      const campo = OPCOES_COM_VALOR.get(t);
      const v = resto[i + 1];
      if (typeof v !== "string" || v === "" || v.startsWith("--")) {
        throw new ErroDoComando(`${t} precisa de um valor.`, { codigo: "USO" });
      }
      if (Object.hasOwn(a, campo)) {
        throw new ErroDoComando(`${t} repetido.`, { codigo: "USO" });
      }
      a[campo] = v;
      i++;
    } else if (typeof t === "string" && t.startsWith("--")) {
      throw new ErroDoComando(
        `opção desconhecida: ${textoSeguro(t.split("=")[0])} (valor não impresso); ${POR_ENTRADA}.`,
        { codigo: "USO" },
      );
    } else {
      throw new ErroDoComando(
        `argumento a mais (não impresso); ${POR_ENTRADA}.`,
        { codigo: "USO" },
      );
    }
  }
  if (typeof a.slug !== "string" || !RE_PROJETO.test(a.slug)) {
    throw new ErroDoComando(
      "--loja <slug> é obrigatório (minúsculas, dígitos e hífen, começando por letra).",
      { codigo: "USO" },
    );
  }
  if (a.org !== undefined && !RE_ORG.test(a.org)) {
    throw new ErroDoComando("--org fora do formato.", { codigo: "USO" });
  }
  if (a.nome !== undefined && !RE_APELIDO.test(a.nome)) {
    throw new ErroDoComando(
      "--nome: até 30 caracteres, começando por letra (letras, dígitos, espaço, . _ -).",
      { codigo: "USO" },
    );
  }
  return a;
}

/** Uma linha não vazia da entrada padrão (colada ou por pipe). A pergunta vai
 * para stderr; a linha lida nunca é ecoada pelo comando. */
async function lerLinhaDaEntrada(pergunta) {
  process.stderr.write(pergunta);
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });
  try {
    for await (const linha of rl) {
      if (linha.trim() !== "") return linha;
    }
    return "";
  } finally {
    rl.close();
  }
}

const CODIGO_DE_SAIDA = Object.freeze({ [SIM]: 0, [NAO]: 1, [INCERTO]: 2 });

async function principal() {
  let pedido;
  try {
    pedido = lerArgumentos(process.argv.slice(2));
  } catch (e) {
    console.error(
      e instanceof ErroDoComando ? e.message : "argumentos ilegíveis.",
    );
    console.error(
      `Uso: node scripts/frota/nova-loja.mjs <${PASSOS.join("|")}> --loja <slug> [--aplicar] [--client-id <id> --redirect <url>] [--org <org>] [--nome <apelido>]`,
    );
    return 1;
  }
  const r = await executarPasso(pedido);
  return CODIGO_DE_SAIDA[r.veredito] ?? 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  principal().then(
    (c) => {
      process.exitCode = c;
    },
    () => {
      process.exitCode = 1;
    },
  );
}
