#!/usr/bin/env node
/* eslint-disable security/detect-object-injection -- as chaves vêm de canais-de-backend.json/politica.json versionados, do inventário montado aqui e de mapas fechados; nenhuma vem de quem chama. */
/* eslint-disable security/detect-non-literal-fs-filename -- lê arquivos ao lado do script, pastas temporárias criadas aqui (mkdtemp) e o --json que o dono passa; não há entrada remota. */
/**
 * publicar-release.mjs — UMA publicação para a frota inteira (06/10/2026).
 *
 * POR QUE EXISTE: em 05/10 a release 1.5.18 foi ao ar só na loja principal e
 * 9 endereços (Savy, lojas de teste, endereços auxiliares) ficaram na 1.5.17.
 * A publicação parcial foi deliberada, por coordenação manual: a Savy ainda
 * não tinha o backend que o site novo exige. Causa de ter de ser assim: o
 * front é UM projeto Vercel para todas as lojas, mas banco e functions são um
 * projeto Supabase por loja, não havia caminho central para levar o backend à
 * Savy, e a saída foi publicar endereço por endereço (`alias set`). Este
 * comando troca a manutenção por cliente por um portão único:
 *
 *   1. CANDIDATO: o deployment parado (`vercel --prod --skip-domain`) é deste
 *      projeto, é produção, está READY e serve o version.json da release
 *      (contrato de scripts/buildStore.mjs, via problemasDoContrato).
 *   2. INVENTÁRIO OFICIAL: todos os aliases do projeto Vercel (o que um
 *      `promote` vai tocar) e, em cada um, a ficha servida pelo porteiro
 *      (cadastro `frota_lojas`): loja = ref Supabase da ficha. Loja nova entra
 *      sozinha; nenhuma lista de clientes por release. Antes de promover, a
 *      conferência da frota roda sobre ESTE inventário e qualquer problema de
 *      identidade, isolamento ou destino canônico bloqueia — versão antiga
 *      (ENDERECO_ANTIGO) é o esperado antes do promote e passa.
 *   3. PRONTIDÃO de cada loja ASSINANTE (todas, menos as de teste declaradas em
 *      politica.json):
 *      - migrations: toda versão da release no ledger da loja
 *        (`supabase migration list`) E, para cada migration NOVA em relação ao
 *        SHA que a loja serve, evidência FRESCA de objetos/corpos: o último run
 *        de `conferir-banco-da-loja.yml` com a consulta de prova declarada em
 *        canais-de-backend.json (provasDeObjetos), daquela loja (ref impresso
 *        pelo próprio script), de um commit com as mesmas migrations e a mesma
 *        consulta do SHA, dentro da validade, com N>0 linhas e nenhuma
 *        ok=false, e sem apply naquela loja depois dele;
 *      - functions: para cada function, o CONJUNTO de arquivos esperado no SHA
 *        (index.ts + tudo o que ele importa por caminho relativo, inclusive
 *        _shared, transitivo) contra o pacote baixado do ar
 *        (`supabase functions download`): arquivo que falta, que sobra ou que
 *        difere conta; verify_jwt igual ao config.toml do SHA.
 *      Loja assinante sem canal de backend cadastrado (canais-de-backend.json)
 *      também BLOQUEIA, pelo nome.
 *   4. Qualquer falha das etapas 1–3 IMPEDE o promote e diz o alvo e o comando
 *      que resolve. Sem `--promover`, para aqui (ensaio).
 *   5. `--promover`: `vercel promote <deployment>` — leva TODOS os domínios de
 *      produção de uma vez, sem rebuild — e roda a conferência da frota com o
 *      SHA: versão, isolamento e destino canônico de cada endereço, e a
 *      produção oficial = o deployment promovido. Falha aqui imprime o
 *      rollback exato (`vercel rollback <produção anterior>`).
 *
 * QUEM RODA: o dono, no PowerShell, de uma worktree limpa do ramo da release
 * com os CLIs do Supabase, da Vercel e do GitHub (gh) logados. As permissões
 * do projeto negam ao agente `vercel promote`/`rollback`; o ensaio (sem
 * --promover) só lê.
 *
 * Uso:
 *   node scripts/frota/publicar-release.mjs --sha <40hex> --deployment <dpl_…> [--promover] [--json <arquivo>]
 * Saída: 0 = pronto (ensaio) ou publicado e conferido; 1 = bloqueado ou
 * conferência pós-promote falhou; 2 = uso errado.
 */

import { execFile, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  conferirFrota,
  criarExecutorVercel,
  inventariar,
  lerPolitica,
  problemasDoContrato,
  resolverCliVercel,
  validarVersao,
} from "./conferir-frota.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..");
const RE_SHA = /^[0-9a-f]{40}$/;
const RE_DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/;
const RE_REF = /^[a-z]{20}$/;
const RE_MIGRATION = /^(\d{13,14})_[^/]+\.sql$/;
const RE_FUNCAO = /^[a-z0-9][a-z0-9_-]*$/;
const RE_CONSULTA = /^[0-9a-z][0-9a-z-]*$/;
/** Classes da conferência da frota que podem existir ANTES do promote. */
const CLASSES_ACEITAS_ANTES = new Set(["OK", "ENDERECO_ANTIGO"]);

export function lerCanais(caminho = path.join(AQUI, "canais-de-backend.json")) {
  const c = JSON.parse(readFileSync(caminho, "utf8"));
  for (const ref of Object.keys(c.canais ?? {})) {
    if (!RE_REF.test(ref))
      throw new Error(`canais-de-backend.json: ref inválido ${ref}`);
  }
  for (const p of c.provasDeObjetos ?? []) {
    for (const consulta of [
      p.consulta,
      p.ausenciaConfirmadaPor,
      ...(p.conferenciasAntesDoApply ?? []),
    ]) {
      if (consulta !== undefined && !RE_CONSULTA.test(consulta ?? ""))
        throw new Error(
          `canais-de-backend.json: consulta inválida ${consulta}`,
        );
    }
    if (p.consulta === undefined)
      throw new Error("canais-de-backend.json: lote sem consulta de prova");
    if (p.backfillLedger !== undefined && !/^\d+-\d+$/.test(p.backfillLedger))
      throw new Error(
        `canais-de-backend.json: backfillLedger inválido ${p.backfillLedger}`,
      );
  }
  return c;
}

/** Texto seguro numa célula de tabela markdown (o título de loja tem "|"). */
const celula = (texto) =>
  String(texto ?? "")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, " ");

const normalizar = (texto) =>
  texto === null || texto === undefined
    ? null
    : String(texto).replace(/\r\n/g, "\n");

// ------------------------------------------------------------------ etapa 1

/** Confere o deployment candidato. Devolve { ok, deployment, problemas[] }. */
export async function conferirCandidato({
  sha,
  deploymentId,
  politica,
  vercelApi,
  fetchImpl,
}) {
  const problemas = [];
  let d;
  try {
    const bruto = await vercelApi(
      `/v13/deployments/${encodeURIComponent(deploymentId)}?teamId=${encodeURIComponent(politica.projetoVercel.time)}`,
    );
    // SÓ estes campos saem daqui (o JSON do deployment tem configuração).
    d = {
      id: bruto?.id ?? null,
      url: bruto?.url ?? null,
      target: bruto?.target ?? null,
      readyState: bruto?.readyState ?? null,
      projectId: bruto?.projectId ?? null,
    };
  } catch (e) {
    return {
      ok: false,
      deployment: null,
      problemas: [`deployment ${deploymentId} não lido: ${e.message}`],
    };
  }
  if (d.id !== deploymentId)
    problemas.push(`a Vercel devolveu outro deployment (${d.id})`);
  if (d.projectId !== politica.projetoVercel.id)
    problemas.push(`deployment de outro projeto (${d.projectId})`);
  if (d.target !== "production")
    problemas.push(
      `deployment não é de produção (target=${d.target}); use vercel --prod --skip-domain`,
    );
  if (d.readyState !== "READY")
    problemas.push(`deployment não está READY (${d.readyState})`);
  if (typeof d.url !== "string" || !/^[a-z0-9.-]+\.vercel\.app$/.test(d.url)) {
    problemas.push("deployment sem URL própria .vercel.app");
  } else {
    try {
      const res = await fetchImpl(
        `https://${d.url}/version.json?t=${Date.now()}`,
        {
          cache: "no-store",
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
        },
      );
      if (res.status !== 200)
        problemas.push(
          `version.json do candidato respondeu HTTP ${res.status}`,
        );
      else {
        const v = validarVersao(await res.text());
        const contrato = v.erro ? [v.erro] : problemasDoContrato(v.versao);
        if (contrato.length)
          problemas.push(
            `version.json do candidato fora do contrato: ${contrato.join("; ")}`,
          );
        else if (v.versao.codeSha !== sha)
          problemas.push(
            `candidato serve codeSha ${v.versao.codeSha}, release é ${sha}`,
          );
        else d.codeVersion = v.versao.codeVersion;
      }
    } catch (e) {
      problemas.push(`version.json do candidato não lido: ${e.message}`);
    }
  }
  return { ok: problemas.length === 0, deployment: d, problemas };
}

