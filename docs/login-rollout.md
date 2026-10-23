# Putting the login change live

Written 23 October 2026. One pass, in a quiet window, in this order. Each
step says how to tell it worked. Nothing here needs a password chosen for
anybody, and nothing here needs a redirect URL added in Supabase: every
emailed link opens `dealers.gidc.ca/account` with a token on it, and that
page does the rest.

## Already done, or do first on its own

1. Run `sql/security-tighten.sql` in the Supabase SQL editor. The table at
   the end lists the roles in use; no row should say UNRECOGNISED.
2. Supabase, Authentication, Sign In / Providers, Email: turn off **Allow
   new users to sign up**. From here the measurement app cannot make
   logins, which is intended.
3. Rotate the service role key that was pasted into a chat in September,
   and change the password that was posted in one.

## In the quiet window

The SQL and the screens go together. Between step 4 and step 7 a dealer
administrator on the old portal is offered buttons the database will
refuse, and the old People screen cannot make a dealer login, so keep the
gap short.

4. **Supabase, Authentication, Emails or Auth settings:** set the email
   link expiry (Email OTP Expiration) to 86400 seconds, a day. The default
   is an hour, which is too short for an invitation somebody opens after
   lunch.
5. **Run `sql/two-sided-access.sql`.** The table at the end lists every
   login with team and dealer access side by side. Nobody's access should
   have moved: dealers now show under dealer, the team under team.
6. **Edge functions.**
   * `create-dealer-user`: paste the new `index.ts` over the old one and
     deploy.
   * `account-link`: new. Deploy a new function, Via Editor, named exactly
     `account-link`, paste `supabase/functions/account-link/index.ts`,
     deploy. Then in its Details turn **off** Enforce JWT verification.
     The forgot my password form is used by somebody who is not signed in,
     so there is no token to verify; the function checks the token itself
     where one is needed.
   * Optional secret `LOGIN_EMAIL_FROM` if login emails should come from a
     different address than order emails. Without it they use
     `ORDER_EMAIL_FROM`.
7. **Upload the three sites.**
   * Dealer portal: everything in `dealer-portal/`, including the new
     `account.html`. Check `dealers.gidc.ca/account` shows Forgotten your
     password.
   * Tools site: zip `tools-site/` and upload as usual. The corner says
     Tools 3.0.
   * Measurement app: `measurement-app/` as usual. Check first that the
     live copy is 1.9, the same as the repo, so nothing newer is
     overwritten.

## The test pass

Use a spare address you can read, not a real person's.

8. Tools site, People and logins. Add a login for the spare address with
   Dealer access for Grinyer's own record and no team access. The invitation
   arrives; its button opens the account page; choose a password; it says
   You are all set and Open the dealer portal goes straight in, signed in.
9. On the portal sign in, Forgotten your password with the spare address:
   the email arrives, the link works, the new password signs in.
10. Back on People and logins, give the spare login team access as Sales.
    Sign in on the tools site with it: the tools open, the wholesale price
    list among them. Set its team access to Installer: only the go back form.
11. Remove the spare login.
12. Sign in to the portal as a real dealer administrator, if one will let
    you watch: orders show, prices do not, no ordering buttons.

## Verification, afterwards and in its own time

13. Run `sql/email-verification.sql`. Nothing is blocked by it. The People
    screen now shows who has confirmed their address and a banner appears
    for everybody who has not.
14. On your own row press Address check, and follow the link. The count
    goes up by one and your banner goes.
15. Press Send the check to the others. Watch the count over a few days.
    Chase anybody stuck, or fix their address with Edit.
16. When the count is right, Turn on. It refuses unless your own address
    is confirmed. Anybody still unconfirmed sees nothing but the banner
    until they press their link.

If the switch ever needs undoing without the screen, this line in the
Supabase SQL editor does it:

    update public.app_settings set value = 'false' where key = 'require_verified_email';

## Checking the SQL without Supabase

`sql/tests/run.sh` runs the files against a local stand in for the live
database and prints what each kind of login can see, including a stranger
who signs up afterwards. `tests/login-screens.js` clicks through the new
screens against a fake Supabase.
