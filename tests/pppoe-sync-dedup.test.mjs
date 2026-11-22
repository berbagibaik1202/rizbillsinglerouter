import test from 'node:test';
import assert from 'node:assert/strict';
import { deduplicateRouterUsers } from '../backend/jobs/pppoeSyncWorker.js';

test('deduplicateRouterUsers removes duplicates and prioritizes active/better entry', () => {
    const rawRouterUsers = [
        {
            id: '*1',
            name: 'FITRI_CMS',
            password: '',
            service: 'any',
            profile: 'default',
            comment: '',
            disabled: true,
        },
        {
            id: '*2',
            name: 'FITRI_CMS',
            password: 'secret_password_123',
            service: 'pppoe',
            profile: 'Paket-20Mbps',
            comment: 'CUST-0012',
            disabled: false,
        },
        {
            id: '*3',
            name: 'JOHN_DOE',
            password: 'pass',
            service: 'pppoe',
            profile: 'default',
            comment: '',
            disabled: false,
        },
        {
            id: '*4',
            name: 'john_doe', // case difference
            password: 'pass',
            service: 'pppoe',
            profile: 'default',
            comment: '',
            disabled: true,
        },
    ];

    const { uniqueUsers, duplicateCount } = deduplicateRouterUsers(rawRouterUsers);

    assert.equal(duplicateCount, 2, 'Should detect 2 duplicates');
    assert.equal(uniqueUsers.length, 2, 'Should only have 2 unique users');

    const fitri = uniqueUsers.find(u => u.name.toUpperCase() === 'FITRI_CMS');
    assert.ok(fitri, 'FITRI_CMS should exist');
    assert.equal(fitri.id, '*2', 'Should keep the enabled, pppoe service, profiled entry (*2)');
    assert.equal(fitri.disabled, false);
    assert.equal(fitri.comment, 'CUST-0012');

    const john = uniqueUsers.find(u => u.name.toUpperCase() === 'JOHN_DOE');
    assert.ok(john, 'JOHN_DOE should exist');
    assert.equal(john.id, '*3', 'Should keep the enabled entry over the disabled one');
    assert.equal(john.disabled, false);
});

test('deduplicateRouterUsers handles empty, malformed, or missing names/ids gracefully', () => {
    const rawRouterUsers = [
        null,
        {},
        { id: '*5', name: '' },
        { id: '', name: 'VALID_USER', disabled: false },
        { id: '*6', name: 'VALID_USER', disabled: false },
    ];

    const { uniqueUsers } = deduplicateRouterUsers(rawRouterUsers);

    assert.equal(uniqueUsers.length, 1);
    assert.equal(uniqueUsers[0].name, 'VALID_USER');
    assert.equal(uniqueUsers[0].id, '*6');
});