// ------------------------------------------------------------------ etapa 2

/**
 * Agrupa o inventário em lojas pelo ref Supabase da ficha servida pelo
 * porteiro. Endereço esperado sem loja (manutenção/redirecionamento) fica fora.
 * Endereço que não é esperado e não tem ficha de loja legível é problema.
 */
export function lojasDoInventario(inventario, politica) {
  const esperados = new Set(politica.enderecosEsperados.map((e) => e.dominio));
  const lojas = new Map();
  const problemas = [];
  if (!inventario.vercel?.ok)
    problemas.push(
      `lista oficial de aliases da Vercel não lida: ${inventario.vercel?.erro ?? "sem --vercel"}`,
    );
  if (!inventario.completo)
    problemas.push(
      `inventário PARCIAL: ${inventario.motivoParcial ?? "motivo não informado"}`,
    );
  for (const sonda of inventario.sondas) {
    if (esperados.has(sonda.dominio)) continue;
    const f = sonda.ficha;
    if (
      !f ||
      f.status !== 200 ||
      f.caderneta !== "hit" ||
      !Array.isArray(f.refs) ||
      f.refs.length !== 1 ||
      f.estavel === false
    ) {
      problemas.push(
        `${sonda.dominio}: não é loja legível (status ${f?.status ?? "-"}, caderneta ${f?.caderneta ?? "-"}, refs ${(f?.refs ?? []).join(",") || "-"}${f?.estavel === false ? ", amostras divergentes" : ""})`,
      );
      continue;
    }
    const ref = f.refs[0];
    if (!lojas.has(ref))
      lojas.set(ref, {
        ref,
        titulos: new Set(),
        dominios: [],
        shasServidos: new Set(),
      });
    const loja = lojas.get(ref);
    loja.dominios.push(sonda.dominio);
    if (f.titulo) loja.titulos.add(f.titulo);
    if (sonda.versao?.codeSha) loja.shasServidos.add(sonda.versao.codeSha);
  }
  return {
    lojas: [...lojas.values()].map((l) => ({
      ref: l.ref,
      titulo: [...l.titulos].join(" / "),
      dominios: l.dominios.sort(),
      shasServidos: [...l.shasServidos],
    })),
    problemas,
  };
}

/**
 * Problemas de identidade/isolamento/canônico/estado ANTES do promote. Decide
 * por ACHADO, nunca pela `classe` resumida: antes do promote quase todo
 * endereço tem ENDERECO_ANTIGO, que é mais grave que CANONICO_INVALIDO,
 * BUILD_DIVERGENTE e ESTADO_INESPERADO na ordem de GRAVIDADE e os esconderia
 * (achado da revisão final, 06/10). Passam só:
 *   - ENDERECO_ANTIGO (o promote existe para isso);
 *   - BUILD_DIVERGENTE de um endereço que NÃO serve o SHA da release — é o
 *     build velho que o promote substitui; no build da release, bloqueia.
 * Roteamento, ficha, isolamento, redirecionamento e estado esperado não mudam
 * com o promote: bloqueiam sempre.
 */
export function problemasAntesDoPromote(conferencia, sha) {
  const saida = [];
  for (const r of conferencia?.resultados ?? []) {
    const achados = Array.isArray(r.achados) ? r.achados : [];
    // "build velho" só com PROVA: um codeSha válido e diferente do da release.
    // Versão ausente ou ilegível não é velha por presunção — bloqueia.
    const codeSha = r.versao?.codeSha;
    const serveARelease = !(
      typeof codeSha === "string" &&
      RE_SHA.test(codeSha) &&
      codeSha !== sha
    );
    const bloqueiam = achados.filter((a) => {
      const classe = a?.classe ?? r.classe;
      if (classe === "ENDERECO_ANTIGO") return false;
      if (classe === "BUILD_DIVERGENTE" && !serveARelease) return false;
      return true;
    });
    if (!achados.length && !CLASSES_ACEITAS_ANTES.has(r.classe))
      bloqueiam.push({ classe: r.classe, motivo: "sem detalhe" });
    if (bloqueiam.length)
      saida.push(
        `${r.dominio}: ${bloqueiam.map((a) => `${a?.classe ?? r.classe} — ${a?.motivo ?? String(a)}`).join("; ")}`,
      );
  }
  return saida;
}

// ------------------------------------------------------------------ etapa 3: migrations

export function migrationsDaRelease(nomesDeArquivo, politica) {
  const fora = new Set(
    (politica.migrationsForaDaRelease ?? []).map((m) => m.versao),
  );
  const versoes = [];
  for (const nome of nomesDeArquivo) {
    const m = RE_MIGRATION.exec(nome);
    if (m && !fora.has(m[1])) versoes.push(m[1]);
  }
  return [...new Set(versoes)].sort();
}

/**
 * Devolve as versões REMOTAS (ledger) da saída de `supabase migration list`.
 * O CLI 2.118 IGNORA `-o json` neste subcomando e imprime a tabela
 * `Local | Remote | Time (UTC)` (medido em 06/10/2026 contra a CAF); o JSON
 * fica aceito para quando o CLI passar a respeitá-lo. Formato desconhecido ou
 * ledger sem nenhuma versão remota LANÇA: ledger não lido nunca vira "nada falta".
 */
export function versoesAplicadas(saida) {
  const texto = String(saida);
  const ini = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  let versoes;
  if (ini >= 0 && fim > ini) {
    const j = JSON.parse(texto.slice(ini, fim + 1));
    if (!Array.isArray(j.migrations))
      throw new Error("migration list sem o campo migrations");
    versoes = j.migrations
      .map((m) => String(m.remote ?? "").trim())
      .filter(Boolean);
  } else {
    const linhas = texto.split(/\r?\n/);
    const cab = linhas.findIndex((l) => /^\s*Local\s*\|\s*Remote\s*\|/.test(l));
    if (cab < 0)
      throw new Error(
        "migration list em formato desconhecido (nem JSON nem a tabela Local | Remote)",
      );
    versoes = [];
    for (const l of linhas.slice(cab + 1)) {
      const celulas = l.split("|");
      if (celulas.length < 3) continue;
      const remota = celulas[1].replaceAll("`", "").trim();
      if (/^\d{13,14}$/.test(remota)) versoes.push(remota);
    }
  }
  if (!versoes.length)
    throw new Error(
      "migration list sem nenhuma versão remota (ledger vazio ou não lido)",
    );
  return new Set(versoes);
}

/** Lê a linha VEREDITO-CONSULTA que scripts/publicacao/conferir-banco.cjs imprime. */
export function lerVeredicto(log, consulta) {
  const re =
    /VEREDITO-CONSULTA consulta=(\S+) ref=([a-z]{20}) sha=([0-9a-f]{40}|local) linhas=(\d+) ok_false=(\d+) ok_nao_booleano=(\d+)/g;
  const achados = [];
  for (const m of String(log).matchAll(re)) {
    if (m[1] === consulta) {
      achados.push({
        ref: m[2],
        sha: m[3],
        linhas: Number(m[4]),
        okFalse: Number(m[5]),
        naoBooleano: Number(m[6]),
      });
    }
  }
  return achados.length === 1 ? achados[0] : null; // zero ou ambíguo = sem evidência
}

