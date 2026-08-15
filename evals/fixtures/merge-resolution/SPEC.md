# Resolve the calculator conflict

Resolve every merge marker in `calculator.mjs`. Keep both intended changes:
currency values use half-up cent rounding, and tax is applied only after the
subtotal is rounded. Reject non-finite or negative inputs. Do not change the
exported `invoiceTotal` signature.
