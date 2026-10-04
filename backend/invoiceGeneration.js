// Recheck the current status in the INSERT itself, since it may change after
// the billing job loads its customer list.
export const insertInvoiceForNonInactiveCustomer = async (db, invoice) => {
    const [result] = await db.query(`
        INSERT INTO invoices (id, customerId, amount, billingPeriodStart, billingPeriodEnd, dueDate, notes, issueDate, status)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        FROM customers
        WHERE id = ? AND LOWER(TRIM(COALESCE(status, ''))) <> 'inactive'
    `, [
        invoice.id, invoice.customerId, invoice.amount, invoice.billingPeriodStart,
        invoice.billingPeriodEnd, invoice.dueDate, invoice.notes, invoice.issueDate,
        invoice.status, invoice.customerId,
    ]);
    return result.affectedRows > 0;
};
