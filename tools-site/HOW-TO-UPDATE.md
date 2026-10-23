# GIDC Tools, all in one

One Cloudflare Pages project serves the landing page and ten tools. Upload this
zip to the project that already answers on tools.gidc.ca and everything goes
live together.

    tools.gidc.ca/               the landing page
    tools.gidc.ca/dashboard/     Company Dashboard
    tools.gidc.ca/production/    Daily Production
    tools.gidc.ca/goback/        Go Back Required
    tools.gidc.ca/gobacks/       Go Backs
    tools.gidc.ca/estimate/      Summary Estimate
    tools.gidc.ca/invoice/       Contract to QuickBooks
    tools.gidc.ca/proliner/      Proliner Door Analysis
    tools.gidc.ca/packing/       Door Packing Sequencer
    tools.gidc.ca/wholesale/     Wholesale Order to QuickBooks
    tools.gidc.ca/exportdocs/    Export Documents

No subdomains, no DNS, no certificates. The tiles link to the folders sitting
beside them, so they work whatever address the project ends up on.

The measurement app is deliberately NOT in here. It stays at
measurement.gidc.ca. Reps have it installed on their phones and are signed in
to it, and moving it would break both.

## Uploading a new version

Open the Pages project, Create deployment, drag this zip on, Save and Deploy.
Every upload replaces the whole set, so always upload the newest zip rather
than an older one with a single tool changed.

## Changing something

To swap in a new version of one tool, replace that folder's index.html and
re-zip. To add a tool, make a folder for it, drop its index.html in, and add a
block to the APPS list near the bottom of the landing page index.html:

    {
      name: 'Whatever it is called',
      desc: 'One line saying what it does.',
      url:  './newtool/',
      icon: 'wrench'
    },

Icons available: ruler, doors, boxes, papers, receipt, chart, tag, globe, wrench.

## Signing in

The site uses the same accounts as the measurement app. Sign in on the landing
page and every tool beside it opens, because they all share one address.

Every login, team and dealer alike, is made and changed on the landing page
under People and logins, by an administrator. Nobody picks anybody else's
password: a new login gets an invitation email and the person chooses their
own on dealers.gidc.ca/account, which is also where Forgotten your password
leads. The dealer portal and the measurement app no longer manage logins.

Be clear about what this gate is and is not. These are static pages with no
server of their own, so the sign in tidies the front door and shows who is
using it. Someone who knows a tool's address can still open it. The real lock
is Cloudflare Access, which refuses to send the page at all. Turning that on for
this domain takes a few minutes and covers the landing page and every tool
with one policy.

The Company Dashboard and Daily Production are different from the rest in one
way worth knowing. Their numbers live in Supabase, and Supabase decides who may
read and write them rather than the front door here. The dashboard shows its
figures only to an administrator. Daily Production lets the shop write the four
production counts and nothing else, and will not let anyone, administrator
included, change a figure the import owns.

Two files do the work. gate.js talks to Supabase, guard.js holds a tool back
until a session is there. Both sit at the root and each tool loads them from the
first two lines of its head. If you replace a tool's index.html, put those two
script tags back at the very top of its head:

    <script src="/gate.js"></script>
    <script src="/guard.js"></script>

Put them straight after the opening head tag, not before the closing one. Some
of these tools carry a spreadsheet library that contains the text for a closing
head tag inside it, and anything inserted there lands in the middle of the
library instead of the page.

## Tidying up afterwards

Once this is live you can delete the separate proliner Pages project and its
proliner.gidc.ca custom domain. Nothing points at it any more.

## Worth doing

Turn on Cloudflare Access for this domain under Zero Trust and allow only your
own email addresses. That is what actually keeps people out, and one policy
covers the landing page and every tool in here.
