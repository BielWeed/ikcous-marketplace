#!/usr/bin/env node
/**
 * medir-token-da-org.cjs — PROVA, só com leitura, que o segredo da org central
 * (`segredoDoGitHub` de scripts/frota/org-central.json, hoje
 * SUPABASE_ACCESS_TOKEN_LOJAS) enxerga SÓ a org "IKCOUS Lojas" (A20 do plano
 * da org central, com o ADENDO da revisão Opus de 26/11/2026). É o script que
 * roda dentro de .github/workflows/medir-token-da-org.yml.
 *
 * POR QUE EXISTE: um token PESSOAL do Supabase (Account > Access Tokens)
 * alcança a CONTA inteira do dono, não uma organização. Guardado como o
 * segredo da org, ele daria a todo run de toda loja da org o alcance dos
 * bancos da IKCOUS, da Savy e de qualquer outro projeto do dono. A guarda dos
 * workflows decide QUAL segredo chega ao passo; ela não limita o que o
 * segredo alcança. Isso só se prova perguntando à API o que o token enxerga.
 *
 * O QUE FAZ: duas leituras, nesta ordem, e nenhuma outra chamada de rede.
 * FONTE (OpenAPI https://api.supabase.com/api/v1-json, lido em 27/11/2026):
 *  - `GET /v1/organizations` (v1-list-all-organizations, escopo
 *    `organizations:read`): lista de `{ id (obsoleto), slug, name }`;
 *  - `GET /v1/projects` (v1-list-all-projects, escopo `projects:read`): lista
 *    de projetos com `ref` e `organization_slug` (o `organization_id` é o
 *    nome obsoleto do mesmo campo, e aqui NÃO serve de reserva).
 *
 * O VEREDITO (falha FECHADA; só "PROVADO" sai 0):
 *  - org-central.json sem `slug` (a org ainda não foi gravada, B2): VERMELHO
 *    antes de qualquer rede;
 *  - o segredo ausente no ambiente: VERMELHO antes de qualquer rede (nunca
 *    tenta outro segredo);
 *  - 401/403 em qualquer leitura: VERMELHO, sem a leitura seguinte;
 *  - qualquer outro status que não seja 2xx, rede que cai, corpo que não é
 *    lista ou item fora do formato: VERMELHO (não dá para provar);
 *  - a lista de orgs tem de ser EXATAMENTE uma, com o slug de
 *    org-central.json. Org a mais = "o segredo é amplo demais";
 *  - todo projeto tem de ter `organization_slug` igual a esse slug. Projeto
 *    de fora = "o segredo é amplo demais";
 *  - loja do lojas.json cujo `segredoDoToken` É o da org e que o token não
 *    enxerga: VERMELHO (os workflows dela falhariam).
 *
 * O QUE VAI PARA O LOG (o log de um repositório público é público): a
 * contagem de orgs e de projetos, o slug da org central (que mora no
 * repositório), os refs dos projetos DA org, e cada loja assinante do
 * cadastro com "visível pelo segredo da org: sim/nao". De fora da org, só
 * contagens e o nome das lojas do cadastro que apareceram; o slug, o nome e o
 * ref de org ou projeto alheio NUNCA são impressos. O corpo cru nunca vai
 * para o log, nem em erro (só o status HTTP), e o token nunca aparece.
 *
 * Testado por tests/ci_medir_token_da_org_test.ts.
 */
const fs = require("node:fs");
const lojasCadastro = require("./lojas.cjs");
const { carregarOrgCentral } = require("./org-central.cjs");

const API_BASE = "https://api.supabase.com";
const TEMPO_LIMITE_MS = 30_000;
const AMPLO_DEMAIS = "o segredo é amplo demais";

const ehObjeto = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Só o nome do erro, só se for um identificador — nunca a mensagem (que pode
 * carregar URL, cabeçalho ou pedaço do corpo). */
function nomeSeguro(erro) {
  const nome = erro && typeof erro.name === "string" ? erro.name : "";
  return /^[A-Za-z]{1,40}$/.test(nome) ? nome : "Error";
}

/**
 * Uma leitura GET. Devolve `{ lista }` ou `{ falha }` (a mensagem já pronta,
 * sem corpo). É a ÚNICA função que toca a rede.
 */
