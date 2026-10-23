# Notes for Claude

- Read `CONTEXT.md` end to end before changing anything. It holds the decisions and the data facts the code does not explain. `MISSING.md` lists the gaps.
- All work lives in this repo. Never leave code only in a session workspace; commit and push it.
- Never commit secrets: no Supabase `sb_secret_` or service role keys, no passwords, no `KPI_IMPORT_KEY` or `RESEND_API_KEY`. The `sb_publishable_` key is public by design and is fine.
- Written output for Andrew contains no hyphens or dashes (see CONTEXT.md section 6).
- Roles are an allowlist everywhere. Put new access logic in a helper, not a policy.
- Every SQL file must be safe to run twice and say so at the top.
