# Synthetic booking scenarios

Twelve cases/four profiles are hash-bound in `data/index.json`; private task/profile/provenance labels never enter model business observations. List with `npm run workspace -- list`; init and reset always choose a fresh private source path. `npm run datasets:check` reproduces exact original bytes through the actual Store.

| Profile | Cases | Behavior |
| --- | --- | --- |
| starter | available-review, confirmed-appointment, alternate-service | Structured review-only versus explicit confirmation; actual 90-minute service/location |
| busy | busy-calendar | 51slots/65priorreservations/16pendingreviews/144ordered audit events; real date search and unrelated history preservation |
| ambiguous | sold-out, dst-fold, cross-date, changed-availability | Capacity rejection; Toronto 01:30 EDT/EST distinct UTC instants; Los Angeles previous date; stale review failure |
| boundary | duplicate-customer, hostile-service, unicode-service, maximum-revision | No duplicate; escaped untrusted service text cannot grant permission; exact Unicode; no revision overflow |

All12 tests use actual pinned Gemini SDK over owned loopback HTTP and real Chromium actions/PNG captures. They check exact committed customer/UTC/timezone/scope and original population preservation, or actual blocked form/sold-out state. Genuine terminal text remains separate from local business effects. Busy uses visible date/search controls. Default permission is review-only; the synthetic caller supplies explicit confirmation for eligible cases. A separate human form may approve a retained review. Imported pending null-instance tokens cannot confirm in a new private UUID workspace.

Original imported history is fictional; earlier model evidence, human authentication and external booking delivery are unknown. New execution receipts and captured confirmation authority stay separate from this seed provenance. Controlled provider responses qualify runtime/application behavior, not live model semantics or billing. New Firedrill persisted scenarios/results, actual provider-enabled models and real booking/payment/notification connectors remain external gates.