async function lerLista({ caminho, token, fetchImpl, segredo }) {
  let r;
  try {
    r = await fetchImpl(`${API_BASE}${caminho}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
  } catch (erro) {
    return {
      falha: `FALHOU: GET ${caminho} não completou (${nomeSeguro(erro)})`,
    };
  }
  const status = Number.isInteger(r.status) ? r.status : 0;
  if (status === 401 || status === 403) {
    return {
      falha: `FALHOU: GET ${caminho} recusou o ${segredo} (HTTP ${status}); o segredo não vale ou não tem o escopo de leitura. Nada mais foi lido.`,
    };
  }
  if (!r.ok) {
    return {
      falha: `FALHOU: GET ${caminho} respondeu HTTP ${status} (corpo não impresso)`,
    };
  }
  let corpo;
  try {
    corpo = JSON.parse(await r.text());
  } catch {
    corpo = null;
  }
  if (!Array.isArray(corpo)) {
    return {
      falha: `FALHOU: GET ${caminho} respondeu 200, mas o corpo não é uma lista (corpo não impresso)`,
    };
  }
  return { lista: corpo };
}

/** Org no formato documentado: objeto com `slug` texto. Sem `slug` (só o `id`
 * obsoleto) não se prova nada. */
const orgValida = (o) =>
  ehObjeto(o) && typeof o.slug === "string" && o.slug !== "";

/** Projeto no formato documentado: `ref` de 20 letras e `organization_slug`. */
function projetoValido(p) {
  if (!ehObjeto(p)) return false;
  if (typeof p.ref !== "string" || !lojasCadastro.RE_REF.test(p.ref))
    return false;
  if (typeof p.organization_slug !== "string" || p.organization_slug === "")
    return false;
  return true;
}

/**
 * Faz a prova. Devolve o código de saída (0 = PROVADO; 1 = vermelho), sem
 * chamar `process.exit` — o teste injeta `fetchImpl`, `saida`, `org` e
 * `cadastro`.
 */
async function medir({ env, fetchImpl, saida, org, cadastro }) {
  const segredo = org.segredoDoGitHub;
  if (org.slug === null) {
    saida.erro(
      "FALHOU: scripts/frota/org-central.json ainda não tem o `slug` da org central (B2 do plano): sem ele não há o que provar. Nada foi lido.",
    );
    return 1;
  }
  // SÓ o segredo da org; sem ele PARA (nunca tenta o de uma loja).
  const token = env[org.segredoDoGitHub];
  if (typeof token !== "string" || token === "") {
    saida.erro(
      `FALHOU: o segredo ${segredo} não chegou a este passo (não gravado no repositório?). Nada foi lido.`,
    );
    return 1;
  }

  const lidaOrgs = await lerLista({
    caminho: "/v1/organizations",
    token,
    fetchImpl,
    segredo,
  });
  if (lidaOrgs.falha) {
    saida.erro(lidaOrgs.falha);
    return 1;
  }
  const orgs = lidaOrgs.lista;
  if (!orgs.every(orgValida)) {
    saida.erro(
      "FALHOU: GET /v1/organizations trouxe org fora do formato (sem `slug`); não dá para provar o escopo (corpo não impresso)",
    );
    return 1;
  }

  const lidaProjetos = await lerLista({
    caminho: "/v1/projects",
    token,
    fetchImpl,
    segredo,
  });
  if (lidaProjetos.falha) {
    saida.erro(lidaProjetos.falha);
    return 1;
  }
  const projetos = lidaProjetos.lista;
  if (!projetos.every(projetoValido)) {
    saida.erro(
      "FALHOU: GET /v1/projects trouxe projeto fora do formato (sem `ref` ou sem `organization_slug`); não dá para provar o escopo (corpo não impresso)",
    );
    return 1;
  }

  const problemas = [];
  const alheias = orgs.filter((o) => o.slug !== org.slug).length;
  const temACentral = orgs.some((o) => o.slug === org.slug);
  if (orgs.length !== 1 || orgs[0].slug !== org.slug) {
    if (orgs.length === 0) {
      problemas.push(
        `o segredo não enxerga nenhuma organização (esperado: só ${org.slug})`,
      );
    } else if (orgs.length > 1) {
      problemas.push(
        `${AMPLO_DEMAIS}: enxerga ${orgs.length} organizações (${alheias} além da central${temACentral ? "" : ", e a central não está entre elas"}); o esperado é só ${org.slug}`,
      );
    } else {
      problemas.push(
        `o segredo enxerga 1 organização, e não é a central ${org.slug} (o nome da outra não é impresso)`,
      );
    }
  }

  const refsDoCadastro = new Map(
    Object.values(cadastro.lojas).map((l) => [l.ref, l.projeto]),
  );
  const fora = projetos.filter((p) => p.organization_slug !== org.slug);
  const dentro = projetos.filter((p) => p.organization_slug === org.slug);
  if (fora.length > 0) {
    const conhecidas = [
      ...new Set(
        fora
          .map((p) => refsDoCadastro.get(p.ref))
          .filter((nome) => typeof nome === "string"),
      ),
    ].sort();
    problemas.push(
      `${AMPLO_DEMAIS}: enxerga ${fora.length} projeto(s) de fora da org central${conhecidas.length > 0 ? `, entre eles ${conhecidas.join(", ")}` : ""} (os refs alheios não são impressos)`,
    );
  }

  const refsVisiveis = new Set(dentro.map((p) => p.ref));
  const assinantes = lojasCadastro.assinantes(cadastro);
  const naOrgInvisiveis = assinantes
    .filter((l) => l.segredoDoToken === segredo && !refsVisiveis.has(l.ref))
    .map((l) => l.projeto);
  if (naOrgInvisiveis.length > 0)
    problemas.push(
      `loja(s) do cadastro no ${segredo} que o segredo NÃO enxerga: ${naOrgInvisiveis.join(", ")} (os workflows delas falhariam)`,
    );

  const visivel = assinantes.map((l) => [
    l.projeto,
    l.ref,
    refsVisiveis.has(l.ref) ? "sim" : "nao",
  ]);
  const titulo = `Escopo do ${segredo} (org central ${org.slug}) — somente leitura`;
  const veredito =
    problemas.length === 0
      ? `PROVADO: o segredo enxerga só a org ${org.slug} e ${dentro.length} projeto(s) dela`
      : `VERMELHO: ${problemas.join("; ")}`;
  const linhas = [
    titulo,
    `organizações visíveis: ${orgs.length}`,
    `projetos visíveis na org central: ${dentro.length}${dentro.length > 0 ? ` (${dentro.map((p) => p.ref).join(", ")})` : ""}`,
    `projetos visíveis fora da org central: ${fora.length}`,
    "loja assinante do cadastro visível pelo segredo da org:",
    ...visivel.map(([nome, ref, sn]) => `  ${nome}: ${sn} (ref ${ref})`),
    veredito,
  ];
  for (const l of linhas) {
    if (l === veredito && problemas.length > 0) saida.erro(l);
    else saida.log(l);
  }
  saida.resumo(
    [
      `### ${titulo}`,
      "",
      "| o quê | valor |",
      "| --- | --- |",
      `| organizações visíveis | ${orgs.length} |`,
      `| projetos na org central | ${dentro.length} |`,
      `| projetos fora da org central | ${fora.length} |`,
      ...visivel.map(([nome, , sn]) => `| loja ${nome} visível | ${sn} |`),
      "",
      `**${veredito}**`,
      "",
    ].join("\n"),
  );
  return problemas.length === 0 ? 0 : 1;
}

