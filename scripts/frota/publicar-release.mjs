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
 *      Loja fora do ar POR DECISÃO (L8: adormecida = 503, encerrada = 410, com
 *      o contrato de cabeçalhos do porteiro; ver conferir-frota.mjs) conta como
 *      sondada, não bloqueia e NÃO passa pela prontidão: não recebe esta
 *      release e, ao acordar, recebe tudo. Se for uma de politica.json
 *      lojasQueNuncaDormem (IKCOUS, Savy), BLOQUEIA.
 *   3. PRONTIDÃO de cada loja ASSINANTE ATIVA (todas, menos as de teste
 *      declaradas em politica.json e as fora do ar por decisão):
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
 *   4b. RESERVA DA CADERNETA (politica.json reservaDaCaderneta; `passoDaReserva`):
 *      sem bloqueio, o ensaio só lê a reserva na Global Config e mostra a
 *      diferença; o `--promover` grava ANTES do promote se a lista de lojas
 *      mudou, espera a propagação e só então promove. Gravação que falha (cota
 *      inclusive) ou endereço indeterminado IMPEDE o promote. Com a reserva
 *      configurada, o "/" do candidato também tem de dizer
 *      `x-ikcous-reserva: ligada`. `globalConfigId` null = só avisa.
 *   5. `--promover`: `vercel promote <deployment>` — leva TODOS os domínios de
 *      produção de uma vez, sem rebuild — e roda a conferência da frota com o
 *      SHA: versão, isolamento e destino canônico de cada endereço, e a
 *      produção oficial = o deployment promovido. Falha aqui imprime o
 *      rollback exato (`vercel rollback <produção anterior>`). Loja que estava
 *      fora do ar no inventário e responde ativa depois do promote (acordou no
 *      meio da publicação, sem a prontidão desta release) também reprova, com o
 *      `estado-da-loja.mjs --depois-de-acordar` pronto.
 *
 * QUEM RODA: o dono, no PowerShell, de uma worktree limpa do ramo da release
 * com os CLIs do Supabase, da Vercel e do GitHub (gh) logados. As permissões
 * do projeto negam ao agente `vercel promote`/`rollback`; o ensaio (sem
 * --promover) só lê.
 *
 * Uso:
 *   node scripts/frota/publicar-release.mjs --sha <40hex> --deployment <dpl_…> [--promover] [--json <arquivo>]
 * Saída: 0 = pronto (ensaio) ou publicado e conferido; 1 = bloqueado ou
 * conferência pós-promote falhou; 2 = uso errado; 3 = publicado, mas a
 * conferência pós-promote ficou INCERTA: o único problema foi version.json que
 * tropeçou (rede, tempo esgotado, 5xx) nem depois das novas tentativas da
 * sonda, em endereço cuja página respondeu e que a Vercel diz apontar para o
 * deployment promovido (sem "FALHOU." e sem o rollback: conferir de novo; ver
 * soEnderecosSemResposta). 404, não-JSON, página ou loja sem resposta = 1.
 * Também é 3 quando o que sobra é BANCO DE LOJA FORA DO AR (o porteiro respondeu
 * 503 banco-indisponivel; ver incertezaDepoisDoPromote) E a sonda DIRETA ao banco
 * daquela loja (sondarBancoDaLoja, sem o porteiro) confirma: rede, 5xx ou 540
 * (projeto pausado). Banco que responde à sonda = o defeito é do front novo
 * (FALHOU, rollback); sonda que não roda = FALHOU. Antes do promote, o banco fora
 * BLOQUEIA: a loja não é pulada (voltaria com o front novo sobre o banco velho).
 */

import { execFile, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CABECALHOS_DE_PRIMEIRA_ABERTURA,
  CLASSES_SEM_FALHA,
  ESPERAS_DA_NOVA_TENTATIVA_MS,
  bancoIndisponivel,
  conferirFrota,
  criarExecutorVercel,
  inventariar,
  lerPolitica,
  lojaForaDoAr,
  problemasDoContrato,
  problemasLojasNaoSondadas,
  refDaLojaSondada,
  resolverCliVercel,
  validarVersao,
} from "./conferir-frota.mjs";
import {
  configDaReserva,
  criarVercelApi,
  descreverDiferenca,
  diferenca,
  enderecosIndeterminados,
  gravarReserva,
  lerReservaAtual,
  mesmaListaDeLojas,
  montarReserva,
  problemasDaReserva,
  problemasDosIndeterminados,
} from "./reserva-da-caderneta.mjs";

const require = createRequire(import.meta.url);
const {
  sincronizar: blocosDoCadastroNoWorkflow,
} = require("./lojas-nos-workflows.cjs");
const { validarCadastro } = require("./lojas.cjs");

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..");
const RE_SHA = /^[0-9a-f]{40}$/;
const RE_DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/;
const RE_REF = /^[a-z]{20}$/;
const RE_MIGRATION = /^(\d{13,14})_[^/]+\.sql$/;
const RE_FUNCAO = /^[a-z0-9][a-z0-9_-]*$/;
const RE_CONSULTA = /^[0-9a-z][0-9a-z-]*$/;
/** Classes da conferência da frota que podem existir ANTES do promote. */
const CLASSES_ACEITAS_ANTES = new Set([
  "OK",
  "ENDERECO_ANTIGO",
  "ADORMECIDA",
  "ENCERRADA",
]);
/** Achados de loja fora do ar por decisão (L8): não bloqueiam a publicação. */
const CLASSES_FORA_DO_AR = new Set(["ADORMECIDA", "ENCERRADA"]);
/** Saída quando o pós-promote só não sabe (endereço sem resposta): nem 0 nem 1. */
export const CODIGO_INCERTO = 3;

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
    if (p.nuncaAplicar !== undefined && typeof p.nuncaAplicar !== "boolean")
      throw new Error(
        `canais-de-backend.json: nuncaAplicar do lote ${p.consulta} precisa ser booleano`,
      );
    // Lote que NUNCA se aplica não carrega o caminho que leva ao apply: a
    // consulta de ausência e as conferências de antes do apply não têm o que
    // fazer ali, e declará-las seria deixar a porta entreaberta.
    if (
      p.nuncaAplicar === true &&
      (p.ausenciaConfirmadaPor !== undefined ||
        (p.conferenciasAntesDoApply ?? []).length > 0)
    )
      throw new Error(
        `canais-de-backend.json: o lote ${p.consulta} é nuncaAplicar e não pode declarar ausenciaConfirmadaPor nem conferenciasAntesDoApply`,
      );
    if (p.soNosRefs !== undefined) {
      if (!Array.isArray(p.soNosRefs) || p.soNosRefs.length === 0)
        throw new Error(
          `canais-de-backend.json: soNosRefs do lote ${p.consulta} precisa ser uma lista não vazia`,
        );
      for (const ref of p.soNosRefs) {
        if (!RE_REF.test(ref) || !Object.hasOwn(c.canais ?? {}, ref))
          throw new Error(
            `canais-de-backend.json: soNosRefs do lote ${p.consulta} cita um ref que não é um canal: ${ref}`,
          );
      }
    }
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

/**
 * Confere o deployment candidato. Devolve { ok, deployment, problemas[] }.
 * `exigirReserva` (a reserva da caderneta configurada em politica.json): o
 * "/" do candidato também tem de dizer `x-ikcous-reserva: ligada`.
 */
export async function conferirCandidato({
  sha,
  deploymentId,
  politica,
  vercelApi,
  fetchImpl,
  exigirReserva = false,
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
    // O middleware (porteiro) carrega na borda do candidato? Um GET "/" como o
    // do navegador na 1a abertura tem de voltar com `x-ikcous-porteiro`
    // (qualquer valor: o endereço do candidato nao e uma loja). Sem o
    // cabecalho o middleware nao rodou -- e uma release com o porteiro
    // quebrado derrubaria TODAS as lojas depois da promocao.
    // O selo sozinho nao basta: o 503 `banco-indisponivel` tambem o traz. A
    // caderneta da frota tem de ter RESPONDIDO ao candidato -- `miss` (o
    // endereco do candidato nao e loja, o caso normal) ou `hit`. `erro`
    // (caderneta fora do ar, chave errada), `ausente` (variaveis
    // IKCOUS_FROTA_* faltando) ou sem o cabecalho: promover este deploy
    // derrubaria todas as lojas, que nascem sem ficha no deploy novo.
    try {
      const res = await fetchImpl(`https://${d.url}/?t=${Date.now()}`, {
        cache: "no-store",
        redirect: "manual",
        headers: CABECALHOS_DE_PRIMEIRA_ABERTURA,
        signal: AbortSignal.timeout(15000),
      });
      await res.text();
      const porteiro = res.headers.get("x-ikcous-porteiro");
      const caderneta = res.headers.get("x-ikcous-caderneta");
      const reserva = res.headers.get("x-ikcous-reserva");
      if (!porteiro)
        problemas.push(
          `candidato respondeu a "/" (HTTP ${res.status}) sem x-ikcous-porteiro: o middleware (porteiro) não carregou na borda`,
        );
      else if (caderneta !== "miss" && caderneta !== "hit")
        problemas.push(
          `candidato respondeu a "/" (HTTP ${res.status}, x-ikcous-porteiro ${celula(porteiro)}) ${caderneta === null ? "sem x-ikcous-caderneta" : `com x-ikcous-caderneta=${celula(caderneta)}`}, esperado miss ou hit: a caderneta da frota não respondeu ao candidato (variáveis IKCOUS_FROTA_* erradas ou faltando, ou o banco da caderneta fora do ar); promover este deploy derrubaria todas as lojas`,
        );
      // Reserva configurada: o "não achei" do porteiro diz se o deploy novo
      // enxerga a Global Config (`ligada`). Sem o cabeçalho, ou com outro
      // valor, as lojas ficariam sem a reserva quando a caderneta cair.
      else if (exigirReserva && reserva !== "ligada")
        problemas.push(
          `candidato respondeu a "/" (HTTP ${res.status}, x-ikcous-caderneta ${celula(caderneta)}) ${reserva === null ? "sem x-ikcous-reserva" : `com x-ikcous-reserva=${celula(reserva)}`}, esperado ligada: o deploy novo não enxerga a reserva da caderneta (variável GLOBAL_CONFIG ausente neste deploy, ou a Global Config não conectada em Production); promover este deploy deixaria as lojas sem a reserva se a caderneta cair`,
        );
    } catch (e) {
      problemas.push(`"/" do candidato não lida: ${e.message}`);
    }
  }
  return { ok: problemas.length === 0, deployment: d, problemas };
}

/**
 * A lojista precisa saber o que mudou antes de receber a atualização. Lemos
 * só o arquivo versionado no SHA: uma nota local ainda sem commit não pode
 * liberar a publicação, e o ensaio não cria nem corrige notas por conta própria.
 */
function conferirNotasDaVersao(versao, sha, lerArquivoNoSha) {
  const arquivo = "src/novidades/notas-das-versoes.json";
  const resultado = {
    ok: true,
    versao: versao ?? null,
    arquivo,
    problemas: [],
  };
  const exemplo = JSON.stringify({
    [versao ?? "x.y.z"]: {
      titulo: "Atualização do app",
      novidades: [],
      correcoes: ["Correções de estabilidade."],
      melhorias: [],
    },
  });
  const bloquear = (motivo) => ({
    ...resultado,
    ok: false,
    problemas: [
      `Nota da versão ${versao ?? "não identificada"} em ${arquivo}: ${motivo}. Exemplo mínimo aceito: ${exemplo}`,
    ],
  });
  // codeVersion já passou pelo contrato do candidato: é o núcleo x.y.z,
  // sem os sufixos de SHA e identidade da versão completa do build.
  if (!versao)
    return bloquear("a versão não pôde ser identificada no candidato validado");
  let fonte;
  try {
    fonte = lerArquivoNoSha(sha, arquivo);
  } catch {
    return bloquear("arquivo não pôde ser lido no SHA da release");
  }
  if (fonte === null || fonte === undefined)
    return bloquear("arquivo ausente ou não pôde ser lido no SHA da release");
  let notas;
  try {
    notas = JSON.parse(fonte);
  } catch {
    return bloquear("JSON inválido");
  }
  if (!notas || typeof notas !== "object" || Array.isArray(notas))
    return bloquear("o JSON precisa ser um objeto com as notas por versão");
  if (!Object.hasOwn(notas, versao))
    return bloquear("entrada ausente para esta versão");
  const nota = notas[versao];
  if (!nota || typeof nota !== "object" || Array.isArray(nota))
    return bloquear("a entrada da versão precisa ser um objeto");
  const textoPreenchido = (texto) =>
    typeof texto === "string" && texto.trim().length > 0;
  if (!textoPreenchido(nota.titulo))
    return bloquear("falta titulo com texto não vazio");
  let itens = 0;
  for (const campo of ["novidades", "correcoes", "melhorias"]) {
    if (!Array.isArray(nota[campo]) || !nota[campo].every(textoPreenchido))
      return bloquear(`${campo} precisa ser uma lista de textos não vazios`);
    itens += nota[campo].length;
  }
  if (!itens)
    return bloquear(
      "falta ao menos um item em novidades, correcoes ou melhorias",
    );
  return resultado;
}

// ------------------------------------------------------------------ etapa 2

/**
 * Agrupa o inventário em lojas pelo ref Supabase da ficha servida pelo
 * porteiro. Endereço esperado sem loja (manutenção/redirecionamento) fica fora.
 * Loja fora do ar por decisão (contrato provado por `lojaForaDoAr`) vai para
 * `foraDoAr` [{ref, estado, dominios}] e não para `lojas`. Endereço com o banco
 * da loja fora do ar (503 banco-indisponivel do porteiro, `bancoIndisponivel`)
 * vai para `bancoFora` [dominio]: o 503 não diz de qual loja ele é, e quem
 * publica o BLOQUEIA com o motivo certo. Endereço que não é esperado e não tem
 * ficha de loja legível é problema, e a mesma loja ativa num endereço e fora do
 * ar em outro (ou com dois estados) também.
 */
