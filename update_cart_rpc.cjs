const { Client } = require('pg');

const connectionString = 'postgresql://postgres:IsaBiel%40hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

const client = new Client({ connectionString });

async function run() {
  try {
    await client.connect();
    
    // Add column if it doesn't exist
    await client.query(`
      ALTER TABLE public.cart_items 
      ADD COLUMN IF NOT EXISTS variant_names text;
    `);

    // Update the RPC
    await client.query(`
      CREATE OR REPLACE FUNCTION public.sync_cart_atomic(p_cart_items jsonb)
       RETURNS void
       LANGUAGE plpgsql
       SECURITY DEFINER
       SET search_path TO 'public'
      AS $function$
      DECLARE
          v_user_id uuid;
      BEGIN
          -- Get current authenticated user ID
          v_user_id := auth.uid();
          
          IF v_user_id IS NULL THEN
              RAISE EXCEPTION 'Not authenticated';
          END IF;

          -- Delete existing items for the user
          DELETE FROM public.cart_items
          WHERE user_id = v_user_id;

          -- Insert new items, grouping and summing to prevent duplicates
          -- payload example: [{"product_id": "...", "variant_id": "...", "quantity": 1, "variant_names": "..."}]
          INSERT INTO public.cart_items (user_id, product_id, variant_id, quantity, variant_names, updated_at)
          SELECT 
              v_user_id,
              (item->>'product_id')::text,
              COALESCE(item->>'variant_id', '')::text,
              SUM((item->>'quantity')::integer),
              MAX(item->>'variant_names')::text,
              NOW()
          FROM jsonb_array_elements(p_cart_items) AS item
          GROUP BY 1, 2, 3;

      END;
      $function$;
    `);
    
    console.log('cart_items and sync_cart_atomic updated successfully!');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
