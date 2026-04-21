-- Ninja Database Schema Baseline (V24.1.2)
-- Used by ninja_sql_guard for logic validation.

CREATE TABLE IF NOT EXISTS public.produtos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    preco DECIMAL(10,2) NOT NULL,
    estoque INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo TEXT UNIQUE NOT NULL,
    desconto_percentual INTEGER NOT NULL,
    uso_maximo INTEGER NOT NULL DEFAULT 1,
    uso_atual INTEGER NOT NULL DEFAULT 0,
    ativo BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS public.vendas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    produto_id UUID REFERENCES public.produtos(id),
    quantidade INTEGER NOT NULL,
    valor_total DECIMAL(10,2) NOT NULL,
    data_venda TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS Baseline
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupons ENABLE ROW LEVEL SECURITY;
