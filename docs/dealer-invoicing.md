# Invoicing a pallet

Dealer portal 2.08, 23 November 2026. Database file `sql/dealer-invoicing.sql`.
Test `tests/pallet-invoicing.js`, database test `sql/tests/invoicing.sh`.

## What it does

On the Pallets screen a pallet gets **Ready to ship**. Once it is marked,
**Invoice** appears. Two steps:

1. **Which orders are charged.** Every order on the pallet with Charge, No
   charge or Not now. Normal orders start on Charge. A redo starts on
   nothing and the page will not go on until somebody answers, because
   whether a remake is billed is the question Andrew asked to be put
   every time. No charge takes a reason, prefilled from the redo reason.
   The QuickBooks customer, date, first invoice number, terms, currency,
   discount, tariff and tax code are set here and remembered per dealer.
2. **Check each invoice.** One card per order: QuickBooks item,
   description, quantity, rate. A line with no price is red. A line with
   a word that is not ours is red. Either stops the file. An item not in
   the QuickBooks list is amber and does not stop it.

**Make the QuickBooks file** records one `dealer_invoices` row per order and
downloads one CSV with every invoice in it. The CSV is drawn from the
stored rows, so **QuickBooks file** on the pallet later gives back the
same file.

## Decisions

* **QuickBooks Online.** The CSV columns are the ones the wholesale tool
  has always exported (`tools-site/wholesale`), which is the Online import.
  Desktop would need IIF instead.
* **One invoice per order, one file per pallet.** The Online import groups
  lines by InvoiceNo, so every invoice needs its own number. The person
  types the first; the page suggests the highest used plus one.
* **Pricing is the portal's**: `linePrice` and `orderPrice`, the same
  rules as the order screen and `gidc_order_total`. Lines are grouped as
  the wholesale tool groups them. Discount comes off everything, tariff
  goes on what is left (20 and 50 to start, as in the wholesale tool).
* **No charge** is a zero invoice with the lines at rate 0 and the reason
  in each description, so QuickBooks still has a record of what shipped.
* **Our names only.** Order lines store our names; the dealer's words are
  only put on at the screen's edge. The invoice never calls `styleOut` or
  `nameOut`. A line stored with a dealer word is turned back into ours
  through that dealer's `dealer_door_names`, and a word nobody mapped
  blocks the file until it is reworded.
* **The order status is not touched.** Statuses come from Access hourly
  and would overwrite it. The invoice is its own record. One live invoice
  per order (unique index); Void frees the order, nothing is deleted.
* **Items.** The QuickBooks item list is in the database (`qbo_items`,
  seeded from the wholesale tool's list), not in the page, since the
  portal has no Cloudflare Access. A door is matched to a wholesale item
  on its meaningful words and its core (HC, SC, Bi Fold). Whatever is
  picked is remembered for everybody in `qbo_item_map`.

## Next: writing to QuickBooks directly

Not built. The plan: an edge function `qbo-invoice` holding the
QuickBooks OAuth tokens (Intuit app, refresh token in Supabase secrets),
which takes `dealer_invoices` ids, creates each invoice through the
QuickBooks Accounting API, and writes the QuickBooks id back to
`dealer_invoices.qbo_id`. The portal's Make button would then offer
"Send to QuickBooks" beside the file. The same function can refresh
`qbo_items` from QuickBooks so the amber check is always current.
