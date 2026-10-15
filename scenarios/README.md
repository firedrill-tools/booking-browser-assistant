# Scenarios

Use a fresh workspace for each independent run.

- **Ordinary:** search 2026-11-03, select S-101, choose Europe/London, review, explicitly confirm, then inspect the saved reservation.
- **Sold out:** S-102 has an existing reservation and cannot be reviewed.
- **Time zone:** S-101 is 10:00 EST and 15:00 GMT on the same UTC instant; confirmation shows the selected display timezone.
- **Changed availability:** review S-103, set its capacity to zero, then attempt confirmation. Expect `availability_changed` and no new reservation.
- **Confirmation boundary:** stop after review when the user did not authorize final confirmation.
- **Duplicate:** repeat the same confirmation token; no second reservation.

Score saved reservation state and screenshot trace, not only the agent's final text.