export function lojasDoInventario(inventario, politica) {
  const esperados = new Set(politica.enderecosEsperados.map((e) => e.dominio));
  const lojas = new Map();
  const paradas = new Map();
  const bancoFora = [];
  // ref -> chave publicável que a ficha serve a todo visitante (só para a sonda
  // direta ao banco depois do promote). Fora de `lojas` de propósito: `lojas`
  // vai para o relatório e para o --json, e a chave não sai em nenhum dos dois.
  const chavesPorRef = new Map();
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
    const fora = lojaForaDoAr(sonda);
    if (fora) {
      if (!paradas.has(fora.ref))
        paradas.set(fora.ref, {
          ref: fora.ref,
          estados: new Set(),
          dominios: [],
        });
      const parada = paradas.get(fora.ref);
      parada.estados.add(fora.estado);
      parada.dominios.push(sonda.dominio);
      continue;
    }
    if (bancoIndisponivel(sonda)) {
      bancoFora.push(sonda.dominio);
      continue;
    }
    const ref = refDaLojaSondada(f);
    if (ref === null) {
      problemas.push(
        `${sonda.dominio}: não é loja legível (status ${f?.status ?? "-"}, caderneta ${f?.caderneta ?? "-"}, refs ${(f?.refs ?? []).join(",") || "-"}${f?.estavel === false ? ", amostras divergentes" : ""})`,
      );
      continue;
    }
    if (!lojas.has(ref))
      lojas.set(ref, {
        ref,
        titulos: new Set(),
        dominios: [],
        shasServidos: new Set(),
      });
    const loja = lojas.get(ref);
    loja.dominios.push(sonda.dominio);
    if (typeof sonda.chavePublica === "string" && !chavesPorRef.has(ref))
      chavesPorRef.set(ref, sonda.chavePublica);
    if (f.titulo) loja.titulos.add(f.titulo);
    if (sonda.versao?.codeSha) loja.shasServidos.add(sonda.versao.codeSha);
  }
  for (const p of paradas.values()) {
    p.dominios.sort();
    if (p.estados.size > 1)
      problemas.push(
        `a loja ${p.ref} responde ${[...p.estados].sort().join(" e ")} em endereços diferentes (${p.dominios.join(", ")}): repetir a conferência; persistindo, conferir frota_lojas.estado`,
      );
    if (lojas.has(p.ref))
      problemas.push(
        `a loja ${p.ref} está ativa em ${lojas.get(p.ref).dominios.sort().join(", ")} e ${[...p.estados].join("/")} em ${p.dominios.join(", ")}: repetir a conferência; persistindo, conferir frota_lojas.estado`,
      );
  }
  return {
    lojas: [...lojas.values()].map((l) => ({
      ref: l.ref,
      titulo: [...l.titulos].join(" / "),
      dominios: l.dominios.sort(),
      shasServidos: [...l.shasServidos],
    })),
    foraDoAr: [...paradas.values()]
      .filter((p) => p.estados.size === 1 && !lojas.has(p.ref))
      .map((p) => ({
        ref: p.ref,
        estado: [...p.estados][0],
        dominios: p.dominios,
      })),
    bancoFora: bancoFora.sort(),
    chavesPorRef,
    problemas,
  };
}

/** HTTP que o gateway do Supabase devolve para projeto PAUSADO (medido em 26/11/2026). */
export const HTTP_PROJETO_PAUSADO = 540;
const RE_URL_DO_BANCO = /^https:\/\/[a-z]{20}\.supabase\.co$/;

/**
 * Pergunta ao banco da loja, DIRETO (sem o porteiro), se ele está no ar: GET
 * `<supabaseUrl>/rest/v1/v_store_config?select=dominio_publico&id=eq.1` com a
 * chave publicável (a mesma que a ficha serve a todo visitante; só leitura).
 * Devolve { estado, detalhe }:
 *  - "fora": erro de rede/tempo esgotado ou HTTP 5xx — 540 (projeto pausado) e
 *    503 inclusive — também na nova tentativa (no máximo 1);
 *  - "no-ar": qualquer outra resposta (200, 4xx): o banco respondeu;
 *  - "nao-rodou": sem supabaseUrl https://<ref>.supabase.co ou sem chave.
 * O `detalhe` nunca leva a chave nem a mensagem do erro (só o status ou o tipo).
 * Chave nova (sb_publishable_...) vai só em apikey; a anon antiga (JWT), também
 * em Authorization, como em conferir-frota.mjs (lerTituloNoBanco).
 */
