// Entrada do _worker.js. A configuração pública é injetada pelo esbuild na
// finalização do build (scripts/hospedagem.mjs); nada aqui lê ambiente.
import { criarWorker } from "./compartilhamento";
import type { HospedagemConfig } from "./contrato";

declare const __IKCOUS_HOSPEDAGEM__: HospedagemConfig;

export default criarWorker(__IKCOUS_HOSPEDAGEM__);
