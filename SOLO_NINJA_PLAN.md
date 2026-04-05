# Solo-Ninja Implementation Plan (v17 - Security Consolidation)

## Background

The application has secure RPCs and RLS but the repository migration files are behind the actual database state (especially `v16`). Some RLS policies are redundant.

## Proposed Changes

### Database (Supabase)

- **[NEW] `20260316_consolidated_security_v17.sql`**:
  - Syncs `v16` definition to repo.
  - Consolidates `profiles` SELECT policies into one: `Profiles are viewable by self or admin`.
  - Drop redundant policies.

### Frontend

- **[MODIFY] `src/contexts/AuthContext.tsx`**:
  - Enhance `checkAdminStatus` to handle RPC failures gracefully.
- **[MODIFY] `src/hooks/useAddresses.ts`**:
  - Ensure all `supabase.from('user_addresses')` queries include `.eq('user_id', user.id)`.

## Verification Plan

1. Apply migration and check for conflicts.
2. Attempt to fetch another user's profile UUID (should be blocked by RLS).
3. Attempt to create an order with another user's address UUID (should be blocked by v16).
