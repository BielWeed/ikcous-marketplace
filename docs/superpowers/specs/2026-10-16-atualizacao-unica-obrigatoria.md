# Atualização única, obrigatória e com novidades — desenho aprovado (16/10/2026)

Pedido do dono: depois de publicar, o aviso de atualização aparece de formas diferentes (cartão no painel, faixa na
loja, mensagem depois do recarregamento). Ele quer **uma notificação só**, **sem botão de não atualizar**, mostrando
"instalando" e "instalou" na barra superior que expande (a ilha), e depois deixar na área de Notificações as novidades,
correções e melhorias da versão **em linguagem de lojista leigo**.

Decisão do sócio, aprovada pelo dono (não renegociar sem ele):

1. **Obrigatória, sem botão de recusar, sem prazo máximo de espera.**
2. **Só instala num ponto de parada:** quando a pessoa troca de tela (a tela muda, ela já espera) ou quando o app vai
   para segundo plano (documento oculto). Nunca no meio de uma tela parada.
3. **Espera TODAS as abas abertas ficarem livres**, não só a aba onde a atualização chegou. (O `vite-plugin-pwa` 2.0.0
   em modo `prompt` instala um ouvinte `controlling` que recarrega as outras abas sem consultar ninguém.)
4. **Nenhuma versão corta pagamento ou venda no meio**, nem a "versão mínima obrigatória" (`config.minAppVersion`):
   o caminho obrigatório passa pela MESMA regra de momento seguro. Os momentos sensíveis acabam sozinhos.
5. **Trava contra recarregamento infinito:** no máximo 2 tentativas por versão-alvo em cada aparelho; se a versão nova
   não entrou, desiste em silêncio (já aconteceu em julho).
6. O **comprador** vê a ilha por cerca de 1 s ("Atualizando…" e "Pronto"), **sem** novidades. O **lojista** vê a ilha no
   painel (que hoje não tem ilha) e recebe as novidades na central de Notificações dele.
7. Novidades: um texto por versão, em linguagem simples, versionado no repositório e embutido no build. O portão de
   publicação passa a exigir que exista nota para a versão (aceita uma linha simples, ex.: "Correções de estabilidade").

## O que NÃO muda
Banco de dados, service worker (`src/sw/sw.ts`), `vite.config.ts`, headers do `vercel.json`, `recuperacao-chunk.ts`
(a mecânica de aplicar e recarregar com prazo de 1,2 s é reaproveitada, não reescrita).

## Onda 1 (frentes independentes)

### Frente `instalador` (risco ALTO: recarregamento, purga, abas) — posse em `docs/superpowers/lanes/...onda1.json`
Entrega o **contrato de estado** que a Onda 2 consome, em `src/lib/atualizacao/`:

```ts
// src/lib/atualizacao/estado-da-atualizacao.ts
export type FaseDaAtualizacao = "nenhuma" | "aguardando" | "instalando" | "concluida";
export interface EstadoDaAtualizacao {
  readonly fase: FaseDaAtualizacao;
  readonly versaoNova: string | null; // núcleo semver legível, ex. "1.5.32"
}
export function obterEstadoDaAtualizacao(): EstadoDaAtualizacao;
export function definirEstadoDaAtualizacao(parcial: Partial<EstadoDaAtualizacao>): void;
export function useEstadoDaAtualizacao(): EstadoDaAtualizacao; // useSyncExternalStore
/** fase "concluida" por ~3 s (duracaoMs) e volta a "nenhuma". */
export function anunciarAtualizacaoConcluida(opcoes?: { duracaoMs?: number }): void;
```

Também em `src/lib/atualizacao/`: `momento-seguro.ts` (função pura
`decidirMomentoSeguro({ view, adminDirty, pedidoPendenteDoCheckout, documentoOculto, trocouDeTela })`),
`coordenacao-entre-abas.ts` (BroadcastChannel: cada aba publica se está segura; antes de instalar pergunta às
outras e espera uma janela curta, ~300 ms; qualquer "ocupada" adia; sem resposta = está sozinha; sem BroadcastChannel =
só esta aba), `trava-anti-repeticao.ts` (máx. 2 tentativas por versão-alvo; chave `pwa_*` para sobreviver à purga).

`src/lib/motivo-de-recarga.ts` ganha `consumirOrigemDaAtualizacao(versaoAtual): { trocouDeBuild: boolean; de: string | null }`
(lê E limpa a origem, devolvendo também a versão de onde veio — a Onda 2 usa `de` para escolher as novidades).
`atualizacaoTrocouDeBuild` continua existindo e se comportando igual (outros testes dependem dele).

