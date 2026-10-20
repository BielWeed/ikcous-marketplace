// @ts-nocheck
// Dublês e dados FALSOS compartilhados pelos testes do e-mail da loja
// (`email-da-loja_test.ts`, `credenciais-email/index_test.ts`, e os dos
// chamadores). Nada aqui toca rede, e toda senha é de mentira e legível.
import { chaveDeCifra, cifrar } from "./credenciais-mp.ts";
import {
  CHAVE_SETTINGS_EMAIL,
  CHAVE_SETTINGS_SAUDE,
} from "./email-da-loja.ts";

/** Chave de cifra de MENTIRA, só para o AES rodar de verdade dentro do teste. */
export const CHAVE_CIFRA_TESTE = btoa(
  String.fromCharCode(
    ...Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256),
  ),
);
export const OUTRA_CHAVE_CIFRA = btoa(
  String.fromCharCode(
    ...Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 256),
  ),
);

export const SENHA_DO_PAINEL = "senhadopainelfal"; // 16 letras minúsculas
export const USUARIO_DO_PAINEL = "lojista.teste@gmail.com";
export const USUARIO_DO_AMBIENTE = "ambiente@exemplo.com";
export const SENHA_DO_AMBIENTE = "senha-do-ambiente-falsa";

export const AMBIENTE_COMPLETO = {
  SMTP_USER: USUARIO_DO_AMBIENTE,
  SMTP_PASSWORD: SENHA_DO_AMBIENTE,
};

export function env(pares: Record<string, string>) {
  const mapa = new Map(Object.entries(pares));
  return { get: (chave: string) => mapa.get(chave) };
}

export async function registroCifrado(
  senha = SENHA_DO_PAINEL,
  chaveBase64 = CHAVE_CIFRA_TESTE,
  usuario = USUARIO_DO_PAINEL,
) {
  const chave = await chaveDeCifra(env({ MP_CHAVES_ENCRYPTION_KEY: chaveBase64 }));
  const { cifrado, iv } = await cifrar(senha, chave);
  return {
    usuario,
    senha_cifrada: cifrado,
    iv,
    atualizado_em: "2026-10-14T10:00:00.000Z",
    ultimo_teste: null,
  };
}

type OpcoesDoBanco = {
  /** Valores iniciais por chave de app_settings (já como objeto; o dublê serializa). */
  registro?: unknown;
  saude?: unknown;
  /** Valor CRU (texto) para o registro — para simular lixo no banco. */
  registroCru?: string;
  /** Como a LEITURA se comporta (todas as chaves, ou só `chaveDaFalha`). */
  leitura?: "ok" | "erro" | "lanca" | "pendura";
  /** Se a leitura/escrita que falha vale só para uma chave (a do registro ou a da saúde). */
  chaveDaFalha?: string;
  /** Escritas que ainda passam (Infinity = todas). */
  escritasPermitidas?: number;
  /** Texto do erro de escrita — para provar que ele nunca é ecoado. */
  textoDoErroDeEscrita?: string;
  /** O que o client diz ser (`supabaseKey`) — para a trava de service role. */
  supabaseKey?: string;
};

/**
 * Dublê de app_settings por chave. `estado.leituras` lista as chaves lidas e
 * `estado.escritas` as gravações/remoções, na ordem.
 */
export function bancoFalso(opcoes: OpcoesDoBanco = {}) {
  const valores = new Map<string, string>();
  if (opcoes.registro) valores.set(CHAVE_SETTINGS_EMAIL, JSON.stringify(opcoes.registro));
  if (opcoes.registroCru !== undefined) valores.set(CHAVE_SETTINGS_EMAIL, opcoes.registroCru);
  if (opcoes.saude) valores.set(CHAVE_SETTINGS_SAUDE, JSON.stringify(opcoes.saude));
  const estado = {
    valores,
    leituras: [] as string[],
    escritas: [] as Array<{ acao: "upsert" | "delete"; key: string; value?: string }>,
    escritasPermitidas: opcoes.escritasPermitidas ?? Infinity,
  };
  const falhaVale = (chave: string) =>
    !opcoes.chaveDaFalha || opcoes.chaveDaFalha === chave;
  const cliente = {
    ...(opcoes.supabaseKey ? { supabaseKey: opcoes.supabaseKey } : {}),
    from(tabela: string) {
      if (tabela !== "app_settings") {
        throw new Error(`tabela inesperada: ${tabela}`);
      }
      return {
        select: () => ({
          eq: (coluna: string, chave: string) => ({
            maybeSingle: () => {
              estado.leituras.push(chave);
              if (opcoes.leitura && opcoes.leitura !== "ok" && falhaVale(chave)) {
                if (opcoes.leitura === "lanca") throw new Error("banco explodiu");
                if (opcoes.leitura === "pendura") return new Promise(() => {});
                return Promise.resolve({
                  data: null,
                  error: { message: "permission denied for table app_settings" },
                });
              }
              const value = valores.get(chave);
              return Promise.resolve({
                data: value ? { value } : null,
                error: null,
              });
            },
          }),
        }),
        upsert: (linha: { key: string; value: string }) => {
          if (estado.escritas.length >= estado.escritasPermitidas) {
            return Promise.resolve({
              error: {
                message: opcoes.textoDoErroDeEscrita ?? "app_settings fora do ar",
                details: `Failing row contains (${linha.key}, ${linha.value})`,
              },
            });
          }
          estado.escritas.push({ acao: "upsert", key: linha.key, value: linha.value });
          valores.set(linha.key, linha.value);
          return Promise.resolve({ error: null });
        },
        delete: () => ({
          eq: (_coluna: string, chave: string) => {
            estado.escritas.push({ acao: "delete", key: chave });
            valores.delete(chave);
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  };
  return Object.assign(cliente, { estado });
}

/** Captura console.error/warn/log durante `corpo` e devolve tudo que saiu. */
export async function capturandoLogs(corpo: () => Promise<unknown>) {
  const saiu: string[] = [];
  const originais = { error: console.error, warn: console.warn, log: console.log };
  const anota = (...args: unknown[]) => {
    saiu.push(
      args
        .map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a)))
        .join(" "),
    );
  };
  console.error = anota;
  console.warn = anota;
  console.log = anota;
  try {
    await corpo();
  } finally {
    console.error = originais.error;
    console.warn = originais.warn;
    console.log = originais.log;
  }
  return saiu.join("\n");
}

/** JWT legado só com o payload que importa (a assinatura não é verificada por ninguém aqui). */
export function chaveLegada(role: string): string {
  const parte = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${parte({ alg: "HS256", typ: "JWT" })}.${parte({ role })}.assinatura`;
}
