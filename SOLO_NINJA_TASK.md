# Solo-Ninja Security Audit & Hardening Task List

## Status: %WAITING_FOR_EXECUTION%

### Phase 1: Reconnaissance (DONE)

- [x] Map Auth & Admin cache (`AuthContext.tsx`)
- [x] Audit RPCs (`v16`, `is_admin`)
- [x] Inspect RLS Policies (`profiles`, `user_addresses`)

### Phase 2: Vulnerability Analysis (DONE)

- [x] BOLA in Orders (Protected by v16)

- [x] BOLA in Addresses (Protected by RLS)
- [x] PII Leak in Profiles (Protected by RLS, but redundant)

### Phase 3: Hardening Implementation (DONE)

- [x] Create `20260316_consolidated_security_v17.sql` (Repo Sync)
  - [x] Analisar `index.html` para scripts externos e estilos inline
- [x] Consolidate `profiles` RLS policies
- [x] Refactor `AuthContext.tsx` stability verified
- [x] Secure `useAddresses` frontend filters

### Phase 4: Verification (DONE)

- [x] Test BOLA bypass attempt (Protected by v16 & RLS)
- [x] Verify PII redaction (Profiles SELECT consolidated)
- [x] Final Solo-Ninja Audit Walkthrough Generated
