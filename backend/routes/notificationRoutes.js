import express from 'express';
import pool from '../db.js';

const router = express.Router();

// GET /api/notifications - Fetch all notifications
router.get('/', async (req, res) => {
    try {
        const [notifications] = await pool.query(
            'SELECT * FROM admin_notifications ORDER BY created_at DESC'
        );
        res.json(notifications);
    } catch (error) {
        console.error('Failed to fetch notifications:', error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

// DELETE /api/notifications/:id - Delete a single notification
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await pool.query('DELETE FROM admin_notifications WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Notification not found' });
        }
        res.status(204).send(); // No Content
    } catch (error) {
        console.error(`Failed to delete notification ${id}:`, error);
        res.status(500).json({ error: 'Failed to delete notification' });
    }
});

// DELETE /api/notifications - Delete all notifications
router.delete('/', async (req, res) => {
    try {
        await pool.query('DELETE FROM admin_notifications');
        res.status(204).send(); // No Content
    } catch (error) {
        console.error('Failed to clear all notifications:', error);
        res.status(500).json({ error: 'Failed to clear notifications' });
    }
});

export default router;