/** A saída real: stdout/stderr do job e o resumo do run (GITHUB_STEP_SUMMARY). */
function saidaDoProcesso() {
  return {
    log: (linha) => console.log(linha),
    erro: (linha) => console.error(linha),
    resumo: (markdown) => {
      const destino = process.env.GITHUB_STEP_SUMMARY;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho vem do runner do GitHub Actions (GITHUB_STEP_SUMMARY), não de entrada de usuário.
      if (destino) fs.appendFileSync(destino, `${markdown}\n`);
    },
  };
}

async function main() {
  const saida = saidaDoProcesso();
  let org;
  let cadastro;
  try {
    org = carregarOrgCentral();
    cadastro = lojasCadastro.carregarLojas();
  } catch (erro) {
    // só as mensagens dos validadores do próprio repositório, numa linha
    saida.erro(
      `FALHOU: ${String(erro?.message ?? "")
        .replace(/[\r\n%]/g, " ")
        .slice(0, 300)}`,
    );
    process.exitCode = 1;
    return;
  }
  process.exitCode = await medir({
    env: process.env,
    fetchImpl: globalThis.fetch,
    saida,
    org,
    cadastro,
  });
}

if (require.main === module) {
  main();
}

module.exports = { API_BASE, AMPLO_DEMAIS, medir, main };
