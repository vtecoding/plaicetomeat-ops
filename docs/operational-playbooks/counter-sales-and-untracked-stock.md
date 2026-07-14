# Counter sales and untracked stock

Use this when serving a walk-in customer or deciding what an each/box stock number means.

## Serve a customer

1. Open **Operator → Serve** and choose the product.
2. For meat sold by weight, choose a weight or enter grams. For an each item, answer
   **How many?** For a box, answer **How many boxes?** Counts must be whole numbers from 1 to 99.
3. Read the approximate price on the button aloud. Add any other items.
4. Choose Cash or Card. On the review screen, check every line price and the **Total**.
5. Save once. On **Done**, use the saved Total. If it says **Price updated**, that is the
   final server price.

## What “Stock not counted” means

- The item can still be sold. Its sale, cash/card tender and product performance are recorded.
- PTM does not claim a quantity, value, expiry risk, days of cover or low-stock warning for it.
- The owner controls its public availability manually from Products.
- Do not create a kg batch for it. Operator delivery and waste product pickers list only products
  whose batch stock is counted.

This is intentional honesty, not missing sale data. PTM records what was sold without inventing a
weight or a stock count that nobody observed.

## Choose whether a kg product is counted

Each and box products are always **Stock not counted**. For a kg product, the owner makes the
choice explicitly in **Admin → Products**:

1. When creating a kg product, leave **Count this product in stock** on for normal batch/weight
   stock. Turn it off only when PTM must record sales without claiming a physical kg balance.
2. On an existing kg product, use **Stop counting stock** only after checking the warning. The
   change is audited and immediately removes that product and all of its batches from stock,
   expiry, value, cover, waste and buying claims. It does not remove its sales or tender history.
3. **Start counting stock** is allowed only when that product has never had batch history. This
   prevents an old balance from silently becoming live again. If old batches exist, create the
   correct replacement product or reconcile the catalogue with the owner; do not work around the
   refusal by changing the unit.

Once a product is **Stock not counted**, stale delivery, waste, cost and adjustment screens are
also refused by the database. Set public availability manually on the product until counted stock
is deliberately established on a safe product record.
