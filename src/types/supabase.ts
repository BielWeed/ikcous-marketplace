export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      _ninja_migrations: {
        Row: {
          applied_at: string | null
          checksum: string | null
          filename: string | null
          id: number
        }
        Insert: {
          applied_at?: string | null
          checksum?: string | null
          filename?: string | null
          id?: number
        }
        Update: {
          applied_at?: string | null
          checksum?: string | null
          filename?: string | null
          id?: number
        }
        Relationships: []
      }
      alertas: {
        Row: {
          data: string
          id: string
          lida: boolean | null
          mensagem: string | null
          tipo: string | null
          titulo: string
        }
        Insert: {
          data?: string
          id?: string
          lida?: boolean | null
          mensagem?: string | null
          tipo?: string | null
          titulo: string
        }
        Update: {
          data?: string
          id?: string
          lida?: boolean | null
          mensagem?: string | null
          tipo?: string | null
          titulo?: string
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          metadata: Json | null
          product_id: string | null
          source_view: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          product_id?: string | null
          source_view?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          product_id?: string | null
          source_view?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      answers: {
        Row: {
          answer: string
          created_at: string
          id: string
          question_id: string
          user_id: string
        }
        Insert: {
          answer: string
          created_at?: string
          id?: string
          question_id: string
          user_id: string
        }
        Update: {
          answer?: string
          created_at?: string
          id?: string
          question_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      banners: {
        Row: {
          active: boolean | null
          created_at: string
          id: string
          image_url: string
          link: string | null
          order: number | null
          position: string | null
          title: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string
          id?: string
          image_url: string
          link?: string | null
          order?: number | null
          position?: string | null
          title?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string
          id?: string
          image_url?: string
          link?: string | null
          order?: number | null
          position?: string | null
          title?: string | null
        }
        Relationships: []
      }
      cart_items: {
        Row: {
          created_at: string
          id: string
          product_id: string
          quantity: number
          updated_at: string
          user_id: string
          variant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          quantity?: number
          updated_at?: string
          user_id: string
          variant_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
          updated_at?: string
          user_id?: string
          variant_id?: string
        }
        Relationships: []
      }
      categorias: {
        Row: {
          ativo: boolean | null
          created_at: string
          descricao: string | null
          id: string
          nome: string
          slug: string | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          slug?: string | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
          slug?: string | null
        }
        Relationships: []
      }
      companies: {
        Row: {
          cnpj: string | null
          created_at: string | null
          email: string | null
          endereco: Json | null
          id: string
          nome: string
          telefone: string | null
          website: string | null
        }
        Insert: {
          cnpj?: string | null
          created_at?: string | null
          email?: string | null
          endereco?: Json | null
          id?: string
          nome: string
          telefone?: string | null
          website?: string | null
        }
        Update: {
          cnpj?: string | null
          created_at?: string | null
          email?: string | null
          endereco?: Json | null
          id?: string
          nome?: string
          telefone?: string | null
          website?: string | null
        }
        Relationships: []
      }
      configuracoes: {
        Row: {
          dias_sem_venda_alerta: number | null
          estoque_minimo_alerta: number | null
          id: string
          moeda: string | null
          notificacoes_ativas: boolean | null
          tema: string | null
        }
        Insert: {
          dias_sem_venda_alerta?: number | null
          estoque_minimo_alerta?: number | null
          id?: string
          moeda?: string | null
          notificacoes_ativas?: boolean | null
          tema?: string | null
        }
        Update: {
          dias_sem_venda_alerta?: number | null
          estoque_minimo_alerta?: number | null
          id?: string
          moeda?: string | null
          notificacoes_ativas?: boolean | null
          tema?: string | null
        }
        Relationships: []
      }
      coupons: {
        Row: {
          active: boolean | null
          code: string
          created_at: string
          id: string
          min_purchase: number | null
          type: string
          usage_count: number | null
          usage_limit: number | null
          used_count: number | null
          valid_until: string | null
          value: number
        }
        Insert: {
          active?: boolean | null
          code: string
          created_at?: string
          id?: string
          min_purchase?: number | null
          type: string
          usage_count?: number | null
          usage_limit?: number | null
          used_count?: number | null
          valid_until?: string | null
          value: number
        }
        Update: {
          active?: boolean | null
          code?: string
          created_at?: string
          id?: string
          min_purchase?: number | null
          type?: string
          usage_count?: number | null
          usage_limit?: number | null
          used_count?: number | null
          valid_until?: string | null
          value?: number
        }
        Relationships: []
      }
      favorites: {
        Row: {
          created_at: string
          id: string
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          user_id?: string
        }
        Relationships: []
      }
      fluxo_caixa: {
        Row: {
          categoria: string | null
          data: string
          descricao: string | null
          id: string
          relacionado_id: string | null
          tipo: string | null
          valor: number
        }
        Insert: {
          categoria?: string | null
          data?: string
          descricao?: string | null
          id?: string
          relacionado_id?: string | null
          tipo?: string | null
          valor: number
        }
        Update: {
          categoria?: string | null
          data?: string
          descricao?: string | null
          id?: string
          relacionado_id?: string | null
          tipo?: string | null
          valor?: number
        }
        Relationships: []
      }
      fornecedores: {
        Row: {
          ativo: boolean | null
          confiabilidade: number | null
          contato: string | null
          created_at: string
          email: string | null
          id: string
          nome: string
          prazo_medio: number | null
          telefone: string | null
        }
        Insert: {
          ativo?: boolean | null
          confiabilidade?: number | null
          contato?: string | null
          created_at?: string
          email?: string | null
          id?: string
          nome: string
          prazo_medio?: number | null
          telefone?: string | null
        }
        Update: {
          ativo?: boolean | null
          confiabilidade?: number | null
          contato?: string | null
          created_at?: string
          email?: string | null
          id?: string
          nome?: string
          prazo_medio?: number | null
          telefone?: string | null
        }
        Relationships: []
      }
      historico_precos: {
        Row: {
          data: string
          id: string
          motivo: string | null
          preco_antigo: number | null
          preco_novo: number | null
          produto_id: string | null
        }
        Insert: {
          data?: string
          id?: string
          motivo?: string | null
          preco_antigo?: number | null
          preco_novo?: number | null
          produto_id?: string | null
        }
        Update: {
          data?: string
          id?: string
          motivo?: string | null
          preco_antigo?: number | null
          preco_novo?: number | null
          produto_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "historico_precos_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_precos_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "vw_produtos_public"
            referencedColumns: ["id"]
          },
        ]
      }
      kanban_cards: {
        Row: {
          data_criacao: string
          data_limite: string | null
          descricao: string | null
          id: string
          prioridade: string | null
          status: string | null
          tags: string[] | null
          titulo: string
        }
        Insert: {
          data_criacao?: string
          data_limite?: string | null
          descricao?: string | null
          id?: string
          prioridade?: string | null
          status?: string | null
          tags?: string[] | null
          titulo: string
        }
        Update: {
          data_criacao?: string
          data_limite?: string | null
          descricao?: string | null
          id?: string
          prioridade?: string | null
          status?: string | null
          tags?: string[] | null
          titulo?: string
        }
        Relationships: []
      }
      marketplace_ai_state: {
        Row: {
          component_name: string
          state_json: Json
          updated_at: string | null
        }
        Insert: {
          component_name: string
          state_json: Json
          updated_at?: string | null
        }
        Update: {
          component_name?: string
          state_json?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      marketplace_order_history: {
        Row: {
          created_at: string | null
          id: string
          new_status: string
          notes: string | null
          old_status: string | null
          order_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          new_status: string
          notes?: string | null
          old_status?: string | null
          order_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          new_status?: string
          notes?: string | null
          old_status?: string | null
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_order_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "marketplace_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_order_items: {
        Row: {
          created_at: string | null
          id: string
          image_url: string | null
          order_id: string | null
          price: number
          product_id: string | null
          product_name: string | null
          quantity: number
          variant_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          image_url?: string | null
          order_id?: string | null
          price: number
          product_id?: string | null
          product_name?: string | null
          quantity: number
          variant_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          image_url?: string | null
          order_id?: string | null
          price?: number
          product_id?: string | null
          product_name?: string | null
          quantity?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "marketplace_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "vw_produtos_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_orders: {
        Row: {
          coupon_code: string | null
          created_at: string
          customer_data: Json
          customer_name: string
          discount: number | null
          id: string
          notes: string | null
          payment_method: string | null
          shipping: number | null
          status: string | null
          subtotal: number
          total: number
          tracking_code: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          coupon_code?: string | null
          created_at?: string
          customer_data: Json
          customer_name: string
          discount?: number | null
          id?: string
          notes?: string | null
          payment_method?: string | null
          shipping?: number | null
          status?: string | null
          subtotal: number
          total: number
          tracking_code?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          coupon_code?: string | null
          created_at?: string
          customer_data?: Json
          customer_name?: string
          discount?: number | null
          id?: string
          notes?: string | null
          payment_method?: string | null
          shipping?: number | null
          status?: string | null
          subtotal?: number
          total?: number
          tracking_code?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      metas: {
        Row: {
          ativa: boolean | null
          concluida: boolean | null
          data_fim: string
          data_inicio: string
          descricao: string | null
          id: string
          tipo: string | null
          titulo: string
          valor_atual: number | null
          valor_target: number
        }
        Insert: {
          ativa?: boolean | null
          concluida?: boolean | null
          data_fim: string
          data_inicio: string
          descricao?: string | null
          id?: string
          tipo?: string | null
          titulo: string
          valor_atual?: number | null
          valor_target: number
        }
        Update: {
          ativa?: boolean | null
          concluida?: boolean | null
          data_fim?: string
          data_inicio?: string
          descricao?: string | null
          id?: string
          tipo?: string | null
          titulo?: string
          valor_atual?: number | null
          valor_target?: number
        }
        Relationships: []
      }
      notificacoes: {
        Row: {
          acao: Json | null
          created_at: string
          dados: Json | null
          id: string
          lida: boolean | null
          mensagem: string | null
          tipo: string | null
          titulo: string
          usuario_id: string | null
        }
        Insert: {
          acao?: Json | null
          created_at?: string
          dados?: Json | null
          id?: string
          lida?: boolean | null
          mensagem?: string | null
          tipo?: string | null
          titulo: string
          usuario_id?: string | null
        }
        Update: {
          acao?: Json | null
          created_at?: string
          dados?: Json | null
          id?: string
          lida?: boolean | null
          mensagem?: string | null
          tipo?: string | null
          titulo?: string
          usuario_id?: string | null
        }
        Relationships: []
      }
      pedido_itens: {
        Row: {
          id: string
          nome_produto: string | null
          pedido_id: string | null
          preco_unitario: number
          produto_id: string | null
          quantidade: number
        }
        Insert: {
          id?: string
          nome_produto?: string | null
          pedido_id?: string | null
          preco_unitario: number
          produto_id?: string | null
          quantidade: number
        }
        Update: {
          id?: string
          nome_produto?: string | null
          pedido_id?: string | null
          preco_unitario?: number
          produto_id?: string | null
          quantidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "pedido_itens_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "vw_produtos_public"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos: {
        Row: {
          codigo_rastreio: string | null
          data_entrega: string | null
          data_pedido: string
          data_prevista: string | null
          fornecedor_id: string | null
          fornecedor_nome: string | null
          id: string
          status: string | null
          valor_total: number | null
        }
        Insert: {
          codigo_rastreio?: string | null
          data_entrega?: string | null
          data_pedido?: string
          data_prevista?: string | null
          fornecedor_id?: string | null
          fornecedor_nome?: string | null
          id?: string
          status?: string | null
          valor_total?: number | null
        }
        Update: {
          codigo_rastreio?: string | null
          data_entrega?: string | null
          data_pedido?: string
          data_prevista?: string | null
          fornecedor_id?: string | null
          fornecedor_nome?: string | null
          id?: string
          status?: string | null
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          active: boolean | null
          created_at: string
          id: string
          name: string
          price_override: number | null
          product_id: string
          sku: string | null
          stock_increment: number | null
          value: string
        }
        Insert: {
          active?: boolean | null
          created_at?: string
          id?: string
          name: string
          price_override?: number | null
          product_id: string
          sku?: string | null
          stock_increment?: number | null
          value: string
        }
        Update: {
          active?: boolean | null
          created_at?: string
          id?: string
          name?: string
          price_override?: number | null
          product_id?: string
          sku?: string | null
          stock_increment?: number | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "vw_produtos_public"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos: {
        Row: {
          ativo: boolean | null
          categoria: string | null
          codigo: string | null
          custo: number
          data_cadastro: string
          descricao: string | null
          estoque: number | null
          estoque_minimo: number | null
          fornecedor_id: string | null
          frete_gratis: boolean | null
          id: string
          imagem_url: string | null
          imagem_urls: string[] | null
          is_bestseller: boolean | null
          meta_description: string | null
          meta_title: string | null
          nome: string
          preco_original: number | null
          preco_venda: number
          sold: number | null
          tags: string[] | null
          ultima_atualizacao: string
        }
        Insert: {
          ativo?: boolean | null
          categoria?: string | null
          codigo?: string | null
          custo: number
          data_cadastro?: string
          descricao?: string | null
          estoque?: number | null
          estoque_minimo?: number | null
          fornecedor_id?: string | null
          frete_gratis?: boolean | null
          id?: string
          imagem_url?: string | null
          imagem_urls?: string[] | null
          is_bestseller?: boolean | null
          meta_description?: string | null
          meta_title?: string | null
          nome: string
          preco_original?: number | null
          preco_venda: number
          sold?: number | null
          tags?: string[] | null
          ultima_atualizacao?: string
        }
        Update: {
          ativo?: boolean | null
          categoria?: string | null
          codigo?: string | null
          custo?: number
          data_cadastro?: string
          descricao?: string | null
          estoque?: number | null
          estoque_minimo?: number | null
          fornecedor_id?: string | null
          frete_gratis?: boolean | null
          id?: string
          imagem_url?: string | null
          imagem_urls?: string[] | null
          is_bestseller?: boolean | null
          meta_description?: string | null
          meta_title?: string | null
          nome?: string
          preco_original?: number | null
          preco_venda?: number
          sold?: number | null
          tags?: string[] | null
          ultima_atualizacao?: string
        }
        Relationships: [
          {
            foreignKeyName: "produtos_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company_id: string | null
          cpf: string | null
          created_at: string | null
          full_name: string | null
          id: string
          role: string | null
          updated_at: string | null
          whatsapp: string | null
        }
        Insert: {
          avatar_url?: string | null
          company_id?: string | null
          cpf?: string | null
          created_at?: string | null
          full_name?: string | null
          id: string
          role?: string | null
          updated_at?: string | null
          whatsapp?: string | null
        }
        Update: {
          avatar_url?: string | null
          company_id?: string | null
          cpf?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
          role?: string | null
          updated_at?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      push_notifications_log: {
        Row: {
          body: string
          created_by: string | null
          id: string
          recipient_count: number | null
          sent_at: string
          status: string | null
          title: string
          url: string | null
        }
        Insert: {
          body: string
          created_by?: string | null
          id?: string
          recipient_count?: number | null
          sent_at?: string
          status?: string | null
          title: string
          url?: string | null
        }
        Update: {
          body?: string
          created_by?: string | null
          id?: string
          recipient_count?: number | null
          sent_at?: string
          status?: string | null
          title?: string
          url?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string | null
        }
        Relationships: []
      }
      questions: {
        Row: {
          created_at: string
          id: string
          product_id: string
          question: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          question: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          question?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "questions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "vw_produtos_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      retiradas: {
        Row: {
          data: string
          descricao: string | null
          id: string
          responsavel: string | null
          valor: number
        }
        Insert: {
          data?: string
          descricao?: string | null
          id?: string
          responsavel?: string | null
          valor: number
        }
        Update: {
          data?: string
          descricao?: string | null
          id?: string
          responsavel?: string | null
          valor?: number
        }
        Relationships: []
      }
      reviews: {
        Row: {
          comment: string | null
          created_at: string
          helpful: number | null
          id: string
          merchant_reply: string | null
          merchant_reply_at: string | null
          product_id: string
          rating: number
          user_id: string
          verified: boolean | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          helpful?: number | null
          id?: string
          merchant_reply?: string | null
          merchant_reply_at?: string | null
          product_id: string
          rating: number
          user_id: string
          verified?: boolean | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          helpful?: number | null
          id?: string
          merchant_reply?: string | null
          merchant_reply_at?: string | null
          product_id?: string
          rating?: number
          user_id?: string
          verified?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "vw_produtos_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      store_config: {
        Row: {
          business_hours: string | null
          created_at: string | null
          enable_coupons: boolean | null
          enable_reviews: boolean | null
          free_shipping_min: number | null
          id: number
          logo_url: string | null
          min_app_version: string | null
          primary_color: string | null
          push_marketing_enabled: boolean | null
          real_time_sales_alerts: boolean | null
          share_text: string | null
          shipping_fee: number | null
          theme_mode: string | null
          updated_at: string | null
          whatsapp_number: string | null
        }
        Insert: {
          business_hours?: string | null
          created_at?: string | null
          enable_coupons?: boolean | null
          enable_reviews?: boolean | null
          free_shipping_min?: number | null
          id?: number
          logo_url?: string | null
          min_app_version?: string | null
          primary_color?: string | null
          push_marketing_enabled?: boolean | null
          real_time_sales_alerts?: boolean | null
          share_text?: string | null
          shipping_fee?: number | null
          theme_mode?: string | null
          updated_at?: string | null
          whatsapp_number?: string | null
        }
        Update: {
          business_hours?: string | null
          created_at?: string | null
          enable_coupons?: boolean | null
          enable_reviews?: boolean | null
          free_shipping_min?: number | null
          id?: number
          logo_url?: string | null
          min_app_version?: string | null
          primary_color?: string | null
          push_marketing_enabled?: boolean | null
          real_time_sales_alerts?: boolean | null
          share_text?: string | null
          shipping_fee?: number | null
          theme_mode?: string | null
          updated_at?: string | null
          whatsapp_number?: string | null
        }
        Relationships: []
      }
      user_addresses: {
        Row: {
          cep: string
          city: string
          complement: string | null
          created_at: string | null
          id: string
          is_default: boolean | null
          name: string
          neighborhood: string
          number: string
          recipient_name: string
          reference: string | null
          state: string
          street: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cep: string
          city: string
          complement?: string | null
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          neighborhood: string
          number: string
          recipient_name: string
          reference?: string | null
          state: string
          street: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cep?: string
          city?: string
          complement?: string | null
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          neighborhood?: string
          number?: string
          recipient_name?: string
          reference?: string | null
          state?: string
          street?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      v_store_config: {
        Row: {
          free_shipping_min: number | null
          shipping_fee: number | null
        }
        Insert: {
          free_shipping_min?: number | null
          shipping_fee?: number | null
        }
        Update: {
          free_shipping_min?: number | null
          shipping_fee?: number | null
        }
        Relationships: []
      }
      vendas: {
        Row: {
          canal: string | null
          cliente: string | null
          custo_unitario: number
          data: string
          id: string
          lucro: number | null
          preco_unitario: number
          produto_id: string | null
          produto_nome: string | null
          quantidade: number
        }
        Insert: {
          canal?: string | null
          cliente?: string | null
          custo_unitario: number
          data?: string
          id?: string
          lucro?: number | null
          preco_unitario: number
          produto_id?: string | null
          produto_nome?: string | null
          quantidade: number
        }
        Update: {
          canal?: string | null
          cliente?: string | null
          custo_unitario?: number
          data?: string
          id?: string
          lucro?: number | null
          preco_unitario?: number
          produto_id?: string | null
          produto_nome?: string | null
          quantidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "vendas_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendas_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "vw_produtos_public"
            referencedColumns: ["id"]
          },
        ]
      }
      vor_receipts: {
        Row: {
          action_type: string
          created_at: string | null
          id: string
          input_data: Json
          output_data: Json
          previous_hash: string | null
          proof_hash: string
          verified: boolean | null
        }
        Insert: {
          action_type: string
          created_at?: string | null
          id?: string
          input_data?: Json
          output_data?: Json
          previous_hash?: string | null
          proof_hash: string
          verified?: boolean | null
        }
        Update: {
          action_type?: string
          created_at?: string | null
          id?: string
          input_data?: Json
          output_data?: Json
          previous_hash?: string | null
          proof_hash?: string
          verified?: boolean | null
        }
        Relationships: []
      }
    }
    Views: {
      public_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          full_name: string | null
          id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string | null
        }
        Relationships: []
      }
      sales_overview: {
        Row: {
          average_ticket: number | null
          gross_revenue: number | null
          net_revenue: number | null
          sales_day: string | null
          total_orders: number | null
        }
        Relationships: []
      }
      vw_produtos_public: {
        Row: {
          ativo: boolean | null
          categoria: string | null
          data_cadastro: string | null
          descricao: string | null
          estoque: number | null
          frete_gratis: boolean | null
          id: string | null
          imagem_url: string | null
          imagem_urls: string[] | null
          is_bestseller: boolean | null
          meta_description: string | null
          meta_title: string | null
          nome: string | null
          preco_original: number | null
          preco_venda: number | null
          sold: number | null
          tags: string[] | null
        }
        Insert: {
          ativo?: boolean | null
          categoria?: string | null
          data_cadastro?: string | null
          descricao?: string | null
          estoque?: number | null
          frete_gratis?: boolean | null
          id?: string | null
          imagem_url?: string | null
          imagem_urls?: string[] | null
          is_bestseller?: boolean | null
          meta_description?: string | null
          meta_title?: string | null
          nome?: string | null
          preco_original?: number | null
          preco_venda?: number | null
          sold?: number | null
          tags?: string[] | null
        }
        Update: {
          ativo?: boolean | null
          categoria?: string | null
          data_cadastro?: string | null
          descricao?: string | null
          estoque?: number | null
          frete_gratis?: boolean | null
          id?: string | null
          imagem_url?: string | null
          imagem_urls?: string[] | null
          is_bestseller?: boolean | null
          meta_description?: string | null
          meta_title?: string | null
          nome?: string | null
          preco_original?: number | null
          preco_venda?: number | null
          sold?: number | null
          tags?: string[] | null
        }
        Relationships: []
      }
    }
    Functions: {
      answer_question_atomic:
        | {
            Args: { p_answer: string; p_question_id: string }
            Returns: undefined
          }
        | {
            Args: {
              p_admin_id: string
              p_answer: string
              p_question_id: string
            }
            Returns: undefined
          }
      check_is_admin: { Args: never; Returns: boolean }
      check_stock_v1: {
        Args: { p_product_id: string; p_quantity: number; p_variant_id: string }
        Returns: boolean
      }
      decrement_stock: {
        Args: { p_id: string; quantity: number }
        Returns: undefined
      }
      get_admin_analytics_v2: { Args: never; Returns: Json }
      get_admin_customers_paged: {
        Args: {
          p_page?: number
          p_page_size?: number
          p_search?: string
          p_sort_direction?: string
          p_sort_field?: string
        }
        Returns: Json
      }
      get_admin_dashboard_stats: { Args: never; Returns: Json }
      get_admin_dashboard_summary: { Args: never; Returns: Json }
      get_admin_executive_summary: { Args: never; Returns: Json }
      get_admin_list_paginated: {
        Args: {
          p_filter_status?: string
          p_page_number?: number
          p_page_size?: number
          p_search_query?: string
          p_table_name: string
        }
        Returns: Json
      }
      get_category_analytics: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: {
          name: string
          value: number
        }[]
      }
      get_coupon_stats: {
        Args: never
        Returns: {
          active_coupons: number
          avg_discount: number
          total_coupons: number
          total_uses: number
        }[]
      }
      get_customer_intelligence: {
        Args: never
        Returns: {
          customer_id: string
          customer_name: string
          is_push_subscribed: boolean
          last_order_at: string
          ltv_score: number
          order_count: number
          total_spent: number
        }[]
      }
      get_inventory_health: {
        Args: never
        Returns: {
          current_stock: number
          days_remaining: number
          product_id: string
          product_name: string
          sales_last_30d: number
        }[]
      }
      get_my_complete_profile: {
        Args: never
        Returns: {
          avatar_url: string
          created_at: string
          full_name: string
          id: string
          role: string
          whatsapp: string
        }[]
      }
      get_orders_by_whatsapp: {
        Args: { customer_email?: string; phone_number: string }
        Returns: Json[]
      }
      get_orders_by_whatsapp_v2: {
        Args: {
          p_email: string
          p_order_fragment: string
          p_phone_number: string
        }
        Returns: {
          coupon_code: string | null
          created_at: string
          customer_data: Json
          customer_name: string
          discount: number | null
          id: string
          notes: string | null
          payment_method: string | null
          shipping: number | null
          status: string | null
          subtotal: number
          total: number
          tracking_code: string | null
          updated_at: string
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "marketplace_orders"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_orders_by_whatsapp_v3: {
        Args: {
          p_customer_email: string
          p_order_fragment: string
          p_phone_number: string
        }
        Returns: {
          coupon_code: string | null
          created_at: string
          customer_data: Json
          customer_name: string
          discount: number | null
          id: string
          notes: string | null
          payment_method: string | null
          shipping: number | null
          status: string | null
          subtotal: number
          total: number
          tracking_code: string | null
          updated_at: string
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "marketplace_orders"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_product_optimization_data: {
        Args: never
        Returns: {
          current_min: number
          id: string
          name: string
          velocity: number
        }[]
      }
      get_product_recommendations: {
        Args: { p_limit?: number; p_product_id: string }
        Returns: {
          ativo: boolean | null
          categoria: string | null
          codigo: string | null
          custo: number
          data_cadastro: string
          descricao: string | null
          estoque: number | null
          estoque_minimo: number | null
          fornecedor_id: string | null
          frete_gratis: boolean | null
          id: string
          imagem_url: string | null
          imagem_urls: string[] | null
          is_bestseller: boolean | null
          meta_description: string | null
          meta_title: string | null
          nome: string
          preco_original: number | null
          preco_venda: number
          sold: number | null
          tags: string[] | null
          ultima_atualizacao: string
        }[]
        SetofOptions: {
          from: "*"
          to: "produtos"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_product_stats: { Args: never; Returns: Json[] }
      get_retention_analytics:
        | {
            Args: never
            Returns: {
              month: string
              retention_rate: number
              returning_customers: number
              total_customers: number
            }[]
          }
        | { Args: { p_days?: number }; Returns: number }
      get_retention_rate: { Args: never; Returns: number }
      get_sales_analytics:
        | {
            Args: { end_date: string; start_date: string }
            Returns: {
              day: string
              orders: number
              revenue: number
              ticket: number
            }[]
          }
        | {
            Args: { end_date: string; start_date: string }
            Returns: {
              day: string
              orders: number
              revenue: number
              ticket: number
            }[]
          }
      get_segmented_push_targets: {
        Args: {
          p_days_inactive?: number
          p_min_ltv?: number
          p_segment?: string
        }
        Returns: {
          auth: string
          endpoint: string
          p256dh: string
          user_id: string
        }[]
      }
      increment_helpful: { Args: { review_id: string }; Returns: undefined }
      is_admin: { Args: never; Returns: boolean }
      record_vor_action: {
        Args: {
          p_action_type: string
          p_input_data: Json
          p_output_data: Json
          p_proof_hash: string
        }
        Returns: undefined
      }
      reply_review_atomic:
        | { Args: { p_reply: string; p_review_id: string }; Returns: undefined }
        | {
            Args: { p_admin_id: string; p_reply: string; p_review_id: string }
            Returns: undefined
          }
      swap_banner_order: {
        Args: { banner_id_1: string; banner_id_2: string }
        Returns: undefined
      }
      sync_cart_atomic:
        | { Args: { p_cart_items: Json; p_user_id?: string }; Returns: Json }
        | { Args: { p_items: Json; p_user_id: string }; Returns: undefined }
      test_lang: { Args: never; Returns: number }
      update_my_profile_secure: {
        Args: { p_full_name: string; p_whatsapp: string }
        Returns: undefined
      }
      update_order_status_atomic:
        | { Args: { p_new_status: string; p_order_id: string }; Returns: Json }
        | {
            Args: {
              p_new_status: string
              p_notes?: string
              p_order_id: string
              p_silent?: boolean
            }
            Returns: undefined
          }
      upsert_store_config: { Args: { config_json: Json }; Returns: Json }
      validate_coupon_secure: {
        Args: { p_code: string; p_subtotal: number }
        Returns: {
          discount_amount: number
          discount_type: string
          error_message: string
          is_valid: boolean
        }[]
      }
      validate_coupon_secure_v2: {
        Args: { p_code: string; p_subtotal: number }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
