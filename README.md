# GIDC Utilities

Grinyer internal systems. Read `CONTEXT.md` before changing anything, then `MISSING.md` for what is not here yet.

| folder | what |
|---|---|
| `tools-site/` | tools.gidc.ca, Tools 2.9 (20 Oct 2026): landing page, `gate.js`, `guard.js`, dashboard and the other tools. Deploy notes in `tools-site/HOW-TO-UPDATE.md`. |
| `dealer-portal/` | dealers.gidc.ca, Dealer portal 1.99 (19 Oct 2026). Built `index.html` only; the commented source and `build.py` were lost. |
| `sql/` | current Supabase changes, in run order (see `docs/backup-2026-10-23-README.md`) |
| `powershell/` | scripts that run on the office server `SVR-GDDC` against the Access back end |
| `apps-script/` | the script inside the website leads Google Sheet |
| `tools-html/` | older standalone copies of single tools; `tools-site/` is newer |
| `docs/` | notes from the 23 Oct 2026 backup |

Not here yet: the measurement app (save from measurement.gidc.ca), and the four Supabase edge functions (copy out of the Supabase dashboard).
