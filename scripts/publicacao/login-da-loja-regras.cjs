/**
 * REGRAS PURAS do login da loja (26/11/2026): o que `acertar` grava no Auth da
 * loja e o que `conferir` responde. Nenhuma rede, nenhum segredo, nenhum efeito:
 * quem chama é scripts/publicacao/login-da-loja.cjs. Testado por
 * tests/ci_login_da_loja_regras_test.ts.
 *
 * O DEFEITO QUE ISTO CONSERTA: projeto Supabase novo nasce com
 * `site_url = http://localhost:3000`, e o endereço de volta que não está
 * liberado cai no site_url — o link do e-mail de confirmação/recuperação leva a
 * uma página morta. O mesmo esquema+host+porta do site_url já é aceito sem estar
 * na lista, então acertar o site_url resolve quase tudo; a lista ganha
 * `https://<dominio>/**` porque a recuperação de senha volta para caminhos
 * diferentes (src/contexts/AuthContext.tsx, `resetPasswordForEmail`).
 *
 * FONTES (conferidas em 26/11/2026):
 *  - OpenAPI vivo https://api.supabase.com/api/v1-json, operação
 *    `v1-update-auth-service-config` (PATCH /v1/projects/{ref}/config/auth,
 *    escopo `auth:write`, respostas 200/401/402/403/429/500), corpo
 *    `UpdateAuthConfigBody`: `site_url` string anulável (padrão `^[^,]+$`),
 *    `uri_allow_list` string anulável (separada por vírgula), `rate_limit_email_sent`
 *    inteiro anulável 1..2147483647. Leitura: `v1-get-auth-service-config`
 *    (`auth:read`), schema `AuthConfigResponse_Output`.
 *  - github.com/supabase/auth (master): internal/utilities/request.go
 *    `IsRedirectURLValid` (a regra copiada em `enderecoAceito`),
 *    internal/utilities/url_validator.go `isLocalhost`, e
 *    internal/conf/configuration.go (`glob.MustCompile(uri, '.', '/')`).
 *  - supabase.com/docs/guides/auth/rate-limits: `rate_limit_email_sent` vale
 *    mesmo com o Send Email Hook (o limite é conferido antes do hook) — é o
 *    único freio que protege o Gmail da lojista contra cadastro em massa.
 *
 * Domínio: fonte única `store_config.dominio_publico` (host minúsculo, sem
 * esquema nem porta), com a MESMA regra do CHECK da migration 20261140.
 */

/** As ÚNICAS chaves que o `acertar` pode mandar no PATCH. O nome é do plano;
 * inclui o limite de e-mails, que não é URL, mas é o terceiro e último campo
 * que este fluxo toca. Nunca smtp_*, hook_*, mailer_* ou qualquer outra. */
const CAMPOS_URLS = Object.freeze([
  "site_url",
  "uri_allow_list",
  "rate_limit_email_sent",
]);
/** 30 e-mails por hora. Subir é um PR de uma linha. */
const LIMITE_EMAIL_POR_HORA = 30;

/** A regra do CHECK `store_config_dominio_publico_host_check` (20261140). */
const RE_DOMINIO =
  // eslint-disable-next-line security/detect-unsafe-regex -- cópia do CHECK; a entrada é limitada a 253 caracteres por `dominioValido`.
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

// app_settings.value é TEXTO JSON (gravarValor, email-da-loja.ts). Só voltam o
// domínio (que é público) e um sim/não de Gmail; nenhuma credencial é projetada.
// A linha de store_config é a id=1 (a mesma que o porteiro lê, `id=eq.1`).
// O nome é o do plano; a consulta também traz o domínio.
const CONSULTA_GMAIL = `SELECT
  (SELECT dominio_publico FROM public.store_config WHERE id = 1) AS dominio_publico,
  EXISTS (
    SELECT 1 FROM public.app_settings
    WHERE key = 'email_da_loja'
      AND jsonb_typeof(value::jsonb) = 'object'
      AND jsonb_typeof(value::jsonb -> 'usuario') = 'string'
      AND length(btrim(value::jsonb ->> 'usuario')) > 0
      AND jsonb_typeof(value::jsonb -> 'senha_cifrada') = 'string'
      AND length(btrim(value::jsonb ->> 'senha_cifrada')) > 0
      AND jsonb_typeof(value::jsonb -> 'iv') = 'string'
      AND length(btrim(value::jsonb ->> 'iv')) > 0
  ) AS gmail_cadastrado`;

class Parada extends Error {}
const parar = (mensagem) => {
  throw new Parada(mensagem);
};

