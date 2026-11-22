import test from 'node:test';
import assert from 'node:assert/strict';

export const deduplicateProfiles = (items) => {
    if (!Array.isArray(items)) return [];
    const seen = new Set();
    const unique = [];

    for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const nameKey = String(item.name || '').trim().toLowerCase();
        if (!nameKey || seen.has(nameKey)) continue;
        seen.add(nameKey);
        unique.push(item);
    }

    return unique;
};

test('deduplicateProfiles removes duplicated profile names case-insensitively and preserves first valid entry', () => {
    const rawProfiles = [
        { id: '*1', name: 'Paket-1Jam', rateLimit: '1M/1M', price: 1000, sellingPrice: 2000, duration_minutes: 60, userCount: 5 },
        { id: '*2', name: 'Paket-1Jam', rateLimit: '1M/1M', price: 1000, sellingPrice: 2000, duration_minutes: 60, userCount: 5 },
        { id: '*3', name: 'paket-1jam', rateLimit: '1M/1M', price: 1000, sellingPrice: 2000, duration_minutes: 60, userCount: 0 },
        { id: '*4', name: 'Paket-1Hari', rateLimit: '2M/2M', price: 3000, sellingPrice: 5000, duration_minutes: 1440, userCount: 12 },
        { id: '*5', name: 'Paket-1Hari', rateLimit: '2M/2M', price: 3000, sellingPrice: 5000, duration_minutes: 1440, userCount: 12 },
    ];

    const result = deduplicateProfiles(rawProfiles);

    assert.equal(result.length, 2, 'Should only have 2 unique profiles');
    assert.equal(result[0].name, 'Paket-1Jam');
    assert.equal(result[0].id, '*1');
    assert.equal(result[1].name, 'Paket-1Hari');
    assert.equal(result[1].id, '*4');
});

test('deduplicateProfiles handles null, undefined, empty array or invalid items safely', () => {
    assert.deepEqual(deduplicateProfiles(null), []);
    assert.deepEqual(deduplicateProfiles(undefined), []);
    assert.deepEqual(deduplicateProfiles([]), []);
    assert.deepEqual(deduplicateProfiles([null, {}, { name: '' }, { name: 'Valid', id: '*1' }]), [{ name: 'Valid', id: '*1' }]);
});
