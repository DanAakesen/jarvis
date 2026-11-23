# Nutrition

When [Health is enabled](../README.md), Nutrition uses the existing owner-bound
SQL store for meals, favourites, plans and feedback. The assistant and the
iPhone Nutrition screen use the same meal ledger. Storage and source keys
retain the `daily` namespace.

## Logging and edits

- The signed-in owner can add a meal with exact kcal and optional protein grams through
  [`POST /health/meals`](../routes/manual-meals.ts). iPhone submits the
  occurrence and an idempotency key. The server derives the Copenhagen date,
  and leaves unsupplied macros null. If the save is unconfirmed, retry with the
  same key, occurrence and nutrient values; an exact retry does not add another meal.
- `health_food` logs an explicit label or saved favourite from the verified
  current owner message. The model supplies the operation, not the food,
  amount, owner or operation key. One source message cannot log two meals.
- `health_food_review` looks up components and handles estimates, corrections
  and deletion. Lookup never writes. For a requested reference-based estimate,
  the server resolves the components and derives the nutrients again; it does
  not accept model-supplied reference totals. A changed identity, preparation
  or quantity needs a fresh lookup. Corrections and deletions require the
  exact owned entry and its current revision. Deletion retains a tombstone.
- `health_saved_food` reads or changes owned favourites, plans and preferences.
  The server resolves plan slots from owned favourites and snapshots them.
  Saving a favourite or plan does not log intake. These tools do not export to
  Apple Health. The parked [external connector](../mcp/README.md) has its own
  approval boundary.

Only a matching committed receipt supports “logged” or “updated”. For an
uncertain tool write, read back the exact entry before retrying. Store changes
publish refresh after acknowledged commit, not on replay.

## Reads and reference data

- `daily.nutrition.days` aggregates retained, non-deleted meals. Unknown totals
  stay null, and partial totals are lower bounds. It does not create empty days.
- `GET` and `PATCH /health/nutrition-targets` are signed-in owner Settings
  routes. `health_nutrition_targets` reads or changes the named targets. No
  default target is inferred. `health_nutrition_suggest` reads stored targets,
  active energy recorded so far and logged meals for the current Copenhagen day.
  It considers only saved favourites, does not extrapolate burn or intake, and
  treats remaining protein as an upper bound when some meals lack protein data.
- The [Frida adapter](frida.ts) uses the public DTU release 10 / Frida 5.5 dataset
  ([DOI](https://doi.org/10.11583/DTU.29500682); CC BY 4.0 for XLSX/ODS data).
  Retain returned attribution, retrieval time, unknowns and matched subtotals.
  Values refer to edible food and are not measurements of what the owner ate.
  Missing values are not zero, and partial matches are not complete estimates.

Offline coverage includes [food intent](intent.test.ts), [tool refusals](../tools/refusals.test.ts)
and the [manual meal route](../routes/manual-meals.test.ts). See the
[plan](../../../../../PLAN.md#next-steps-and-blockers) for device acceptance.
