/* eslint-disable security/detect-non-literal-fs-filename -- Caminhos vem do kit local: loja e' um dos valores fixos de LOJAS, e sha256/nome (o objeto mora em objetos/<sha256>/<nome-original>) vem de asset.path, ja validado por assetSchema (^v1/[a-f0-9]{64}/[A-Za-z0-9][A-Za-z0-9._-]{0,79}$, sem "/" nem ".."); nenhum vem de rede ou de entrada nao validada do usuario. */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  downloadIdentityAssets,
  readPublicStoreIdentity,
} from "../src/lib/publicStoreIdentity";
import {
  IdentityError,
  identityAssetDescriptors,
  normalizeSupabaseOrigin,
  parseBrandingAssets,
  parseStoreIdentity,
} from "../src/lib/storeIdentity";
import type { BrandingAssets } from "../src/lib/storeIdentity";

// Reexportado para o lancador (scripts/identidade-bootstrap.mjs) validar
// VITE_SUPABASE_URL ANTES de chamar o nucleo, com uma mensagem que aponta
// para o ambiente em vez de "VALORES" (ver ANOTADO da revisao A11:
// montarIdentidade confunde URL malformada com valor de identidade ruim).
export { normalizeSupabaseOrigin };

export type Loja = "ikcous" | "savy";
export interface ObjetoDoKit {
  readonly path: string;
  readonly arquivo: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly mime: string;
}
export interface Kit {
  readonly loja: Loja;
  readonly assets: BrandingAssets;
  // Chave = path (v1/<sha>/<nome>).
  readonly objetos: ReadonlyMap<string, ObjetoDoKit>;
}
export interface Valores {
  readonly store_name: string;
  readonly primary_color: string;
  readonly secondary_color: string;
  readonly accent_color: string;
  readonly store_city: string | null;
  readonly store_state: string | null;
}
type Textual =
  | "store_name"
  | "store_city"
  | "store_state"
  | "primary_color"
  | "secondary_color"
  | "accent_color"
  | "logo_url";
export type LinhaIdentidade = { readonly [K in Textual]: string | null } & {
  readonly branding_assets: BrandingAssets | null;
};
export interface IdentidadeLida {
  readonly revision: string;
  readonly identity: LinhaIdentidade;
}
export type Plano =
  | {
      readonly acao: "bootstrap";
      readonly desired: LinhaIdentidade;
      readonly atual: IdentidadeLida;
      readonly objetos: readonly ObjetoDoKit[];
    }
  | { readonly acao: "nada"; readonly motivo: string }
  | { readonly acao: "recusa"; readonly motivo: string };
export type CodigoErro =
  | "KIT"
  | "VALORES"
  | "ESTADO"
  | "UPLOAD"
  | "CONFERENCIA"
  | "CONFLITO"
  | "PROVA";
export class BootstrapError extends Error {
  // Node roda .ts com "erasableSyntaxOnly": propriedade de parametro no
  // construtor nao e' sintaxe apagavel (TS1294), por isso o campo e'
  // declarado e atribuido a parte.
  readonly code: CodigoErro;
  constructor(code: CodigoErro, message: string) {
    super(message);
    this.name = "BootstrapError";
    this.code = code;
  }
}

const LOJAS: ReadonlySet<string> = new Set(["ikcous", "savy"]);
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