/**
 * Procura a evidência fresca de UMA consulta numa loja. Devolve
 * { ok, estado, motivo, run }, com estado:
 *   POSITIVA      — todas as linhas ok=true (ok = true);
 *   NEGATIVA      — evidência válida que DIZ ok=false (o banco não está como a
 *                   consulta espera) — é um resultado, não falta de prova;
 *   SEM_EVIDENCIA — qualquer outro caso (sem run, vencido, em execução,
 *                   falhou, outra loja, outro commit, veredicto ausente,
 *                   ambíguo, sem linhas ou com ok não booleano).
 * Regras na ordem: o run MAIS NOVO com o título da loja decide; dentro da
 * validade; terminado com sucesso; sem apply depois dele naquela loja; commit
 * com migrations e consulta iguais às do SHA; veredicto único da consulta, ref
 * da loja, sha = commit do run, linhas > 0.
 */
export async function evidenciaDaProva({
  consulta,
  projeto,
  projetosNoMesmoBanco = [],
  ref,
  sha,
  topo,
  validadeHoras,
  agora,
  deps,
}) {
  const titulo = `conferir ${consulta} em ${projeto}`;
  const limite = agora - validadeHoras * 3600 * 1000;
  const sem = (motivo, run) => ({
    ok: false,
    estado: "SEM_EVIDENCIA",
    motivo,
    ...(run ? { run } : {}),
  });
  // A MAIS NOVA conferência pertinente decide, em qualquer estado: um run
  // antigo verde nunca esconde um mais novo vermelho, cancelado ou em execução.
  const pertinentes = (await deps.listarRuns("conferir-banco-da-loja.yml"))
    .filter(
      (r) =>
        r.displayTitle === titulo && Number.isFinite(Date.parse(r.createdAt)),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (!pertinentes.length) return sem(`sem run "${titulo}"`);
  const run = pertinentes[0];
  if (Date.parse(run.createdAt) < limite) {
    return sem(
      `sem run "${titulo}" nas últimas ${validadeHoras} h (o mais novo é de ${run.createdAt})`,
      run,
    );
  }
  if (run.status !== "completed") {
    return sem(
      `o run mais novo "${titulo}" (${run.databaseId}) ainda não terminou (${run.status})`,
      run,
    );
  }
  if (run.conclusion !== "success") {
    return sem(
      `o run mais novo "${titulo}" (${run.databaseId}) terminou ${run.conclusion ?? "sem conclusão"}`,
      run,
    );
  }
  // Vence a evidência qualquer apply que POSSA ter tocado este banco depois do
  // início dela: o alvo da loja ou outro alvo do MESMO banco (a CAF também é
  // `loja`), apply ainda em execução, ou terminado depois do início dela, e
  // run sem o título padrão (ramo antigo: alvo desconhecido = conta).
  const projetos = new Set([projeto, ...projetosNoMesmoBanco]);
  const inicio = Date.parse(run.createdAt);
  const tocaEsteBanco = (r) => {
    const m = /^aplicar em ([a-z0-9-]+):/.exec(String(r.displayTitle ?? ""));
    return m ? projetos.has(m[1]) : true;
  };
  const depois = (t) =>
    !Number.isFinite(Date.parse(t)) || Date.parse(t) > inicio;
  const vencedores = (await deps.listarRuns("aplicar-migrations.yml")).filter(
    (r) =>
      tocaEsteBanco(r) &&
      (r.status !== "completed" ||
        depois(r.createdAt) ||
        depois(r.updatedAt ?? r.createdAt)),
  );
  if (vencedores.length) {
    return sem(
      `evidência vencida: apply ${vencedores.map((r) => r.databaseId).join(", ")} neste banco em execução ou terminado depois do run ${run.databaseId}`,
      run,
    );
  }
  if (
    !(await deps.arvoreIgual(run.headSha, sha, [
      "supabase/migrations",
      `scripts/publicacao/consultas/${consulta}.sql`,
    ]))
  ) {
    return sem(
      `run ${run.databaseId} é de um commit (${String(run.headSha).slice(0, 8)}) com migrations ou consulta diferentes do SHA`,
      run,
    );
  }
  // A ferramenta que imprime o veredicto também tem de ser a do topo do ramo
  // (um ramo com conferir-banco.cjs alterado poderia imprimir qualquer VEREDITO).
  if (
    !topo ||
    !(await deps.arvoreIgual(run.headSha, topo, [
      "scripts/publicacao/conferir-banco.cjs",
      ".github/workflows/conferir-banco-da-loja.yml",
    ]))
  ) {
    return sem(
      `run ${run.databaseId}: a ferramenta de conferência daquele commit difere da do topo do ramo (ou o topo não foi lido)`,
      run,
    );
  }
  const v = lerVeredicto(await deps.logDoRun(run.databaseId), consulta);
  if (!v)
    return sem(
      `run ${run.databaseId} sem um VEREDITO-CONSULTA único de ${consulta}`,
      run,
    );
  if (v.ref !== ref)
    return sem(
      `run ${run.databaseId} conferiu o ref ${v.ref}, não ${ref}`,
      run,
    );
  if (v.sha !== run.headSha)
    return sem(`run ${run.databaseId}: sha do veredicto ≠ commit do run`, run);
  if (v.linhas === 0)
    return sem(
      `run ${run.databaseId}: consulta sem linhas (nada conferido)`,
      run,
    );
  if (v.naoBooleano > 0)
    return sem(
      `run ${run.databaseId}: ${v.okFalse} linha(s) ok=false, ${v.naoBooleano} sem ok booleano`,
      run,
    );
  if (v.okFalse > 0) {
    return {
      ok: false,
      estado: "NEGATIVA",
      motivo: `run ${run.databaseId}: ${v.okFalse} linha(s) ok=false de ${v.linhas}`,
      run,
    };
  }
  return {
    ok: true,
    estado: "POSITIVA",
    motivo: `run ${run.databaseId}: ${v.linhas} linhas, todas ok=true`,
    run,
  };
}

/**
 * Decide o próximo passo SEGURO de UM lote de migrations (uma entrada de
 * provasDeObjetos) numa loja. Nunca reaplica o que já está no banco:
 *   - ledger completo: só exige a prova quando o lote é novo para a loja;
 *   - ledger com lacuna: PRIMEIRO a prova de objetos/corpos. Positiva = os
 *     objetos já estão lá e falta só o REGISTRO → só o backfill protegido do
 *     ledger, nenhum apply. Sem evidência → só a prova.
 *   - prova negativa: diagnóstico antes de qualquer apply. Apply só quando a
 *     consulta de ausência (8a) PROVA o lote inteiro ausente, as conferências
 *     de antes (8b, 8c) estão ok e o ledger não registra nenhuma versão dele.
 *     Qualquer ok=false do diagnóstico, ou contradição, PARA e vai ao dono.
 * Devolve { acao: NADA|CONFERIR|BACKFILL|APLICAR|PARAR, motivo, consultas?, versoes? }.
 */
export function decidirLote({
  lote,
  faltam,
  exigeProva,
  prova,
  diagnostico = new Map(),
}) {
  const consulta = lote.consulta;
  if (!faltam.length) {
    if (!exigeProva)
      return {
        acao: "NADA",
        motivo: "lote inteiro no ledger e já presente no SHA que a loja serve",
      };
    if (prova.estado === "POSITIVA")
      return {
        acao: "NADA",
        motivo: `objetos/corpos provados (${prova.motivo})`,
      };
    if (prova.estado === "NEGATIVA") {
      return {
        acao: "PARAR",
        motivo: `o ledger registra o lote, mas a prova ${consulta} diz que objetos/corpos divergem (${prova.motivo}): diagnóstico com o dono; nenhum apply`,
      };
    }
    return {
      acao: "CONFERIR",
      consultas: [consulta],
      motivo: `prova ${consulta}: ${prova.motivo}`,
    };
  }
  const lista = faltam.join(", ");
  if (prova.estado === "POSITIVA") {
    if (!lote.backfillLedger) {
      return {
        acao: "PARAR",
        motivo: `ledger sem ${lista}, objetos já no banco (${prova.motivo}), mas o lote não declara backfillLedger: registrar à mão é decisão do dono; nenhum apply`,
      };
    }
    return {
      acao: "BACKFILL",
      motivo: `ledger sem ${lista}, mas os objetos/corpos já estão no banco (${prova.motivo}): só o backfill do REGISTRO; nada se reaplica`,
    };
  }
  if (prova.estado !== "NEGATIVA") {
    return {
      acao: "CONFERIR",
      consultas: [consulta],
      motivo: `ledger sem ${lista}; primeiro a prova ${consulta} (${prova.motivo})`,
    };
  }
  const ausencia = lote.ausenciaConfirmadaPor;
  if (!ausencia) {
    return {
      acao: "PARAR",
      motivo: `ledger sem ${lista} e prova ${consulta} negativa (${prova.motivo}), mas o lote não declara a consulta de ausência: diagnóstico com o dono; nenhum apply`,
    };
  }
  const necessarias = [
    ...new Set([ausencia, ...(lote.conferenciasAntesDoApply ?? [])]),
  ];
  // Diagnóstico só vale se for da MESMA janela ou mais novo que a prova
  // negativa: uma 8a "tudo ausente" mais velha que uma 8e que já vê parte do
  // lote no banco não autoriza apply (achado da revisão final, 06/10).
  const inicioProva = Date.parse(prova.run?.createdAt ?? "");
  for (const c of necessarias) {
    const e = diagnostico.get(c);
    if (
      e &&
      e.estado !== "SEM_EVIDENCIA" &&
      !(
        Number.isFinite(inicioProva) &&
        Date.parse(e.run?.createdAt ?? "") >= inicioProva
      )
    ) {
      diagnostico.set(c, {
        ...e,
        ok: false,
        estado: "SEM_EVIDENCIA",
        motivo: `mais antiga que a prova ${consulta} (${e.motivo}): rodar de novo`,
      });
    }
  }
  const negativas = necessarias.filter(
    (c) => diagnostico.get(c)?.estado === "NEGATIVA",
  );
  if (negativas.length) {
    return {
      acao: "PARAR",
      motivo: `ledger sem ${lista}, prova ${consulta} negativa (${prova.motivo}) e ok=false em ${negativas.join(", ")}: estado parcial ou dado a decidir — diagnóstico com o dono antes de qualquer apply`,
    };
  }
  const semEvidencia = necessarias.filter(
    (c) => diagnostico.get(c)?.estado !== "POSITIVA",
  );
  if (semEvidencia.length) {
    return {
      acao: "CONFERIR",
      consultas: semEvidencia,
      motivo: `ledger sem ${lista} e prova ${consulta} negativa (${prova.motivo}): diagnóstico antes do apply — ${semEvidencia.map((c) => `${c}: ${diagnostico.get(c)?.motivo ?? "não lida"}`).join("; ")}`,
    };
  }
  if (faltam.length !== lote.versoes.length) {
    return {
      acao: "PARAR",
      motivo: `${ausencia} confirma o lote AUSENTE, mas o ledger já registra parte dele (faltam só ${lista}): contradição — diagnóstico com o dono`,
    };
  }
  return {
    acao: "APLICAR",
    versoes: faltam,
    motivo: `lote ausente confirmado (${necessarias.join(", ")} todas ok=true): aplicar ${lista} na ordem`,
  };
}

// ------------------------------------------------------------------ etapa 3: functions

/** verify_jwt esperado por function, lido do config.toml do SHA (padrão do Supabase: true). */
export function verifyJwtDoConfig(toml) {
  const mapa = {};
  let atual = null;
  for (const linha of String(toml ?? "").split(/\r?\n/)) {
    const cab = /^\s*\[functions\."?([a-z0-9_-]+)"?\]\s*$/.exec(linha);
    if (cab) {
      atual = cab[1];
      continue;
    }
    if (/^\s*\[/.test(linha)) {
      atual = null;
      continue;
    }
    const v = /^\s*verify_jwt\s*=\s*(true|false)\s*$/.exec(linha);
    if (atual && v) mapa[atual] = v[1] === "true";
  }
  return mapa;
}

/** Especificadores relativos importados/reexportados por um arquivo TS/JS. */
export function importsRelativos(fonte) {
  const especs = new Set();
  // eslint-disable-next-line security/detect-unsafe-regex -- roda só sobre o código das functions do próprio repositório no SHA da release (texto versionado e limitado), nunca sobre entrada externa.
  const re =
    /(?:\bimport\s+(?:[^'"`;]*?\s+from\s+)?|\bexport\s+[^'"`;]*?\s+from\s+|\bimport\s*\(\s*)["']([^"']+)["']/g;
  for (const m of String(fonte ?? "").matchAll(re)) {
    if (m[1].startsWith("./") || m[1].startsWith("../")) especs.add(m[1]);
  }
  return [...especs];
}

/**
 * Conjunto de arquivos que o pacote de uma function deve ter num SHA:
 * supabase/functions/<nome>/index.ts e tudo o que ele importa por caminho
 * relativo, transitivo. Map caminho → conteúdo (null = importado mas ausente).
 */
export function arquivosEsperados(nome, ler) {
  const raiz = `supabase/functions/${nome}/index.ts`;
  const vistos = new Map();
  const fila = [raiz];
  while (fila.length) {
    const atual = fila.shift();
    if (vistos.has(atual)) continue;
    const conteudo = ler(atual);
    vistos.set(atual, conteudo);
    if (conteudo === null || !/\.(ts|tsx|js|mjs)$/.test(atual)) continue;
    for (const espec of importsRelativos(conteudo)) {
      const destino = path.posix.normalize(
        path.posix.join(path.posix.dirname(atual), espec),
      );
      if (destino.startsWith("supabase/functions/")) fila.push(destino);
    }
  }
  return vistos;
}

/**
 * Compara o pacote baixado do ar com o conjunto esperado no SHA e na base.
 *   EM_DIA        — mesmos caminhos e mesmo conteúdo do SHA.
 *   NAO_PRONTA    — caminho que falta, sobra ou difere E que a release mudou
 *                   (o conjunto/conteúdo na base é outro), ou base desconhecida.
 *   DERIVA_ANTIGA — diferenças só no que a release não mudou.
 * `baixados`: Map caminho → conteúdo. `esperadosSha`/`esperadosBase`: Map de
 * arquivosEsperados (base null = desconhecida).
 */
export function classificarFuncao(baixados, esperadosSha, esperadosBase) {
  if (baixados.size === 0)
    return { estado: "NAO_PRONTA", divergentes: ["(download vazio)"] };
  const caminhos = new Set([...baixados.keys(), ...esperadosSha.keys()]);
  const divergentes = [];
  let mudouNaRelease = false;
  for (const c of [...caminhos].sort()) {
    const noAr = baixados.has(c) ? normalizar(baixados.get(c)) : null;
    const noSha = esperadosSha.has(c) ? normalizar(esperadosSha.get(c)) : null;
    if (noAr !== null && noAr === noSha) continue;
    const tipo =
      noAr === null ? "falta no ar" : noSha === null ? "sobra no ar" : "difere";
    divergentes.push(`${c} (${tipo})`);
    if (esperadosBase === null) {
      mudouNaRelease = true;
      continue;
    }
    const naBase = esperadosBase.has(c)
      ? normalizar(esperadosBase.get(c))
      : null;
    if (naBase !== noSha) mudouNaRelease = true;
  }
  if (!divergentes.length) return { estado: "EM_DIA", divergentes };
  return {
    estado: mudouNaRelease ? "NAO_PRONTA" : "DERIVA_ANTIGA",
    divergentes,
  };
}

// ------------------------------------------------------------------ etapa 3: por loja

async function prontidaoDaLoja(loja, canal, ctx) {
  const {
    sha,
    deps,
    requeridas,
    funcoesDoSha,
    verifyJwt,
    canais,
    agora,
    topo,
  } = ctx;
  const r = {
    ref: loja.ref,
    ledgerLido: false,
    faltamMigrations: [],
    lotes: [],
    funcoes: [],
    problemas: [],
    bancoPronto: false,
  };
  const base = loja.shasServidos.length === 1 ? loja.shasServidos[0] : null;
  if (!base)
    r.problemas.push(
      `base indefinida (a loja serve ${loja.shasServidos.length} SHAs): toda diferença conta como da release`,
    );
  const problemasAntesDoBanco = r.problemas.length;

  // Migrations — 1/2: o que o ledger da loja registra.
  try {
    const aplicadas = versoesAplicadas(await deps.migrationList(loja.ref));
    r.faltamMigrations = requeridas.filter((v) => !aplicadas.has(v));
    r.ledgerLido = true;
  } catch (e) {
    r.problemas.push(`ledger não lido: ${e.message}`);
  }
  // As NOVAS (ausentes do SHA que a loja serve) exigem prova de objetos fresca.
  let novas = requeridas;
  if (base) {
    try {
      const naBase = new Set(
        migrationsDaRelease(await deps.listarMigrationsNoSha(base), {
          migrationsForaDaRelease: [],
        }),
      );
      novas = requeridas.filter((v) => !naBase.has(v));
    } catch (e) {
      r.problemas.push(
        `migrations da base ${base.slice(0, 8)} não lidas: ${e.message}`,
      );
    }
  }
  const lotes = canais.provasDeObjetos ?? [];
  const noLote = (v) => lotes.some((p) => (p.versoes ?? []).includes(v));
  for (const v of novas) {
    if (!noLote(v))
      r.problemas.push(
        `migration nova ${v} sem prova de objetos declarada (canais-de-backend.json provasDeObjetos)`,
      );
  }
  for (const v of r.faltamMigrations) {
    if (!noLote(v))
      r.problemas.push(
        `migration ${v} ausente do ledger e fora de qualquer lote declarado: diagnóstico antes de qualquer apply (nenhum comando automático)`,
      );
  }

  // Migrations — 2/2: cada lote decide o próximo passo seguro (decidirLote).
  const evidencia = async (consulta) => {
    try {
      return await evidenciaDaProva({
        consulta,
        projeto: canal.migrations,
        projetosNoMesmoBanco: canal.projetosNoMesmoBanco ?? [],
        ref: loja.ref,
        sha,
        topo,
        validadeHoras: canais.validadeDaEvidenciaHoras ?? 6,
        agora,
        deps,
      });
    } catch (e) {
      return {
        ok: false,
        estado: "SEM_EVIDENCIA",
        motivo: `não lida: ${e.message}`,
      };
    }
  };
  if (r.ledgerLido) {
    for (const p of lotes) {
      const versoes = (p.versoes ?? []).filter((v) => requeridas.includes(v));
      const faltam = r.faltamMigrations.filter((v) => versoes.includes(v));
      const exigeProva = novas.some((v) => versoes.includes(v));
      if (!versoes.length || (!faltam.length && !exigeProva)) continue;
      const prova = await evidencia(p.consulta);
      const diagnostico = new Map();
      if (faltam.length && prova.estado === "NEGATIVA") {
        for (const c of new Set(
          [
            p.ausenciaConfirmadaPor,
            ...(p.conferenciasAntesDoApply ?? []),
          ].filter(Boolean),
        )) {
          diagnostico.set(c, await evidencia(c));
        }
      }
      const lote = { ...p, versoes };
      const decisao = decidirLote({
        lote,
        faltam,
        exigeProva,
        prova,
        diagnostico,
      });
      r.lotes.push({ consulta: p.consulta, lote, faltam, prova, decisao });
      if (decisao.acao !== "NADA")
        r.problemas.push(
          `lote ${p.consulta} → ${decisao.acao}: ${decisao.motivo}`,
        );
    }
  }
  r.bancoPronto = r.ledgerLido && r.problemas.length === problemasAntesDoBanco;

  // Functions.
  let noAr;
  try {
    noAr = await deps.listarFuncoes(loja.ref);
  } catch (e) {
    r.problemas.push(`functions não listadas: ${e.message}`);
    return r;
  }
  const porNome = new Map(noAr.map((f) => [f.slug, f]));
  for (const nome of funcoesDoSha) {
    const esperadosSha = arquivosEsperados(nome, (c) =>
      deps.lerArquivoNoSha(sha, c),
    );
    const esperadosBase = base
      ? arquivosEsperados(nome, (c) => deps.lerArquivoNoSha(base, c))
      : null;
    const viva = porNome.get(nome);
    if (!viva) {
      const mudou =
        esperadosBase === null ||
        [...esperadosSha].some(
          ([c, v]) =>
            normalizar(esperadosBase.get(c) ?? null) !== normalizar(v),
        ) ||
        esperadosBase.size !== esperadosSha.size;
      r.funcoes.push({
        nome,
        estado: mudou ? "NAO_PRONTA" : "DERIVA_ANTIGA",
        motivo: "não publicada nesta loja",
      });
      continue;
    }
    const esperado = verifyJwt[nome] ?? true;
    if (viva.verify_jwt !== esperado) {
      r.funcoes.push({
        nome,
        estado: "NAO_PRONTA",
        motivo: `verify_jwt ${viva.verify_jwt} no ar, config.toml do SHA diz ${esperado}`,
      });
      continue;
    }
    let baixados;
    try {
      baixados = new Map(
        (await deps.baixarFuncao(loja.ref, nome)).map((a) => [
          a.caminho,
          a.conteudo,
        ]),
      );
    } catch (e) {
      r.funcoes.push({
        nome,
        estado: "NAO_PRONTA",
        motivo: `download falhou: ${e.message}`,
      });
      continue;
    }
    const c = classificarFuncao(baixados, esperadosSha, esperadosBase);
    r.funcoes.push({
      nome,
      estado: c.estado,
      motivo: c.divergentes.length ? c.divergentes.join(", ") : "",
    });
  }
  return r;
}

/**
 * Os comandos do PRÓXIMO passo seguro de uma loja, prontos para colar: o SHA
 * efetivo do topo do ramo (o `expected_sha` que os workflows exigem igual ao
 * commit do run) e os nomes COMPLETOS dos arquivos de migration, nunca
 * marcador. Valores entre aspas (no PowerShell, vírgula solta vira lista).
 * Só um passo por vez: depois de cada run terminar, o ensaio roda de novo e
 * imprime o seguinte — apply e prova nunca saem juntos, porque a prova antes
 * do fim do apply mediria o banco errado.
 *
 * ctx: { ramo, topo (40 hex ou null), topoBancoIgual, topoFunctionsIgual, nomesPorVersao }
 */
export function comandosDeConserto(loja, pront, canal, ctx) {
  const { ramo, topo, topoBancoIgual, topoFunctionsIgual, nomesPorVersao } =
    ctx;
  const quem = `${loja.titulo} (${loja.ref})`;
  if (!topo)
    return [`# ${quem}: sem comandos — o topo de origin/${ramo} não foi lido`];
  const cmds = [];
  const f = (k, v) => `-f "${k}=${v}"`;
  const conferir = (c, extra = []) =>
    [
      `gh workflow run conferir-banco-da-loja.yml --ref "${ramo}"`,
      f("consulta", c),
      f("projeto", canal.migrations),
      f("expected_sha", topo),
      ...extra,
    ].join(" ");
  const pendentes = pront.lotes.filter((l) => l.decisao.acao !== "NADA");
  if (pendentes.length && !topoBancoIgual) {
    cmds.push(
      `# ${quem}: o topo ${topo} tem migrations ou consultas diferentes da release — nenhum comando de banco; publicar a partir de um ramo cujo topo bata com a release`,
    );
  } else {
    for (const l of pendentes) {
      const d = l.decisao;
      if (d.acao === "CONFERIR") {
        cmds.push(
          `# ${quem} — ${l.consulta}: conferência SÓ LEITURA (${d.consultas.join(", ")}); qualquer ok=false PARA e vai ao dono`,
          ...d.consultas.map((c) => conferir(c)),
        );
      } else if (d.acao === "BACKFILL") {
        cmds.push(
          `# ${quem} — grava SÓ o registro do ledger (${l.faltam.join(", ")}): a pré-checagem da ${l.consulta} roda antes de gravar; nenhuma migration é reaplicada`,
          conferir(l.consulta, [
            f("gravar_ledger", l.lote.backfillLedger),
            f("confirmar", "GRAVAR"),
          ]),
        );
      } else if (d.acao === "APLICAR") {
        const nomes = d.versoes.map((v) => nomesPorVersao.get(v));
        if (nomes.some((n) => !n)) {
          cmds.push(
            `# ${quem}: arquivo de migration não achado no SHA para ${d.versoes.filter((_, i) => !nomes[i]).join(", ")} — nenhum apply`,
          );
        } else {
          cmds.push(
            `# ${quem} — aplicar o lote AUSENTE (${d.motivo}); o apply grava o ledger na mesma transação. Depois que ele terminar verde, o ensaio pede a prova ${l.consulta}`,
            [
              `gh workflow run aplicar-migrations.yml --ref "${ramo}"`,
              f("projeto", canal.migrations),
              f("expected_sha", topo),
              f("migracoes", nomes.join(",")),
            ].join(" "),
          );
        }
      } else {
        cmds.push(`# ${quem} — PARADO, sem comando: ${d.motivo}`);
      }
    }
  }
  const naoProntas = pront.funcoes
    .filter((x) => x.estado === "NAO_PRONTA")
    .map((x) => x.nome);
  // O workflow só publica, por este canal, as functions declaradas nele (loja
  // cliente: as cinco financeiras). As outras não ganham comando — o workflow
  // recusaria —, ficam PARADAS pelo nome.
  const publicaveis = new Set(canal.functionsPublicaveis ?? []);
  const fora = naoProntas.filter((n) => !publicaveis.has(n));
  if (fora.length) {
    cmds.push(
      `# ${quem} — PARADO, sem comando: functions ${fora.join(", ")} mudaram na release, mas o canal ${canal.functions} só publica ${[...publicaveis].join(", ") || "(nenhuma declarada)"} — decisão do dono antes de publicar`,
    );
  }
  const funcoes = naoProntas.filter((n) => publicaveis.has(n));
  if (funcoes.length) {
    if (!pront.bancoPronto) {
      cmds.push(
        `# ${quem}: functions ${funcoes.join(", ")} SÓ depois do banco pronto (banco → functions → front); o ensaio seguinte imprime o comando`,
      );
    } else if (!topoFunctionsIgual) {
      cmds.push(
        `# ${quem}: o topo ${topo} tem functions ou config.toml diferentes da release — nenhum comando de functions`,
      );
    } else {
      cmds.push(
        `# ${quem} — functions da release (banco já pronto)`,
        [
          `gh workflow run publicar-functions.yml --ref "${ramo}"`,
          f("projeto", canal.functions),
          f("functions", funcoes.join(",")),
          f("expected_sha", topo),
        ].join(" "),
      );
    }
  }
  return cmds;
}

// ------------------------------------------------------------------ orquestração

export async function publicarRelease(opcoes, deps) {
  const { sha, deploymentId, promover } = opcoes;
  const politica = deps.politica;
  const canais = deps.canais;
  const agora = deps.agora ? deps.agora() : Date.now();
  const bloqueios = [];
  const linhas = [
    "# Publicação central da release",
    "",
    `Release: \`${sha}\` · candidato: \`${deploymentId}\` · ${new Date(agora).toISOString()}`,
    "",
  ];

  // 1. candidato
  const cand = await conferirCandidato({
    sha,
    deploymentId,
    politica,
    vercelApi: deps.vercelApi,
    fetchImpl: deps.fetchImpl,
  });
  linhas.push(
    "## 1. Candidato",
    cand.ok
      ? `OK: ${cand.deployment.url} (READY, produção, codeSha da release)`
      : "BLOQUEADO",
    "",
  );
  for (const p of cand.problemas)
    bloqueios.push({ alvo: `deployment ${deploymentId}`, motivo: p });

  // 2. inventário oficial + identidade/isolamento/canônico antes do promote
  const inventario = await deps.inventariar(politica);
  const { lojas, problemas: probInv } = lojasDoInventario(inventario, politica);
  for (const p of probInv) bloqueios.push({ alvo: "inventário", motivo: p });
  const producaoAnterior = inventario.vercel?.producaoOficial ?? null;
  if (
    typeof producaoAnterior !== "string" ||
    !RE_DEPLOYMENT.test(producaoAnterior)
  ) {
    bloqueios.push({
      alvo: "inventário",
      motivo:
        "produção oficial do projeto não lida (sem ela não há rollback exato)",
    });
  }
  const antes = await deps.conferirFrota(politica, sha, inventario);
  for (const p of problemasAntesDoPromote(antes, sha))
    bloqueios.push({ alvo: "frota (antes do promote)", motivo: p });
  linhas.push(
    "## 2. Inventário oficial (aliases do projeto + ficha do porteiro)",
    `${inventario.dominios?.length ?? 0} endereços; produção oficial antes: \`${producaoAnterior ?? "não lida"}\``,
    "",
    "| Loja | Ref | Endereços | SHA servido | Backend |",
    "|---|---|---|---|---|",
  );
  const semBackend = new Set(
    (politica.lojasSemBackendGerenciado ?? []).map((l) => l.ref),
  );
  for (const l of lojas) {
    const papel = semBackend.has(l.ref)
      ? "teste: só front (política)"
      : canais.canais[l.ref]
        ? `assinante (${canais.canais[l.ref].migrations})`
        : "ASSINANTE SEM CANAL";
    linhas.push(
      `| ${celula(l.titulo)} | ${l.ref} | ${celula(l.dominios.join(", "))} | ${l.shasServidos.map((s) => s.slice(0, 8)).join(", ")} | ${papel} |`,
    );
  }
  linhas.push("");

  // 3. prontidão
  const requeridas = migrationsDaRelease(
    await deps.listarMigrationsNoSha(sha),
    politica,
  );
  const funcoesDoSha = (await deps.listarFuncoesNoSha(sha)).filter(
    (n) =>
      RE_FUNCAO.test(n) &&
      n !== "_shared" &&
      !(canais.funcoesNaoPublicadas ?? []).includes(n),
  );
  const verifyJwt = verifyJwtDoConfig(
    deps.lerArquivoNoSha(sha, "supabase/config.toml"),
  );
  const nomesPorVersao = new Map();
  for (const nome of await deps.listarMigrationsNoSha(sha)) {
    const m = RE_MIGRATION.exec(nome);
    if (m && !nomesPorVersao.has(m[1])) nomesPorVersao.set(m[1], nome);
  }
  // O topo do ramo é o commit que os workflows vão rodar (expected_sha). Os
  // comandos só saem se ele tiver as MESMAS migrations, consultas e functions
  // da release — senão o run aplicaria/publicaria outra coisa.
  const ramo = canais.ramoDaRelease;
  let topo = null;
  try {
    const t = String(await deps.topoDoRamo(ramo)).trim();
    if (!RE_SHA.test(t))
      throw new Error(`resposta inválida "${t.slice(0, 50)}"`);
    topo = t;
  } catch (e) {
    bloqueios.push({
      alvo: `ramo ${ramo}`,
      motivo: `topo de origin/${ramo} não lido (${e.message}): sem comandos de conserto`,
    });
  }
  const consultasDosLotes = [
    ...new Set(
      (canais.provasDeObjetos ?? [])
        .flatMap((p) => [
          p.consulta,
          p.ausenciaConfirmadaPor,
          ...(p.conferenciasAntesDoApply ?? []),
        ])
        .filter(Boolean),
    ),
  ];
  const topoBancoIgual = topo
    ? await deps.arvoreIgual(topo, sha, [
        "supabase/migrations",
        ...consultasDosLotes.map(
          (c) => `scripts/publicacao/consultas/${c}.sql`,
        ),
      ])
    : false;
  const topoFunctionsIgual = topo
    ? await deps.arvoreIgual(topo, sha, [
        "supabase/functions",
        "supabase/config.toml",
      ])
    : false;
  const ctxConserto = {
    ramo,
    topo,
    topoBancoIgual,
    topoFunctionsIgual,
    nomesPorVersao,
  };
  const sobreOTopo = topo
    ? ` (migrations/consultas ${topoBancoIgual ? "iguais" : "DIFERENTES"} e functions ${topoFunctionsIgual ? "iguais" : "DIFERENTES"} às da release)`
    : "";
  linhas.push(
    "## 3. Prontidão das lojas assinantes",
    "",
    `Topo de origin/${ramo}: \`${topo ?? "não lido"}\`${sobreOTopo}`,
    "",
  );
  const consertos = [];
  for (const loja of lojas) {
    if (semBackend.has(loja.ref)) continue;
    const canal = canais.canais[loja.ref];
    if (!canal) {
      bloqueios.push({
        alvo: `${loja.titulo} (${loja.ref})`,
        motivo:
          "loja assinante sem canal de backend: cadastrar o alvo nos workflows e em canais-de-backend.json (ou, se for loja de teste, em politica.json) antes de publicar",
      });
      continue;
    }
    const pront = await prontidaoDaLoja(loja, canal, {
      sha,
      deps,
      requeridas,
      funcoesDoSha,
      verifyJwt,
      canais,
      agora,
      topo,
    });
    const naoProntas = pront.funcoes.filter((f) => f.estado === "NAO_PRONTA");
    const derivas = pront.funcoes.filter((f) => f.estado === "DERIVA_ANTIGA");
    linhas.push(
      `### ${loja.titulo} (${loja.ref})`,
      `- migrations da release: ${requeridas.length}; faltam no ledger: ${!pront.ledgerLido ? "NÃO LIDO" : pront.faltamMigrations.length ? pront.faltamMigrations.join(", ") : "nenhuma"}`,
      ...pront.lotes.map(
        (l) =>
          `- lote ${l.consulta}: ${l.decisao.acao} — prova ${l.prova.estado}: ${l.prova.motivo}`,
      ),
      `- functions: ${pront.funcoes.filter((f) => f.estado === "EM_DIA").length} em dia, ${naoProntas.length} não prontas${naoProntas.length ? ` (${naoProntas.map((f) => `${f.nome}: ${f.motivo}`).join("; ")})` : ""}`,
      ...(derivas.length
        ? [
            `- deriva antiga (não bloqueia esta release): ${derivas.map((f) => `${f.nome} — ${f.motivo}`).join("; ")}`,
          ]
        : []),
      ...pront.problemas.map((p) => `- problema: ${p}`),
      "",
    );
    for (const p of pront.problemas)
      bloqueios.push({ alvo: `${loja.titulo} (${loja.ref})`, motivo: p });
    for (const f of naoProntas)
      bloqueios.push({
        alvo: `${loja.titulo} (${loja.ref})`,
        motivo: `function ${f.nome}: ${f.motivo}`,
      });
    const c = comandosDeConserto(loja, pront, canal, ctxConserto);
    if (c.length) consertos.push(...c, "");
  }

  // 4. portão
  if (bloqueios.length) {
    linhas.push(
      "## 4. BLOQUEADO — o front NÃO foi promovido",
      "",
      "| Alvo | Motivo |",
      "|---|---|",
    );
    for (const b of bloqueios)
      linhas.push(`| ${celula(b.alvo)} | ${celula(b.motivo)} |`);
    if (consertos.length) {
      consertos.push(
        "# quando cada run acima terminar (gh run watch <id>), o ensaio de novo imprime o passo seguinte:",
        `node scripts/frota/publicar-release.mjs --sha ${sha} --deployment ${deploymentId}`,
      );
      linhas.push(
        "",
        "Próximo passo seguro (um por vez; nada aqui reaplica migration já no banco):",
        "```",
        ...consertos,
        "```",
      );
    }
    return {
      codigo: 1,
      relatorio: linhas.join("\n"),
      bloqueios,
      consertos,
      lojas,
      producaoAnterior,
    };
  }
  if (!promover) {
    linhas.push(
      "## 4. PRONTO — nenhum alvo bloqueia",
      "",
      "Para publicar (o mesmo comando, com --promover):",
      "```",
      `node scripts/frota/publicar-release.mjs --sha ${sha} --deployment ${deploymentId} --promover`,
      "```",
    );
    return {
      codigo: 0,
      relatorio: linhas.join("\n"),
      bloqueios,
      lojas,
      producaoAnterior,
    };
  }

  // 5. promover UM front e conferir a frota toda
  linhas.push("## 5. Promoção", "");
  try {
    await deps.promover(deploymentId);
    linhas.push(`vercel promote ${deploymentId}: concluído`);
  } catch (e) {
    linhas.push(
      `vercel promote FALHOU: ${e.message}`,
      "",
      `Conferir o estado com: node scripts/frota/conferir-frota.mjs --sha ${sha} --vercel`,
    );
    return {
      codigo: 1,
      relatorio: linhas.join("\n"),
      bloqueios: [{ alvo: "promote", motivo: e.message }],
      lojas,
      producaoAnterior,
    };
  }
  const pos = await deps.conferirFrota(politica, sha, null);
  const producaoDepois = pos.vercel?.producaoOficial ?? null;
  const ok = pos.ok === true && producaoDepois === deploymentId;
  linhas.push(
    "",
    "## 6. Conferência da frota depois do promote",
    "",
    pos.relatorio ?? "(sem relatório)",
    "",
  );
  if (producaoDepois !== deploymentId)
    linhas.push(
      `Produção oficial depois: \`${producaoDepois}\` (esperado \`${deploymentId}\`).`,
    );
  if (!ok) {
    linhas.push(
      "",
      "**FALHOU.** Se houver LOJA_TROCADA (isolamento), voltar AGORA a frota inteira:",
      "```",
      `vercel rollback ${producaoAnterior} --yes --scope ${politica.projetoVercel?.escopo ?? "<slug do time>"}`,
      "```",
      "Depois de um rollback a atribuição automática de domínios fica desligada até o próximo promote.",
    );
  }
  return {
    codigo: ok ? 0 : 1,
    relatorio: linhas.join("\n"),
    bloqueios: ok
      ? []
      : [{ alvo: "frota", motivo: "conferência pós-promote falhou" }],
    lojas,
    producaoAnterior,
  };
}

// ------------------------------------------------------------------ dependências reais

function rodar(comando, args, opcoes = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      comando,
      args,
      {
        timeout: opcoes.timeout ?? 180000,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        cwd: opcoes.cwd ?? RAIZ,
        env: process.env,
      },
      (erro, stdout, stderr) => {
        if (erro) {
          const linha = String(stderr || "")
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && !/new version|recommend/i.test(l))
            .pop();
          reject(
            new Error(
              `${path.basename(comando)} ${args[0]} falhou${linha ? `: ${linha.slice(0, 200)}` : ""}`,
            ),
          );
          return;
        }
        resolve(String(stdout));
      },
    );
  });
}

