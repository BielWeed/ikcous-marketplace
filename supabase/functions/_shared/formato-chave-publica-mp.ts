// Mesmo formato no painel e no servidor. O prefixo sozinho também casa
// com Access Tokens e não é suficiente para decidir o que pode ser público.
export const FORMATO_CHAVE_PUBLICA_MP =
    /^(APP_USR|TEST)-[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

export const ERRO_FORMATO_CHAVE_PUBLICA_MP =
    "Copie a chave pública (Public Key) no painel do Mercado Pago. Confira se não colou o token secreto.";

export const ERRO_CHAVE_PUBLICA_IGUAL_AO_TOKEN_MP =
    "A chave pública não pode ser o token secreto. Confira os campos.";
