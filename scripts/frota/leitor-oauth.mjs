// Leitor da loja OAuth (T5 do plano PORTAO-OAUTH-PONTE-A, 26/11/2026). A loja
// aberta pelo nova-loja só tem acesso OAuth (a conta do dono não é membro da
// org da lojista), então o portão (publicar-release.mjs) não consegue lê-la
// pelo CLI. Este adaptador faz as MESMAS três leituras pela Management API, com
// o cliente da gestão da loja (scripts/frota/supabase-gestao.mjs, token da
// lojista), e devolve AS MESMAS FORMAS que o caminho pelo CLI devolve:
//
//   migrationList(ref)       -> texto que `versoesAplicadas` lê (o JSON
//                               { migrations: [{ remote }] }), do GET migracoes;
//   listarFuncoes(ref)       -> [{ slug, verify_jwt }], do GET funcoes;
//   baixarFuncao(ref, nome)  -> [{ caminho: "supabase/functions/…", conteudo }],
//                               do `baixar` INJETADO.
//
// O `baixar` é injetado porque a origem do código ainda depende da prova P8: o
// corpo pela API (T3) ou o CLI com o token SÓ no env daquela chamada. Os dois
// têm de entregar caminhos já no formato do repositório ("supabase/functions/
// <nome>/index.ts", "supabase/functions/_shared/…"), que é o que o portão
// compara com o SHA (arquivosEsperados). Este arquivo confere o contrato, não
// faz o mapeamento.
//
// O QUE ESTE ARQUIVO GARANTE (e tests/frota_leitor_oauth_test.ts trava):
//  - ledger vazio, versão fora de ^\d{13,14}$, versão repetida ou corpo que não
//    é lista LANÇAM: no portão isso é "ledger não lido", nunca "nada falta";
//  - verify_jwt não booleano, slug repetido ou não-texto LANÇAM;
//  - caminho de arquivo fora de "supabase/functions/", com "..", ".", "\",
//    segmento vazio ou absoluto, conteúdo que não é texto, ou caminho repetido
//    LANÇAM (o pacote inteiro é recusado, nunca filtrado);
//  - ref e nome conferidos ANTES de qualquer leitura;
//  - erros da gestão e do `baixar` (SemAcesso, ESTADO_DESCONHECIDO) sobem SEM
//    alteração; as mensagens daqui nunca ecoam valor vindo da resposta;
//  - as leituras não dependem de `this` (o portão as chama por `apply`).
//
// Sem rede própria e sem segredo: o token vive dentro do cliente da gestão e do
// `baixar` que quem chama montou.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { RE_REF } = require("./lojas.cjs");

/** Versão do ledger (a mesma régua de `versoesAplicadas` para a tabela do CLI). */
const RE_VERSAO = /^\d{13,14}$/;
/** Nome de function como o portão o aceita (o RE_FUNCAO de publicar-release.mjs,
 * copiado: importar de lá criaria um ciclo quando o portão importar este). */
const RE_FUNCAO = /^[a-z0-9][a-z0-9_-]*$/;
const PREFIXO_DAS_FUNCOES = "supabase/functions/";
/** Caracteres de caminho aceitos (os mesmos do deploy em supabase-gestao.mjs). */
const RE_CAMINHO = /^[A-Za-z0-9._\-/]+$/;

function erroDoLeitor(mensagem) {
  return new Error(`leitor OAuth: ${mensagem}`);
}

/** Objeto literal (não lista, não null). */
function objeto(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function conferirRef(ref) {
  if (typeof ref !== "string" || !RE_REF.test(ref))
    throw erroDoLeitor("ref inválido (esperado 20 letras minúsculas).");
}

/** "supabase/functions/<algo>" relativo, sem ".", "..", "\" nem segmento vazio. */
function caminhoDeFuncaoSeguro(c) {
  if (typeof c !== "string" || c.length > 512) return false;
  if (!c.startsWith(PREFIXO_DAS_FUNCOES) || !RE_CAMINHO.test(c)) return false;
  const resto = c.slice(PREFIXO_DAS_FUNCOES.length);
  return (
    resto.length > 0 &&
    resto.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..")
  );
}

/**
 * @param {{
 *   gestao: { pedir: (modelo: string, opcoes: { ref: string }) => Promise<unknown> },
 *   baixar: (ref: string, nome: string) =>
 *     Promise<{ caminho: string, conteudo: string }[]>,
 * }} opcoes
 */
export function criarLeitorOAuth({ gestao, baixar } = {}) {
  if (!gestao || typeof gestao.pedir !== "function")
    throw new TypeError("criarLeitorOAuth: gestao.pedir é obrigatório");
  if (typeof baixar !== "function")
    throw new TypeError("criarLeitorOAuth: baixar é obrigatório");

  async function migrationList(ref) {
    conferirRef(ref);
    const corpo = await gestao.pedir("migracoes", { ref });
    if (!Array.isArray(corpo))
      throw erroDoLeitor("o ledger da API não é uma lista.");
    if (corpo.length === 0)
      throw erroDoLeitor("ledger vazio (nenhuma versão aplicada).");
    const versoes = new Set();
    for (const m of corpo) {
      if (!objeto(m) || typeof m.version !== "string")
        throw erroDoLeitor("item do ledger sem versão em texto.");
      if (!RE_VERSAO.test(m.version))
        throw erroDoLeitor("versão do ledger fora de ^\\d{13,14}$.");
      if (versoes.has(m.version))
        throw erroDoLeitor("versão repetida no ledger (resposta suspeita).");
      versoes.add(m.version);
    }
    // O formato JSON que `versoesAplicadas` aceita (o mesmo campo `remote` do CLI).
    return JSON.stringify({
      migrations: [...versoes].map((v) => ({ remote: v })),
    });
  }

  async function listarFuncoes(ref) {
    conferirRef(ref);
    const corpo = await gestao.pedir("funcoes", { ref });
    if (!Array.isArray(corpo))
      throw erroDoLeitor("a lista de functions da API não é uma lista.");
    const vistos = new Set();
    return corpo.map((f) => {
      if (!objeto(f) || typeof f.slug !== "string" || f.slug === "")
        throw erroDoLeitor("function sem slug em texto.");
      if (typeof f.verify_jwt !== "boolean")
        throw erroDoLeitor("function com verify_jwt que não é booleano.");
      if (vistos.has(f.slug))
        throw erroDoLeitor("slug repetido na lista de functions.");
      vistos.add(f.slug);
      return { slug: f.slug, verify_jwt: f.verify_jwt };
    });
  }

  async function baixarFuncao(ref, nome) {
    conferirRef(ref);
    if (typeof nome !== "string" || !RE_FUNCAO.test(nome))
      throw erroDoLeitor("nome de function inválido.");
    const arquivos = await baixar(ref, nome);
    if (!Array.isArray(arquivos))
      throw erroDoLeitor("o código baixado não é uma lista de arquivos.");
    const caminhos = new Set();
    return arquivos.map((a) => {
      if (!objeto(a) || !caminhoDeFuncaoSeguro(a.caminho))
        throw erroDoLeitor(
          'arquivo com caminho fora de "supabase/functions/" ou inseguro (não impresso).',
        );
      if (typeof a.conteudo !== "string")
        throw erroDoLeitor("arquivo com conteúdo que não é texto.");
      if (caminhos.has(a.caminho))
        throw erroDoLeitor("arquivo repetido no código baixado.");
      caminhos.add(a.caminho);
      return { caminho: a.caminho, conteudo: a.conteudo };
    });
  }

  return { migrationList, listarFuncoes, baixarFuncao };
}