const objeto = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const preenchido = (v) => typeof v === "string" && v.trim() !== "";
const formatoHash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

function dominioValido(d) {
  return typeof d === "string" && d.length <= 253 && RE_DOMINIO.test(d);
}

const siteUrlDe = (dominio) => `https://${dominio}`;
const padraoDaLista = (dominio) => `https://${dominio}/**`;
const uriDoHook = (ref) =>
  `https://${ref}.supabase.co/functions/v1/auth-send-email`;

// isLocalhost do supabase/auth (url_validator.go), com o hostname do WHATWG URL
// (IPv6 vem entre colchetes).
const LOCALHOST = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "0.0.0.0",
  "[::]",
]);
const ehLocalhost = (hostname) => LOCALHOST.has(String(hostname).toLowerCase());

function lerUrl(v) {
  try {
    return new URL(v);
  } catch {
    return null;
  }
}

// O `regularHostname` do supabase/auth. Também decide o que pode ser IMPRESSO
// de um host remoto (nada além de letras, números, ponto e hífen).
// eslint-disable-next-line security/detect-unsafe-regex -- cópia do `regularHostname` do supabase/auth; o host vem do parser de URL.
const RE_HOST_REGULAR = /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/;
const hostImprimivel = (h) =>
  typeof h === "string" && h.length <= 253 && RE_HOST_REGULAR.test(h)
    ? h
    : "(formato inesperado)";

/** URL de configuração remota para IMPRESSÃO: só os caracteres de URL comuns,
 * sem quebra de linha, `|` ou `%` (nada que vire comando de workflow ou quebre o
 * resumo), com teto de tamanho. Nunca usado para valor secreto. */