// jsonb compara por valor: a ordem das chaves e' irrelevante no banco, mas a
// comparacao local (planejar/prova) usa uma forma canonica para nao depender
// da ordem de insercao do objeto em memoria.
export function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;
  if (valor !== null && typeof valor === "object")
    return `{${Object.entries(valor)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonico(v)}`)
      .join(",")}}`;
  return JSON.stringify(valor);
}

export async function lerKit(dir: string, loja: Loja): Promise<Kit> {
  if (!LOJAS.has(loja)) throw new BootstrapError("KIT", "loja desconhecida");
  const mapa = path.join(dir, loja, "branding-assets.json");
  let bruto: unknown;
  try {
    bruto = JSON.parse(await fs.readFile(mapa, "utf8"));
  } catch {
    throw new BootstrapError("KIT", `kit sem ${loja}/branding-assets.json`);
  }
  let assets: BrandingAssets;
  try {
    assets = parseBrandingAssets(bruto);
  } catch (error) {
    throw new BootstrapError(
      "KIT",
      `branding-assets.json invalido: ${error instanceof IdentityError ? error.code : "?"}`,
    );
  }
  const objetos = new Map<string, ObjetoDoKit>();
  for (const asset of identityAssetDescriptors(assets)) {
    // Header e loader (por exemplo) podem apontar para o mesmo path; a
    // consistencia entre papeis ja foi checada por parseBrandingAssets.
    if (objetos.has(asset.path)) continue;
    // O terceiro segmento (o nome original) ja foi validado por assetSchema
    // junto com o sha256 (segundo segmento): sem "/" nem "..", so'
    // [A-Za-z0-9][A-Za-z0-9._-]{0,79}. O kit A6a grava um DIRETORIO por sha,
    // com o nome original dentro (objetos/<sha256>/<nome-original>), porque
    // dois paths podem compartilhar o mesmo sha com nomes diferentes.
    const nome = asset.path.split("/")[2];
    const caminhoRelativo = path.join("objetos", asset.sha256, nome);
    const arquivo = path.join(dir, caminhoRelativo);
    let bytes: Uint8Array;
    try {
      bytes = await fs.readFile(arquivo);
    } catch {
      throw new BootstrapError(
        "KIT",
        `objeto ausente: ${asset.sha256} (tentado em ${caminhoRelativo})`,
      );
    }
    if (sha(bytes) !== asset.sha256 || bytes.length !== asset.bytes)
      throw new BootstrapError(
        "KIT",
        `objeto divergente do path: ${asset.path}`,
      );
    objetos.set(asset.path, {
      path: asset.path,
      arquivo,
      sha256: asset.sha256,
      bytes: bytes.length,
      mime: asset.media_type,
    });
  }
  return { loja, assets, objetos };
}

export function montarIdentidade(
  kit: Kit,
  valores: Valores,
  supabaseUrl: string,
): LinhaIdentidade {
  // Todo o corpo esta sob a mesma guarda: uma URL malformada e' tao "valor
  // invalido" quanto uma cor preta ou um nome vazio, e nunca deve escapar
  // como IdentityError crua (o contrato desta funcao e' so' BootstrapError).
  try {
    const origin = normalizeSupabaseOrigin(supabaseUrl);
    const linha: LinhaIdentidade = {
      store_name: valores.store_name,
      store_city: valores.store_city,
      store_state: valores.store_state,
      primary_color: valores.primary_color,
      secondary_color: valores.secondary_color,
      accent_color: valores.accent_color,
      logo_url: `${origin}/storage/v1/object/public/branding/${kit.assets.header.path}`,
      branding_assets: kit.assets,
    };
    // A mesma guarda do build: se ela recusa aqui, o build recusaria depois de gravar.
    parseStoreIdentity(linha, supabaseUrl);
    return linha;
  } catch (error) {
    throw new BootstrapError(
      "VALORES",
      `o build recusaria esta linha: ${error instanceof IdentityError ? error.code : "?"}`,
    );
  }
}

const NULA = (identity: LinhaIdentidade) =>
  Object.values(identity).every((v) => v === null);

export function planejar(
  desired: LinhaIdentidade,
  atual: IdentidadeLida,
  kit: Kit,
): Plano {
  if (canonico(atual.identity) === canonico(desired))
    return {
      acao: "nada",
      motivo: `identidade ja gravada (revisao ${atual.revision})`,
    };
  if (!NULA(atual.identity))
    return {
      acao: "recusa",
      motivo:
        "o banco ja tem identidade diferente da desejada; esta ferramenta nunca sobrescreve",
    };
  return {
    acao: "bootstrap",
    desired,
    atual,
    objetos: [...kit.objetos.values()],
  };
}

export interface PortaBanco {
  // read_store_identity()
  ler(): Promise<IdentidadeLida>;
  // save_store_identity; lanca BootstrapError("CONFLITO") em P0001/IDENTITY_CONFLICT.
  gravar(
    expectedRevision: string,
    expected: LinhaIdentidade,
    desired: LinhaIdentidade,
  ): Promise<IdentidadeLida>;
}
export interface PortaStorage {
  // supabase storage cp
  subir(objeto: ObjetoDoKit): Promise<void>;
  // supabase storage rm
  remover(paths: readonly string[]): Promise<void>;
}
export interface Portas {
  readonly banco: PortaBanco;
  readonly storage: PortaStorage;
  readonly fetchImpl: typeof fetch;
  readonly supabaseUrl: string;
  readonly chavePublica: string;
}
export interface Relatorio {
  readonly acao: Plano["acao"] | "desfeito";
  readonly subidos: readonly string[];
  readonly pulados: readonly string[];
  // So' populado por desfazer: os paths do KIT que NAO entraram em
  // removerPaths e por isso continuam no bucket (orfao e' inofensivo, o path
  // e' enderecado por conteudo). Sempre [] em executar.
  readonly deixados: readonly string[];
  readonly revisao: string | null;
  readonly prova: "ok" | "nao-rodou";
  // false em todo dry-run (sem --aplicar) e quando plano.acao nao e' "bootstrap";
  // true so' quando a escrita (gravar/subir/remover) de fato aconteceu.
  readonly aplicado: boolean;
}
export const LINHA_NULA: LinhaIdentidade = {
  store_name: null,
  store_city: null,
  store_state: null,
  primary_color: null,
  secondary_color: null,
  accent_color: null,
  logo_url: null,
  branding_assets: null,
};

async function estadoNoBucket(
  objeto: ObjetoDoKit,
  portas: Portas,
): Promise<"ausente" | "igual" | "diferente"> {
  const origin = normalizeSupabaseOrigin(portas.supabaseUrl);
  const resposta = await portas.fetchImpl(
    `${origin}/storage/v1/object/public/branding/${objeto.path}`,
    { redirect: "error" },
  );
  if (resposta.status === 404 || resposta.status === 400) {
    await resposta.body?.cancel();
    return "ausente";
  }
  if (!resposta.ok)
    throw new BootstrapError(
      "UPLOAD",
      `status ${resposta.status} ao consultar ${objeto.path}`,
    );
  const bytes = new Uint8Array(await resposta.arrayBuffer());
  return sha(bytes) === objeto.sha256 ? "igual" : "diferente";
}

async function provarPeloConsumidor(portas: Portas): Promise<void> {
  const publica = await readPublicStoreIdentity({
    supabaseUrl: portas.supabaseUrl,
    publicKey: portas.chavePublica,
    fetchImpl: portas.fetchImpl,
  });
  await downloadIdentityAssets(publica, { fetchImpl: portas.fetchImpl });
}

export async function executar(
  plano: Plano,
  portas: Portas,
  opcoes: { aplicar?: boolean } = {},
): Promise<Relatorio> {
  if (plano.acao !== "bootstrap")
    return {
      acao: plano.acao,
      subidos: [],
      pulados: [],
      deixados: [],
      revisao: null,
      prova: "nao-rodou",
      aplicado: false,
    };
  const pulados: string[] = [];
  const candidatos: ObjetoDoKit[] = [];
  for (const objeto of plano.objetos) {
    const estado = await estadoNoBucket(objeto, portas);
    if (estado === "diferente")
      throw new BootstrapError(
        "UPLOAD",
        `objeto ${objeto.path} ja existe com conteudo diferente; path e' enderecado por conteudo`,
      );
    if (estado === "igual") pulados.push(objeto.path);
    else candidatos.push(objeto);
  }
  if (!opcoes.aplicar)
    return {
      acao: "bootstrap",
      subidos: candidatos.map((o) => o.path),
      pulados,
      deixados: [],
      revisao: null,
      prova: "nao-rodou",
      aplicado: false,
    };
  for (const objeto of candidatos) await portas.storage.subir(objeto);
  // Conferir pela porta do consumidor ANTES de gravar: gravar antes e' o
  // defeito nomeado no plano (a loja no ar leria uma identidade cujos
  // arquivos ainda podem nao estar publicamente legiveis).
  try {
    await downloadIdentityAssets(
      parseStoreIdentity(plano.desired, portas.supabaseUrl),
      {
        fetchImpl: portas.fetchImpl,
      },
    );
  } catch (error) {
    throw new BootstrapError(
      "CONFERENCIA",
      `objeto publico recusado pelo leitor do build: ${error instanceof IdentityError ? error.code : String(error)}`,
    );
  }
  const gravado = await portas.banco.gravar(
    plano.atual.revision,
    plano.atual.identity,
    plano.desired,
  );
  if (canonico(gravado.identity) !== canonico(plano.desired))
    throw new BootstrapError(
      "PROVA",
      "o banco devolveu identidade diferente da gravada",
    );
  try {
    await provarPeloConsumidor(portas);
  } catch (error) {
    throw new BootstrapError(
      "PROVA",
      `BANCO JA GRAVADO (revisao ${gravado.revision}); a leitura publica falhou: ${error instanceof IdentityError ? error.code : String(error)}`,
    );
  }
  return {
    acao: "bootstrap",
    subidos: candidatos.map((o) => o.path),
    pulados,
    deixados: [],
    revisao: gravado.revision,
    prova: "ok",
    aplicado: true,
  };
}

