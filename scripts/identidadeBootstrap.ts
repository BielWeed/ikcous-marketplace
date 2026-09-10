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
    revisao: gravado.revision,
    prova: "ok",
    aplicado: true,
  };
}

export async function desfazer(
  kit: Kit,
  valores: Valores,
  portas: Portas,
  opcoes: { aplicar?: boolean } = {},
): Promise<Relatorio> {
  const desired = montarIdentidade(kit, valores, portas.supabaseUrl);
  const atual = await portas.banco.ler();
  if (canonico(atual.identity) !== canonico(desired))
    throw new BootstrapError(
      "ESTADO",
      "o banco nao tem exatamente a identidade deste kit; desfazer so' desfaz o que esta ferramenta gravou",
    );
  if (!opcoes.aplicar)
    return {
      acao: "desfeito",
      subidos: [],
      pulados: [],
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
  await portas.storage.remover([...kit.objetos.keys()]);
  return {
    acao: "desfeito",
    subidos: [],
    pulados: [],
    revisao: gravado.revision,
    prova: "nao-rodou",
    aplicado: true,
  };
}
