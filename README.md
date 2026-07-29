# 🛒 IKCOUS Marketplace

Uma plataforma de marketplace moderna, rápida e responsiva, focada em produtos com estoque imediato em Monte Carmelo, MG.

## ✨ Características Principais

- **🚀 Performance Extrema**: Construído com Vite + React 19 para carregamento instantâneo.
- **📱 PWA Ready**: Instalável no celular para uma experiência de aplicativo nativo.
- **🔔 Notificações Push**: Sistema de avisos para avaliações respondidas e promoções via Web Push.
- **💳 Checkout Fluído**: Integração direta com WhatsApp para finalização de pedidos rápida e segura.
- **🛡️ Painel Admin Premium**: Gestão completa de produtos, categorias, cupons, Q&A e avaliações com estética de alto nível.
- **💬 Interatividade**: Sistema de Perguntas e Respostas (Q&A) e avaliações de clientes.

## 🛠️ Stack Tecnológica

- **Frontend**: React 19, TypeScript, Tailwind CSS.
- **UI Components**: Radix UI + Lucide React.
- **Backend/DB**: Supabase (Auth, Database, Realtime, Storage).
- **Edge Logic**: Supabase Edge Functions (Deno).
- **Deploy**: Vercel.

## 📦 Estrutura do Projeto

- `/src/components`: Componentes de UI reutilizáveis e customizados.
- `/src/hooks`: Lógica de negócios encapsulada (Supabase integration).
- `/src/views`: Páginas principais do Marketplace e Admin.
- `/src/contexts`: Gerenciamento de estado global (Auth, etc).
- `/supabase/functions`: Lógica de servidor (Push Notifications).

## 🚀 Como Executar

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Configure as variáveis no `.env.local` (copie de `.env.example`):

   ```env
   VITE_SUPABASE_URL=seu_url
   VITE_SUPABASE_ANON_KEY=sua_chave
   VITE_VAPID_PUBLIC_KEY=sua_chave_vapid
   ```

   > Os nomes precisam bater exatamente com estes — o Vite embute as
   > variáveis no build, então um nome errado deixa o app sem conexão com o
   > Supabase e sem erro visível.

3. Inicie o ambiente de desenvolvimento:

   ```bash
   npm run dev
   ```

### 📱 Testando no celular durante o desenvolvimento

O `vite.config.ts` já usa `server.host: true`, então o servidor de dev escuta
na rede local e não apenas em `localhost`. Para abrir o app no celular
enquanto edita o código no computador:

1. Com o `npm run dev` rodando, o Vite imprime dois endereços. Use o que
   aparece como **Network**, por exemplo `http://192.168.0.15:5173`.
2. Conecte o celular ao **mesmo Wi-Fi** do computador e abra esse endereço
   no navegador.
3. O hot reload funciona normalmente: salvou um arquivo, a tela do celular
   atualiza sozinha.

Se o endereço não abrir, quase sempre é o firewall do sistema bloqueando
conexões de entrada na porta 5173 — libere a porta para redes privadas.

Esse fluxo exige rodar o projeto na sua própria máquina. Sessões do Claude
Code na web executam num container isolado na nuvem, sem rota de rede até
seus dispositivos; nesses casos, use os deploys de preview da Vercel.

## 📄 Deploy & Produção

Consulte o arquivo [DEPLOYMENT.md](./DEPLOYMENT.md) para instruções detalhadas sobre como colocar este projeto no ar.

---
*Desenvolvido com foco em UX e Acessibilidade.*