export async function desfazer(
  kit: Kit,
  valores: Valores,
  portas: Portas,
  // removerPaths: lista EXPLICITA (fecha o achado ANTES DE CRESCER da
  // revisao A11b: remover [...kit.objetos.keys()] apagava do bucket tambem
  // os objetos que executar() PULOU por ja existirem -- por exemplo, o mesmo
  // path v1/<sha>/<nome> gravado antes pelo painel administrativo, que grava
  // no MESMO bucket com o MESMO endereco por conteudo). Sem a lista (ou
  // vazia), desfazer grava NULL e NAO remove nada.
  opcoes: { aplicar?: boolean; removerPaths?: readonly string[] } = {},
): Promise<Relatorio> {
  const desired = montarIdentidade(kit, valores, portas.supabaseUrl);
  const atual = await portas.banco.ler();
  if (canonico(atual.identity) !== canonico(desired))
    throw new BootstrapError(
      "ESTADO",
      "o banco nao tem exatamente a identidade deste kit; desfazer so' desfaz o que esta ferramenta gravou",
    );
  const remover = opcoes.removerPaths ?? [];
  const removerSet = new Set(remover);
  // Informativo mesmo em dry-run (o mesmo padrao de executar(), que ja
  // devolve subidos/pulados calculados mesmo sem --aplicar): os paths do kit
  // que NAO estao na lista explicita e portanto ficariam orfaos no bucket.
  const deixados = [...kit.objetos.keys()].filter((p) => !removerSet.has(p));
  if (!opcoes.aplicar)
    return {
      acao: "desfeito",
      subidos: [],
      pulados: [],
      deixados,
      revisao: null,
      prova: "nao-rodou",
      aplicado: false,
    };
  // Banco primeiro (a loja volta a usar as reservas locais), objetos depois:
  // se o processo morrer entre os dois passos, o pior cenario e' objeto orfao
  // no bucket, nunca a loja no ar apontando para um arquivo que sumiu.
  const gravado = await portas.banco.gravar(
    atual.revision,
    atual.identity,
    LINHA_NULA,
  );
  // Sem lista, nao chama a porta de remocao (falha fechada: objeto orfao no
  // bucket e' inofensivo, path enderecado por conteudo; remover o kit
  // inteiro por padrao e' o defeito que este parametro corrige).
  if (remover.length > 0) await portas.storage.remover(remover);
  return {
    acao: "desfeito",
    subidos: [],
    pulados: [],
    deixados,
    revisao: gravado.revision,
    prova: "nao-rodou",
    aplicado: true,
  };
}