/**
 * O `promote` por execFile, sem shell: o CLI resolvido por resolverCliVercel
 * (no Windows, node + vc.js; nunca o vercel.cmd) e argumentos separados. O id
 * passa pelo formato `dpl_…` antes de virar argumento.
 */
export function argumentosDoPromote(cli, id, escopo) {
  if (!RE_DEPLOYMENT.test(String(id)))
    throw new Error(`deployment inválido para promote: ${id}`);
  // --scope = slug do time dono do projeto (politica.projetoVercel.escopo, lido
  // da API em 06/10): o promote não depende de qual conta está ativa no login.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(escopo ?? "")))
    throw new Error(`escopo (slug do time) inválido para promote: ${escopo}`);
  return {
    comando: cli.comando,
    args: [
      ...cli.prefixo,
      "promote",
      id,
      "--yes",
      "--timeout",
      "5m",
      "--scope",
      escopo,
    ],
  };
}

/** Só .exe no Windows: execFile sem shell não roda .cmd (EINVAL); sem .exe, o nome puro. */
function comandoNoWindows(nome) {
  if (process.platform !== "win32") return nome;
  for (const dir of (process.env.PATH ?? process.env.Path ?? "").split(
    path.delimiter,
  )) {
    const c = path.join(dir, `${nome}.exe`);
    if (dir && existsSync(c)) return c;
  }
  return nome;
}

