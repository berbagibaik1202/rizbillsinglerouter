
import express from 'express';
import pool from '../db.js';
import { getSettings } from '../utils.js';
import tripayService from '../tripayService.js';

const router = express.Router();

// Middleware to ensure the user is a reseller
router.use((req, res, next) => {
    if (req.user.role !== 'reseller') {
        return res.status(403).json({ message: 'Forbidden: Access denied.' });
    }
    next();
});

// POST /api/reseller/request-topup
router.post('/request-topup', async (req, res) => {
    const resellerId = req.user.id;
    const { amount, method } = req.body;

    if (!amount || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ message: 'Invalid top-up amount.' });
    }
    if (!method) {
        return res.status(400).json({ message: 'Payment method is required.' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Use a different prefix for reseller top-ups to distinguish them in the callback
        const topupId = `RTOPUP-${Date.now()}`;
        
        // We reuse the topup_requests table.
        // FIX: Store reseller ID in user_id, leave customer_id NULL.
        const newTopupRequest = {
            id: topupId,
            customer_id: null,
            user_id: resellerId,
            amount: amount,
            status: 'pending',
        };
        await connection.query('INSERT INTO topup_requests SET ?', newTopupRequest);
        
        const [[reseller]] = await connection.query('SELECT * FROM users WHERE id = ?', [resellerId]);
        if (!reseller) throw new Error('Reseller account not found.');

        const settings = await getSettings();
        const returnUrl = `${settings.app.baseUrl.replace(/\/$/, '')}/#admin`; // Return to reseller dashboard

        // Create a dummy invoice object for Tripay service
        const dummyInvoice = { id: topupId, amount: amount };

        // Create a dummy customer object for Tripay service from reseller data
        const dummyCustomer = { 
            name: reseller.username, 
            email: `reseller-${reseller.id}@yourdomain.com`, // Create a dummy email
            phone: reseller.phone 
        };

        const tripayResponse = await tripayService.createTransaction(dummyInvoice, dummyCustomer, returnUrl, method);

        await connection.query('UPDATE topup_requests SET tripay_reference = ? WHERE id = ?', [tripayResponse.reference, topupId]);
        
        await connection.commit();
        
        res.json({ paymentUrl: tripayResponse.checkout_url });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error requesting reseller top-up:", error);
        res.status(500).json({ message: error.message || 'Failed to request top-up.' });
    } finally {
        if (connection) connection.release();
    }
});

export default router;
