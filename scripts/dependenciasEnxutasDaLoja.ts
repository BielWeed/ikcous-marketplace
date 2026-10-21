import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

interface Substituicao {
  caminho: string;
  sha256: string;
  codigo: string;
}

// Mesma fronteira de graficoEnxuto: só módulos internos de versões conferidas.
// O hash trava também mudança do padrão dentro da mesma versão. Ao atualizar,
// revisar os módulos E repetir as provas diferenciais antes de trocar os hashes.
function substituirModulos(
  pacote: string,
  versao: string,
  substituicoes: Substituicao[],
): Plugin {
  const vistos = new Set<string>();
  return {
    name: `dependencia-enxuta:${pacote}`,
    enforce: "pre",
    apply: "build",
    buildStart() {
      vistos.clear();
      const instalado = createRequire(import.meta.url)(
        `${pacote}/package.json`,
      ) as { version: string };
      if (instalado.version !== versao)
        throw new Error(
          `Loja enxuta: revisar ${pacote} ${instalado.version}; validado: ${versao}.`,
        );
    },
    transform(codigo, id) {
      const caminho = id.replaceAll("\\", "/").split("?")[0];
      const alvo = substituicoes.find((item) =>
        caminho.endsWith(`/node_modules/${pacote}/${item.caminho}`),
      );
      if (!alvo) return null;
      if (createHash("sha256").update(codigo).digest("hex") !== alvo.sha256)
        throw new Error(
          `Loja enxuta: revisar padrão de ${pacote}/${alvo.caminho}; conteúdo diferente do validado.`,
        );
      vistos.add(alvo.caminho);
      return alvo.codigo;
    },
    generateBundle() {
      const ausentes = substituicoes.filter(
        (item) => !vistos.has(item.caminho),
      );
      if (ausentes.length)
        throw new Error(
          `Loja enxuta: revisar resolução de ${pacote}; módulos não encontrados: ${ausentes.map((item) => item.caminho).join(", ")}.`,
        );
    },
  };
}

const SEM_JSON_SCHEMA = `
function indisponivel() {
  throw new Error("JSON Schema não faz parte da loja; revisar a economia do zod antes de usar.");
}
`;

/**
 * Parsing e validação permanecem originais, inclusive z.json e zodResolver.
 * Só a conversão para JSON Schema sai. As fábricas são chamadas ao construir
 * QUALQUER schema: devolvem a função que falha, sem impedir sua construção.
 */
export function zodSemJsonSchema(): Plugin {
  return substituirModulos("zod", "4.6.5", [
    {
      caminho: "v4/core/json-schema-processors.js",
      sha256:
        "b6d2aee72212c076b9cde38da6333591c76a24eb049a4ee4e7bd2b7825d8b817",
      codigo: `${SEM_JSON_SCHEMA}
export const allProcessors = {};
export {
  indisponivel as toJSONSchema, indisponivel as aggregateChecks,
  indisponivel as stringProcessor, indisponivel as numberProcessor,
  indisponivel as booleanProcessor, indisponivel as bigintProcessor,
  indisponivel as symbolProcessor, indisponivel as nullProcessor,
  indisponivel as undefinedProcessor, indisponivel as voidProcessor,
  indisponivel as neverProcessor, indisponivel as anyProcessor,
  indisponivel as unknownProcessor, indisponivel as dateProcessor,
  indisponivel as enumProcessor, indisponivel as literalProcessor,
  indisponivel as nanProcessor, indisponivel as templateLiteralProcessor,
  indisponivel as fileProcessor, indisponivel as successProcessor,
  indisponivel as customProcessor, indisponivel as functionProcessor,
  indisponivel as transformProcessor, indisponivel as mapProcessor,
  indisponivel as setProcessor, indisponivel as arrayProcessor,
  indisponivel as objectProcessor, indisponivel as unionProcessor,
  indisponivel as intersectionProcessor, indisponivel as tupleProcessor,
  indisponivel as recordProcessor, indisponivel as nullableProcessor,
  indisponivel as nonoptionalProcessor, indisponivel as defaultProcessor,
  indisponivel as prefaultProcessor, indisponivel as catchProcessor,
  indisponivel as pipeProcessor, indisponivel as readonlyProcessor,
  indisponivel as promiseProcessor, indisponivel as optionalProcessor,
  indisponivel as lazyProcessor
};
`,
    },
    {
      caminho: "v4/core/to-json-schema.js",
      sha256:
        "85b883eb8f05e9f060c71a39fce7df9345b566af29d5bc9c8fa477fe616a051d",
      codigo: `${SEM_JSON_SCHEMA}
export const createToJSONSchemaMethod = () => indisponivel;
export const createStandardJSONSchemaMethod = () => indisponivel;
export {
  indisponivel as initializeContext, indisponivel as processSchema,
  indisponivel as process, indisponivel as extractDefs,
  indisponivel as finalize, indisponivel as handleUnrepresentable
};
`,
    },
  ]);
}

/**
 * Nenhuma chamada do app usa passkey ou MFA WebAuthn (guarda em tests/front).
 * GoTrueClient, GoTrueAdminApi (usada pelo logout), sessão, OTP, senha,
 * confirmação e recuperação não são substituídos.
 */
export function authSemWebAuthn(): Plugin {
  return substituirModulos("@supabase/auth-js", "2.117.2", [
    {
      caminho: "dist/module/lib/webauthn.js",
      sha256:
        "816b695280e032e881525ac7c0cc7de52936e7da12e2df25c4e6bf1179946d67",
      codigo: `
function indisponivel() {
  throw new Error("WebAuthn/passkey não faz parte da loja; revisar a economia de auth-js antes de usar.");
}
export const webAuthnAbortService = {
  createNewAbortSignal: indisponivel,
  cancelCeremony: indisponivel
};
// O cliente constrói mfa.webauthn mesmo sem usar MFA.
export class WebAuthnApi {}
export const browserSupportsWebAuthn = () => false;
export {
  indisponivel as createCredential, indisponivel as getCredential,
  indisponivel as deserializeCredentialCreationOptions,
  indisponivel as deserializeCredentialRequestOptions,
  indisponivel as serializeCredentialCreationResponse,
  indisponivel as serializeCredentialRequestResponse
};
`,
    },
  ]);
}
