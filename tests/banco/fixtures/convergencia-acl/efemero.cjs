"use strict";

// Casca: a prova do PR #741 (pix-do-balcao-viva.cjs) pede "./efemero.cjs" ao lado
// dela. Ela mora aqui SEM EDICAO (identica a do PR); este arquivo so repassa a
// trava de banco efemero de tests/banco/efemero.cjs.
module.exports = require("../../efemero.cjs");
