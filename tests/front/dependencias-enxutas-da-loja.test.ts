/* eslint-disable security/detect-non-literal-fs-filename -- Lê apenas módulos resolvidos das dependências e fontes do checkout em listas fechadas. */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { type Plugin, build } from "vite";
import { describe, expect, it, vi } from "vitest";
import {
  authSemWebAuthn,
  zodSemJsonSchema,
} from "../../scripts/dependenciasEnxutasDaLoja";

const versoes = vi.hoisted(() => new Map<string, string>());
vi.mock("node:module", async (original) => {
  const modulo = await original<typeof import("node:module")>();
  return {
    ...modulo,
    createRequire: (url: string | URL) => {
      const real = modulo.createRequire(url);
      return Object.assign((id: string) => {
        const valor = real(id);
        return versoes.has(id) ? { ...valor, version: versoes.get(id) } : valor;
      }, real);
    },
  };
});

const require = createRequire(import.meta.url);
interface Ganchos {
  buildStart(): void;
  generateBundle(): void;
  transform(codigo: string, id: string): string | null;
}
function resolver(alvo: string): string {
  if (alvo.startsWith("zod/"))
    return path.join(
      path.dirname(require.resolve("zod/package.json")),
      alvo.slice(4),
    );
  return require.resolve(alvo);
}
const alvos = [
  [zodSemJsonSchema, "zod/v4/core/to-json-schema.js"],
  [zodSemJsonSchema, "zod/v4/core/json-schema-processors.js"],
  [authSemWebAuthn, "@supabase/auth-js/dist/module/lib/webauthn.js"],
] as const;

