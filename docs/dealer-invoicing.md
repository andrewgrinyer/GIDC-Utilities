# Invoicing a pallet, and its customs papers

Dealer portal 2.09, 23 November 2026 (2.08 was the first cut, never live).
Database file `sql/dealer-invoicing.sql`. Tests `tests/pallet-invoicing.js`
and `sql/tests/invoicing.sh`.

## What it does

Every pallet with an order on it has **Invoice pallet**. An order can be
invoiced as soon as it is on a pallet; its status does not matter. One
button covers the whole pallet, in two steps:

1. **Which orders are charged.** Every order on the pallet with Charge, No
   charge or Not now. Normal orders start on Charge. A redo starts on
   nothing and the page will not go on until somebody answers, because
   whether a remake is billed is the question Andrew asked to be put every
   time. No charge takes a reason, prefilled from the redo reason. The
   QuickBooks customer, date, first invoice number, terms, currency,
   discount, tariff and tax code are set here and remembered per dealer.
   Below them, the shipment half of the customs papers: ship to
   (remembered per dealer), ship date, ship via, waybill, weight, pallets,
   entry and container numbers.
2. **Check each invoice.** One card per order: QuickBooks item,
   description, quantity, rate. A line with no price is red. A line with a
   word that is not ours is red. Either stops it. An item not in the
   QuickBooks list is amber and does not stop it.

**Make the QuickBooks files** records one `dealer_invoices` row per order,
downloads one CSV per order (in one zip when there is more than one, since
a browser will not save several files from one click), and makes the
customs papers for every invoiced order on the pallet. **QuickBooks files**
on the pallet gives the same files back, drawn from the record.

## Customs papers

The proforma invoice, Lacey PPQ 505 and TSCA certification, made by the
export documents app's own code. `scripts/port-export-docs.js` copies the
document half of `tools-site/exportdocs/index.html` into the portal
between the EXPORT DOCS markers: classification rules and HS codes,
discount and service charge spreading, tariff left off, line merging,
Lacey weights, the three documents, their styles and the logo. The app's
PDF reading is left behind, because the portal already has the lines.
**When the export app changes, run that script and ship the portal.**

The papers are kept in `pallet_customs_docs`, newest first, never deleted,
with the order ids they covered. The pallet card has Print (opens them in a
tab with a Print button) and Download (the same page as an .html file).

The Plant and Plant Product Declaration (Lacey) has one entry per
commercial invoice line, in the same order, numbered "Line 1", "Line 2" and
so on, each with its own HTS number, entered value and its share of the
plant weight split into the components (portal 2.25). The broker, Farrow,
rejected a declaration that combined like lines on 27 November 2026. It
runs to as many PPQ 505 pages as it needs, five invoice lines a page.

No charge remakes go on the papers as doors at their invoiced value of
zero. The "No charge" prefix comes off first, because "charge" is one of the
export app's service words and would otherwise drop the doors.

The tariff line's description reads "Tariff (50% of the net products)". The
wholesale tool's "after discount" wording contains the word discount, which
the export app reads as a discount line before it looks for tariff, so it
took the tariff off the customs value a second time.

## Warnings, Grinyer only

* **Taking an order off** a pallet whose customs papers are made says so in
  the confirm box, and that the order stays invoiced. Afterwards the pallet
  card shows "Customs papers out of date", names what changed, and offers
  Make them again.
* **Adding an order** to a pallet already invoiced warns at once, and the
  order's line on the main list carries "Pallet already invoiced, this
  order is not" and "Not on the pallet's customs papers" until it is.

These are drawn only from `dealer_invoices` and `pallet_customs_docs`,
which `can_invoice()` (administrators) keeps from everyone else. A dealer's
portal never asks for them and the database would refuse if it did.

## Decisions

* **QuickBooks Online.** The CSV columns are the ones the wholesale tool has
  always exported (`tools-site/wholesale`). Desktop would need IIF.
* **Invoice numbers.** The Online import groups lines by InvoiceNo, so every
  invoice needs its own. The person types the first; the page suggests the
  highest used plus one.
* **Pricing is the portal's**: `linePrice` and `orderPrice`, the same rules
  as the order screen and `gidc_order_total`. Discount comes off
  everything, tariff goes on what is left (20 and 50 to start).
* **No negative numbers** (2.13). QuickBooks Online's invoice import refuses a
  negative line, so the discount line goes in the file as a positive number,
  as Andrew asked. He turns it back into a discount by hand in QuickBooks
  after importing. (2.12 built the discount into each rate; Andrew did not
  want that.) The file also has a DueDate column, the invoice date.
* **No charge** is a zero invoice with the lines at rate 0 and the reason in
  each description, so QuickBooks still records what shipped.
* **Our names only.** The invoice never calls `styleOut` or `nameOut`. A line
  stored with a dealer word is turned back into ours through that dealer's
  `dealer_door_names`; a word nobody mapped blocks it until reworded.
* **The order status is not touched.** Access sets statuses hourly.
* **Items.** The QuickBooks item list is in the database (`qbo_items`), not
  the page, since the portal has no Cloudflare Access. Picks are
  remembered for everybody in `qbo_item_map`.

## Next: writing to QuickBooks directly

Not built. The plan: an edge function `qbo-invoice` holding the QuickBooks
OAuth tokens (Intuit app, refresh token in Supabase secrets), which takes
`dealer_invoices` ids, creates each invoice through the QuickBooks
Accounting API and writes the QuickBooks id back to `dealer_invoices.qbo_id`.
Invoice pallet then sends all of them in one go instead of handing over
files. The same function can refresh `qbo_items` so the amber check is
always current.
