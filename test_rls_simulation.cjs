const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

async function runSimulation() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        console.log('--- STARTING RLS SECURITY EVALUATION SIMULATION ---');

        await client.query('BEGIN;');

        // 0. Check if banners table exists
        const tableCheck = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'banners'
            ) as banner_exists,
            EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'marketplace_order_history'
            ) as history_exists;
        `);
        const hasBanners = tableCheck.rows[0].banner_exists;
        const hasHistory = tableCheck.rows[0].history_exists;
        console.log(`Banners table exists: ${hasBanners}`);
        console.log(`Marketplace Order History table exists: ${hasHistory}`);

        // Log marketplace_orders constraints
        console.log('Querying marketplace_orders constraints...');
        const constraintsRes = await client.query(`
            SELECT conname, pg_get_constraintdef(oid) as def 
            FROM pg_constraint 
            WHERE conrelid = 'public.marketplace_orders'::regclass;
        `);
        for (const row of constraintsRes.rows) {
            console.log(`Constraint ${row.conname}: ${row.def}`);
        }

        // Setup mock user & data by querying an existing 'vendedor' profile
        const userRes = await client.query("SELECT id FROM public.profiles WHERE role = 'vendedor' LIMIT 1;");
        if (userRes.rows.length === 0) {
            throw new Error("No user with 'vendedor' role found in public.profiles. Please check profiles table.");
        }
        const mockUserId = userRes.rows[0].id;
        console.log(`Using existing vendedor profile ID: ${mockUserId}`);

        // Get a DIFFERENT user's profile ID to test cross-user data isolation
        const otherUserRes = await client.query("SELECT id FROM public.profiles WHERE id != $1 LIMIT 1;", [mockUserId]);
        if (otherUserRes.rows.length === 0) {
            throw new Error("Only one user profile found in the database. Need at least two to test isolation.");
        }
        const otherUserId = otherUserRes.rows[0].id;
        console.log(`Using other user profile ID for isolation tests: ${otherUserId}`);

        // Make sure mock user is set to 'vendedor' (non-admin)
        await client.query(`
            UPDATE public.profiles SET role = 'vendedor' WHERE id = '${mockUserId}';
        `);

        // Check the profile before exploit
        let profileRes = await client.query(`SELECT role FROM public.profiles WHERE id = '${mockUserId}';`);
        console.log(`[Superuser] Initial role for mock user: ${profileRes.rows[0].role}`);

        // Helper function to run a code block under a savepoint
        async function runWithSavepoint(name, action) {
            await client.query(`SAVEPOINT ${name};`);
            try {
                await action();
                await client.query(`RELEASE SAVEPOINT ${name};`);
            } catch (e) {
                console.log(`[${name}] Block failed (as expected if blocked): ${e.message}`);
                await client.query(`ROLLBACK TO SAVEPOINT ${name};`);
            }
        }

        // --- SETUP OTHER USER'S ORDER AND HISTORY AS SUPERUSER ---
        const otherOrderId = '88888888-8888-8888-8888-888888888888';
        // Clean up any leftovers from prior transactions (though we use rollback, be safe)
        await client.query(`DELETE FROM public.marketplace_order_history WHERE order_id = '${otherOrderId}';`);
        await client.query(`DELETE FROM public.marketplace_orders WHERE id = '${otherOrderId}';`);
        
        // Find a status that fits constraints or default to pending
        let orderStatus = 'pending';
        const statusCheckDef = constraintsRes.rows.find(c => c.conname === 'marketplace_orders_status_check');
        if (statusCheckDef) {
            const defLower = statusCheckDef.def.toLowerCase();
            if (defLower.includes('pendente')) orderStatus = 'pendente';
            else if (defLower.includes('pending')) orderStatus = 'pending';
            else if (defLower.includes('criado')) orderStatus = 'criado';
        }

        await client.query(`
            INSERT INTO public.marketplace_orders (id, user_id, total, subtotal, status, customer_name, customer_data)
            VALUES ('${otherOrderId}', '${otherUserId}', 150.00, 150.00, '${orderStatus}', 'Other Customer', '{}'::jsonb);
        `);
        if (hasHistory) {
            await client.query(`
                INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes, created_by)
                VALUES ('${otherOrderId}', '${orderStatus}', '${orderStatus}', 'Initial setup', '${otherUserId}');
            `);
        }
        console.log(`Inserted mock order and history for other user (as Superuser) with status ${orderStatus}`);

        // --- VULNERABILITY 1: Privilege Escalation ---
        console.log('\n--- TESTING VULNERABILITY 1: Privilege Escalation ---');
        await runWithSavepoint('priv_esc', async () => {
            // Set role to authenticated and mock auth.uid()
            await client.query('SET LOCAL ROLE authenticated;');
            await client.query(`SELECT set_config('request.jwt.claims', '{"sub": "${mockUserId}", "role": "authenticated"}', true);`);

            // Try to escalate role to admin
            await client.query(`
                UPDATE public.profiles 
                SET role = 'admin' 
                WHERE id = '${mockUserId}';
            `);
            console.log('Update query executed.');
        });

        // Switch back to superuser to inspect the result
        await client.query('RESET ROLE;');
        profileRes = await client.query(`SELECT role FROM public.profiles WHERE id = '${mockUserId}';`);
        console.log(`[Superuser] Role after escalation attempt: ${profileRes.rows[0].role}`);
        const isEscalationVulnerable = profileRes.rows[0].role === 'admin';
        console.log(isEscalationVulnerable ? '🔴 VULNERABLE to Privilege Escalation!' : '🟢 SECURE against Privilege Escalation!');

        // --- VULNERABILITY 2: Order Manipulation ---
        console.log('\n--- TESTING VULNERABILITY 2: Direct Order Insertion/Manipulation ---');
        let orderCreated = false;
        await runWithSavepoint('order_insert', async () => {
            await client.query('SET LOCAL ROLE authenticated;');
            await client.query(`SELECT set_config('request.jwt.claims', '{"sub": "${mockUserId}", "role": "authenticated"}', true);`);

            // Try direct insert of an order under mock user's name
            await client.query(`
                INSERT INTO public.marketplace_orders (id, user_id, total, subtotal, status, customer_name, customer_data)
                VALUES ('99999999-9999-9999-9999-999999999999', '${mockUserId}', 0.01, 1000.00, '${orderStatus}', 'Hacker', '{}'::jsonb);
            `);
            console.log('Direct INSERT into marketplace_orders executed.');
            orderCreated = true;
        });

        await client.query('RESET ROLE;');
        const orderCheck = await client.query(`SELECT * FROM public.marketplace_orders WHERE id = '99999999-9999-9999-9999-999999999999';`);
        if (orderCheck.rows.length > 0 || orderCreated) {
            console.log(`[Superuser] Inserted order found!`);
            console.log('🔴 VULNERABLE: Direct order insertion bypasses price validation!');
        } else {
            console.log('🟢 SECURE: Direct order insertion blocked.');
        }

        // --- VULNERABILITY 3: Coupon Manipulation ---
        console.log('\n--- TESTING VULNERABILITY 3: Unauthorized Coupon Manipulation ---');
        let couponCreated = false;
        await runWithSavepoint('coupon_insert', async () => {
            await client.query('SET LOCAL ROLE authenticated;');
            await client.query(`SELECT set_config('request.jwt.claims', '{"sub": "${mockUserId}", "role": "authenticated"}', true);`);

            await client.query(`
                INSERT INTO public.coupons (code, value, type, active)
                VALUES ('FREE100', 100, 'percentage', true);
            `);
            console.log('Direct INSERT into coupons executed.');
            couponCreated = true;
        });

        await client.query('RESET ROLE;');
        const couponCheck = await client.query(`SELECT * FROM public.coupons WHERE code = 'FREE100';`);
        if (couponCheck.rows.length > 0 || couponCreated) {
            console.log('🔴 VULNERABLE: Normal users can insert discount coupons!');
        } else {
            console.log('🟢 SECURE: Coupon insertion restricted.');
        }

        // --- VULNERABILITY 4: Banners Manipulation (If exists) ---
        if (hasBanners) {
            console.log('\n--- TESTING VULNERABILITY 4: Banner Modification ---');
            let bannerCreated = false;
            await runWithSavepoint('banner_insert', async () => {
                await client.query('SET LOCAL ROLE authenticated;');
                await client.query(`SELECT set_config('request.jwt.claims', '{"sub": "${mockUserId}", "role": "authenticated"}', true);`);

                await client.query(`
                    INSERT INTO public.banners (title, image_url)
                    VALUES ('Defaced', 'http://hack.com/banner.jpg');
                `);
                console.log('Direct INSERT into banners executed.');
                bannerCreated = true;
            });
            await client.query('RESET ROLE;');
            const bannerCheck = await client.query(`SELECT * FROM public.banners WHERE title = 'Defaced';`);
            if (bannerCheck.rows.length > 0 || bannerCreated) {
                console.log('🔴 VULNERABLE: Normal users can insert banners!');
            } else {
                console.log('🟢 SECURE: Banner insertion restricted.');
            }
        }

        // --- VULNERABILITY 5: Cross-User Order and Order History Read ---
        console.log('\n--- TESTING VULNERABILITY 5: Cross-User Order and History Access (SELECT) ---');
        let orderReadCount = 0;
        let historyReadCount = 0;
        
        await runWithSavepoint('cross_read', async () => {
            await client.query('SET LOCAL ROLE authenticated;');
            await client.query(`SELECT set_config('request.jwt.claims', '{"sub": "${mockUserId}", "role": "authenticated"}', true);`);

            // Try to select the other user's order
            const orderReadRes = await client.query(`SELECT COUNT(*) FROM public.marketplace_orders WHERE id = '${otherOrderId}';`);
            orderReadCount = parseInt(orderReadRes.rows[0].count, 10);
            
            if (hasHistory) {
                // Try to select the other user's order history
                const historyReadRes = await client.query(`SELECT COUNT(*) FROM public.marketplace_order_history WHERE order_id = '${otherOrderId}';`);
                historyReadCount = parseInt(historyReadRes.rows[0].count, 10);
            }
        });
        await client.query('RESET ROLE;');
        
        console.log(`[As Vendedor] Can view other user's order count: ${orderReadCount}`);
        if (hasHistory) {
            console.log(`[As Vendedor] Can view other user's history count: ${historyReadCount}`);
        }
        
        const isCrossOrderVulnerable = orderReadCount > 0;
        const isCrossHistoryVulnerable = hasHistory && historyReadCount > 0;
        
        if (isCrossOrderVulnerable) {
            console.log('🔴 VULNERABLE: Normal users can view other users\' orders!');
        } else {
            console.log('🟢 SECURE: Cross-user orders are isolated.');
        }
        
        if (hasHistory) {
            if (isCrossHistoryVulnerable) {
                console.log('🔴 VULNERABLE: Normal users can view other users\' order history!');
            } else {
                console.log('🟢 SECURE: Cross-user order history is isolated.');
            }
        }

        console.log('\n=== APPLYING HARDENING PATCHES IN TRANSACTION ===');

        // Let's drop conflicting/permissive policies and apply secure ones
        // Patch 1: Profiles
        await client.query(`
            DROP POLICY IF EXISTS profiles_update_policy ON public.profiles;
            
            -- Ensure there is a single secure update policy for profiles
            DROP POLICY IF EXISTS "Profiles self-update secure" ON public.profiles;
            CREATE POLICY "Profiles self-update secure" ON public.profiles
                FOR UPDATE
                TO authenticated
                USING (auth.uid() = id)
                WITH CHECK (
                    auth.uid() = id 
                    AND (
                        -- Admin can do whatever
                        (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
                        OR
                        -- Normal user cannot change their role
                        (role = (SELECT role FROM public.profiles WHERE id = auth.uid()))
                    )
                );
        `);
        console.log('Applied Profiles hardening patch.');

        // Patch 2: Coupons
        await client.query(`
            -- Drop any permissive public policies on coupons write
            DROP POLICY IF EXISTS "Admins full access on coupons" ON public.coupons;
            DROP POLICY IF EXISTS "Admins only delete coupons" ON public.coupons;
            DROP POLICY IF EXISTS "Admins only insert coupons" ON public.coupons;
            DROP POLICY IF EXISTS "Admins only update coupons" ON public.coupons;
            DROP POLICY IF EXISTS "admin_delete_coupons" ON public.coupons;
            DROP POLICY IF EXISTS "admin_insert_coupons" ON public.coupons;
            DROP POLICY IF EXISTS "admin_update_coupons" ON public.coupons;
            DROP POLICY IF EXISTS "Public Read Coupons" ON public.coupons;
            DROP POLICY IF EXISTS "Anyone can view active coupons" ON public.coupons;
            DROP POLICY IF EXISTS "Admins can view all coupons" ON public.coupons;
            
            -- Create clean policies
            -- Admins can do everything
            CREATE POLICY "Admins full access on coupons" ON public.coupons
                FOR ALL
                TO authenticated
                USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin')
                WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
                
            -- Customers can only view active coupons
            CREATE POLICY "Anyone can view active coupons" ON public.coupons
                FOR SELECT
                TO authenticated
                USING (
                    active = true 
                    AND (valid_until IS NULL OR valid_until > now()) 
                    AND (usage_limit IS NULL OR usage_count < usage_limit)
                );
        `);
        console.log('Applied Coupons hardening patch.');

        // Patch 3: Marketplace Orders
        await client.query(`
            DROP POLICY IF EXISTS "Owners and Admins update orders" ON public.marketplace_orders;
            DROP POLICY IF EXISTS "marketplace_orders_select_policy" ON public.marketplace_orders;
            DROP POLICY IF EXISTS "Select Orders: Owner or Admin" ON public.marketplace_orders;
            DROP POLICY IF EXISTS "Users can only see their own marketplace orders" ON public.marketplace_orders;
            DROP POLICY IF EXISTS "Users can see own orders" ON public.marketplace_orders;
            DROP POLICY IF EXISTS "Users can view their own orders" ON public.marketplace_orders;
            DROP POLICY IF EXISTS "Order visibility" ON public.marketplace_orders;
            DROP POLICY IF EXISTS "Admins can update orders" ON public.marketplace_orders;
            DROP POLICY IF EXISTS "DML Orders: Admin Only" ON public.marketplace_orders;
            DROP POLICY IF EXISTS "No direct deletes on orders" ON public.marketplace_orders;
            DROP POLICY IF EXISTS "marketplace_orders_admin_all_policy" ON public.marketplace_orders;
            
            -- Enable RLS on marketplace_orders
            ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;
            
            -- Select: Owners and Admins
            CREATE POLICY "Select Orders: Owner or Admin" ON public.marketplace_orders
                FOR SELECT
                TO authenticated
                USING (auth.uid() = user_id OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
                
            -- No direct INSERT/UPDATE/DELETE for customers. Only Admin has direct DML access.
            CREATE POLICY "Admins full access on orders" ON public.marketplace_orders
                FOR ALL
                TO authenticated
                USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin')
                WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
        `);
        console.log('Applied Marketplace Orders hardening patch.');

        // Patch 4: Order History
        if (hasHistory) {
            await client.query(`
                ALTER TABLE public.marketplace_order_history ENABLE ROW LEVEL SECURITY;
                DROP POLICY IF EXISTS "Select history: Owner or Admin" ON public.marketplace_order_history;
                DROP POLICY IF EXISTS "All history: Admin only" ON public.marketplace_order_history;
                
                CREATE POLICY "Select history: Owner or Admin" ON public.marketplace_order_history
                    FOR SELECT
                    TO authenticated
                    USING (
                        EXISTS (
                            SELECT 1 FROM public.marketplace_orders mo
                            WHERE mo.id = order_id AND (mo.user_id = auth.uid() OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin')
                        )
                    );
                    
                CREATE POLICY "All history: Admin only" ON public.marketplace_order_history
                    FOR ALL
                    TO authenticated
                    USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin')
                    WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
            `);
            console.log('Applied Marketplace Order History hardening patch.');
        }

        // Patch 5: Banners (if exists)
        if (hasBanners) {
            await client.query(`
                ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;
                DROP POLICY IF EXISTS "Public select banners" ON public.banners;
                DROP POLICY IF EXISTS "Admin DML banners" ON public.banners;
                
                CREATE POLICY "Public select banners" ON public.banners
                    FOR SELECT
                    TO public
                    USING (true);
                    
                CREATE POLICY "Admin DML banners" ON public.banners
                    FOR ALL
                    TO authenticated
                    USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin')
                    WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
            `);
            console.log('Applied Banners hardening patch.');
        }

        // --- RETESTING VULNERABILITIES ---
        console.log('\n--- RETESTING VULNERABILITY 1: Privilege Escalation (Post-Patch) ---');
        await runWithSavepoint('retest_priv_esc', async () => {
            await client.query('SET LOCAL ROLE authenticated;');
            await client.query(`SELECT set_config('request.jwt.claims', '{"sub": "${mockUserId}", "role": "authenticated"}', true);`);

            await client.query(`
                UPDATE public.profiles 
                SET role = 'admin' 
                WHERE id = '${mockUserId}';
            `);
            console.log('🔴 FAIL: Privilege escalation query executed!');
        });
        await client.query('RESET ROLE;');
        profileRes = await client.query(`SELECT role FROM public.profiles WHERE id = '${mockUserId}';`);
        console.log(`[Superuser] Role after escalation attempt: ${profileRes.rows[0].role}`);
        if (profileRes.rows[0].role === 'admin') {
            console.log('🔴 FAIL: Still vulnerable to privilege escalation!');
        } else {
            console.log('🟢 SUCCESS: Privilege escalation blocked!');
        }

        console.log('\n--- RETESTING VULNERABILITY 2: Direct Order Insertion (Post-Patch) ---');
        let retestOrderCreated = false;
        await runWithSavepoint('retest_order_insert', async () => {
            await client.query('SET LOCAL ROLE authenticated;');
            await client.query(`SELECT set_config('request.jwt.claims', '{"sub": "${mockUserId}", "role": "authenticated"}', true);`);

            await client.query(`
                INSERT INTO public.marketplace_orders (id, user_id, total, subtotal, status, customer_name, customer_data)
                VALUES ('99999999-9999-9999-9999-999999999999', '${mockUserId}', 0.01, 1000.00, '${orderStatus}', 'Hacker', '{}'::jsonb);
            `);
            console.log('🔴 FAIL: Direct INSERT into marketplace_orders executed!');
            retestOrderCreated = true;
        });
        await client.query('RESET ROLE;');
        const retestOrderCheck = await client.query(`SELECT * FROM public.marketplace_orders WHERE id = '99999999-9999-9999-9999-999999999999';`);
        if (retestOrderCheck.rows.length > 0 || retestOrderCreated) {
            console.log('🔴 FAIL: Direct INSERT into marketplace_orders succeeded!');
        } else {
            console.log('🟢 SUCCESS: Direct INSERT into marketplace_orders blocked.');
        }

        console.log('\n--- RETESTING VULNERABILITY 3: Coupon Insertion (Post-Patch) ---');
        let retestCouponCreated = false;
        await runWithSavepoint('retest_coupon_insert', async () => {
            await client.query('SET LOCAL ROLE authenticated;');
            await client.query(`SELECT set_config('request.jwt.claims', '{"sub": "${mockUserId}", "role": "authenticated"}', true);`);

            await client.query(`
                INSERT INTO public.coupons (code, value, type, active)
                VALUES ('FREE100', 100, 'percentage', true);
            `);
            console.log('🔴 FAIL: Direct INSERT into coupons executed!');
            retestCouponCreated = true;
        });
        await client.query('RESET ROLE;');
        const retestCouponCheck = await client.query(`SELECT * FROM public.coupons WHERE code = 'FREE100';`);
        if (retestCouponCheck.rows.length > 0 || retestCouponCreated) {
            console.log('🔴 FAIL: Direct INSERT into coupons succeeded!');
        } else {
            console.log('🟢 SUCCESS: Direct INSERT into coupons blocked.');
        }

        if (hasBanners) {
            console.log('\n--- RETESTING VULNERABILITY 4: Banner Insertion (Post-Patch) ---');
            let retestBannerCreated = false;
            await runWithSavepoint('retest_banner_insert', async () => {
                await client.query('SET LOCAL ROLE authenticated;');
                await client.query(`SELECT set_config('request.jwt.claims', '{"sub": "${mockUserId}", "role": "authenticated"}', true);`);

                await client.query(`
                    INSERT INTO public.banners (title, image_url)
                    VALUES ('Defaced', 'http://hack.com/banner.jpg');
                `);
                console.log('🔴 FAIL: Direct INSERT into banners executed!');
                retestBannerCreated = true;
            });
            await client.query('RESET ROLE;');
            const retestBannerCheck = await client.query(`SELECT * FROM public.banners WHERE title = 'Defaced';`);
            if (retestBannerCheck.rows.length > 0 || retestBannerCreated) {
                console.log('🔴 FAIL: Direct INSERT into banners succeeded!');
            } else {
                console.log('🟢 SUCCESS: Direct INSERT into banners blocked.');
            }
        }

        console.log('\n--- RETESTING VULNERABILITY 5: Cross-User Order and History Access (SELECT) (Post-Patch) ---');
        let retestOrderReadCount = 0;
        let retestHistoryReadCount = 0;
        
        await runWithSavepoint('retest_cross_read', async () => {
            await client.query('SET LOCAL ROLE authenticated;');
            await client.query(`SELECT set_config('request.jwt.claims', '{"sub": "${mockUserId}", "role": "authenticated"}', true);`);

            const orderReadRes = await client.query(`SELECT COUNT(*) FROM public.marketplace_orders WHERE id = '${otherOrderId}';`);
            retestOrderReadCount = parseInt(orderReadRes.rows[0].count, 10);
            
            if (hasHistory) {
                const historyReadRes = await client.query(`SELECT COUNT(*) FROM public.marketplace_order_history WHERE order_id = '${otherOrderId}';`);
                retestHistoryReadCount = parseInt(historyReadRes.rows[0].count, 10);
            }
        });
        await client.query('RESET ROLE;');
        
        console.log(`[As Vendedor] (Post-Patch) Can view other user's order count: ${retestOrderReadCount}`);
        if (hasHistory) {
            console.log(`[As Vendedor] (Post-Patch) Can view other user's history count: ${retestHistoryReadCount}`);
        }
        
        if (retestOrderReadCount > 0) {
            console.log('🔴 FAIL: Still vulnerable. Cross-user orders are readable!');
        } else {
            console.log('🟢 SUCCESS: Cross-user orders are isolated!');
        }
        
        if (hasHistory) {
            if (retestHistoryReadCount > 0) {
                console.log('🔴 FAIL: Still vulnerable. Cross-user history is readable!');
            } else {
                console.log('🟢 SUCCESS: Cross-user order history is isolated!');
            }
        }

        console.log('\nRolling back transaction to keep database in original state...');
        await client.query('ROLLBACK;');
        console.log('Rollback complete. Database state is untouched.');

    } catch (err) {
        console.error('Error during simulation:', err);
        try {
            await client.query('ROLLBACK;');
        } catch (e) {}
    } finally {
        await client.end();
    }
}

runSimulation();
