// Apresentação apenas: a preparação do build já validou a identidade inteira.
// Não há marca de reserva fora da entrega nem semente para configuração gravável.
//
// O PIVÔ (etapa 2 da escala, 11/09/2026): com um build ÚNICO servindo N
// lojas, o "assado" (`__STORE_IDENTITY__`) deixa de bastar sozinho — em modo
// `database` ele carrega UMA loja só, em modo `fixture` compartilhado é a
// loja "de ninguém". Quando o porteiro (`middleware.ts`, na borda) grava a
// FICHA DA LOJA no HTML, ela VENCE para marca (`identity`, `localUrls`,
// `publicUrl`, `identityRevision`). Os campos de CÓDIGO (`codeVersion`,
// `codeSha`, `deliveryVersion`) continuam vindo do assado — a ficha não os
// carrega, porque publicar código é um evento separado de configurar loja.
//
// Ficha AUSENTE (build de loja única, sem porteiro na frente): nada muda,
// cai no assado — é o caminho que os 3520 testes já cobrem hoje, e continua
// verde porque nenhuma suíte injeta `#ikcous-loja` no jsdom.
//
// Ficha PRESENTE e inválida: `lerFichaDaLoja()` lança `IDENTITY_FICHA_INVALID`
// — nunca cai no assado, que num build compartilhado pode ser de OUTRA loja.
// FALHA FECHADA VISÍVEL (menor da revisão Opus, rodada B, 11/09/2026): antes
// de relançar, pinta a tela — sem isso o React nunca monta e o loader do
// silent-guardian fica girando para sempre, sem nenhuma mensagem (o mesmo
// bug que `env.ts` já resolve para chave de ambiente ausente; aqui é o
// equivalente para ficha corrompida).
//
// CORREÇÃO (rodada 2, achado 1 do revisor Opus, 11/09/2026): a versão
// anterior chamava `renderBootFailure` (`@/lib/env`) importando aquele
// módulo DINAMICAMENTE de dentro do `catch`. Isso não funciona: `env.ts`
// computa `SUPABASE_URL = lerSupabaseUrl()` na PRÓPRIA avaliação do módulo
// (T1, rodada A, fora do escopo desta tarefa) — e essa chamada volta a
// invocar `lerFichaDaLoja()`, que relança O MESMO `IDENTITY_FICHA_INVALID`
// (o cache do módulo só guarda SUCESSO, nunca falha — cada chamada com
// ficha inválida revalida e relança). Em ESM, um módulo cuja avaliação
// lança nunca entrega seu namespace a quem o importa — nem por import
// estático, nem por import DINÂMICO — então `import("@/lib/env")` SEMPRE
// rejeitava neste ramo, o `.then(renderBootFailure)` nunca rodava, `#root`
// ficava vazio e o loader do silent-guardian continuava girando: o "loader
// eterno sem mensagem" que este item existe para eliminar. Medido com o
// módulo real (sem mock): `#root.innerHTML === ""` e stderr com
// `[fichaDaLoja] Não foi possível pintar a falha de boot.`.
//
// A pintura abaixo é uma cópia mínima e AUTÔNOMA (sem nenhum import): o
// único jeito de garantir que ela roda justamente no caso em que qualquer
// módulo que dependa da ficha (como `@/lib/env`) está, por desenho,
// impedido de terminar de avaliar. `env.ts` continua exportando
// `renderBootFailure` para o próprio portão dela (chave de ambiente
// ausente) — os dois pintam a MESMA tela, mas por caminhos independentes,
// de propósito.
import { lerFichaDaLoja } from "./fichaDaLoja";

if (typeof __STORE_IDENTITY__ === "undefined") {
  throw new Error("IDENTITY_BUILD_MISSING");
}

function pintarFichaInvalidaNoBoot(titulo: string, detalhe: string): void {
  if (typeof document === "undefined") return;

  // O loader do silent-guardian fica por cima de tudo e tem fallback
  // próprio de 20s — sem removê-lo, a mensagem ficaria escondida atrás dele.
  document.getElementById("silent-guardian-loader")?.remove();

  const host = document.getElementById("root") || document.body;
  host.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.style.cssText =
    "position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:32px;background:#dc2626;color:#fff;font-family:Inter,system-ui,sans-serif;text-align:center;";

  const heading = document.createElement("h1");
  heading.style.cssText = "margin:0;font-size:28px;font-weight:900;";
  heading.textContent = titulo;

  const message = document.createElement("p");
  message.style.cssText =
    "margin:0;max-width:420px;font-size:16px;line-height:1.6;";
  message.textContent = detalhe;

  wrapper.append(heading, message);
  host.append(wrapper);
}

let fichaDaLoja: ReturnType<typeof lerFichaDaLoja>;
try {
  fichaDaLoja = lerFichaDaLoja();
} catch (erro) {
  pintarFichaInvalidaNoBoot(
    "Loja em manutenção",
    "Não foi possível confirmar os dados desta loja agora. Recarregue em alguns instantes.",
  );
  throw erro;
}

export const buildIdentity: typeof __STORE_IDENTITY__ = fichaDaLoja
  ? { ...__STORE_IDENTITY__, source: "porteiro", ...fichaDaLoja.identidade }
  : __STORE_IDENTITY__;