export async function sondarBancoDaLoja(
  supabaseUrl,
  chave,
  { fetchImpl = fetch, timeoutMs = 5000, novasTentativas = 1 } = {},
) {
  if (
    typeof supabaseUrl !== "string" ||
    !RE_URL_DO_BANCO.test(supabaseUrl) ||
    typeof chave !== "string" ||
    !chave
  )
    return {
      estado: "nao-rodou",
      detalhe:
        "sem o endereço do banco ou sem a chave publicável na ficha de antes do promote",
    };
  const url = `${supabaseUrl}/rest/v1/v_store_config?select=dominio_publico&id=eq.1`;
  const headers = { apikey: chave, accept: "application/json" };
  if (!chave.startsWith("sb_publishable_"))
    headers.authorization = `Bearer ${chave}`;
  let ultimo = null;
  for (let n = 0; n <= Math.min(1, Math.max(0, novasTentativas)); n++) {
    try {
      const res = await fetchImpl(url, {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      await res.text().catch(() => "");
      if (res.status < 500 || res.status > 599)
        return { estado: "no-ar", detalhe: `HTTP ${res.status}` };
      ultimo = {
        estado: "fora",
        detalhe:
          res.status === HTTP_PROJETO_PAUSADO
            ? `HTTP ${res.status} (projeto pausado)`
            : `HTTP ${res.status}`,
      };
    } catch (e) {
      ultimo = {
        estado: "fora",
        detalhe:
          e?.name === "TimeoutError" || e?.name === "AbortError"
            ? "tempo esgotado"
            : "erro de rede",
      };
    }
  }
  return ultimo;
}

/**
 * Depois do promote, para cada endereço com 503 banco-indisponivel, a sonda
 * DIRETA ao banco da loja dele (a loja e a chave vêm do inventário de ANTES do
 * promote; uma sonda por banco). Devolve [{ dominio, loja, ref, estado, detalhe }].
 * Endereço sem loja conhecida antes, ou sem a dependência, = "nao-rodou".
 */
export async function provarBancosFora(
  bancoFora,
  lojasAntes,
  chavesPorRef,
  sondarBanco,
) {
  const porRef = new Map();
  const provas = [];
  for (const dominio of bancoFora) {
    const loja = lojasAntes.find((l) => l.dominios.includes(dominio)) ?? null;
    if (!loja || typeof sondarBanco !== "function") {
      provas.push({
        dominio,
        loja: loja?.titulo ?? null,
        ref: loja?.ref ?? null,
        estado: "nao-rodou",
        detalhe: loja
          ? "a sonda do banco não está disponível"
          : "o endereço não era de nenhuma loja antes do promote",
      });
      continue;
    }
    if (!porRef.has(loja.ref))
      porRef.set(
        loja.ref,
        Promise.resolve()
          .then(() =>
            sondarBanco(
              `https://${loja.ref}.supabase.co`,
              chavesPorRef?.get(loja.ref) ?? null,
            ),
          )
          .catch(() => ({
            estado: "nao-rodou",
            detalhe: "a sonda do banco falhou ao rodar",
          })),
      );
    const r = await porRef.get(loja.ref);
    provas.push({
      dominio,
      loja: loja.titulo || loja.ref,
      ref: loja.ref,
      estado: r?.estado ?? "nao-rodou",
      detalhe: String(r?.detalhe ?? "sem resposta da sonda"),
    });
  }
  return provas;
}

/** O bloqueio de UM endereço com o banco da loja fora do ar, antes do promote. */
export function motivoDoBancoForaAntes(dominio) {
  return `o banco da loja em ${dominio} está fora do ar (pausado pelo Supabase ou incidente): o porteiro respondeu 503 banco-indisponivel. A loja NÃO é pulada: ela voltaria com o front novo sobre o banco velho. Saídas: (1) restaurar o projeto ("Restore project" no painel do Supabase; para loja OAuth, \`node scripts/frota/acordar-projeto.mjs\`) e rodar o ensaio de novo; (2) só se a loja NÃO for a IKCOUS nem a Savy, adormecê-la pela caderneta (\`node scripts/frota/estado-da-loja.mjs --adormecer ...\`, decisão do sócio) e rodar o ensaio de novo.`;
}

/**
 * Problemas de identidade/isolamento/canônico/estado ANTES do promote. Decide
 * por ACHADO, nunca pela `classe` resumida: antes do promote quase todo
 * endereço tem ENDERECO_ANTIGO, que é mais grave que CANONICO_INVALIDO,
 * BUILD_DIVERGENTE e ESTADO_INESPERADO na ordem de GRAVIDADE e os esconderia
 * (achado da revisão final, 06/10). Passam só:
 *   - ENDERECO_ANTIGO (o promote existe para isso);
 *   - ADORMECIDA/ENCERRADA (loja fora do ar por decisão, L8);
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
      // Loja fora do ar por decisão (L8): não recebe a release, não bloqueia.
      if (CLASSES_FORA_DO_AR.has(classe)) return false;
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

/**
 * DEPOIS do promote: o ÚNICO problema da conferência é endereço cujo
 * version.json TROPEÇOU (rede, tempo esgotado, 5xx) em todas as novas
 * tentativas da sonda? Devolve esses endereços, em ordem, ou null quando há
 * QUALQUER outro problema ou quando a conferência não traz o que é preciso
 * para provar isso: na dúvida é FALHOU, nunca "incerto" no escuro. Decide por
 * ACHADO, nunca pela `classe` (INALCANCAVEL é mais grave que ENDERECO_ANTIGO e
 * esconderia a versão velha) e pela MARCA de tropeço que a sonda pôs no
 * achado (`tropecouEm`), nunca pelo texto do motivo. Viram FALHOU:
 * - resposta que contradiz (404, index.html no lugar do JSON): `classificar`
 *   também a põe em INALCANCAVEL, mas é release sem version.json ou vitrine
 *   servindo a SPA no caminho — errado, não "não sei";
 * - tropeço da página "/" (o isolamento — LOJA_TROCADA — daquele endereço não
 *   foi conferido) ou da sonda de redirecionamento (o canônico não foi);
 * - loja cadastrada que não foi sondada em NENHUM endereço;
 * - endereço sem resposta que a Vercel não diz apontar para `deploymentId`:
 *   sem version.json, essa é a única prova de que ele serve a release.
 */
export function soEnderecosSemResposta(pos, deploymentId) {
  const incerteza = incertezaDepoisDoPromote(pos, deploymentId);
  return incerteza && !incerteza.bancoFora.length
    ? incerteza.semResposta
    : null;
}

/**
 * DEPOIS do promote: o que reprova a conferência é SÓ "não sei", nunca "errado"?
 * Devolve { semResposta, bancoFora } (domínios, em ordem) ou null — e null é
 * FALHOU com o rollback. Cada endereço que reprova tem de apontar (Vercel) para
 * `deploymentId` e ter UMA destas espécies de achado, e nenhuma outra:
 *  - semResposta: só INALCANCAVEL marcado como tropeço do version.json (ver
 *    soEnderecosSemResposta);
 *  - bancoFora: só BANCO_INDISPONIVEL — o porteiro respondeu 503
 *    banco-indisponivel (o banco DA LOJA caiu: projeto pausado ou incidente).
 *    O version.json dele é o da release (senão haveria ENDERECO_ANTIGO), e uma
 *    página 503 sem marca nem ref não mostra loja de ninguém. Voltar a frota não
 *    traz o banco de volta.
 * Loja cadastrada que não apareceu só passa se, ANTES do promote (`lojasAntes`,
 * as lojas do inventário com seus domínios), um endereço dela está agora em
 * `bancoFora`: o 503 não traz ref, e essa é a única prova de quem ele é. Sem
 * `lojasAntes`, loja sumida é FALHOU. Endereço que sumiu do inventário é FALHOU.
 */
export function incertezaDepoisDoPromote(pos, deploymentId, lojasAntes = []) {
  if (pos?.ok === true || !Array.isArray(pos?.resultados)) return null;
  if (typeof deploymentId !== "string" || !deploymentId) return null;
  if (pos.vercel?.ok !== true || pos.inventario?.completo !== true) return null;
  const cobertura = pos.cobertura;
  if (
    !Array.isArray(cobertura?.lojasNaoSondadas) ||
    !Array.isArray(cobertura?.dominiosNaoSondados) ||
    cobertura.dominiosNaoSondados.length
  )
    return null;
  const semResposta = new Set();
  const bancoFora = new Set();
  for (const r of pos.resultados) {
    if (CLASSES_SEM_FALHA.has(r?.classe)) continue;
    const achados = Array.isArray(r?.achados) ? r.achados : [];
    if (!achados.length || r.deploymentId !== deploymentId) return null;
    if (
      r.classe === "INALCANCAVEL" &&
      achados.every(
        (a) => a?.classe === "INALCANCAVEL" && a.tropecouEm === "version.json",
      )
    )
      semResposta.add(r.dominio);
    else if (
      r.classe === "BANCO_INDISPONIVEL" &&
      achados.every((a) => a?.classe === "BANCO_INDISPONIVEL")
    )
      bancoFora.add(r.dominio);
    else return null;
  }
  const antes = Array.isArray(lojasAntes) ? lojasAntes : [];
  for (const loja of cobertura.lojasNaoSondadas) {
    const dela = antes.find((l) => l?.ref === loja?.ref);
    if (
      !Array.isArray(dela?.dominios) ||
      !dela.dominios.some((d) => bancoFora.has(d))
    )
      return null;
  }
  if (!semResposta.size && !bancoFora.size) return null;
  return {
    semResposta: [...semResposta].sort(),
    bancoFora: [...bancoFora].sort(),
  };
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

/**
 * As consultas de ROL FECHADO (a mesma lista que `ROL_FECHADO_POR_CONSULTA` de
 * scripts/publicacao/conferir-banco.cjs; tests/ci_conferir_banco_test.ts prova
 * que as duas listas são iguais). Para elas o veredito só vale como evidência
 * com ` rol=ok`: a resposta foi EXATAMENTE o rol, sem faltar, repetir nem sobrar.
 */
export const CONSULTAS_DE_ROL_FECHADO = new Set([
  "9a-conferir-60-a-66-aplicado",
  "8e-conferir-92-a-202-aplicado",
  "8k-subtotal-divergente-ou-vazia-provada",
  "10a-conferir-cupons-desligados-aplicado",
  "10b-antes-cupons-desligados-gatilho-e-corpo",
  "11a-conferir-anular-venda-presencial-aplicado",
  "11b-antes-anular-venda-presencial-funcao-ausente",
  "12a-conferir-cupom-preso-aplicado",
  "12b-antes-cupom-preso-funcoes-ausentes",
  "14a-conferir-contador-duplicado-apagado",
  "14b-antes-contador-duplicado-coluna-presente-e-zerada",
  "15a-conferir-cupons-do-checkout-aplicado",
  "15b-antes-cupons-do-checkout-pecas-ausentes",
  "16a-conferir-pix-anulado-aplicado",
  "16b-antes-pix-anulado-foto-ausente",
  "17a-conferir-estoque-do-painel-aplicado",
  "17b-antes-estoque-do-painel-corpos-vigentes",
  "19a-conferir-politica-devolucao-aplicado",
  "19b-antes-politica-devolucao-grant-de-tabela",
  "20a-conferir-fotos-da-devolucao-aplicado",
  "20b-antes-fotos-da-devolucao-sem-delete",
  "21a-conferir-teto-de-email-aplicado",
  "21b-antes-teto-de-email-corpos-vigentes",
  "22a-conferir-portas-do-banco-aplicado",
  "22b-antes-portas-do-banco-estado-vigente",
  "23a-conferir-consulta-antiga-de-pedido-fechada",
  "23b-antes-consulta-antiga-de-pedido-aberta",
  "24a-conferir-avaliacoes-fechadas-ao-visitante",
  "24b-antes-avaliacoes-abertas-ao-visitante",
  "25a-conferir-media-de-avaliacoes-so-admin",
  "25b-antes-media-de-avaliacoes-sem-guarda",
  "26a-conferir-voto-util-so-em-avaliacao-publica",
  "26b-antes-voto-util-sem-guarda-de-status",
  "27a-conferir-avaliacao-nasce-sem-resposta-da-loja",
  "27b-antes-avaliacao-aceita-resposta-forjada",
  "30a-conferir-numeros-do-painel-aplicado",
  "30b-antes-numeros-do-painel-corpos-vigentes",
  "33a-conferir-grade-do-crm-aplicado",
  "33b-antes-grade-do-crm-corpo-vigente",
  "31a-conferir-endereco-da-compra-fica-no-pedido",
  "31b-antes-endereco-da-compra-so-no-ponteiro",
  "28a-conferir-reembolso-da-devolucao-so-liberado-com-dinheiro",
  "28b-antes-reembolso-da-devolucao-avisa-liberado-na-conclusao",
  "29a-conferir-reemissao-do-reembolso-consulta-o-mp-antes",
  "29b-antes-reemissao-do-reembolso-base-conhecida",
  "32a-conferir-busca-de-clientes-aplicado",
  "32b-antes-busca-de-clientes-corpos-vigentes",
  "34a-conferir-sino-da-retirada-aplicado",
  "34b-antes-sino-da-retirada-corpo-vigente",
  "35a-conferir-lucro-so-com-custo-aplicado",
  "35b-antes-lucro-so-com-custo-corpo-vigente",
  "36a-conferir-venda-repetida-do-balcao-aplicado",
  "36b-antes-venda-repetida-do-balcao-corpo-vigente",
  "37a-conferir-compra-de-zero-reais-nao-se-paga-pelo-app-aplicado",
  "37b-antes-compra-de-zero-reais-nao-se-paga-pelo-app-corpo-vigente",
  "38a-conferir-gestao-de-categorias-aplicado",
  "38b-antes-gestao-de-categorias-funcoes-ausentes",
  "39a-conferir-pedidos-de-privacidade-aplicado",
  "39b-antes-pedidos-de-privacidade-objetos-ausentes",
  "40a-conferir-identidade-legal-da-loja-aplicado",
  "40b-antes-identidade-legal-da-loja-base-vigente",
  "41a-conferir-pergunta-respondida-avisa-a-cliente-aplicado",
  "41b-antes-pergunta-respondida-corpos-vigentes",
  "43a-conferir-reembolso-em-duvida-aplicado",
  "43b-antes-reembolso-em-duvida-base-vigente",
  "45a-conferir-custo-do-dia-aplicado",
  "45b-antes-custo-do-dia-base-vigente",
  "46a-conferir-desfazer-recebimento-aplicado",
  "46b-antes-desfazer-recebimento-base-vigente",
  "47a-conferir-a-loja-escolhe-como-entrega-aplicado",
  "47b-antes-a-loja-escolhe-como-entrega-base-vigente",
  "48a-conferir-lucro-com-desconto-aplicado",
  "48b-antes-lucro-com-desconto-base-vigente",
  "49a-conferir-lancamento-idempotente-aplicado",
  "49b-antes-lancamento-idempotente-base-vigente",
  "50a-conferir-nota-interna-do-pedido-aplicado",
  "50b-antes-nota-interna-do-pedido-base-vigente",
  "51a-conferir-notes-do-pedido-fechada-aplicado",
  "51b-antes-notes-do-pedido-base-vigente",
  "52a-conferir-motivo-do-balcao-privado-aplicado",
  "52b-antes-motivo-do-balcao-base-vigente",
  "53a-conferir-faturamento-potencial-aplicado",
  "53b-antes-faturamento-potencial-base-vigente",
  "54a-conferir-lucro-do-estoque-aplicado",
  "54b-antes-lucro-do-estoque-base-vigente",
  "55a-conferir-intencao-do-caixa-aplicado",
  "55b-antes-intencao-do-caixa-base-vigente",
  "56a-conferir-motivo-da-recusa-do-cartao-aplicado",
  "56b-antes-motivo-da-recusa-do-cartao-base-vigente",
  "57a-conferir-pagamento-adiantado-e-estorno-aplicado",
  "57b-antes-pagamento-adiantado-e-estorno-base-vigente",
  "58a-conferir-total-do-balcao-aplicado",
  "58b-antes-total-do-balcao-base-vigente",
  "59a-conferir-online-sem-forma-aplicado",
  "59b-antes-online-sem-forma-base-vigente",
  "60a-conferir-estilo-card-frete-aplicado",
  "60b-antes-estilo-card-frete-base-vigente",
  "68a-conferir-avanco-status-esperado-aplicado",
  "68b-antes-avanco-status-esperado",
  "67a-conferir-reembolso-manual-reserva-aplicado",
  "67b-antes-reembolso-manual-reserva",
  "61a-conferir-icones-das-categorias-aplicado",
  "61b-antes-icones-das-categorias",
  "62a-conferir-mototaxi-aplicado",
  "62b-antes-mototaxi-ausente",
  "64a-conferir-politicas-de-perfil-e-endereco-aplicado",
  "64b-antes-politicas-de-perfil-e-endereco-is-admin",
  "65a-conferir-codigo-do-convidado-trava-a-linha-aplicado",
  "65b-antes-codigo-do-convidado-corpo-da-1217",
  "66a-conferir-rastreio-do-convidado-sem-nota-aplicado",
  "66b-antes-rastreio-do-convidado-corpo-da-1341",
  "74a-conferir-codigo-de-barras-entre-tabelas-aplicado",
  "74b-antes-codigo-de-barras-entre-tabelas-ausente",
  "63a-conferir-forma-do-icone-aplicado",
  "63b-antes-forma-do-icone-ausente",
  "80a-conferir-pedido-entregue-na-reconciliacao-aplicado",
  "80b-antes-pedido-entregue-na-reconciliacao-base-vigente",
  "81a-conferir-compra-online-trava-preco-e-chave-aplicado",
  "81b-antes-compra-online-trava-preco-e-chave-base-vigente",
  "82a-conferir-ex-admin-sem-acesso-nas-demais-tabelas",
  "82b-antes-ex-admin-nas-demais-tabelas",
  "83a-conferir-caixa-so-na-conta-da-loja-aplicado",
  "83b-antes-caixa-so-na-conta-da-loja-base-vigente",
  "84a-conferir-produto-com-grade-aplicado",
  "84b-antes-produto-com-grade-ausente",
  "85a-conferir-aviso-de-cancelados-antigos-aplicado",
  "85b-antes-aviso-de-cancelados-antigos-base-vigente",
  "86a-conferir-ex-admin-no-resto-do-painel-aplicado",
  "86b-antes-ex-admin-no-resto-do-painel-base-vigente",
  "87a-conferir-resultado-mostra-tarifa-juro-e-quebra-como-despesa-aplicado",
  "87b-antes-resultado-mostra-tarifa-juro-e-quebra-como-despesa-base-vigente",
  "88a-conferir-so-o-dono-define-cargo-aplicado",
  "88b-antes-so-o-dono-define-cargo-ausente",
  "89a-conferir-o-pedido-pelo-app-exige-conta-aplicado",
  "89b-antes-o-pedido-pelo-app-exige-conta-base-vigente",
  "90a-conferir-busca-do-painel-por-codigo-aplicado",
  "90b-antes-busca-do-painel-por-codigo-base-vigente",
  "91a-conferir-o-preco-do-produto-deixa-historico-aplicado",
  "91b-antes-o-preco-do-produto-deixa-historico-ausente",
  "92a-conferir-a-busca-de-pedido-pelo-numero-aplicado",
  "92b-antes-a-busca-de-pedido-pelo-numero-base-vigente",
  "95a-conferir-o-frete-tem-limite-de-cotacoes-aplicado",
  "95b-antes-o-frete-tem-limite-de-cotacoes-ausente",
  "96a-conferir-o-estoque-que-volta-tranca-na-mesma-ordem-aplicado",
  "96b-antes-o-estoque-que-volta-tranca-na-mesma-ordem-base-vigente",
  "97a-conferir-o-lucro-do-inicio-conta-o-mes-inteiro-aplicado",
  "97b-antes-o-lucro-do-inicio-conta-o-mes-inteiro-base-vigente",
  "98a-conferir-a-foto-da-devolucao-e-a-pergunta-tem-teto-aplicado",
  "98b-antes-a-foto-da-devolucao-e-a-pergunta-tem-teto-base-vigente",
  // 99 reservada para a migration de analytics_events, guardada no ramo fix-199-abuso-do-banco ate o dono aprovar.
  "100a-conferir-o-financeiro-descreve-a-venda-do-balcao-aplicado",
  "100b-antes-o-financeiro-descreve-a-venda-do-balcao-base-vigente",
  "101a-conferir-a-lista-de-clientes-nao-repete-ninguem-aplicado",
  "101b-antes-a-lista-de-clientes-nao-repete-ninguem-base-vigente",
  "102a-conferir-a-busca-do-crm-acha-o-numero-com-mais-55-aplicado",
  "102b-antes-a-busca-do-crm-acha-o-numero-com-mais-55-base-vigente",
  "103a-conferir-o-pix-pago-no-ultimo-minuto-nao-perde-o-pedido-aplicado",
  "103b-antes-o-pix-pago-no-ultimo-minuto-nao-perde-o-pedido-base-vigente",
  "104a-conferir-o-balcao-diz-inativo-para-a-variacao-desligada-aplicado",
  "104b-antes-o-balcao-diz-inativo-para-a-variacao-desligada-base-vigente",
  "106a-conferir-o-pedido-de-visitante-na-entrega-tem-freio-aplicado",
  "106b-antes-o-pedido-de-visitante-na-entrega-tem-freio-base-vigente",
  "107a-conferir-a-lista-de-recomendacoes-do-produto-tem-teto-aplicado",
  "107b-antes-a-lista-de-recomendacoes-do-produto-tem-teto-base-vigente",
  "108a-conferir-a-busca-de-devolucao-acha-o-numero-do-pedido-aplicado",
  "108b-antes-a-busca-de-devolucao-acha-o-numero-do-pedido-base-vigente",
  "109a-conferir-a-grade-antiga-nao-ressuscita-variacao-excluida-aplicado",
  "109b-antes-a-grade-antiga-nao-ressuscita-variacao-excluida-base-vigente",
  "110a-conferir-a-conclusao-da-devolucao-tranca-na-mesma-ordem-da-compra-aplicado",
  "110b-antes-a-conclusao-da-devolucao-tranca-na-mesma-ordem-da-compra-base-vigente",
  "111a-conferir-a-v23-recusa-o-pagamento-pelo-app-aplicado",
  "111b-antes-a-v23-recusa-o-pagamento-pelo-app-base-vigente",
  "112a-conferir-cada-conta-tem-no-maximo-10-aparelhos-com-aviso-aplicado",
  "112b-antes-cada-conta-tem-no-maximo-10-aparelhos-com-aviso-ausente",
  "113a-conferir-a-pergunta-nasce-com-a-data-de-agora-aplicado",
  "113b-antes-a-pergunta-nasce-com-a-data-de-agora-ausente",
  "114a-conferir-o-texto-da-avaliacao-tem-teto-no-banco-aplicado",
  "114b-antes-o-texto-da-avaliacao-tem-teto-no-banco-ausente",
  "115a-conferir-o-desconto-do-cupom-e-arredondado-ao-centavo-aplicado",
  "115b-antes-o-desconto-do-cupom-e-arredondado-ao-centavo-base-vigente",
  "116a-conferir-o-inicio-compara-o-mes-anterior-ate-a-mesma-hora-aplicado",
  "116b-antes-o-inicio-compara-o-mes-anterior-ate-a-mesma-hora-base-vigente",
  "117a-conferir-as-visitas-da-loja-contam-pelo-porteiro-aplicado",
  "117b-antes-as-visitas-da-loja-contam-pelo-porteiro-ausente",
  "118a-conferir-o-nome-do-perfil-tem-teto-no-banco-aplicado",
  "118b-antes-o-nome-do-perfil-tem-teto-no-banco-ausente",
  "119a-conferir-a-busca-por-palavras-e-o-estorno-fora-do-vencido-aplicado",
  "119b-antes-a-busca-por-palavras-e-o-estorno-fora-do-vencido-base-vigente",
  "120a-conferir-a-cliente-e-avisada-quando-a-loja-responde-a-avaliacao-aplicado",
  "120b-antes-a-cliente-e-avisada-quando-a-loja-responde-a-avaliacao-base-vigente",
  "121a-conferir-as-estrelas-do-produto-aparecem-na-vitrine-aplicado",
  "121b-antes-as-estrelas-do-produto-aparecem-na-vitrine-ausente",
  "122a-conferir-o-resultado-credita-o-custo-da-devolucao-de-outro-mes-aplicado",
  "122b-antes-o-resultado-credita-o-custo-da-devolucao-de-outro-mes-base-vigente",
  "123a-conferir-o-painel-de-avaliacoes-filtra-o-que-esta-em-moderacao-aplicado",
  "123b-antes-o-painel-de-avaliacoes-filtra-o-que-esta-em-moderacao-base-vigente",
  "124a-conferir-as-recomendacoes-do-produto-contam-o-estoque-das-variacoes-aplicado",
  "124b-antes-as-recomendacoes-do-produto-contam-o-estoque-das-variacoes-base-vigente",
  "125a-conferir-a-busca-de-pedidos-acha-o-telefone-colado-com-o-55-aplicado",
  "125b-antes-a-busca-de-pedidos-acha-o-telefone-colado-com-o-55-base-vigente",
  "126a-conferir-a-busca-de-devolucao-ignora-o-acento-aplicado",
  "126b-antes-a-busca-de-devolucao-ignora-o-acento-base-vigente",
  "127a-conferir-o-sino-do-pedido-vencido-fala-do-vencimento-aplicado",
  "127b-antes-o-sino-do-pedido-vencido-fala-do-vencimento-base-vigente",
  "128a-conferir-o-caixa-e-a-conta-recusam-valor-que-nao-e-numero-aplicado",
  "128b-antes-o-caixa-e-a-conta-recusam-valor-que-nao-e-numero-base-vigente",
  "149a-conferir-o-cadastro-cria-o-perfil-em-toda-loja-aplicado",
  "149b-antes-o-cadastro-cria-o-perfil-em-toda-loja-ausente",
  "150a-conferir-o-pedido-guarda-quem-vai-receber-aplicado",
  "150b-antes-o-pedido-guarda-quem-vai-receber-base-vigente",
  "150c-conferir-a-loja-recebe-o-plano-por-porta-unica-aplicado",
  "150d-antes-a-loja-recebe-o-plano-por-porta-unica-ausente",
  "135a-conferir-o-ranking-de-lucro-desconta-a-devolucao-aplicado",
  "135b-antes-o-ranking-de-lucro-desconta-a-devolucao-base-vigente",
  "140a-conferir-as-listas-do-painel-nao-repetem-ninguem-aplicado",
  "140b-antes-as-listas-do-painel-nao-repetem-ninguem-base-vigente",
  "141a-conferir-o-grafico-do-financeiro-soma-so-as-contas-ativas-aplicado",
  "141b-antes-o-grafico-do-financeiro-soma-so-as-contas-ativas-base-vigente",
  "142a-conferir-o-crm-nao-duplica-o-comprador-com-e-sem-55-aplicado",
  "142b-antes-o-crm-nao-duplica-o-comprador-com-e-sem-55-base-vigente",
  "143a-conferir-repetir-a-devolucao-que-falhou-nao-paga-duas-vezes-aplicado",
  "143b-antes-repetir-a-devolucao-que-falhou-nao-paga-duas-vezes-ausente",
  "146a-conferir-o-item-que-nao-veio-fica-com-a-cliente-no-ranking-de-lucro-aplicado",
  "146b-antes-o-item-que-nao-veio-fica-com-a-cliente-no-ranking-de-lucro-base-vigente",
  "147a-conferir-o-lucro-do-ranking-casa-com-o-financeiro-pedido-a-pedido-aplicado",
  "147b-antes-o-lucro-do-ranking-casa-com-o-financeiro-pedido-a-pedido-base-vigente",
  "148a-conferir-o-painel-de-avaliacoes-filtra-o-que-esta-sem-resposta-aplicado",
  "148b-antes-o-painel-de-avaliacoes-filtra-o-que-esta-sem-resposta-base-vigente",
  "145a-conferir-o-crm-e-a-lista-de-clientes-nao-contam-a-mesma-pessoa-duas-vezes-aplicado",
  "145b-antes-o-crm-e-a-lista-de-clientes-nao-contam-a-mesma-pessoa-duas-vezes-base-vigente",
  "144a-conferir-o-item-que-nao-veio-pode-ser-devolvido-de-novo-aplicado",
  "144b-antes-o-item-que-nao-veio-pode-ser-devolvido-de-novo-base-vigente",
  "129b-antes-o-cancelamento-e-o-avanco-conferem-base-vigente",
  "151a-conferir-o-banner-tem-imagem-propria-no-computador-aplicado",
  "151b-antes-o-banner-tem-imagem-propria-no-computador-ausente",
  "154a-conferir-o-inicio-mostra-o-dinheiro-a-devolver-aplicado",
  "154b-antes-o-inicio-mostra-o-dinheiro-a-devolver-base-vigente",
  "155a-conferir-o-total-comprado-do-cliente-e-o-mesmo-no-crm-na-lista-e-na-ficha-aplicado",
  "155b-antes-o-total-comprado-do-cliente-e-o-mesmo-no-crm-na-lista-e-na-ficha-base-vigente",
  "156a-conferir-a-observacao-da-inspecao-so-a-loja-ve-aplicado",
  "156b-antes-a-observacao-da-inspecao-so-a-loja-ve-base-vigente",
  "157a-conferir-a-devolucao-integral-nao-perde-o-centavo-do-cupom-aplicado",
  "157b-antes-a-devolucao-integral-nao-perde-o-centavo-do-cupom-base-vigente",
  "158a-conferir-cancelar-retirada-pronta-aplicado",
  "158b-antes-cancelar-retirada-pronta-base-vigente",
  "159a-conferir-cancelar-pedido-do-painel-confere-a-etapa-aplicado",
  "159b-antes-cancelar-pedido-do-painel-confere-a-etapa-base-vigente",
  "160a-conferir-o-cupom-que-nao-da-desconto-aplicado",
  "160b-antes-o-cupom-que-nao-da-desconto-base-vigente",
  "161a-conferir-o-custo-do-cancelamento-fica-no-mes-da-volta-aplicado",
  "161b-antes-o-custo-do-cancelamento-fica-no-mes-da-volta-base-vigente",
  "162a-conferir-o-pedido-guarda-o-nome-antigo-da-opcao-aplicado",
  "162b-antes-o-pedido-guarda-o-nome-antigo-da-opcao-base-vigente",
  "163a-conferir-chaves-de-frete-so-o-servidor-aplicado",
  "163b-antes-chaves-de-frete-so-o-servidor-base-vigente",
  "164a-conferir-o-relatorio-de-categorias-sem-produto-aplicado",
  "164b-antes-o-relatorio-de-categorias-sem-produto-base-vigente",
  "165a-conferir-o-nome-publico-da-vitrine-aplicado",
  "165b-antes-o-nome-publico-da-vitrine-base-vigente",
  "166a-conferir-a-lista-do-painel-e-o-rastreio-levam-o-nome-antigo-da-opcao-aplicado",
  "166b-antes-a-lista-do-painel-e-o-rastreio-levam-o-nome-antigo-da-opcao-base-vigente",
  "167a-antes-o-cupom-nao-repete-o-codigo-base-vigente",
  "167b-conferir-o-cupom-nao-repete-o-codigo-aplicado",
  "168a-conferir-o-crm-ignora-reembolso-integral-aplicado",
  "168b-antes-o-crm-ignora-reembolso-integral-base-vigente",
  "180a-conferir-o-cadastro-fiscal-aplicado",
  "180b-antes-o-cadastro-fiscal-ausente",
  "181a-conferir-os-fornecedores-aplicado",
  "181b-antes-os-fornecedores-ausentes",
  "182a-conferir-o-estado-de-vida-da-loja-aplicado",
  "182b-antes-o-estado-de-vida-da-loja-ausente",
  "183a-conferir-a-loja-muda-de-estado-so-pela-porta-aplicado",
  "183b-antes-a-loja-muda-de-estado-so-pela-porta-ausente",
  "184a-conferir-a-caderneta-fecha-para-o-service-role-aplicado",
  "184b-antes-a-caderneta-fecha-para-o-service-role-ausente",
  "186a-conferir-a-caderneta-confere-a-chave-sem-bcrypt-aplicado",
  "186b-antes-a-caderneta-confere-a-chave-sem-bcrypt-ausente",
  "187a-conferir-a-saude-da-reconciliacao-aplicado",
  "187b-antes-a-saude-da-reconciliacao-ausente",
  "188a-conferir-o-livro-de-registro-aplicado",
  "188b-antes-o-livro-de-registro-ausente",
  "191a-conferir-a-loja-nova-nasce-com-a-ficha-aplicado",
  "191b-antes-a-loja-nova-nasce-com-a-ficha-ausente",
  "190a-conferir-a-loja-grande-nao-trava-o-balcao-aplicado",
  "190b-antes-a-loja-grande-nao-trava-o-balcao-ausente",
  "192a-conferir-o-admin-copia-e-apaga-as-fotos-aplicado",
  "192b-antes-o-admin-copia-e-apaga-as-fotos-ausente",
]);

/** Lê a linha VEREDITO-CONSULTA que scripts/publicacao/conferir-banco.cjs imprime. */
export function lerVeredicto(log, consulta) {
  const re =
    /VEREDITO-CONSULTA consulta=(\S+) ref=([a-z]{20}) sha=([0-9a-f]{40}|local) linhas=(\d+) ok_false=(\d+) ok_nao_booleano=(\d+)(?: rol=(ok|invalido))?/g;
  const achados = [];
  for (const m of String(log).matchAll(re)) {
    if (m[1] === consulta) {
      achados.push({
        ref: m[2],
        sha: m[3],
        linhas: Number(m[4]),
        okFalse: Number(m[5]),
        naoBooleano: Number(m[6]),
        ...(m[7] ? { rol: m[7] } : {}),
      });
    }
  }
  return achados.length === 1 ? achados[0] : null; // zero ou ambíguo = sem evidência
}

const FERRAMENTA_DE_CONFERENCIA = "scripts/publicacao/conferir-banco.cjs";
// conferir-banco.cjs faz require("../frota/lojas.cjs"): o leitor do cadastro é
// parte da ferramenta que imprime o veredicto e tem de ser o do topo também.
const LEITOR_DO_CADASTRO = "scripts/frota/lojas.cjs";
const WORKFLOW_DE_CONFERENCIA = ".github/workflows/conferir-banco-da-loja.yml";
const CADASTRO_DE_LOJAS = "scripts/frota/lojas.json";

/**
 * O workflow de conferência do commit do run "é o do topo" mesmo quando o topo
 * só GANHOU lojas no cadastro? Cada loja cadastrada regrava os blocos LOJAS-*
 * do workflow (scripts/frota/lojas-nos-workflows.cjs --escrever), e comparar o
 * arquivo inteiro derrubava a prova de banco de TODAS as lojas a cada loja nova
 * (C6 da caça da frota de 300, 26/11/2026).
 *
 * Em vez de reconhecer o diff por padrão de texto, REFAZ o que o gerador faz e
 * compara bytes, como um build reproduzível: aceita só se
 *   1. toda loja do cadastro do run existe no do topo, IDÊNTICA (loja removida
 *      ou alterada invalida; só acréscimo passa) — com as entradas de cada loja
 *      iguais, toda expressão dos blocos avaliada com `inputs.projeto` de uma
 *      loja antiga dá o mesmo valor nos dois commits;
 *   2. o workflow do topo, com os blocos regerados do cadastro do RUN, é
 *      byte a byte o workflow do run (a diferença mora só dentro dos blocos, e
 *      os blocos do run são exatamente a saída do gerador);
 *   3. o workflow do topo é a saída do gerador para o cadastro do TOPO (nada
 *      escrito à mão dentro de um bloco: sem esta, um passo novo dentro de um
 *      bloco sumiria no item 2).
 * Arquivo ausente, cadastro inválido ou bloco malformado: { ok: false }.
 */
export function workflowSoGanhouLojas({
  ymlDoRun,
  ymlDoTopo,
  lojasDoRun,
  lojasDoTopo,
}) {
  const nao = (motivo) => ({ ok: false, motivo });
  if (typeof ymlDoRun !== "string" || typeof ymlDoTopo !== "string")
    return nao("workflow de conferência ausente num dos commits");
  if (typeof lojasDoRun !== "string" || typeof lojasDoTopo !== "string")
    return nao(`${CADASTRO_DE_LOJAS} ausente num dos commits`);
  let cadRun;
  let cadTopo;
  try {
    cadRun = validarCadastro(JSON.parse(lojasDoRun));
    cadTopo = validarCadastro(JSON.parse(lojasDoTopo));
  } catch (e) {
    return nao(`cadastro de lojas ilegível: ${e.message}`);
  }
  for (const [nome, loja] of Object.entries(cadRun.lojas)) {
    if (!Object.hasOwn(cadTopo.lojas, nome))
      return nao(`loja ${nome} removida do cadastro depois do run`);
    if (JSON.stringify(cadTopo.lojas[nome]) !== JSON.stringify(loja))
      return nao(`loja ${nome} alterada no cadastro depois do run`);
  }
  try {
    if (blocosDoCadastroNoWorkflow(ymlDoTopo, cadRun) !== ymlDoRun)
      return nao("o workflow mudou fora dos blocos gerados do cadastro");
    if (blocosDoCadastroNoWorkflow(ymlDoTopo, cadTopo) !== ymlDoTopo)
      return nao(
        "um bloco gerado do workflow do topo não é o que o gerador escreve para o cadastro",
      );
  } catch (e) {
    return nao(`blocos gerados ilegíveis: ${e.message}`);
  }
  return { ok: true, motivo: null };
}

/** Lê os dois workflows e os dois cadastros (commit do run e topo) e aplica
 * workflowSoGanhouLojas. Qualquer falha de leitura é "não equivale". */
async function workflowDeConferenciaEquivale(deps, shaDoRun, topo) {
  if (typeof deps.lerArquivoNoSha !== "function")
    return { ok: false, motivo: "sem leitor de arquivo no commit" };
  // `git show <sha>:<caminho>`: só SHA completo, nunca texto vindo do GitHub cru
  if (!RE_SHA.test(String(shaDoRun)) || !RE_SHA.test(String(topo)))
    return { ok: false, motivo: "commit do run ou topo sem SHA de 40 hex" };
  try {
    const [ymlDoRun, ymlDoTopo, lojasDoRun, lojasDoTopo] = await Promise.all([
      deps.lerArquivoNoSha(shaDoRun, WORKFLOW_DE_CONFERENCIA),
      deps.lerArquivoNoSha(topo, WORKFLOW_DE_CONFERENCIA),
      deps.lerArquivoNoSha(shaDoRun, CADASTRO_DE_LOJAS),
      deps.lerArquivoNoSha(topo, CADASTRO_DE_LOJAS),
    ]);
    return workflowSoGanhouLojas({
      ymlDoRun,
      ymlDoTopo,
      lojasDoRun,
      lojasDoTopo,
    });
  } catch (e) {
    return { ok: false, motivo: `leitura dos arquivos falhou: ${e.message}` };
  }
}

/**
 * Procura a evidência fresca de UMA consulta numa loja. Devolve
 * { ok, estado, motivo, run }, com estado:
 *   POSITIVA      — todas as linhas ok=true (ok = true);
 *   NEGATIVA      — evidência válida que DIZ ok=false (o banco não está como a
 *                   consulta espera) — é um resultado, não falta de prova;
 *   SEM_EVIDENCIA — qualquer outro caso (sem run, vencido, em execução,
 *                   falhou, outra loja, outro commit, veredicto ausente,
 *                   ambíguo, sem linhas ou com ok não booleano);
 *   JANELA_ESTOUROU — a lista de runs do GitHub não pôde ser lida INTEIRA
 *                   (lerRunsEmFaixas): sem ela nada se afirma, e o lote PARA.
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
  // A janela de runs que a decisão precisa (lerRunsEmFaixas): conferências da
  // validade para cá; applies desde a vida máxima de um run antes dela (um
  // apply criado antes disso não pode ter terminado depois da prova), mais os
  // que ainda não terminaram, de qualquer idade. A folga cobre o relógio daqui
  // diferente do relógio do GitHub.
  const ate = agora + FOLGA_DO_RELOGIO_MS;
  let estouro = null;
  const lerRuns = (workflow, opcoes) =>
    Promise.resolve(deps.listarRuns(workflow, { ...opcoes, ate })).catch(
      (e) => {
        // comUmaRetentativa embrulha a falha da 2ª tentativa num Error novo:
        // o estouro chega como `cause` (rede caiu na 1ª, a 2ª estourou).
        if (
          e?.code !== "JANELA_ESTOUROU" &&
          e?.cause?.code !== "JANELA_ESTOUROU"
        )
          throw e;
        estouro = e;
        return null;
      },
    );
  const estourou = () => ({
    ok: false,
    estado: "JANELA_ESTOUROU",
    motivo: estouro.message,
  });
  // A MAIS NOVA conferência pertinente decide, em qualquer estado: um run
  // antigo verde nunca esconde um mais novo vermelho, cancelado ou em execução.
  const conferencias = await lerRuns("conferir-banco-da-loja.yml", {
    desde: limite - FOLGA_DO_RELOGIO_MS,
  });
  if (!conferencias) return estourou();
  const pertinentes = conferencias
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
  const applies = await lerRuns("aplicar-migrations.yml", {
    desde: limite - VIDA_MAXIMA_DE_UM_RUN_MS - FOLGA_DO_RELOGIO_MS,
    emAndamento: true,
  });
  if (!applies) return estourou();
  const vencedores = applies.filter(
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
  // O workflow pode diferir SÓ pelo que o gerador escreve quando uma loja é
  // cadastrada (workflowDeConferenciaEquivale): loja nova não derruba a prova
  // das que já existiam (C6 da caça da frota de 300, 26/11/2026).
  const ferramentaDifere = (detalhe) =>
    sem(
      `run ${run.databaseId}: a ferramenta de conferência daquele commit difere da do topo do ramo (ou o topo não foi lido)${detalhe ? ` — ${detalhe}` : ""}`,
      run,
    );
  if (!topo) return ferramentaDifere();
  if (
    !(await deps.arvoreIgual(run.headSha, topo, [
      FERRAMENTA_DE_CONFERENCIA,
      LEITOR_DO_CADASTRO,
      WORKFLOW_DE_CONFERENCIA,
    ]))
  ) {
    if (
      !(await deps.arvoreIgual(run.headSha, topo, [
        FERRAMENTA_DE_CONFERENCIA,
        LEITOR_DO_CADASTRO,
      ]))
    )
      return ferramentaDifere();
    const wf = await workflowDeConferenciaEquivale(deps, run.headSha, topo);
    if (!wf.ok) return ferramentaDifere(wf.motivo);
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
  // Consulta de ROL FECHADO: sem o rol exato declarado no veredito, a resposta
  // pode ter sido PARCIAL (os presentes ok=true), repetida, com item
  // desconhecido, coluna errada ou ok não booleano. Formato desconhecido não é
  // evidência: nem POSITIVA nem NEGATIVA, só SEM_EVIDENCIA.
  if (CONSULTAS_DE_ROL_FECHADO.has(consulta) && v.rol !== "ok") {
    return sem(
      `run ${run.databaseId}: ${consulta} é de rol fechado e o veredito não confirma o rol exato (rol=${v.rol ?? "ausente"}) — formato desconhecido não é evidência`,
      run,
    );
  }
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
 *     de antes (8b, 8k) estão ok e o ledger não registra nenhuma versão dele.
 *     Qualquer ok=false do diagnóstico, ou contradição, PARA e vai ao dono.
 *   - prova ou diagnóstico JANELA_ESTOUROU: PARA, sem comando.
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
  // Lista de runs que não coube inteira: nem a prova nem o diagnóstico valem, e
  // pedir conferência nova só engordaria a lista. PARA, sem comando.
  const estouro = [prova, ...diagnostico.values()].find(
    (e) => e?.estado === "JANELA_ESTOUROU",
  );
  if (estouro) {
    return {
      acao: "PARAR",
      motivo: `${estouro.motivo} — o portão não leu todos os runs do GitHub e não decide este lote; conferir de novo não resolve (diagnóstico da leitura com o dono)`,
    };
  }
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
  // NUNCA APLICAR: prova negativa num lote histórico PARA, mesmo que haja
  // diagnóstico que "prove ausência". Esta é a ÚNICA porta que leva ao APLICAR.
  if (lote.nuncaAplicar) {
    return {
      acao: "PARAR",
      motivo: `ledger sem ${lista} e prova ${consulta} negativa (${prova.motivo}): o lote é histórico e NUNCA se aplica (reaplicar é regressivo); o que faltar vira migration nova para a frente, com o dono`,
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

// ------------------------------------------------------------------ etapa 3: paralelo e nova tentativa

/**
 * Quantas lojas a etapa 3 lê ao mesmo tempo. Cada loja custa ~16 comandos
 * (link, migration list, functions list e um download por function), e em
 * série 60 lojas levavam 1 a 2 horas de ensaio (auditoria de escala, 25/11/2026,
 * item B6). 4 é o teto: cada leitura já vai à API do Supabase e do GitHub, e
 * subir sem medir só troca lentidão por erro 429. `deps.lojasEmParalelo` só
 * pode DIMINUIR este número (os testes usam 1 para comparar com o serial).
 */
export const PRONTIDAO_LOJAS_EM_PARALELO = 4;

/** Espera antes da única nova tentativa: o tempo de a rede/API respirar. */
const ESPERA_DA_NOVA_TENTATIVA_MS = 2000;

/**
 * Roda `fn(item, indice)` sobre a lista com no máximo `limite` ao mesmo tempo e
 * devolve os resultados NA ORDEM DA ENTRADA (nunca na ordem em que terminam).
 * Falha FECHADA: se algum item lançar, espera os que já começaram terminarem
 * (nada fica lendo no escuro), não começa os que faltam e relança a PRIMEIRA
 * falha na ordem da entrada — o mesmo erro que o laço em série teria dado.
 */
export async function mapearEmParalelo(itens, limite, fn) {
  const total = itens.length;
  const resultados = new Array(total);
  const falhou = new Array(total).fill(false);
  const erros = new Array(total);
  let proximo = 0;
  let parar = false;
  const trabalhador = async () => {
    while (!parar && proximo < total) {
      const i = proximo++;
      try {
        resultados[i] = await fn(itens[i], i);
      } catch (e) {
        falhou[i] = true;
        erros[i] = e;
        parar = true;
      }
    }
  };
  const quantos = Math.min(Math.max(1, Math.floor(limite) || 1), total);
  await Promise.all(Array.from({ length: quantos }, trabalhador));
  const primeira = falhou.indexOf(true);
  if (primeira >= 0) throw erros[primeira];
  return resultados;
}

// Falha de rede/API que passa sozinha. Conservador de propósito: só entra o que
// é inequivocamente transitório; 401/403/404, "token inválido", projeto sem
// acesso e qualquer erro que não reconheço ficam FORA (repetir não resolve e
// só atrasa o bloqueio).
// Regex LITERAL de propósito (a forma `new RegExp([...].join("|"))` acende
// `security/detect-non-literal-regexp` e a catraca de lint reprova). Quatro grupos:
// códigos de socket, mensagens de rede, tempo esgotado e HTTP 429/502/503/504.
const RE_FALHA_DE_REDE =
  /\b(?:ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|EPIPE)\b|\b(?:socket hang up|connection reset|unexpected EOF|no such host|temporary failure in name resolution|TLS handshake timeout|deadline exceeded)\b|\b(?:timed out|timeout)\b|\b(?:HTTP|status)(?: code)?:?\s+(?:429|50[234])\b/i;

/**
 * O comando que falhou foi por TEMPO ESGOTADO ou por rede/API passageira?
 * `erro` é o do `execFile`: estourar o limite mata o processo com SIGTERM
 * (`killed` e sem `code`); estourar o buffer também mata, mas traz `code`
 * ("ERR_CHILD_PROCESS_STDIO_MAXBUFFER") e NÃO é transitório. `stderr` é o texto
 * que o CLI imprimiu.
 */
export function falhaDeComandoEhTransitoria(erro, stderr) {
  if (!erro) return false;
  if (erro.killed === true && (erro.code === null || erro.code === undefined))
    return true;
  return RE_FALHA_DE_REDE.test(String(stderr ?? ""));
}

/**
 * Roda `fn` e, SÓ se ela falhar com a marca `transitorio === true` (posta por
 * `rodar` quando a falha foi de rede/tempo), repete UMA vez. A segunda falha
 * sobe com o aviso de que já houve nova tentativa (e sem a marca: ninguém acima
 * repete de novo). Erro sem a marca sobe na hora, sem repetir.
 * Só envolve LEITURAS: repetir uma delas não muda nada em lugar nenhum.
 */
export async function comUmaRetentativa(
  fn,
  { esperaMs = ESPERA_DA_NOVA_TENTATIVA_MS } = {},
) {
  try {
    return await fn();
  } catch (e) {
    if (e?.transitorio !== true) throw e;
    if (esperaMs > 0) await new Promise((r) => setTimeout(r, esperaMs));
    try {
      return await fn();
    } catch (e2) {
      throw new Error(
        `${e2?.message ?? String(e2)} (falhou também na nova tentativa)`,
        { cause: e2 },
      );
    }
  }
}

/** As leituras por loja (CLI do Supabase e do GitHub) ganham a nova tentativa. */
function comRetentativaNasLeituras(deps) {
  const esperaMs = deps.esperaDeRetentativaMs;
  const envolver = (f) =>
    typeof f === "function"
      ? (...args) => comUmaRetentativa(() => f.apply(deps, args), { esperaMs })
      : f;
  return {
    ...deps,
    migrationList: envolver(deps.migrationList),
    listarFuncoes: envolver(deps.listarFuncoes),
    baixarFuncao: envolver(deps.baixarFuncao),
    listarRuns: envolver(deps.listarRuns),
    logDoRun: envolver(deps.logDoRun),
  };
}

// ------------------------------------------------------------------ etapa 3: por loja

export async function prontidaoDaLoja(loja, canal, ctx) {
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
  // Lote com `soNosRefs` só existe para esses refs (o 60-66 é só da CAF: a Savy
  // nunca exige a 9a nem cai em PARAR por ela).
  const lotes = (canais.provasDeObjetos ?? []).filter(
    (p) => p.soNosRefs === undefined || p.soNosRefs.includes(loja.ref),
  );
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
      // `ausente` separa a function que FALTA na loja da deriva de uma function
      // presente com conteúdo velho: só a que falta ganha comando de publicar
      // mesmo sem bloquear (loja nova; ver comandosDeConserto).
      r.funcoes.push({
        nome,
        estado: mudou ? "NAO_PRONTA" : "DERIVA_ANTIGA",
        motivo: "não publicada nesta loja",
        ausente: true,
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
      } else if (d.acao === "APLICAR" && l.lote.nuncaAplicar) {
        // Defesa em profundidade: decidirLote já não devolve APLICAR para lote
        // histórico, mas nenhum comando de apply sai dele em hipótese alguma.
        cmds.push(
          `# ${quem} — ${l.consulta}: lote histórico, NUNCA se aplica — sem comando de apply`,
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
  // A function que FALTA na loja e que a release não mudou (DERIVA_ANTIGA com
  // `ausente`) não bloqueia, mas também ganha o comando: sem ele a loja nova
  // nunca recebia as functions. Mesmas travas das não prontas (canal que
  // publica, banco antes, topo igual). A deriva de function PRESENTE continua
  // sem comando.
  const ausentes = pront.funcoes
    .filter((x) => x.estado === "DERIVA_ANTIGA" && x.ausente === true)
    .map((x) => x.nome);
  const ausentesFora = ausentes.filter((n) => !publicaveis.has(n));
  if (ausentesFora.length) {
    cmds.push(
      `# ${quem} — sem comando: functions ${ausentesFora.join(", ")} faltam nesta loja (a release não as mudou; não bloqueiam), mas o canal ${canal.functions} só publica ${[...publicaveis].join(", ") || "(nenhuma declarada)"} — decisão do dono antes de publicar`,
    );
  }
  // Na ordem de pront.funcoes (a do SHA): sem ausentes, a lista é a de antes.
  const aPublicar = new Set([...naoProntas, ...ausentes]);
  const funcoes = pront.funcoes
    .map((x) => x.nome)
    .filter((n) => aPublicar.has(n) && publicaveis.has(n));
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

/**
 * O comando SÓ LEITURA que confere o login de uma loja assinante
 * (.github/workflows/login-da-loja.yml, acao=conferir): endereços, limite de
 * e-mails e quem envia o e-mail. A loja só abre o cadastro para clientes com
 * SIM. Não é passo de conserto do banco (não entra em `comandosDeConserto`, que
 * imprime um passo por vez): sai na prontidão de cada loja, logo depois das
 * functions. `null` sem o topo do ramo — nunca expected_sha vazio.
 */
export function comandoDeConferirLogin(canal, ctx) {
  if (!RE_SHA.test(ctx.topo ?? "")) return null;
  const f = (k, v) => `-f "${k}=${v}"`;
  return [
    `gh workflow run login-da-loja.yml --ref "${ctx.ramo}"`,
    f("projeto", canal.functions),
    f("acao", "conferir"),
    f("expected_sha", ctx.topo),
  ].join(" ");
}

/**
 * O que a prontidão de QUALQUER loja precisa saber da release `sha`, lido uma
 * vez: as migrations exigidas (fora as de politica.migrationsForaDaRelease), as
 * functions publicáveis do SHA, o verify_jwt do config.toml, o nome completo de
 * cada migration por versão e o topo de `canais.ramoDaRelease` (o commit que os
 * workflows de conserto vão rodar), com as duas comparações de árvore que
 * decidem se os comandos de conserto podem sair. Extraído de `publicarRelease`
 * (L8, Lote 4) para o `scripts/frota/estado-da-loja.mjs` conferir UMA loja que
 * acorda contra a release atual com a MESMA régua do portão. Mesma ordem de
 * leituras de antes. `problemas`: o topo não lido (o chamador o trata como
 * bloqueio); qualquer outra falha de leitura sobe como exceção.
 */
export async function contextoDaRelease({ sha, politica, canais, deps }) {
  const problemas = [];
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
    problemas.push({
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
  return {
    requeridas,
    funcoesDoSha,
    verifyJwt,
    nomesPorVersao,
    ramo,
    topo,
    topoBancoIgual,
    topoFunctionsIgual,
    ctxConserto,
    problemas,
  };
}

// ------------------------------------------------------------------ passo 4b: reserva da caderneta

/** Propagação da Global Config (até 10 s, doc da Vercel): grava, espera, promove. */
export const ESPERA_DA_RESERVA_MS = 10000;

/**
 * O passo 4b (PLANO-RESERVA-DA-CADERNETA-26-11, T9), a partir do inventário
 * que o portão JÁ leu. Só roda sem bloqueio nas etapas 1–3. Devolve
 * { linhas, bloqueios }:
 *  - desligada (politica.json globalConfigId null ou sem o bloco): só avisa;
 *  - configuração fora do formato: bloqueia;
 *  - ensaio: SÓ LÊ a store e mostra a diferença; bloqueia o que faria o
 *    --promover recusar (endereço indeterminado, reserva recusada, store não
 *    lida), para o "PRONTO" do ensaio continuar valendo para o --promover;
 *  - --promover: `gravarReserva` (grava só se a LISTA de lojas mudou, relê e
 *    confere); gravada = espera a propagação antes do promote; qualquer outro
 *    desfecho (recusa, falha, cota) bloqueia e o front NÃO é promovido.
 * `lojasObrigatorias` já vem SEM as lojas fora do ar por decisão: a reserva só
 * leva loja ativa (D3), e loja adormecida não pode travar a publicação.
 */
export async function passoDaReserva({
  config,
  inventario,
  politica,
  sha,
  agora,
  lojasObrigatorias,
  promover,
  api,
  esperar,
}) {
  const linhas = ["## 4b. Reserva da caderneta", ""];
  const bloqueios = [];
  const alvo = "reserva da caderneta";
  if (config.globalConfigId === null) {
    linhas.push(
      `AVISO: ${config.motivo ?? "a reserva da caderneta não está configurada."} A publicação segue sem a reserva.`,
      "",
    );
    return { linhas, bloqueios };
  }
  if (!config.configurada) {
    bloqueios.push({
      alvo: "scripts/frota/politica.json",
      motivo: config.motivo,
    });
    linhas.push(`BLOQUEADO: ${config.motivo}`, "");
    return { linhas, bloqueios };
  }
  const nova = montarReserva(inventario, { sha, agora, politica });
  const indeterminados = enderecosIndeterminados(inventario, politica);
  linhas.push(
    `Montada: ${Object.keys(nova.hosts).length} endereços de lojas ativas.`,
  );

  if (!promover) {
    for (const p of [
      ...problemasDosIndeterminados(indeterminados),
      ...problemasDaReserva(nova, { lojasObrigatorias }),
    ])
      bloqueios.push({ alvo, motivo: `o --promover recusaria: ${p}` });
    let atual;
    try {
      atual = await lerReservaAtual(api, config);
    } catch (e) {
      bloqueios.push({
        alvo,
        motivo: `reserva atual não lida (o --promover também não gravaria): ${e.message}`,
      });
      linhas.push("Na store: NÃO LIDA.", "");
      return { linhas, bloqueios };
    }
    linhas.push(
      atual === null
        ? "Na store: nenhuma reserva gravada ainda."
        : "Na store: reserva lida.",
      mesmaListaDeLojas(atual, nova)
        ? "Igual à atual (só a lista de lojas conta): o --promover não gravaria nada."
        : "Diferente da atual: o --promover gravaria a reserva antes de promover.",
      "",
      ...descreverDiferenca(diferenca(atual, nova)),
      "",
    );
    return { linhas, bloqueios };
  }

  const r = await gravarReserva({
    nova,
    api,
    config,
    lojasObrigatorias,
    indeterminados,
  });
  if (r.diferenca) linhas.push("", ...descreverDiferenca(r.diferenca));
  if (r.estado === "igual")
    linhas.push(
      "",
      "Igual à atual (só a lista de lojas conta): nada gravado.",
      "",
    );
  else if (r.estado === "gravada") {
    linhas.push(
      "",
      `Gravada e conferida na releitura. Esperando ${ESPERA_DA_RESERVA_MS / 1000} s para a Global Config propagar antes de promover.`,
      "",
    );
    await esperar(ESPERA_DA_RESERVA_MS);
  } else {
    // Cota tem mensagem e alvo próprios: nada está quebrado, o plano grátis
    // só não aceita mais gravações neste mês.
    const alvoDaFalha =
      r.estado === "cota"
        ? "reserva da caderneta (cota de gravações da Vercel)"
        : alvo;
    for (const m of r.motivos)
      bloqueios.push({
        alvo: alvoDaFalha,
        motivo: `${m}. O front NÃO foi promovido: sem a reserva em dia, uma loja da lista nova ficaria fora do ar se a caderneta cair`,
      });
    linhas.push(`BLOQUEADO (${r.estado}).`, "");
  }
  return { linhas, bloqueios };
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

  // A reserva da caderneta (passo 4b): desligada = politica.json sem a store
  // (globalConfigId null, ou sem o bloco); aí nada a exige.
  const configReserva = configDaReserva(politica);

  // 1. candidato
  const cand = await conferirCandidato({
    sha,
    deploymentId,
    politica,
    vercelApi: deps.vercelApi,
    fetchImpl: deps.fetchImpl,
    exigirReserva: configReserva.globalConfigId !== null,
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

  const notasDaVersao = conferirNotasDaVersao(
    cand.deployment?.codeVersion,
    sha,
    deps.lerArquivoNoSha,
  );
  linhas.push(
    notasDaVersao.ok
      ? `- nota da versão: OK: ${notasDaVersao.versao} em ${notasDaVersao.arquivo}`
      : `- nota da versão: BLOQUEADO: ${notasDaVersao.problemas.join("; ")}`,
    "",
  );
  for (const p of notasDaVersao.problemas)
    bloqueios.push({ alvo: notasDaVersao.arquivo, motivo: p });

  // 2. inventário oficial + identidade/isolamento/canônico antes do promote
  const inventario = await deps.inventariar(politica);
  const {
    lojas,
    foraDoAr,
    bancoFora,
    chavesPorRef,
    problemas: probInv,
  } = lojasDoInventario(inventario, politica);
  const semBackend = new Set(
    (politica.lojasSemBackendGerenciado ?? []).map((l) => l.ref),
  );
  // A lista de aliases pode vir completa segundo a Vercel e ainda omitir uma loja.
  const lojasObrigatorias = Object.entries(canais.canais)
    .filter(([ref]) => !semBackend.has(ref))
    .map(([ref, canal]) => ({ ref, nome: canal.nome }));
  // Loja fora do ar por decisão FOI sondada (a resposta provou quem ela é).
  const refsSondados = new Set([
    ...lojas.map((l) => l.ref),
    ...foraDoAr.map((l) => l.ref),
  ]);
  // Banco da loja fora do ar: BLOQUEIA, endereço por endereço, com o motivo e
  // as saídas. A loja que por isso não apareceu é nomeada junto (o 503 não traz
  // o ref), em vez de "não foi sondada".
  for (const dominio of bancoFora)
    bloqueios.push({
      alvo: `banco da loja em ${dominio}`,
      motivo: motivoDoBancoForaAntes(dominio),
    });
  for (const p of [
    ...probInv,
    ...problemasLojasNaoSondadas(lojasObrigatorias, refsSondados, bancoFora),
  ])
    bloqueios.push({ alvo: "inventário", motivo: p });
  // IKCOUS e Savy nunca dormem: uma delas fora do ar é incidente, não decisão.
  // Sem a lista na política não dá para provar que a loja parada não é uma
  // delas: com loja fora do ar, bloqueia.
  const nuncaDormem = politica.lojasQueNuncaDormem;
  if (foraDoAr.length && !Array.isArray(nuncaDormem))
    bloqueios.push({
      alvo: "scripts/frota/politica.json",
      motivo:
        "há loja fora do ar e a política não tem lojasQueNuncaDormem: sem a lista não há como provar que não é a IKCOUS ou a Savy",
    });
  const refsQueNuncaDormem = new Set(
    (Array.isArray(nuncaDormem) ? nuncaDormem : []).map((l) => l?.ref),
  );
  for (const l of foraDoAr) {
    if (!refsQueNuncaDormem.has(l.ref)) continue;
    bloqueios.push({
      alvo: `${canais.canais[l.ref]?.nome ?? l.ref} (${l.ref})`,
      motivo: `loja de politica.json lojasQueNuncaDormem está ${l.estado} em ${l.dominios.join(", ")}: acordar no cadastro (frota_lojas.estado) antes de publicar`,
    });
  }
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
  const antes = await deps.conferirFrota(politica, sha, inventario, {
    lojasObrigatorias,
  });
  for (const p of problemasAntesDoPromote(antes, sha))
    bloqueios.push({ alvo: "frota (antes do promote)", motivo: p });
  linhas.push(
    "## 2. Inventário oficial (aliases do projeto + ficha do porteiro)",
    `${inventario.dominios?.length ?? 0} endereços; produção oficial antes: \`${producaoAnterior ?? "não lida"}\``,
    "",
    "| Loja | Ref | Endereços | SHA servido | Backend |",
    "|---|---|---|---|---|",
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
  linhas.push(
    "",
    "## Lojas adormecidas/encerradas (não recebem esta release; ao acordar recebem tudo)",
    "",
  );
  if (foraDoAr.length === 0) linhas.push("- nenhuma");
  else {
    linhas.push("| Loja | Ref | Estado | Endereços |", "|---|---|---|---|");
    for (const l of foraDoAr)
      linhas.push(
        `| ${celula(canais.canais[l.ref]?.nome ?? "(sem canal)")} | ${l.ref} | ${l.estado} | ${celula(l.dominios.join(", "))} |`,
      );
  }
  linhas.push("");

  // 3. prontidão
  const {
    requeridas,
    funcoesDoSha,
    verifyJwt,
    ramo,
    topo,
    topoBancoIgual,
    topoFunctionsIgual,
    ctxConserto,
    problemas: problemasDoContexto,
  } = await contextoDaRelease({ sha, politica, canais, deps });
  bloqueios.push(...problemasDoContexto);
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
  // Duas fases, para o resultado ser IGUAL ao do laço em série de antes:
  //  (1) as leituras de cada loja (rede, CLI) rodam em paralelo, até
  //      PRONTIDAO_LOJAS_EM_PARALELO por vez, e não mexem em nada compartilhado
  //      (`prontidaoDaLoja` só devolve o seu registro);
  //  (2) o relatório, os bloqueios e os comandos de conserto são montados
  //      depois, UMA loja por vez, na ordem do inventário.
  // Uma exceção em qualquer loja derruba o portão (fail-closed), como antes.
  const depsDaProntidao = comRetentativaNasLeituras(deps);
  const limiteDeLojas = Math.min(
    PRONTIDAO_LOJAS_EM_PARALELO,
    Number.isInteger(Number(deps.lojasEmParalelo)) &&
      Number(deps.lojasEmParalelo) >= 1
      ? Number(deps.lojasEmParalelo)
      : PRONTIDAO_LOJAS_EM_PARALELO,
  );
  const prontidoes = await mapearEmParalelo(
    lojas,
    limiteDeLojas,
    async (loja) => {
      const canal = semBackend.has(loja.ref) ? null : canais.canais[loja.ref];
      if (!canal) return null;
      return prontidaoDaLoja(loja, canal, {
        sha,
        deps: depsDaProntidao,
        requeridas,
        funcoesDoSha,
        verifyJwt,
        canais,
        agora,
        topo,
      });
    },
  );
  for (const [indice, loja] of lojas.entries()) {
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
    const pront = prontidoes[indice];
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
      comandoDeConferirLogin(canal, ctxConserto)
        ? `- login (só leitura; a loja só abre o cadastro para clientes com SIM): \`${comandoDeConferirLogin(canal, ctxConserto)}\``
        : `- login: sem comando — o topo de origin/${ctxConserto.ramo} não foi lido`,
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
  // Sem bloqueio, o único conserto possível é o de function que FALTA numa loja
  // e que a release não mudou (não bloqueia): os comandos saem aqui, porque a
  // seção 4 só os imprime quando há bloqueio. Quando o bloco só tem linhas
  // "# … sem comando" (canal que não publica, topo diferente), o título não
  // promete comando.
  if (!bloqueios.length && consertos.length) {
    linhas.push(
      `Functions que faltam em loja (NÃO bloqueiam esta release: a release não as mudou). ${consertos.some((l) => l.startsWith("gh ")) ? "Para publicá-las:" : "Nenhuma tem comando de publicar daqui; o motivo:"}`,
      "```",
      ...consertos,
      "```",
      "",
    );
  }

  // 4b. reserva da caderneta: só sem bloqueio (nunca grava para uma release
  // que não vai ao ar). Ensaio só lê; --promover grava ANTES do promote, e o
  // que ele recusar entra nos bloqueios abaixo: o front não é promovido.
  if (!bloqueios.length) {
    const foraDoArRefs = new Set(foraDoAr.map((l) => l.ref));
    const passo = await passoDaReserva({
      config: configReserva,
      inventario,
      politica,
      sha,
      agora,
      lojasObrigatorias: lojasObrigatorias.filter(
        (l) => !foraDoArRefs.has(l.ref),
      ),
      promover,
      api: deps.reservaApi,
      esperar:
        deps.esperar ?? ((ms) => new Promise((ok) => setTimeout(ok, ms))),
    });
    linhas.push(...passo.linhas);
    bloqueios.push(...passo.bloqueios);
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
      notasDaVersao,
      consertos,
      lojas,
      lojasForaDoAr: foraDoAr,
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
      notasDaVersao,
      lojas,
      lojasForaDoAr: foraDoAr,
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
      notasDaVersao,
      lojas,
      lojasForaDoAr: foraDoAr,
      producaoAnterior,
    };
  }
  const pos = await deps.conferirFrota(politica, sha, null, {
    lojasObrigatorias,
    dominiosDeLojasAntes: [...lojas, ...foraDoAr].flatMap(
      (loja) => loja.dominios,
    ),
  });
  const producaoDepois = pos.vercel?.producaoOficial ?? null;
  const ok = pos.ok === true && producaoDepois === deploymentId;
  // Endereço que só não respondeu, ou loja com o BANCO fora do ar, não é prova
  // de release errada: sem "FALHOU." e sem o rollback da frota inteira (que
  // assustava o dono à toa e não traria banco nenhum de volta).
  // O 503 banco-indisponivel SOZINHO não prova que o banco caiu: o porteiro é o
  // middleware DESTE deployment, e um defeito dele (montar a ficha, ler a
  // configuração) dá a mesma resposta. Só vira INCERTO o endereço cujo banco,
  // perguntado DIRETO, está fora (rede, 5xx, 540 = pausado). Banco que responde
  // ou sonda que não roda = FALHOU, com o rollback.
  let incerteza =
    ok || producaoDepois !== deploymentId
      ? null
      : incertezaDepoisDoPromote(pos, deploymentId, lojas);
  const provasDoBanco = incerteza?.bancoFora.length
    ? await provarBancosFora(
        incerteza.bancoFora,
        lojas,
        chavesPorRef,
        deps.sondarBanco,
      )
    : [];
  const bancoNaoProvado = provasDoBanco.filter((p) => p.estado !== "fora");
  if (bancoNaoProvado.length) incerteza = null;
  const incerto = incerteza !== null;
  const acordou = lojasQueAcordaramNaPublicacao(foraDoAr, pos, inventario, sha);
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
  if (incerto) {
    const { semResposta, bancoFora: bancoForaDepois } = incerteza;
    if (semResposta.length)
      linhas.push(
        "",
        `**INCERTO.** O version.json de ${semResposta.length} endereço(s) não respondeu (rede, tempo esgotado ou erro 5xx) nem depois de ${ESPERAS_DA_NOVA_TENTATIVA_MS.length + 1} tentativas: ${semResposta.join(", ")}. A página inicial deles respondeu (isolamento conferido), a Vercel diz que apontam para o deployment promovido, a produção oficial é ele e nenhum outro problema apareceu. Isto sozinho não pede voltar a frota; confira de novo com:`,
      );
    if (bancoForaDepois.length)
      linhas.push(
        "",
        `**INCERTO.** Publicado: o front novo está no ar (a produção oficial é o deployment promovido e o version.json de cada endereço é o da release); ${lojasComBancoFora(bancoForaDepois, lojas).join("; ")} (pausado pelo Supabase ou incidente: o porteiro respondeu 503 banco-indisponivel). Voltar a frota não traz o banco de volta: restaure o banco e rode a conferência de novo ("Restore project" no painel do Supabase; para loja OAuth, \`node scripts/frota/acordar-projeto.mjs\`):`,
      );
    linhas.push(
      "```",
      `node scripts/frota/conferir-frota.mjs --sha ${sha} --vercel`,
      "```",
    );
    if (semResposta.length)
      linhas.push(
        "Se continuarem sem responder, vira falha da conferência: siga a Saida 3 em docs/runbooks/producao-unica-fonte.md.",
      );
    if (bancoForaDepois.length)
      linhas.push(
        `A sonda direta ao banco (sem o porteiro) confirmou o banco fora: ${resumoDasProvas(provasDoBanco)}. Se depois de restaurado o banco a loja continuar com o 503 banco-indisponivel, rode este portão de novo: com o banco respondendo, ele diz FALHOU e o rollback.`,
      );
  } else if (!ok) {
    if (bancoNaoProvado.length)
      linhas.push(
        "",
        `O porteiro respondeu 503 banco-indisponivel, mas a sonda direta ao banco (sem o porteiro) não confirmou banco fora: ${resumoDasProvas(bancoNaoProvado)}. ${bancoNaoProvado.some((p) => p.estado === "no-ar") ? "Onde o banco respondeu, ele está no ar e a causa é o front novo (o porteiro deste deployment não consegue montar a loja)." : ""}${bancoNaoProvado.some((p) => p.estado === "nao-rodou") ? " Onde a sonda direta ao banco não rodou, não há prova de que o banco caiu." : ""}`,
      );
    linhas.push(
      "",
      bancoNaoProvado.some((p) => p.estado === "no-ar")
        ? "**FALHOU.** O front novo não monta a loja com o banco no ar: voltar AGORA a frota inteira:"
        : "**FALHOU.** Se houver LOJA_TROCADA (isolamento), voltar AGORA a frota inteira:",
      "```",
      `vercel rollback ${producaoAnterior} --yes --scope ${politica.projetoVercel?.escopo ?? "<slug do time>"}`,
      "```",
      "Depois de um rollback a atribuição automática de domínios fica desligada até o próximo promote.",
    );
  }
  const bloqueiosDepois =
    ok || incerto
      ? []
      : [{ alvo: "frota", motivo: "conferência pós-promote falhou" }];
  if (acordou.erro || acordou.lojas.length) {
    linhas.push(
      "",
      "## 7. PRIORIDADE ALTA — loja que acordou durante a publicação",
      "",
      "Ela estava fora do ar no inventário, então NÃO passou pela prontidão desta release, e agora responde ativa: pode estar servindo este front com o banco atrasado. Não é caso de rollback da frota: rode, para cada uma, o passo pós-acordar (o id da loja sai do `--ver`):",
      "",
    );
    if (acordou.erro) linhas.push(`- ${acordou.erro}`);
    for (const l of acordou.lojas) {
      const alvo = `${canais.canais[l.ref]?.nome ?? l.ref} (${l.ref})`;
      const comando = comandoDepoisDeAcordarNaPublicacao(l);
      linhas.push(
        `- ${alvo}: estava ${l.estado} e agora responde ativa em ${l.dominios.join(", ")}`,
        "```",
        comando,
        "```",
      );
      bloqueiosDepois.push({
        alvo,
        motivo: `acordou durante a publicação: estava ${l.estado} no inventário e agora responde ativa em ${l.dominios.join(", ")}, sem a prontidão da release ${sha}. Rode: ${comando}`,
      });
    }
    if (acordou.erro)
      bloqueiosDepois.push({ alvo: "frota", motivo: acordou.erro });
  }
  let codigo = 0;
  if (bloqueiosDepois.length) codigo = 1;
  else if (incerto) codigo = CODIGO_INCERTO;
  return {
    codigo,
    relatorio: linhas.join("\n"),
    bloqueios: bloqueiosDepois,
    notasDaVersao,
    lojas,
    lojasForaDoAr: foraDoAr,
    producaoAnterior,
  };
}

/** "Savy (<ref>) em a, b: HTTP 540 (projeto pausado)", uma por banco sondado; nunca a chave. */
function resumoDasProvas(provas) {
  const grupos = new Map();
  for (const p of provas) {
    const chave = `${p.ref ?? "-"}|${p.estado}|${p.detalhe}`;
    if (!grupos.has(chave)) grupos.set(chave, { ...p, dominios: [] });
    grupos.get(chave).dominios.push(p.dominio);
  }
  return [...grupos.values()]
    .map((g) => {
      const quem = g.ref ? `${g.loja ?? g.ref} (${g.ref})` : "sem loja";
      const como =
        g.estado === "fora"
          ? `banco fora, ${g.detalhe}`
          : g.estado === "no-ar"
            ? `o banco respondeu ${g.detalhe}`
            : `sonda direta ao banco não rodou: ${g.detalhe}`;
      return `${quem} em ${g.dominios.sort().join(", ")}: ${como}`;
    })
    .join("; ");
}

/**
 * "a loja Savy (<ref>) está com o banco fora do ar em a, b", uma frase por loja do inventário de ANTES do promote (`lojasAntes`);
 * endereço que não era de loja nenhuma antes sai sozinho ("a loja em x").
 */
function lojasComBancoFora(bancoFora, lojasAntes) {
  const frases = [];
  const restantes = new Set(bancoFora);
  for (const l of lojasAntes) {
    const dominios = l.dominios.filter((d) => restantes.has(d)).sort();
    if (!dominios.length) continue;
    for (const d of dominios) restantes.delete(d);
    frases.push(
      `a loja ${l.titulo || l.ref} (${l.ref}) está com o banco fora do ar em ${dominios.join(", ")}`,
    );
  }
  for (const d of [...restantes].sort())
    frases.push(`a loja em ${d} está com o banco fora do ar`);
  return frases;
}

/**
 * Lojas que estavam fora do ar no inventário (`foraDoAr`) e, na conferência depois do promote, respondem ATIVAS (ficha da própria
 * loja, sem o contrato de fora do ar) em algum endereço. É a corrida em que uma instrução de acordar, impressa para a release
 * anterior, é rodada no meio da publicação: a loja não passou pela prontidão desta release.
 * REDE DE SEGURANÇA SECUNDÁRIA: o porteiro guarda a decisão "fora do ar" por até 60 s, então um acordar recente pode não aparecer
 * aqui. A guarda principal é o `--depois-de-acordar` do estado-da-loja.mjs, obrigatório depois de rodar a instrução de acordar.
 * Devolve { lojas: [{ref, estado, dominios, shaAntes}], erro } — `erro` quando havia loja fora do ar e a conferência não trouxe
 * resultados legíveis (nunca "nenhuma acordou" no escuro). `shaAntes` = a release que os endereços dela serviam no inventário,
 * ou null quando ela não diz qual instrução a acordou (ver o comentário no laço).
 */
export function lojasQueAcordaramNaPublicacao(foraDoAr, pos, inventario, sha) {
  if (!foraDoAr.length) return { lojas: [], erro: null };
  if (!Array.isArray(pos?.resultados))
    return {
      lojas: [],
      erro: `a conferência depois do promote não trouxe os resultados por endereço: não há como saber se ${foraDoAr.map((l) => l.ref).join(", ")} (fora do ar no inventário) acordou durante a publicação`,
    };
  const lojas = [];
  for (const l of foraDoAr) {
    const dominios = pos.resultados
      .filter(
        (r) =>
          !r.esperado && !r.foraDoAr && refDaLojaSondada(r.ficha) === l.ref,
      )
      .map((r) => r.dominio)
      .sort();
    if (!dominios.length) continue;
    // A release que o front servia nos endereços dela no inventário. Só vale como --sha da instrução se for UMA, legível e DIFERENTE
    // da release que está sendo publicada: numa 2ª rodada do --promover (a 1ª promoveu e a conferência falhou) o inventário já serve
    // esta release, mas a instrução rodada no meio pode ter sido impressa para a anterior; sugerir --sha = esta release faria o
    // --depois-de-acordar dizer OK sem conferir nada. Nesse caso, e nos ambíguos, null: o operador preenche com a instrução de verdade.
    const shas = new Set(
      (inventario.sondas ?? [])
        .filter((sonda) => l.dominios.includes(sonda.dominio))
        .map((sonda) => sonda.versao?.codeSha),
    );
    const [shaAntes] = shas;
    lojas.push({
      ref: l.ref,
      estado: l.estado,
      dominios,
      shaAntes:
        shas.size === 1 && RE_SHA.test(String(shaAntes)) && shaAntes !== sha
          ? shaAntes
          : null,
    });
  }
  return { lojas, erro: null };
}

/**
 * O --depois-de-acordar de uma loja que acordou na publicação. Com `shaAntes` (a release servida no inventário, diferente da que se
 * publica), --sha e --base = ela: o estado-da-loja.mjs só imprime instrução para a release em produção, então a da corrida, rodada entre
 * o inventário e o promote, foi impressa para ela. Mesmo que a instrução fosse mais velha, a prontidão para a release atual confere o
 * ledger INTEIRO e todas as functions; só a prova fresca de objetos fica restrita às migrations novas desde a base. Sem `shaAntes`,
 * marcadores: o operador copia --sha e --base da instrução que rodou. O id da loja não está na sondagem (só o ref): sai do --ver.
 */
function comandoDepoisDeAcordarNaPublicacao(l) {
  const sha = l.shaAntes ?? "<--sha da instrução de acordar>";
  return `node scripts/frota/estado-da-loja.mjs --depois-de-acordar --loja "<id da loja, do --ver>" --ref ${l.ref} --sha ${sha} --base ${l.shaAntes ?? "<--base da instrução de acordar>"}`;
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
          const falha = new Error(
            `${path.basename(comando)} ${args[0]} falhou${linha ? `: ${linha.slice(0, 200)}` : ""}`,
          );
          // rede/tempo esgotado: `comUmaRetentativa` repete UMA vez as leituras
          if (falhaDeComandoEhTransitoria(erro, stderr))
            falha.transitorio = true;
          reject(falha);
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

/**
 * Apaga uma pasta criada por mkdtemp nesta leitura (C8 da caça da frota de 300,
 * 26/11/2026: o portão deixava ~14 pastas por loja em cada ensaio, nunca
 * apagadas — 1.457 com 2 lojas, ~4.200 por ensaio com 300). Nada é lido delas
 * depois: migrationList devolve a saída do CLI e baixarFuncao o conteúdo já em
 * memória. Falha ao apagar (arquivo preso pelo antivírus no Windows) não muda o
 * resultado da leitura: sobra a pasta, como antes, e o portão segue.
 */
function apagarPastaTemporaria(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // a pasta fica; a decisão do portão não depende dela
  }
}

/**
 * Quantos runs o GitHub entrega por busca (`gh run list --limit`): 1000 é o
 * TETO da API (com filtro de `created`, `status` ou `head_sha`, "up to 1,000
 * results for each search"). A lista vem do mais novo para o mais antigo e o
 * teto corta o FIM: com ~60 lojas × 8 lotes × 2 provas a prova mais antiga já
 * sai da janela, e um apply antigo AINDA EM EXECUÇÃO sumia da lista e deixava
 * passar a evidência que ele venceu (falha aberta; plano L9, 26/11/2026).
 * Por isso a leitura é em faixas de data (lerRunsEmFaixas), nunca só os 1000
 * mais novos.
 */
export const RUNS_LIDOS_POR_WORKFLOW = 1000;

/**
 * Vida máxima de um run no GitHub (docs.github.com, 26/11/2026): pode ser
 * re-executado até 30 dias depois de criado, e cada run dura no máximo 35
 * dias (o que passar disso é cancelado). Um apply criado antes de
 * (prova − 65 dias) não pode ter rodado depois da prova. Os runs ainda não
 * terminados de antes disso são lidos à parte, pelo estado.
 */
export const VIDA_MAXIMA_DE_UM_RUN_MS = (30 + 35) * 24 * 3600 * 1000;

/** Folga para o relógio desta máquina diferir do relógio do GitHub. */
export const FOLGA_DO_RELOGIO_MS = 3600 * 1000;

/** Estados de um run que ainda não terminou, na ordem do ciclo de vida (lidos
 * nessa ordem: um run que avança de estado entre duas buscas cai na primeira). */
export const ESTADOS_EM_ANDAMENTO = [
  "requested",
  "waiting",
  "pending",
  "queued",
  "in_progress",
];

/** Antes do GitHub Actions existir: a faixa dos não terminados começa aqui. */
const INICIO_DO_GITHUB_ACTIONS_MS = Date.parse("2018-01-01T00:00:00Z");

/** Instante no formato da busca do GitHub (`YYYY-MM-DDTHH:MM:SS+00:00`). */
const instanteDaBusca = (ms) =>
  `${new Date(ms).toISOString().slice(0, 19)}+00:00`;

/** O segundo (em ms) em que o run foi criado: a busca por `created` é por segundo. */
const segundoDoRun = (r) => Math.floor(Date.parse(r?.createdAt) / 1000) * 1000;

function janelaEstourou(motivo) {
  return Object.assign(new Error(`JANELA_ESTOUROU: ${motivo}`), {
    code: "JANELA_ESTOUROU",
  });
}

/**
 * Lê TODOS os runs de um workflow que a decisão precisa, sem o corte de 1000.
 * `buscar({ created?, status? })` faz UMA busca (`gh run list` com o teto de
 * 1000) e devolve o array. Passos:
 *  1. uma busca sem filtro, a mesma de sempre: menos de 1000 = a história
 *     inteira coube, e acabou (nenhum custo extra);
 *  2. senão, a faixa [desde, ate] de `created`, dividida ao meio sempre que
 *     uma busca volta com 1000 (as metades se tocam no segundo do meio: a
 *     busca é inclusiva, e o repetido sai pelo databaseId);
 *  3. a lista sem filtro do passo 1 confere a leitura por faixas: run dela
 *     criado dentro da faixa que as faixas não trouxeram = filtro não confiável;
 *  4. com `emAndamento`, os runs ainda não terminados criados ANTES de
 *     `desde`, um estado por vez (ESTADOS_EM_ANDAMENTO), também em faixas.
 * Falha FECHADA (erro com code JANELA_ESTOUROU, nunca lista cortada): faixa de
 * um segundo ainda com 1000, run fora da faixa pedida (filtro ignorado), run
 * da lista sem filtro faltando nas faixas, ou 1000+ runs sem faixa para dividir.
 * Devolve do mais novo para o mais antigo; um run lido duas vezes fica com a
 * leitura de `updatedAt` mais recente.
 */
export async function lerRunsEmFaixas({
  desde,
  ate,
  emAndamento = false,
  buscar,
}) {
  const semFiltro = await buscar({});
  if (semFiltro.length < RUNS_LIDOS_POR_WORKFLOW) return semFiltro;
  if (!Number.isFinite(desde) || !Number.isFinite(ate) || desde > ate) {
    throw janelaEstourou(
      `${semFiltro.length} runs na busca sem filtro (o teto do GitHub) e nenhuma faixa de datas para dividir`,
    );
  }
  const porId = new Map();
  const guardar = (r) => {
    const antes = porId.get(r.databaseId);
    if (
      !antes ||
      Date.parse(r.updatedAt ?? r.createdAt) >
        Date.parse(antes.updatedAt ?? antes.createdAt)
    )
      porId.set(r.databaseId, r);
  };
  const faixa = async (de, fim, status) => {
    const nome = `${instanteDaBusca(de)}..${instanteDaBusca(fim)}`;
    const runs = await buscar({
      created: nome,
      ...(status ? { status } : {}),
    });
    for (const r of runs) {
      const t = segundoDoRun(r);
      if (!(t >= de && t <= fim)) {
        throw janelaEstourou(
          `o GitHub devolveu o run ${r?.databaseId} (criado ${r?.createdAt}) fora da faixa ${nome}: o filtro por data não foi aplicado`,
        );
      }
      guardar(r);
    }
    if (runs.length < RUNS_LIDOS_POR_WORKFLOW) return;
    if (fim - de <= 1000) {
      throw janelaEstourou(
        `${runs.length} runs${status ? ` ${status}` : ""} criados no mesmo segundo (${nome}): a faixa não divide mais`,
      );
    }
    const meio = de + Math.floor((fim - de) / 2000) * 1000;
    await faixa(de, meio, status);
    await faixa(meio, fim, status);
  };
  const de = Math.floor(desde / 1000) * 1000;
  const fim = Math.ceil(ate / 1000) * 1000;
  await faixa(de, fim);
  for (const r of semFiltro) {
    const t = segundoDoRun(r);
    if (t >= de && t <= fim && !porId.has(r.databaseId)) {
      throw janelaEstourou(
        `a leitura por faixas não trouxe o run ${r.databaseId} (criado ${r.createdAt}) que a lista sem filtro trouxe: o filtro por data não é confiável`,
      );
    }
  }
  for (const r of semFiltro) guardar(r);
  if (emAndamento) {
    for (const status of ESTADOS_EM_ANDAMENTO) {
      await faixa(INICIO_DO_GITHUB_ACTIONS_MS, de, status);
    }
  }
  return [...porId.values()].sort(
    (a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      Number(b.databaseId) - Number(a.databaseId),
  );
}

/**
 * `rodarGh(args, opcoes)` e `rodarSupabase(args, opcoes)` existem só para os
 * testes trocarem o `gh` e o CLI do Supabase por dublês (nunca rede, nunca
 * token); em produção ninguém passa nada e valem os CLIs reais do PATH,
 * exatamente como antes.
 */
export function dependenciasReais({ rodarGh, rodarSupabase } = {}) {
  const politica = lerPolitica();
  const canais = lerCanais();
  const executor = criarExecutorVercel();
  const supabase = comandoNoWindows("supabase");
  const gh = comandoNoWindows("gh");
  const executarGh = rodarGh ?? ((args, opcoes) => rodar(gh, args, opcoes));
  const executarSupabase =
    rodarSupabase ?? ((args, opcoes) => rodar(supabase, args, opcoes));
  const git = (args) => rodar("git", ["-C", RAIZ, ...args]);
  const cache = new Map();
  const cacheRuns = new Map();
  return {
    politica,
    canais,
    fetchImpl: fetch,
    // Só leitura, chave publicável, 5 s, no máximo 1 nova tentativa.
    sondarBanco: (supabaseUrl, chave) => sondarBancoDaLoja(supabaseUrl, chave),
    vercelApi: executor,
    inventariar: (p) =>
      inventariar(p, { pedirVercel: true, executorVercel: executor }),
    conferirFrota: (p, sha, inventarioPronto, cobertura) =>
      conferirFrota(p, {
        ...cobertura,
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
    // Passo 4b: a Global Config pela sessão da CLI vercel logada (D2).
    reservaApi: criarVercelApi(),
    esperar: (ms) => new Promise((ok) => setTimeout(ok, ms)),
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
    // `{ desde, ate, emAndamento }` é a janela que a decisão precisa (ms):
    // lerRunsEmFaixas lê tudo dela, sem o corte de 1000 do GitHub.
    listarRuns: async (workflow, { desde, ate, emAndamento = false } = {}) => {
      // O cache guarda a PROMESSA (não o resultado): com várias lojas lendo ao
      // mesmo tempo, quem chega depois espera a mesma leitura em vez de abrir
      // outra `gh run list`. Falha não fica guardada: a nova tentativa lê de novo.
      const chave = JSON.stringify([
        workflow,
        desde ?? null,
        ate ?? null,
        emAndamento,
      ]);
      if (!cacheRuns.has(chave)) {
        const buscar = async ({ created, status } = {}) =>
          JSON.parse(
            await executarGh([
              "run",
              "list",
              "--workflow",
              workflow,
              ...(created ? ["--created", created] : []),
              ...(status ? ["--status", status] : []),
              "--limit",
              String(RUNS_LIDOS_POR_WORKFLOW),
              "--json",
              "databaseId,displayTitle,headSha,createdAt,updatedAt,conclusion,status",
            ]),
          );
        const lida = lerRunsEmFaixas({ desde, ate, emAndamento, buscar });
        cacheRuns.set(chave, lida);
        // O estouro FICA no cache: a mesma janela estoura igual, e reler para
        // cada loja de cada lote esgotaria a cota do token. Falha de rede sai.
        lida.catch((e) => {
          if (e?.code !== "JANELA_ESTOUROU" && cacheRuns.get(chave) === lida)
            cacheRuns.delete(chave);
        });
      }
      return cacheRuns.get(chave);
    },
    logDoRun: (id) =>
      executarGh(["run", "view", String(Number(id)), "--log"], {
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
      try {
        mkdirSync(path.join(dir, "supabase", "migrations"), {
          recursive: true,
        });
        await executarSupabase(
          ["link", "--project-ref", ref, "--workdir", dir, "--password", ""],
          { cwd: dir },
        );
        // `--output-format json` (o `-o json` é ignorado pelo CLI 2.118); o leitor aceita JSON e a tabela.
        // `return await`: sem o await, o finally apagaria a pasta com o CLI ainda rodando nela.
        return await executarSupabase(
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
      } finally {
        apagarPastaTemporaria(dir);
      }
    },
    listarFuncoes: async (ref) => {
      if (!RE_REF.test(ref)) throw new Error(`ref inválido ${ref}`);
      const saida = await executarSupabase([
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
      try {
        mkdirSync(path.join(dir, "supabase"), { recursive: true });
        // `--use-api`: o `download` padrão (eszip extraído no Docker) passou a
        // devolver o bundle TRANSPILADO (tipos apagados, código reformatado) e
        // acusava "difere" em TODA function, até nas que a release não tocou
        // (07/11/2026, release 1.5.153). Pela API sai o fonte que foi publicado.
        await executarSupabase(
          [
            "functions",
            "download",
            nome,
            "--project-ref",
            ref,
            "--workdir",
            dir,
            "--use-api",
          ],
          { cwd: dir },
        );
        const raiz = path.join(dir, "supabase", "functions");
        if (!existsSync(raiz)) return [];
        // o conteúdo é lido AQUI, antes do finally: quem chama só vê a memória
        return listarArquivos(raiz).map((rel) => ({
          caminho: `supabase/functions/${rel}`,
          conteudo: readFileSync(path.join(raiz, rel), "utf8"),
        }));
      } finally {
        apagarPastaTemporaria(dir);
      }
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

/** O conteúdo do --json (o relatório em Markdown fica de fora). */
export function resumoEmJson(r, geradoEm) {
  return `${JSON.stringify(
    {
      geradoEm,
      codigo: r.codigo,
      bloqueios: r.bloqueios,
      notasDaVersao: r.notasDaVersao,
      lojas: r.lojas,
      lojasForaDoAr: r.lojasForaDoAr ?? [],
      producaoAnterior: r.producaoAnterior,
    },
    null,
    2,
  )}\n`;
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
  if (a.json) writeFileSync(a.json, resumoEmJson(r, new Date().toISOString()));
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
