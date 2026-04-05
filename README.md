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

2. Configure as variáveis no `.env`:

   ```env
   VITE_SUPABASE_URL=seu_url
   VITE_SUPABASE_ANON_KEY=sua_chave
   ```

3. Inicie o ambiente de desenvolvimento:

   ```bash
   npm run dev
   ```

## 📄 Deploy & Produção

Consulte o arquivo [DEPLOYMENT.md](./DEPLOYMENT.md) para instruções detalhadas sobre como colocar este projeto no ar.

---
*Desenvolvido com foco em UX e Acessibilidade.*