export interface Argumentos {
  readonly kit: string;
  readonly loja: Loja;
  readonly valores: string;
  readonly workdirSupabase: string;
  readonly aplicar: boolean;
  readonly desfazer: boolean;
  // --saida: caminho onde o lancador grava o relatorio JSON de um --aplicar
  // de bootstrap (obrigatorio nesse caso). null quando nao informado.
  readonly saida: string | null;
  // --subidos: relatorio de um --aplicar anterior, de onde o lancador le
  // `.subidos` para virar `removerPaths` de desfazer(). null = desfazer nao
  // remove nada do bucket (so' grava NULL).
  readonly subidos: string | null;
}

const FLAGS_COM_VALOR: ReadonlySet<string> = new Set([
  "--kit",
  "--loja",
  "--valores",
  "--workdir-supabase",
  "--saida",
  "--subidos",
]);
const FLAGS_BOOLEANAS: ReadonlySet<string> = new Set([
  "--aplicar",
  "--desfazer",
]);
const USO =
  "uso: identidade-bootstrap.mjs --kit <dir> --loja ikcous|savy --valores <json> --workdir-supabase <dir> [--desfazer [--subidos <arquivo>]] [--aplicar [--saida <arquivo>]]\n" +
  "sem --aplicar nada e' gravado nem removido (dry-run), inclusive no --desfazer";

