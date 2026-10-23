# The database changes that are current

Run in the Supabase SQL editor. Every file is safe to run twice, and
tested in every order against a copy of the live shape.

1. **security-tighten.sql** — closes three holes found on 21 October.
   Independent of the rest. Run this first and soon.
2. **two-sided-access.sql** — splits one role into team access and
   dealer access so a person can have either or both. Migrates existing
   dealers across. Nobody's access changes.
3. **email-verification.sql** — adds the verification record and the
   switch. Refuses to run before step 2. Changes nobody's access until
   you turn the switch on.

Steps 2 and 3 go live together with the screens that read them. The
whole order, with a test pass, is in `docs/login-rollout.md`.

**tests/** runs these files against a local stand in for the live
database, in any order and twice, and prints what each kind of login can
see. Never pointed at Supabase.

**security-audit.sql** is read only and can be run any time. It reports
what is actually exposed rather than what anybody remembers writing.

Also do this in the Supabase dashboard, which no SQL file can do for
you: Authentication, Sign In / Providers, Email, turn off **Allow new
users to sign up**. Note that this stops the measurement app creating
logins, which is deliberate: logins are made on the tools site.
