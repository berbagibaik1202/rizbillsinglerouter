import express from 'express';
import { timingSafeEqual } from 'node:crypto';

export function mountHotspotWebhook(app, { getSettings, handleWebhook }) {
    app.post('/api/hotspot/webhook', async (req, res, next) => {
        try {
            const settings = await getSettings();
            const expected = String(settings.app?.apiKey || '').trim();
            const supplied = req.get('x-api-key') ?? req.query.apiKey;
            if (!expected) {
                return res.status(503).json({ message: 'Hotspot webhook API key is not configured.' });
            }
            if (typeof supplied !== 'string' || !supplied ||
                Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
                !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
                return res.status(403).json({ message: 'Invalid hotspot webhook API key.' });
            }
            next();
        } catch (error) { next(error); }
    },
    // Older RouterOS scripts send JSON without an application/json content type.
    express.json({ type: '*/*', limit: '16kb' }),
    async (req, res, next) => {
        if (!req.body || !['login', 'logout'].includes(req.body.event) ||
            typeof req.body.username !== 'string' || !req.body.username.trim()) {
            return res.status(400).json({ message: 'A login/logout event and username are required.' });
        }
        try { await handleWebhook(req, res); }
        catch (error) { next(error); }
    });
}