// --aplicar e --desfazer sao independentes, e a MESMA regra vale para os
// dois: sem --aplicar e' dry-run (nada gravado nem removido); --desfazer
// --aplicar executa de verdade (grava NULL, remove so' o que --subidos
// apontar). Correcao da leitura anterior (ver
// central/tarefa-A11c-desfazer-dry-run-relatorio.md): um comando destrutivo
// sem pre-visualizacao nao e' aceitavel numa loja viva. --saida so' e'
// exigido no ramo bootstrap (--aplicar sem --desfazer) -- --desfazer nao usa
// --saida.
export function lerArgumentos(argv: readonly string[]): Argumentos {
  const valores = new Map<string, string>();
  const booleanas = new Set<string>();
  // Fila consumida por .shift(): evita indexacao por variavel (argv[i]), que
  // o eslint-plugin-security marca como "object injection" mesmo quando o
  // indice e' so' um contador do proprio laco.
  const fila = [...argv];
  for (let flag = fila.shift(); flag !== undefined; flag = fila.shift()) {
    if (FLAGS_COM_VALOR.has(flag)) {
      if (valores.has(flag))
        throw new BootstrapError("VALORES", `flag repetida: ${flag}`);
      const valor = fila.shift();
      if (valor === undefined)
        throw new BootstrapError("VALORES", `falta valor para ${flag}`);
      valores.set(flag, valor);
      continue;
    }
    if (FLAGS_BOOLEANAS.has(flag)) {
      if (booleanas.has(flag))
        throw new BootstrapError("VALORES", `flag repetida: ${flag}`);
      booleanas.add(flag);
      continue;
    }
    throw new BootstrapError("VALORES", `flag desconhecida: ${flag}`);
  }
  const kit = valores.get("--kit");
  const lojaBruta = valores.get("--loja");
  const arquivoValores = valores.get("--valores");
  const workdirSupabase = valores.get("--workdir-supabase");
  if (!kit || !lojaBruta || !arquivoValores || !workdirSupabase)
    throw new BootstrapError("VALORES", USO);
  if (!LOJAS.has(lojaBruta))
    throw new BootstrapError("VALORES", `loja desconhecida: ${lojaBruta}`);
  const aplicar = booleanas.has("--aplicar");
  const desfazer = booleanas.has("--desfazer");
  const saida = valores.get("--saida") ?? null;
  // So' o ramo bootstrap (--aplicar sem --desfazer) precisa de --saida: e'
  // onde o relatorio de um --aplicar e' gravado. --desfazer nao usa --saida.
  if (aplicar && !desfazer && !saida)
    throw new BootstrapError(
      "VALORES",
      "--aplicar exige --saida <arquivo> (onde o relatorio e' gravado)",
    );
  return {
    kit,
    // LOJAS.has(lojaBruta) ja' garantiu que lojaBruta e' "ikcous" ou "savy".
    loja: lojaBruta === "ikcous" ? "ikcous" : "savy",
    valores: arquivoValores,
    workdirSupabase,
    aplicar,
    desfazer,
    saida,
    subidos: valores.get("--subidos") ?? null,
  };
}

export const CODIGOS_DE_SAIDA: Readonly<
  Record<
    | "ok"
    | "recusa"
    | "upload"
    | "conflito"
    | "entrada"
    | "inesperado"
    | "prova",
    number
  >
> = {
  ok: 0,
  inesperado: 1,
  recusa: 2,
  upload: 3,
  conflito: 4,
  entrada: 5,
  // PROVA e' o unico erro em que o banco JA FOI GRAVADO e a loja ja mudou
  // por realtime -- achado C3 da revisao A11: confundir isso com falha de
  // upload/conferencia (exit 3) faz quem le o exit code concluir "nada foi
  // gravado" quando a identidade ja esta no ar.
  prova: 6,
};

// Replacer de JSON.stringify: nunca deixa a chave "arquivo" (caminho
// ABSOLUTO de disco de um ObjetoDoKit, que carrega o nome de usuario do SO)
// escapar para a saida do lancador, em qualquer profundidade do objeto --
// mesmo que um campo novo volte a carregar ObjetoDoKit no relatorio no
// futuro. Relatorio hoje so' carrega paths (string), entao isto e' defesa em
// profundidade, nao a unica guarda.
export function semArquivo(chave: string, valor: unknown): unknown {
  return chave === "arquivo" ? undefined : valor;
}