function listarArquivos(dir, base = dir) {
  const saida = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) saida.push(...listarArquivos(p, base));
    else saida.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return saida;
}

/** `git show` síncrono com cache (null = o arquivo não existe naquele SHA). */
function lerNoSha(sha, caminho, cache) {
  const chave = `${sha}:${caminho}`;
  if (cache.has(chave)) return cache.get(chave);
  let conteudo = null;
  try {
    conteudo = execFileSync("git", ["-C", RAIZ, "show", `${sha}:${caminho}`], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    conteudo = null;
  }
  cache.set(chave, conteudo);
  return conteudo;
}

export function dependenciasReais() {
  const politica = lerPolitica();
  const canais = lerCanais();
  const executor = criarExecutorVercel();
  const supabase = comandoNoWindows("supabase");
  const gh = comandoNoWindows("gh");
  const git = (args) => rodar("git", ["-C", RAIZ, ...args]);
  const cache = new Map();
  const cacheRuns = new Map();
  return {
    politica,
    canais,
    fetchImpl: fetch,
    vercelApi: executor,
    inventariar: (p) =>
      inventariar(p, { pedirVercel: true, executorVercel: executor }),
    conferirFrota: (p, sha, inventarioPronto) =>
      conferirFrota(p, {
        sha,
        pedirVercel: true,
        executorVercel: executor,
        ...(inventarioPronto ? { inventarioPronto } : {}),
      }),
    promover: (id) => {
      const { comando, args } = argumentosDoPromote(
        resolverCliVercel(),
        id,
        politica.projetoVercel?.escopo,
      );
      return rodar(comando, args, { timeout: 400000 });
    },
    listarMigrationsNoSha: async (sha) =>
      (await git(["ls-tree", "--name-only", `${sha}:supabase/migrations`]))
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    listarFuncoesNoSha: async (sha) =>
      (await git(["ls-tree", "-d", "--name-only", `${sha}:supabase/functions`]))
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    lerArquivoNoSha: (sha, caminho) => lerNoSha(sha, caminho, cache),
    arvoreIgual: async (a, b, caminhos) => {
      if (!RE_SHA.test(String(a)) || !RE_SHA.test(String(b))) return false;
      try {
        await git(["diff", "--quiet", a, b, "--", ...caminhos]);
        return true;
      } catch {
        return false; // diferença (exit 1) ou commit ausente: sem evidência
      }
    },
    listarRuns: async (workflow) => {
      if (!cacheRuns.has(workflow)) {
        const saida = await rodar(gh, [
          "run",
          "list",
          "--workflow",
          workflow,
          "--limit",
          "100",
          "--json",
          "databaseId,displayTitle,headSha,createdAt,updatedAt,conclusion,status",
        ]);
        cacheRuns.set(workflow, JSON.parse(saida));
      }
      return cacheRuns.get(workflow);
    },
    logDoRun: (id) =>
      rodar(gh, ["run", "view", String(Number(id)), "--log"], {
        timeout: 120000,
      }),
    // SHA do topo do ramo no GitHub (o commit que um `gh workflow run --ref` roda),
    // trazido para o repositório local se faltar, para comparar árvores com a release.
    topoDoRamo: async (ramo) => {
      if (!/^[A-Za-z0-9._/-]+$/.test(ramo))
        throw new Error(`ramo inválido ${ramo}`);
      const linha =
        (await git(["ls-remote", "origin", `refs/heads/${ramo}`]))
          .trim()
          .split(/\s+/)[0] ?? "";
      if (!RE_SHA.test(linha)) throw new Error(`ls-remote sem o ramo ${ramo}`);
      try {
        await git(["cat-file", "-e", `${linha}^{commit}`]);
      } catch {
        await git(["fetch", "--quiet", "--no-tags", "origin", linha]);
      }
      return linha;
    },
    migrationList: async (ref) => {
      if (!RE_REF.test(ref)) throw new Error(`ref inválido ${ref}`);
      const dir = mkdtempSync(path.join(os.tmpdir(), `frota-ledger-${ref}-`));
      mkdirSync(path.join(dir, "supabase", "migrations"), { recursive: true });
      await rodar(
        supabase,
        ["link", "--project-ref", ref, "--workdir", dir, "--password", ""],
        { cwd: dir },
      );
      // `--output-format json` (o `-o json` é ignorado pelo CLI 2.118); o leitor aceita JSON e a tabela.
      return rodar(
        supabase,
        [
          "migration",
          "list",
          "--linked",
          "--workdir",
          dir,
          "--output-format",
          "json",
        ],
        { cwd: dir },
      );
    },
    listarFuncoes: async (ref) => {
      if (!RE_REF.test(ref)) throw new Error(`ref inválido ${ref}`);
      const saida = await rodar(supabase, [
        "functions",
        "list",
        "--project-ref",
        ref,
        "-o",
        "json",
      ]);
      const ini = saida.indexOf("[");
      const fim = saida.lastIndexOf("]");
      if (ini < 0 || fim < ini)
        throw new Error("functions list não devolveu JSON");
      const lista = JSON.parse(saida.slice(ini, fim + 1));
      if (!Array.isArray(lista))
        throw new Error("functions list não é uma lista");
      return lista.map((f) => ({ slug: f.slug, verify_jwt: f.verify_jwt }));
    },
    baixarFuncao: async (ref, nome) => {
      if (!RE_REF.test(ref) || !RE_FUNCAO.test(nome))
        throw new Error("ref ou nome inválido");
      const dir = mkdtempSync(path.join(os.tmpdir(), `frota-fn-${nome}-`));
      mkdirSync(path.join(dir, "supabase"), { recursive: true });
      await rodar(
        supabase,
        ["functions", "download", nome, "--project-ref", ref, "--workdir", dir],
        { cwd: dir },
      );
      const raiz = path.join(dir, "supabase", "functions");
      if (!existsSync(raiz)) return [];
      return listarArquivos(raiz).map((rel) => ({
        caminho: `supabase/functions/${rel}`,
        conteudo: readFileSync(path.join(raiz, rel), "utf8"),
      }));
    },
  };
}

// ------------------------------------------------------------------ CLI

export function lerArgumentos(argv) {
  const a = { sha: null, deployment: null, promover: false, json: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--promover") a.promover = true;
    else if (x === "--sha" || x === "--deployment" || x === "--json") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`${x} exige um valor`);
      a[x.slice(2)] = v;
    } else throw new Error(`argumento desconhecido: ${x}`);
  }
  if (!a.sha || !RE_SHA.test(a.sha.toLowerCase()))
    throw new Error("--sha <40 hex> é obrigatório");
  if (!a.deployment || !RE_DEPLOYMENT.test(a.deployment))
    throw new Error("--deployment <dpl_…> é obrigatório");
  a.sha = a.sha.toLowerCase();
  return a;
}

const USO =
  "Uso: node scripts/frota/publicar-release.mjs --sha <40hex> --deployment <dpl_…> [--promover] [--json <arquivo>]";

export async function main(argv = process.argv.slice(2)) {
  let a;
  try {
    a = lerArgumentos(argv);
  } catch (e) {
    console.error(`${e.message}\n${USO}`);
    return 2;
  }
  const r = await publicarRelease(
    { sha: a.sha, deploymentId: a.deployment, promover: a.promover },
    dependenciasReais(),
  );
  console.log(r.relatorio);
  if (a.json) {
    writeFileSync(
      a.json,
      `${JSON.stringify({ geradoEm: new Date().toISOString(), codigo: r.codigo, bloqueios: r.bloqueios, lojas: r.lojas, producaoAnterior: r.producaoAnterior }, null, 2)}\n`,
    );
  }
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
      console.error(`erro inesperado: ${e.message}`);
      process.exitCode = 2;
    },
  );
}
