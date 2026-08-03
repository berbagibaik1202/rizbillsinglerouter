export const OLT_SNMP_PROFILES = {
    'hioso-c': {
        id: 'hioso-c',
        name: 'HIOSO_C (C-DATA Base)',
        modelPattern: /hioso|c-?data|cdata|fd1|fd16|fd12/i,
        oids: {
            name: '1.3.6.1.4.1.25355.3.2.6.3.2.1.37',
            sn: '1.3.6.1.4.1.25355.3.2.6.3.2.1.11',
            status: '1.3.6.1.4.1.25355.3.2.6.3.2.1.39',
            tx: '1.3.6.1.4.1.25355.3.2.6.14.2.1.4',
            rx: '1.3.6.1.4.1.25355.3.2.6.14.2.1.8',
            divider: 1,
        },
    },
    'hioso-b': {
        id: 'hioso-b',
        name: 'HIOSO_B (BDCOM Base)',
        modelPattern: /bdcom|hioso-b/i,
        oids: {
            name: '1.3.6.1.4.1.3320.101.10.1.1.79',
            sn: '1.3.6.1.4.1.3320.101.10.1.1.3',
            status: '1.3.6.1.4.1.3320.101.10.1.1.26',
            tx: '1.3.6.1.4.1.3320.101.10.5.1.5',
            rx: '1.3.6.1.4.1.3320.101.10.5.1.6',
            divider: 10,
        },
    },
    'hioso-gpon': {
        id: 'hioso-gpon',
        name: 'HIOSO_GPON (C-DATA GPON)',
        modelPattern: /gpon|hioso-gpon/i,
        oids: {
            name: '1.3.6.1.4.1.25355.3.3.1.1.1.2',
            sn: '1.3.6.1.4.1.25355.3.3.1.1.1.5',
            status: '1.3.6.1.4.1.25355.3.3.1.1.1.11',
            tx: '1.3.6.1.4.1.25355.3.3.1.1.4.1.2',
            rx: '1.3.6.1.4.1.25355.3.3.1.1.4.1.1',
            divider: 100,
        },
    },
    'hioso-ha73': {
        id: 'hioso-ha73',
        name: 'HIOSO_HA73',
        modelPattern: /ha73|hioso-ha73/i,
        oids: {
            name: '1.3.6.1.4.1.34592.1.3.100.12.1.1.2',
            sn: '1.3.6.1.4.1.34592.1.3.100.12.1.1.12',
            status: '1.3.6.1.4.1.34592.1.3.100.12.1.1.5',
            tx: '1.3.6.1.4.1.34592.1.3.100.12.1.1.13',
            rx: '1.3.6.1.4.1.34592.1.3.100.12.1.1.14',
            divider: 10,
        },
    },
    'zte-c300-c320': {
        id: 'zte-c300-c320',
        name: 'ZTE C300/C320',
        modelPattern: /zte|c300|c320/i,
        statusEncoding: 'zte-onu-phase',
        signalEncoding: 'zte-0p002-minus-30',
        indexEncoding: 'zte-ifindex-onuid',
        oids: {
            // Berdasar referensi oidc300c320.txt
            name: '1.3.6.1.4.1.3902.1082.500.10.2.3.3.1.2',
            sn: '1.3.6.1.4.1.3902.1082.500.10.2.3.3.1.18',
            status: '1.3.6.1.4.1.3902.1082.500.10.2.3.8.1.4',
            rx: '1.3.6.1.4.1.3902.1082.500.20.2.2.2.1.10',
            tx: '1.3.6.1.4.1.3902.1082.500.20.2.2.2.1.14',
            divider: 1,
        },
    },
};

export const listOltSnmpProfiles = () => Object.values(OLT_SNMP_PROFILES);

export const getOltSnmpProfileById = (id = '') => OLT_SNMP_PROFILES[String(id || '').trim().toLowerCase()] || null;

export const guessOltSnmpProfile = (model = '') => {
    const normalized = String(model || '').trim().toLowerCase();
    if (/zte|c300|c320/i.test(normalized)) return OLT_SNMP_PROFILES['zte-c300-c320'];
    return Object.values(OLT_SNMP_PROFILES).find((p) => p.modelPattern.test(normalized)) || OLT_SNMP_PROFILES['hioso-c'];
};
