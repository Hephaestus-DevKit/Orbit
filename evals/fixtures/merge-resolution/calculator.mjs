export function invoiceTotal(amounts, taxRate) {
<<<<<<< HEAD
  const subtotal = amounts.reduce((sum, value) => sum + value, 0);
  return Math.round(subtotal * (1 + taxRate) * 100) / 100;
=======
  const subtotal = Math.round(amounts.reduce((sum, value) => sum + value, 0) * 100) / 100;
  return subtotal + subtotal * taxRate;
>>>>>>> feature/tax-rounding
}