function textoDeUrl(v, maximo = 300) {
  if (v === null || v === undefined) return "(vazio)";
  if (typeof v !== "string") return "(formato inesperado)";
  if (v === "") return "(vazio)";
  const limpo = v.replace(/[^A-Za-z0-9._~:/?#[\]@!$&'()*+,;=-]/g, "?");
  return limpo.length > maximo ? `${limpo.slice(0, maximo)}…` : limpo;
}

/** "vazio" | "localhost" | "certo" | "outro" | "invalido" */
function classificarSiteUrl(site, dominio) {
  if (site === null || site === undefined) return "vazio";
  if (typeof site !== "string") return "invalido";
  if (site.trim() === "") return "vazio";
  if (
    dominioValido(dominio) &&
    (site === siteUrlDe(dominio) || site === `${siteUrlDe(dominio)}/`)
  )
    return "certo";
  const u = lerUrl(site);
  if (!u) return "invalido";
  if (ehLocalhost(u.hostname)) return "localhost";
  return "outro";
}

/** As entradas da lista, na ordem original, sem as vazias (vírgula sobrando);
 * cada entrada é mantida byte a byte (o Supabase não apara espaço). */
function entradasDaLista(lista) {
  if (lista === null || lista === undefined) return [];
  if (typeof lista !== "string")
    parar("uri_allow_list do Auth em formato inesperado (não impresso)");
  return lista.split(",").filter((e) => e !== "");
}

function smtpCompleto(c) {
  return (
    preenchido(c.smtp_host) &&
    c.smtp_port !== null &&
    c.smtp_port !== undefined &&
    c.smtp_port !== "" &&
    preenchido(c.smtp_user) &&
    preenchido(c.smtp_pass) &&
    preenchido(c.smtp_admin_email)
  );
}
/** Remetente próprio = SMTP completo ou Send Email Hook ligado. Só com ele o
 * limite de e-mails sobe (sem ele o Supabase manda pelo envio padrão). */
const remetenteProprio = (c) =>
  c.hook_send_email_enabled === true || smtpCompleto(c);

/** A trava do executor: o objeto que vai no PATCH só tem chaves de CAMPOS_URLS
 * (e pelo menos uma). Devolve o próprio patch. */
function conferirPatch(patch) {
  if (
    !objeto(patch) ||
    Object.keys(patch).length === 0 ||
    !Object.keys(patch).every((k) => CAMPOS_URLS.includes(k))
  )
    parar("PATCH fora de CAMPOS_URLS");
  return patch;
}

/**
 * O plano do `acertar`, a partir da configuração LIDA e do domínio do banco.
 * Devolve `{ patch, mudancas }` (patch congelado; `{}` = nada a fazer) ou lança
 * `Parada` sem gravar nada. As mensagens nunca carregam valor remoto além do
 * host (filtrado) de um site_url alheio.
 */
function planejarPatchUrls(config, dominio) {
  if (!objeto(config)) parar("configuração de Auth inesperada");
  if (!preenchido(dominio))
    parar(
      "dominio_publico da loja está vazio no banco; cadastre o domínio antes de acertar o login",
    );
  if (!dominioValido(dominio))
    parar(
      "dominio_publico fora do formato (host minúsculo, sem esquema, sem porta, com ponto); valor não impresso",
    );

  const patch = {};
  const mudancas = [];

  const classe = classificarSiteUrl(config.site_url, dominio);
  if (classe === "invalido")
    parar("site_url do Auth em formato inesperado (não impresso)");
  if (classe === "outro") {
    const u = lerUrl(config.site_url);
    parar(
      `site_url aponta para outro endereço (host ${hostImprimivel(u?.hostname)}); confira à mão antes de trocar`,
    );
  }
  if (classe === "vazio" || classe === "localhost") {
    patch.site_url = siteUrlDe(dominio);
    mudancas.push({
      campo: "site_url",
      antes: config.site_url ?? null,
      depois: patch.site_url,
    });
  }

  const entradas = entradasDaLista(config.uri_allow_list);
  const padrao = padraoDaLista(dominio);
  if (!entradas.includes(padrao)) {
    patch.uri_allow_list = [...entradas, padrao].join(",");
    mudancas.push({
      campo: "uri_allow_list",
      antes: config.uri_allow_list ?? null,
      depois: patch.uri_allow_list,
    });
  }

  const limite = config.rate_limit_email_sent;
  if (limite !== null && limite !== undefined && !Number.isInteger(limite))
    parar("rate_limit_email_sent do Auth em formato inesperado");
  if (
    remetenteProprio(config) &&
    (limite === null || limite === undefined || limite < LIMITE_EMAIL_POR_HORA)
  ) {
    patch.rate_limit_email_sent = LIMITE_EMAIL_POR_HORA;
    mudancas.push({
      campo: "rate_limit_email_sent",
      antes: limite ?? null,
      depois: LIMITE_EMAIL_POR_HORA,
    });
  }

  if (!Object.keys(patch).every((k) => CAMPOS_URLS.includes(k)))
    parar("PATCH fora de CAMPOS_URLS");
  return { patch: Object.freeze(patch), mudancas: Object.freeze(mudancas) };
}

// ---------------------------------------------------------------------------
// "Endereço aceito": cópia de IsRedirectURLValid (supabase/auth, request.go)
// ---------------------------------------------------------------------------

/** glob.MustCompile(padrao, '.', '/') do gobwas/glob, no subconjunto que um
 * padrão de uri_allow_list usa: `**` (qualquer coisa), `*` (qualquer coisa sem
 * '.' nem '/'), `?` (um caractere sem '.' nem '/'), `[...]`/`[!...]` e `\`.
 * `{` (alternativas) devolve null: esta cópia não decide, e quem chama trata
 * como "não medido", nunca como aceito. */
function globParaRegExp(padrao) {
  let re = "^";
  for (let i = 0; i < padrao.length; i++) {
    const c = padrao.charAt(i);
    if (c === "*") {
      if (padrao[i + 1] === "*") {
        re += ".*";
        i++;
      } else re += "[^./]*";
    } else if (c === "?") re += "[^./]";
    else if (c === "\\") {
      i++;
      if (i >= padrao.length) return null;
      re += escaparRegExp(padrao.charAt(i));
    } else if (c === "[") {
      const fim = padrao.indexOf("]", i + 2);
      if (fim < 0) return null;
      let corpo = padrao.slice(i + 1, fim);
      let neg = false;
      if (corpo.startsWith("!")) {
        neg = true;
        corpo = corpo.slice(1);
      }
      if (corpo === "" || /[\\[\]^]/.test(corpo)) return null;
      re += `[${neg ? "^" : ""}${corpo}]`;
      i = fim;
    } else if (c === "{" || c === "}") return null;
    else re += escaparRegExp(c);
  }
  try {
    // eslint-disable-next-line security/detect-non-literal-regexp -- montado só de classes fixas e de caracteres escapados.
    return new RegExp(`${re}$`, "s");
  } catch {
    return null;
  }
}
const escaparRegExp = (c) => c.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

/**
 * true/false como o Supabase decidiria; null quando a decisão dependeria de um
 * padrão que esta cópia não interpreta (nunca "sim" por suposição).
 */
function enderecoAceito(config, url) {
  if (typeof url !== "string" || url === "") return false;
  const base = lerUrl(config?.site_url ?? "");
  const ref = lerUrl(url);
  if (!base || !ref) return false;
  // url.Port() do Go devolve "" para porta ausente; o WHATWG URL também
  // devolve "" para a porta PADRÃO do esquema (443 em https) — a única
  // diferença, irrelevante para os endereços que o app manda (sem porta).
  if (
    base.hostname === ref.hostname &&
    base.protocol === ref.protocol &&
    (base.port === ref.port || ehLocalhost(ref.hostname))
  )
    return true;
  const esquema = ref.protocol.replace(/:$/, "").toLowerCase();
  const http = esquema === "http" || esquema === "https";
  const host = ref.hostname;
  if (/^[0-9]+$/.test(host)) return false;
  // eslint-disable-next-line security/detect-unsafe-regex -- repetição fixa {3}, sem aninhamento ilimitado.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("["))
    return ehLocalhost(host);
  if (http && !RE_HOST_REGULAR.test(host)) return false;
  let lista;
  try {
    lista = entradasDaLista(config?.uri_allow_list);
  } catch {
    return false;
  }
  const semFragmento = url.split("#")[0];
  let indecidivel = false;
  for (const padrao of lista) {
    const re = globParaRegExp(padrao);
    if (re === null) {
      indecidivel = true;
      continue;
    }
    if (re.test(semFragmento)) return true;
  }
  return indecidivel ? null : false;
}

// ---------------------------------------------------------------------------
// Tarefa 2 — diagnosticar
// ---------------------------------------------------------------------------

const OK = "OK";
const FALTA = "FALTA";
const ATENCAO = "ATENÇÃO";
const NAO_MEDIDO = "NÃO MEDIDO";

/**
 * O que o `conferir` responde. Entrada: a configuração lida, o domínio do banco
 * (`undefined` = não medido, `null` = vazio), o ref, e o que foi medido da
 * função auth-send-email, do segredo e do Gmail (`undefined` = não medido).
 * Saída: `{ itens: [{nome, estado, detalhe}], veredito }`, veredito SIM só sem
 * nenhuma FALTA e sem nenhum NÃO MEDIDO. Nenhum valor de smtp_pass, do segredo
 * do hook ou de URI remota sai daqui.
 */
function diagnosticar({
  config,
  dominio,
  ref,
  funcao,
  verifyJwt,
  segredoPresente,
  gmail,
}) {
  const itens = [];
  const item = (nome, estado, detalhe) => itens.push({ nome, estado, detalhe });

  if (!objeto(config)) {
    item("configuração do Auth", NAO_MEDIDO, "não lida");
    return { itens, veredito: "INCERTO" };
  }

  // 1. domínio
  const dominioOk = dominioValido(dominio);
  if (dominio === undefined)
    item("domínio público da loja", NAO_MEDIDO, "não medido");
  else if (dominioOk) item("domínio público da loja", OK, dominio);
  else
    item(
      "domínio público da loja",
      FALTA,
      preenchido(dominio) ? "fora do formato" : "vazio no banco",
    );

  // 2. site_url
  const classe = classificarSiteUrl(config.site_url, dominio);
  if (classe === "certo")
    item("endereço do site (site_url)", OK, siteUrlDe(dominio));
  else if (classe === "localhost" || classe === "vazio")
    item(
      "endereço do site (site_url)",
      FALTA,
      classe === "localhost"
        ? "aponta para localhost: o link do e-mail leva a página morta"
        : "vazio",
    );
  else if (!dominioOk)
    item(
      "endereço do site (site_url)",
      NAO_MEDIDO,
      "sem domínio para comparar",
    );
  else if (classe === "outro")
    item(
      "endereço do site (site_url)",
      FALTA,
      `aponta para outro endereço (host ${hostImprimivel(lerUrl(config.site_url)?.hostname)})`,
    );
  else item("endereço do site (site_url)", FALTA, "formato inesperado");

  // 3. endereço de volta aceito (a regra do Supabase)
  if (!dominioOk)
    item("endereço de volta aceito", NAO_MEDIDO, "sem domínio para conferir");
  else {
    const urls = [
      siteUrlDe(dominio),
      `${siteUrlDe(dominio)}/auth?type=recovery`,
    ];
    const r = urls.map((u) => enderecoAceito(config, u));
    if (r.every((x) => x === true))
      item("endereço de volta aceito", OK, "cadastro e recuperação de senha");
    else if (r.some((x) => x === false))
      item(
        "endereço de volta aceito",
        FALTA,
        "o Supabase recusaria a volta para a loja e mandaria para o site_url",
      );
    else
      item(
        "endereço de volta aceito",
        NAO_MEDIDO,
        "padrão da lista que esta conferência não interpreta",
      );
  }

  // 4. limite de e-mails
  const limite = config.rate_limit_email_sent;
  if (Number.isInteger(limite) && limite >= LIMITE_EMAIL_POR_HORA)
    item("limite de e-mails por hora", OK, String(limite));
  else
    item(
      "limite de e-mails por hora",
      ATENCAO,
      Number.isInteger(limite)
        ? `${limite} (abaixo de ${LIMITE_EMAIL_POR_HORA})`
        : limite === null || limite === undefined
          ? "vazio"
          : "formato inesperado",
    );

  // 5. localhost na lista
  let entradas = [];
  try {
    entradas = entradasDaLista(config.uri_allow_list);
  } catch {
    entradas = null;
  }
  if (entradas === null)
    item(
      "lista de endereços autorizados sem localhost",
      ATENCAO,
      "formato inesperado",
    );
  else if (
    entradas.some((e) => {
      const u = lerUrl(e.replace(/\*+/g, "x"));
      return (
        (u && ehLocalhost(u.hostname)) || /localhost|127\.0\.0\.1/i.test(e)
      );
    })
  )
    item(
      "lista de endereços autorizados sem localhost",
      ATENCAO,
      "tem endereço de localhost (sobra de desenvolvimento)",
    );
  else item("lista de endereços autorizados sem localhost", OK, "sim");

  // 6. quem envia o e-mail
  const hook = config.hook_send_email_enabled;
  if (hook === true) {
    if (config.hook_send_email_uri !== uriDoHook(ref))
      item(
        "quem envia o e-mail",
        FALTA,
        "Send Email Hook ligado com endereço diferente do desta loja",
      );
    else if (!formatoHash(config.hook_send_email_secrets))
      item(
        "quem envia o e-mail",
        FALTA,
        "Send Email Hook ligado sem o segredo no Auth",
      );
    else item("quem envia o e-mail", OK, "Send Email Hook desta loja (Gmail)");

    if (funcao === undefined)
      item("função auth-send-email ativa", NAO_MEDIDO, "não medido");
    else
      item(
        "função auth-send-email ativa",
        funcao ? OK : FALTA,
        funcao ? "sim" : "não",
      );

    if (verifyJwt === false) item("verify_jwt da função", OK, "false");
    else if (verifyJwt === undefined && funcao === undefined)
      item("verify_jwt da função", NAO_MEDIDO, "não medido");
    else
      item(
        "verify_jwt da função",
        FALTA,
        "precisa ser false (o Auth chama com assinatura de webhook, não com login)",
      );

    if (segredoPresente === undefined)
      item("segredo do hook na função", NAO_MEDIDO, "não medido");
    else
      item(
        "segredo do hook na função",
        segredoPresente ? OK : FALTA,
        segredoPresente ? "presente" : "ausente",
      );

    if (gmail === undefined)
      item("Gmail cadastrado no painel", NAO_MEDIDO, "não medido");
    else
      item(
        "Gmail cadastrado no painel",
        gmail ? OK : FALTA,
        gmail ? "sim" : "não",
      );
  } else if (hook === false || hook === null || hook === undefined) {
    if (smtpCompleto(config))
      item("quem envia o e-mail", OK, "remetente próprio (SMTP)");
    else if (config.mailer_autoconfirm === false)
      item(
        "quem envia o e-mail",
        FALTA,
        "sem remetente próprio e o cadastro exige confirmação: o e-mail só chega à equipe do projeto",
      );
    else if (config.mailer_autoconfirm === true)
      item(
        "quem envia o e-mail",
        ATENCAO,
        "sem remetente próprio: a recuperação de senha só chega à equipe do projeto",
      );
    else
      item(
        "quem envia o e-mail",
        NAO_MEDIDO,
        "confirmação de cadastro desconhecida",
      );
  } else item("quem envia o e-mail", NAO_MEDIDO, "estado do hook inesperado");

  const veredito = itens.some((i) => i.estado === FALTA)
    ? "NÃO"
    : itens.some((i) => i.estado === NAO_MEDIDO)
      ? "INCERTO"
      : "SIM";
  return { itens, veredito };
}

module.exports = {
  CAMPOS_URLS,
  LIMITE_EMAIL_POR_HORA,
  RE_DOMINIO,
  CONSULTA_GMAIL,
  Parada,
  parar,
  dominioValido,
  siteUrlDe,
  padraoDaLista,
  uriDoHook,
  textoDeUrl,
  hostImprimivel,
  classificarSiteUrl,
  remetenteProprio,
  smtpCompleto,
  conferirPatch,
  planejarPatchUrls,
  globParaRegExp,
  enderecoAceito,
  diagnosticar,
};