`src/components/pwa/PWAUpdateGate.tsx`: deixa de renderizar cartão e faixa; passa a ORQUESTRAR: `needRefresh` ligado →
fase "aguardando" (+ `versaoNova`); ao chegar um ponto de parada seguro, com todas as abas seguras e a trava liberada →
fase "instalando" e aplica via `aplicarAtualizacaoPendenteERecarregar` (já existente). Sem soneca, sem "Depois".
`src/hooks/useUpdateCheck.ts`: o caminho `minAppVersion` deixa de purgar na hora do boot sem olhar nada: passa pela mesma
regra (no boot o "ponto de parada" já está satisfeito, mas as proteções de pagamento/venda valem); o export enganoso
`performNuclearPurge` (que aponta para o apply normal) ganha nome honesto. A purga real continua restrita a esse caminho.
`UpdateNotification.tsx` e `AvisoDeAtualizacaoDiscreto.tsx` e os testes só deles são REMOVIDOS; os testes que protegiam
comportamento que continua (não interromper checkout/PDV, apply recarrega sozinho, realtime sem aviso paralelo, versão
limpa) são reescritos para o desenho novo, sem enfraquecer a proteção.

### Frente `novidades` (dados e armazenamento local)
- `src/novidades/notas-das-versoes.json`: `{ "<x.y.z>": { "titulo": string, "novidades": string[], "correcoes": string[], "melhorias": string[] } }`.
  Texto para lojista leigo: frases curtas, sem jargão (sem "PR", "migration", "deploy", "cache", "service worker", "SHA"…),
  sem nome de loja ou cliente. Entrada inicial: `1.5.31` (ver brief).
- `src/lib/novidades/notas.ts`: tipos, validação, `notasEntre(de: string | null, para: string)` (versões > `de` e ≤ `para`,
  ordem crescente por semver; `de` nulo → só `para`; versão sem nota → lista vazia, nunca erro).
- `src/lib/novidades/armazenamento-local.ts`: histórico por aparelho (não por conta) em `localStorage`, chave com o prefixo
  `notificacoes-` (sobrevive à purga, ver `src/lib/localStoragePurgeWhitelist.ts`). API:
  `registrarNovidadesDaAtualizacao({ de, para, agora? })` (idempotente por versão), `listarNovidades()`,
  `marcarNovidadeComoLida(versao)`, `marcarTodasComoLidas()`, `useNovidadesDoAparelho()` (useSyncExternalStore + evento
  `storage`). Teto de 20 entradas; storage indisponível → memória, sem lançar erro.
- Teste-guarda: nenhuma nota usa as palavras técnicas proibidas.

### Frente `portao-notas` (risco MÉDIO: portão de publicação)
`scripts/frota/publicar-release.mjs`: antes do ensaio/promoção, **exige** que `src/novidades/notas-das-versoes.json` do
checkout no SHA da release tenha entrada para a versão publicada (título não vazio e ao menos um item numa das listas);
sem ela: BLOQUEADO com mensagem clara em português, apontando o arquivo. Testes em `tests/frota_publicar_release_test.ts`;
uma linha no `docs/runbooks/producao-unica-fonte.md`.

## Onda 2 (depende dos contratos acima — só começa com a Onda 1 integrada)
- `ilha`: `IlhaDeAtualizacao` (aria-live, `prefers-reduced-motion`), montada no Header do cliente e no cabeçalho do painel
  (`AdminLayout`); o efeito de boot do `App.tsx` ("Sistema Atualizado") passa a chamar `anunciarAtualizacaoConcluida()` e
  `registrarNovidadesDaAtualizacao({ de, para })` em vez do toast de sucesso.
- `central-lojista`: `AdminNotificationsView` ganha a seção "Novidades do app", marcável como lida. Sem mexer no sino.

## Como desfazer
Publicar a versão anterior (o mecanismo de atualização dos aparelhos a instala sozinho). Não há banco nem migration.

## Emendas pós-revisão (16/10/2026)

- **`src/sw/sw.ts` e `src/lib/recuperacao-chunk.ts` mudaram** (a seção "O que NÃO muda" ficou para trás): o service worker ganhou guarda para navegador sem `BroadcastChannel`, e a recuperação de chunk passou a consultar o veto de operação sensível antes de recarregar. Publicar esta versão exige o service worker novo em TODAS as lojas.
- **A ilha não usa framer-motion** (o caminho do primeiro paint não pode baixá-lo): a entrada é CSS (`tailwindcss-animate`, `motion-safe:`). `aoIniciarAposAtualizacao` mora em `src/components/pwa/ao-iniciar-apos-atualizacao.ts`, fora do arquivo da ilha.
- **Novidades na primeira passagem 1.5.31→1.5.32:** o build 1.5.31 nunca gravou a chave "última versão vista"; quando a troca de build está provada, a origem gravada pela própria atualização (`de`) faz as vezes dessa chave.
- **Caminho de falha:** quando a recarga não traz versão nova, o boot ainda mostra um toast neutro ("não houve confirmação"). É a única segunda superfície; só aparece em falha.
- **A primeira passagem para esta versão é conduzida pelo código antigo** já instalado nos aparelhos, então o aviso antigo (com "Depois") aparece mais uma vez.
