# Prova local do envio retomavel

Execute `node tests/browser-identity-upload/run.mjs` na raiz do worktree. O runner usa somente esbuild, Puppeteer e Sharp ja instalados, nao le env nem sobe o aplicativo. Evidencias ficam em `C:/Users/Gabriel/recuperacao-ikcous/20260909-ecossistema/controle/tarefa-A5c3b-browser-<timestamp>`.

O navegador executa preparador, coordenador, cliente TUS 4.3.1 ESM browser, transporte e verificador reais. O servidor sintetico recebe bytes em memoria e implementa POST, HEAD, PATCH e GET publico. URLs Supabase ficticias passam pelas guardas de produto; somente o fetch injetado pelo harness mapeia para loopback. CSP e interceptacao bloqueiam rede externa. Autorizacao e exclusivamente ficticia e redigida nas evidencias.

A prova inclui original JPEG decodificavel de exatamente 20 MiB, chunks 6/6/6/2 MiB, cancelamento e recarga mantendo localStorage, vinculo de HEAD, sessao, conflitos, erro de resposta final e confirmacao pelo SHA publico. O import TUS testa/restaura a chave `tusSupport`; armazenamento nao e totalmente livre de acessos globais. Nao prova DNS, TLS, CORS, CDN, permissoes nem servico real Supabase. Nenhum objeto ou dado remoto e criado, apagado ou ativado.