function pluginsLigados(codigo: string): string[] {
  const fonte = ts.createSourceFile(
    "vite.config.ts",
    codigo,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const exportacao = fonte.statements.find(ts.isExportAssignment);
  if (!exportacao || !ts.isCallExpression(exportacao.expression)) return [];
  const configurar = exportacao.expression.arguments[0];
  if (
    !configurar ||
    !ts.isArrowFunction(configurar) ||
    !ts.isBlock(configurar.body)
  )
    return [];
  // Só o return direto da configuração principal. Não conta preview, comentário,
  // string ou uma chamada que não participe do array plugins retornado.
  const retorno = configurar.body.statements.find(ts.isReturnStatement);
  if (!retorno?.expression || !ts.isObjectLiteralExpression(retorno.expression))
    return [];
  const plugins = retorno.expression.properties.find(
    (prop) =>
      ts.isPropertyAssignment(prop) && prop.name.getText(fonte) === "plugins",
  );
  if (
    !plugins ||
    !ts.isPropertyAssignment(plugins) ||
    !ts.isArrayLiteralExpression(plugins.initializer)
  )
    return [];
  return plugins.initializer.elements.flatMap((item) =>
    ts.isCallExpression(item) &&
    ts.isIdentifier(item.expression) &&
    ["zodSemJsonSchema", "authSemWebAuthn"].includes(item.expression.text)
      ? [item.expression.text]
      : [],
  );
}

describe("dependências enxutas da loja — substituição fechada", () => {
  it.each([
    ["zod", zodSemJsonSchema],
    ["@supabase/auth-js", authSemWebAuthn],
  ] as const)("reprova upgrade não revisado de %s", (pacote, criar) => {
    versoes.set(`${pacote}/package.json`, "99.0.0");
    try {
      expect(() => (criar() as unknown as Ganchos).buildStart()).toThrow(
        /revisar.*99.0.0/,
      );
    } finally {
      versoes.clear();
    }
  });
  it.each(alvos)(
    "substitui somente o módulo validado: %s / %s",
    (criar, alvo) => {
      const plugin = criar() as unknown as Ganchos;
      const id = resolver(alvo);
      const codigo = readFileSync(id, "utf8");
      plugin.buildStart();
      expect(plugin.transform?.(codigo, id)).toEqual(expect.any(String));
      expect(plugin.transform?.(codigo, id.replaceAll("/", "\\"))).toEqual(
        plugin.transform?.(codigo, id),
      );
      expect(plugin.transform?.(codigo, "C:/repo/src/qualquer.js")).toBeNull();
    },
  );

  it.each(alvos)("falha alto se mudar o conteúdo: %s / %s", (criar, alvo) => {
    const plugin = criar() as unknown as Ganchos;
    const id = resolver(alvo);
    const codigo = readFileSync(id, "utf8");
    expect(() => plugin.transform?.(`${codigo}\n// mudou`, id)).toThrow(
      /revisar/i,
    );
  });

  it.each([zodSemJsonSchema, authSemWebAuthn])(
    "falha alto se a resolução não passar pelos módulos esperados",
    (criar) => {
      const plugin = criar() as unknown as Ganchos;
      plugin.buildStart();
      expect(() => plugin.generateBundle()).toThrow(/módulos não encontrados/);
    },
  );

  it("não substitui admin, cliente nem o parsing do zod", () => {
    const auth = authSemWebAuthn() as unknown as Ganchos;
    const zod = zodSemJsonSchema() as unknown as Ganchos;
    expect(
      auth.transform(
        "",
        resolver("@supabase/auth-js/dist/module/GoTrueAdminApi.js"),
      ),
    ).toBeNull();
    expect(
      auth.transform(
        "",
        resolver("@supabase/auth-js/dist/module/GoTrueClient.js"),
      ),
    ).toBeNull();
    expect(zod.transform("", resolver("zod/v4/core/parse.js"))).toBeNull();
    expect(zod.transform("", resolver("zod/v4/core/registries.js"))).toBeNull();
  });

  it("está ligado no build real", () => {
    const config = readFileSync("vite.config.ts", "utf8");
    expect(pluginsLigados(config)).toEqual([
      "zodSemJsonSchema",
      "authSemWebAuthn",
    ]);
  });

  it.each(["zodSemJsonSchema", "authSemWebAuthn"])(
    "comentar %s na lista real faz a guarda reprovar",
    (nome) => {
      const config = readFileSync("vite.config.ts", "utf8");
      const chamada = `${nome}(),`;
      expect(config.split(chamada)).toHaveLength(2);
      const desligado = config.replace(chamada, `// ${chamada}`);
      expect(pluginsLigados(desligado)).not.toContain(nome);
    },
  );

  it("ignora chamadas fora de plugins e a lista de preview", () => {
    expect(
      pluginsLigados(`
export default defineConfig(async () => {
  // zodSemJsonSchema()
  const texto = "authSemWebAuthn()";
  zodSemJsonSchema();
  if (isPreview) return { plugins: [zodSemJsonSchema(), authSemWebAuthn()] };
  return { plugins: [] };
});
`),
    ).toEqual([]);
  });
});

const ENTRADA = "virtual:prova-dependencias-loja";

async function compilar(codigo: string, plugins: Plugin[] = []) {
  const saida = await build({
    configFile: false,
    envFile: false,
    logLevel: "silent",
    resolve: { alias: { "@": path.resolve("src") } },
    plugins: [
      ...plugins,
      {
        name: "entrada-da-prova",
        resolveId: (id) => (id === ENTRADA ? `\0${id}` : null),
        load: (id) => (id === `\0${ENTRADA}` ? codigo : null),
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: ENTRADA, formats: ["cjs"] },
      rollupOptions: {
        input: ENTRADA,
        onwarn(aviso, avisar) {
          if (aviso.code === "MISSING_EXPORT") throw new Error(aviso.message);
          avisar(aviso);
        },
      },
    },
  });
  const rodada = Array.isArray(saida) ? saida[0] : saida;
  if (!("output" in rodada)) throw new Error("Build sem saída");
  const chunk = rodada.output.find((c) => c.type === "chunk")!;
  const modulo = {
    exports: {} as Record<string, (...args: unknown[]) => unknown>,
  };
  new Function("require", "module", "exports", chunk.code)(
    require,
    modulo,
    modulo.exports,
  );
  return { api: modulo.exports, codigo: chunk.code };
}

describe("auth-js enxuto — fluxos sem WebAuthn idênticos", () => {
  it("preserva cadastro com e sem confirmação, senha, OTP, recuperação, sessão, refresh e logout REAL da API admin", async () => {
    const entrada = `
import { GoTrueClient } from "@supabase/auth-js";
export async function fluxo() {
 const pedidos = [], eventos = [], resultados = [];
 const usuario = { id:"00000000-0000-4000-8000-000000000001", email:"cliente@example.test", aud:"authenticated", app_metadata:{}, user_metadata:{}, created_at:"2026-01-01T00:00:00Z" };
 const token = "e30." + btoa(JSON.stringify({exp:4102444800,sub:usuario.id})) + ".ficticio";
 const sessao = {access_token:token,refresh_token:"refresh-ficticio",token_type:"bearer",expires_in:3600,user:usuario};
 const fetch = async (url, opcoes = {}) => {
  const u = new URL(url);
  const corpo = opcoes.body ? JSON.parse(opcoes.body) : null;
  pedidos.push({rota:u.pathname+u.search,metodo:opcoes.method,corpo});
  let resposta = {};
  let status = 200;
  if (u.pathname.endsWith("/signup")) resposta = corpo.email.startsWith("confirmar") ? {user:usuario,session:null} : sessao;
  if (u.pathname.endsWith("/token")) {
   if (corpo.password === "errada") { status = 400; resposta = {code:"invalid_credentials",msg:"Invalid login credentials"}; }
   else resposta = sessao;
  }
  if (u.pathname.endsWith("/verify")) {
   if (corpo.token === "vencido") { status = 403; resposta = {code:"otp_expired",msg:"Token has expired"}; }
   else resposta = sessao;
  }
  if (u.pathname.endsWith("/user")) resposta = usuario;
  if (u.pathname.endsWith("/logout")) status = 204;
  return new Response(status === 204 ? null : JSON.stringify(resposta), {status,headers:{"content-type":"application/json","x-supabase-api-version":"2024-01-01"}});
 };
 const auth = new GoTrueClient({url:"https://auth.example.test/auth/v1",headers:{apikey:"chave-publica-ficticia"},fetch,autoRefreshToken:false,persistSession:false,detectSessionInUrl:false});
 const capturar = (r) => resultados.push({usuario:r.data?.user?.id??null,sessao:!!r.data?.session,erro:r.error?{message:r.error.message,code:r.error.code,status:r.error.status}:null});
 await auth.initialize();
 const {data:{subscription}} = auth.onAuthStateChange((evento) => { if(evento !== "INITIAL_SESSION") eventos.push(evento); });
 capturar(await auth.signUp({email:"confirmar@example.test",password:"senha-ficticia",options:{data:{name:"Pessoa fictícia"}}}));
 capturar(await auth.signUp({email:usuario.email,password:"senha-ficticia"}));
 capturar(await auth.signInWithPassword({email:usuario.email,password:"errada"}));
 capturar(await auth.signInWithPassword({email:usuario.email,password:"senha-ficticia"}));
 capturar(await auth.resetPasswordForEmail(usuario.email, {redirectTo:"https://loja.example.test/recuperar"}));
 capturar(await auth.verifyOtp({email:usuario.email,token:"vencido",type:"recovery"}));
 capturar(await auth.verifyOtp({email:usuario.email,token:"123456",type:"signup"}));
 capturar(await auth.verifyOtp({email:usuario.email,token:"123456",type:"recovery"}));
 capturar(await auth.getSession());
 capturar(await auth.getUser());
 capturar(await auth.refreshSession());
 capturar(await auth.updateUser({password:"nova-senha-ficticia"}));
 capturar(await auth.signOut());
 capturar(await auth.getSession());
 subscription.unsubscribe();
 return {pedidos,eventos,resultados};
}
`;
    const original = await compilar(entrada);
    const enxuto = await compilar(entrada, [authSemWebAuthn()]);
    const esperado = (await original.api.fluxo()) as {
      pedidos: { rota: string }[];
      eventos: string[];
      resultados: { sessao: boolean; erro: unknown }[];
    };
    expect(await enxuto.api.fluxo()).toEqual(esperado);
    expect(
      esperado.pedidos.some((p) => p.rota.split("?")[0].endsWith("/logout")),
    ).toBe(true);
    expect(esperado.eventos).toContain("SIGNED_OUT");
    expect(esperado.resultados[0].sessao).toBe(false);
    expect(esperado.resultados[1].sessao).toBe(true);
    expect(esperado.resultados[2].erro).toMatchObject({
      code: "invalid_credentials",
    });
    expect(esperado.resultados[5].erro).toMatchObject({ code: "otp_expired" });
    expect(
      esperado.resultados
        .filter((_, indice) => ![2, 5].includes(indice))
        .every((r) => r.erro === null),
    ).toBe(true);
    expect(esperado.eventos).toContain("PASSWORD_RECOVERY");
    expect(esperado.eventos).toContain("TOKEN_REFRESHED");
    expect(esperado.resultados.at(-1)?.sessao).toBe(false);
    expect(enxuto.codigo.length).toBeLessThan(original.codigo.length);
  }, 30_000);
});

// Recorta a expressão REAL, via AST, sem copiar a regra nem exportar coisa
// de teste no componente de produção. Renomear/remover o schema reprova alto.
function inicializador(arquivo: string, nome: string): string {
  const fonte = ts.createSourceFile(
    arquivo,
    readFileSync(arquivo, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const encontrados: string[] = [];
  function visitar(no: ts.Node) {
    if (
      ts.isVariableDeclaration(no) &&
      ts.isIdentifier(no.name) &&
      no.name.text === nome &&
      no.initializer
    )
      encontrados.push(no.initializer.getText(fonte));
    ts.forEachChild(no, visitar);
  }
  visitar(fonte);
  expect(encontrados).toHaveLength(1);
  return encontrados[0];
}

describe("zod enxuto — propriedades públicas dos schemas", () => {
  it("preserva limites e formatos de string, number, bigint e date, inclusive em shape", async () => {
    const entrada = `
import { z } from "zod";
export function propriedades() {
 const strings = [z.string(),z.string().min(8).max(9),z.string().min(1).min(8).max(20).max(9),z.string().length(4),z.email(),z.string().regex(/teste/),z.base64()];
 const numeros = [z.number(),z.number().min(-2).max(9),z.number().gt(0).lt(100),z.int(),z.int32(),z.float32(),z.number().multipleOf(2),z.number().multipleOf(0.5)];
 const inteiros = [z.bigint(),z.bigint().min(-4n).max(15n),z.int64(),z.uint64()];
 const datas = [z.date(),z.date().min(new Date("2026-01-01")).max(new Date("2026-12-31"))];
 const cep = z.object({cep:z.string().min(8).max(9)}).shape.cep;
 return {
  strings:strings.map(s=>({min:s.minLength,max:s.maxLength,format:s.format})),
  numeros:numeros.map(s=>({min:s.minValue,max:s.maxValue,isInt:s.isInt,format:s.format})),
  inteiros:inteiros.map(s=>({min:s.minValue,max:s.maxValue,format:s.format})),
  datas:datas.map(s=>({min:s.minDate,max:s.maxDate})),
  cep:{min:cep.minLength,max:cep.maxLength}
 };
}
`;
    const original = await compilar(entrada);
    const enxuto = await compilar(entrada, [zodSemJsonSchema()]);
    const esperado = original.api.propriedades();
    expect(esperado).toMatchObject({ cep: { min: 8, max: 9 } });
    expect(enxuto.api.propriedades()).toEqual(esperado);
  }, 30_000);

  it("mantém aggregateChecks e auxiliares fiéis ao módulo original travado", () => {
    const id = resolver("zod/v4/core/json-schema-processors.js");
    const original = readFileSync(id, "utf8");
    const inicio = "const narrowMin =";
    const fim = "const formatMap =";
    expect(original.split(inicio)).toHaveLength(2);
    expect(original.split(fim)).toHaveLength(2);
    const agregado = original.slice(
      original.indexOf(inicio),
      original.indexOf(fim),
    );
    const enxuto = (zodSemJsonSchema() as unknown as Ganchos).transform(
      original,
      id,
    );
    expect(enxuto).toContain(agregado);
  });
});

describe("passkey retirada — sem cerimônia nem rede", () => {
  it("recusa a chamada sem chamar a rede, conservando o diagnóstico de suporte da biblioteca", async () => {
    const entrada = `
import { GoTrueClient } from "@supabase/auth-js";
export async function entrar() {
 let chamadas = 0;
 const auth = new GoTrueClient({url:"https://auth.example.test",persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,fetch:async()=>{chamadas++;throw new Error("Rede não deveria ser chamada");}});
 await auth.initialize();
 const {error} = await auth.signInWithPasskey({});
 return {mensagem:error?.message,chamadas};
}
`;
    const enxuto = await compilar(entrada, [authSemWebAuthn()]);
    expect(await enxuto.api.entrar()).toEqual({
      mensagem: "Browser does not support WebAuthn",
      chamadas: 0,
    });
  }, 30_000);
});

describe("zod enxuto — regras reais de formulários", () => {
  it("endereço, avaliação e checkout mantêm dados, mensagens, caminhos e resolver em todos os modos", async () => {
    const endereco = inicializador(
      "src/components/ui/custom/AddressForm.tsx",
      "addressSchema",
    );
    const avaliacao = inicializador(
      "src/components/ui/custom/ReviewForm.tsx",
      "reviewSchema",
    );
    const checkout = inicializador(
      "src/views/customer/CheckoutView.tsx",
      "dynamicSchema",
    );
    const entrada = `
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { cpfValido } from "@/lib/cpf";
import { ufBrasileiraValida } from "@/lib/uf-brasileira";
import { celularBrasileiroCompleto, mensagemDeWhatsappIncompleto } from "@/lib/telefone-br";
const addressSchema = ${endereco};
const reviewSchema = ${avaliacao};
const useMemo = (criar) => criar();
const address = {name:"Casa fictícia",cep:"12345-678",street:"Rua de teste",number:"10",neighborhood:"Bairro fictício",city:"Cidade de teste",state:"SP",recipient_name:"Pessoa fictícia",is_default:true};
const compra = {name:"Pessoa fictícia",whatsapp:"11987654321",cep:"12345-678",street:"Rua de teste",number:"10",neighborhood:"Bairro fictício",city:"Cidade de teste",state:"SP",cpf:"52998224725"};
export async function validar() {
 const cenarios = [
  [addressSchema, [address,{}, {...address,cep:"12345-67"}, {...address,name:" ",number:" ",recipient_name:" "}, {...address,extra:"retirado"},null]],
  [reviewSchema,[{rating:5,comment:"Ótimo"},{rating:1,comment:""}, {rating:0,comment:" "}, {rating:"5",comment:"teste"},{}]],
 ];
 for (const user of [null, {id:"pessoa-ficticia"}]) {
  for (const exigeCpfDoDestinatario of [false,true]) {
   const dynamicSchema = ${checkout};
   cenarios.push([dynamicSchema, [compra,{}, {...compra,whatsapp:"1134567890"}, {...compra,cep:"12345-67",street:" ",number:""}, {...compra,cpf:""}, {...compra,cpf:"11111111111"}]]);
  }
 }
 return Promise.all(cenarios.map(async ([schema, entradas]) => Promise.all(entradas.map(async (dados) => {
  const r = schema.safeParse(dados);
  const assincrono = await schema.safeParseAsync(dados);
  return {
   resultado:r.success ? {data:r.data} : {issues:r.error.issues},
   assincrono:assincrono.success ? {data:assincrono.data} : {issues:assincrono.error.issues},
   resolver:await zodResolver(schema)(dados, {}, {criteriaMode:"all",shouldUseNativeValidation:false,fields:{}})
  };
 }))));
}
`;
    const original = await compilar(entrada);
    const enxuto = await compilar(entrada, [zodSemJsonSchema()]);
    const esperado = (await original.api.validar()) as {
      resultado: { data?: unknown; issues?: unknown };
    }[][];
    expect(await enxuto.api.validar()).toEqual(esperado);
    expect(esperado).toHaveLength(6);
    expect(esperado[0][0].resultado.data).toBeDefined();
    expect(esperado[0][2].resultado.issues).toBeDefined();
    expect(esperado[1][2].resultado.issues).toBeDefined();
    for (const casos of esperado.slice(2)) {
      expect(casos[0].resultado.data).toBeDefined();
      expect(casos[2].resultado.issues).toBeDefined();
    }
  }, 30_000);
});

describe("zod enxuto — geração removida, validação mantida", () => {
  it("mantém parse, safeParse, assíncrono e o resolver, e recusa JSON Schema explicitamente", async () => {
    const entrada = `
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
const s = z.object({ email:z.email(), senha:z.string().min(8), extra:z.string().optional(), dados:z.json().optional() });
export async function validar() {
 const entradas = [{email:"cliente@example.test",senha:"senha-ficticia",dados:{lista:[1,true,null,"valor"]}}, {email:"cliente@example.test",senha:"senha-ficticia",dados:()=>1}, {email:"nao",senha:"curta"}, {}, null];
 return Promise.all(entradas.map(async x => {
   const r = s.safeParse(x);
   return {
     sincrono:r.success ? r.data : r.error.issues,
     assincrono:JSON.parse(JSON.stringify(await s.safeParseAsync(x))),
     resolver:await zodResolver(s)(x, {}, {criteriaMode:"all",shouldUseNativeValidation:false,fields:{}})
   };
 }));
}
export function gerar() { return z.toJSONSchema(s); }
export function gerarMetodo() { return s.toJSONSchema(); }
export function gerarStandard() { return s["~standard"].jsonSchema.input({}); }
`;
    const original = await compilar(entrada);
    const enxuto = await compilar(entrada, [zodSemJsonSchema()]);
    expect(await enxuto.api.validar()).toEqual(await original.api.validar());
    expect(original.api.gerar()).toHaveProperty("properties.email");
    for (const gerar of [
      enxuto.api.gerar,
      enxuto.api.gerarMetodo,
      enxuto.api.gerarStandard,
    ])
      expect(() => gerar()).toThrow(/JSON Schema/);
    expect(enxuto.codigo.length).toBeLessThan(original.codigo.length);
  }, 30_000);
});
