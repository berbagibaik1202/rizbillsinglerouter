import React, { useState } from 'react';
import { ApiSettings } from '../../../types';
import MapPicker from '../../common/MapPicker';

type OltDevice = NonNullable<ApiSettings['olt']>['devices'][number];

interface Props {
    devices: OltDevice[];
    onChange: (devices: OltDevice[]) => void;
}

const blankDevice = (): OltDevice => ({
    name: '',
    host: '',
    port: 22,
    username: '',
    password: '',
    model: '',
    connectionType: 'ssh',
    snmpEnabled: false,
    snmpHost: '',
    snmpPort: 161,
    snmpVersion: '2c',
    snmpCommunity: 'public',
    snmpProfile: 'auto',
    snmpTimeoutMs: 5000,
    snmpRetries: 1,
    description: '',
});

const OltSettings: React.FC<Props> = ({ devices, onChange }) => {
    const [showPasswords, setShowPasswords] = useState(false);

    const updateField = (index: number, field: keyof OltDevice, value: any) => {
        const next = [...devices];
        next[index] = { ...next[index], [field]: value };
        onChange(next);
    };

    const updateSnmpOid = (index: number, key: 'name' | 'sn' | 'status' | 'tx' | 'rx' | 'divider', value: string | number) => {
        const next = [...devices];
        const prev = next[index] || {};
        const currentOids = prev.snmpOids || {};
        next[index] = {
            ...prev,
            snmpOids: {
                ...currentOids,
                [key]: value,
            },
        };
        onChange(next);
    };

    const addDevice = () => {
        onChange([...(devices || []), blankDevice()]);
    };

    const removeDevice = (index: number) => {
        const next = devices.filter((_, i) => i !== index);
        onChange(next);
    };

    const applyModelDefaults = (index: number, model: string) => {
        const next = [...devices];
        const prev = next[index] || blankDevice();
        const upper = String(model || '').toUpperCase();
        if (upper === 'C300' || upper === 'C320') {
            next[index] = {
                ...prev,
                model,
                connectionType: 'telnet',
                port: prev.port && prev.port !== 22 ? prev.port : 23,
                snmpEnabled: true,
                snmpProfile: prev.snmpProfile && prev.snmpProfile !== 'auto' ? prev.snmpProfile : 'auto',
            };
        } else {
            next[index] = { ...prev, model };
        }
        onChange(next);
    };

    const setCliProtocol = (index: number, protocol: 'ssh' | 'telnet') => {
        const next = [...devices];
        const prev = next[index] || blankDevice();
        next[index] = {
            ...prev,
            connectionType: protocol,
            port: protocol === 'telnet'
                ? (prev.port === 22 || !prev.port ? 23 : prev.port)
                : (prev.port === 23 || !prev.port ? 22 : prev.port),
        };
        onChange(next);
    };

    const supportsSnmpProfile = (model: string | undefined) => /hioso|c-?data|cdata|fd1|fd16|fd12|zte|c300|c320/i.test(String(model || ''));

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">OLT Settings (CLI + SNMP)</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-300">Pisahkan koneksi aksi (CLI) dan koneksi monitoring (SNMP).</p>
                </div>
                <button
                    onClick={addDevice}
                    className="px-4 py-2 bg-green-600 text-white rounded-md shadow hover:bg-green-700"
                    type="button"
                >
                    + Tambah OLT
                </button>
            </div>

            {devices.length === 0 && (
                <p className="text-sm text-gray-600 dark:text-gray-300">Belum ada OLT. Tambahkan untuk mulai konfigurasi.</p>
            )}

            <div className="flex items-center gap-2 text-sm">
                <input
                    id="showPass"
                    type="checkbox"
                    checked={showPasswords}
                    onChange={(e) => setShowPasswords(e.target.checked)}
                />
                <label htmlFor="showPass" className="text-gray-700 dark:text-gray-300">Tampilkan password</label>
            </div>

            <div className="space-y-4">
                {devices.map((dev, idx) => (
                    <div key={idx} className="border rounded-lg p-4 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nama</label>
                                <input
                                    type="text"
                                    value={dev.name}
                                    onChange={(e) => updateField(idx, 'name', e.target.value)}
                                    className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    placeholder="OLT Utama"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Model</label>
                                <select
                                    value={dev.model || ''}
                                    onChange={(e) => applyModelDefaults(idx, e.target.value)}
                                    className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                >
                                    <option value="">Pilih model</option>
                                    <option value="C300">ZTE C300</option>
                                    <option value="C320">ZTE C320</option>
                                    <option value="CDATA">C-DATA</option>
                                    <option value="HIOSO">HIOSO</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Protokol CLI (untuk aksi)</label>
                                <div className="mt-1 grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setCliProtocol(idx, 'ssh')}
                                        className={`px-3 py-2 rounded border text-sm font-medium ${String(dev.connectionType || 'ssh') === 'ssh'
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-white text-gray-700 border-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600'
                                            }`}
                                    >
                                        SSH
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setCliProtocol(idx, 'telnet')}
                                        className={`px-3 py-2 rounded border text-sm font-medium ${String(dev.connectionType || 'ssh') === 'telnet'
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-white text-gray-700 border-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600'
                                            }`}
                                    >
                                        Telnet
                                    </button>
                                </div>
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Registrasi/reboot ONU menggunakan channel CLI ini.</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Host/IP</label>
                                <input
                                    type="text"
                                    value={dev.host}
                                    onChange={(e) => updateField(idx, 'host', e.target.value)}
                                    className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    placeholder="10.0.0.1"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Port SSH/Telnet</label>
                                <input
                                    type="number"
                                    value={dev.port ?? 22}
                                    onChange={(e) => updateField(idx, 'port', Number(e.target.value) || 22)}
                                    className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    min={1}
                                    max={65535}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Username</label>
                                <input
                                    type="text"
                                    value={dev.username}
                                    onChange={(e) => updateField(idx, 'username', e.target.value)}
                                    className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    placeholder="admin"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Password</label>
                                <input
                                    type={showPasswords ? 'text' : 'password'}
                                    value={dev.password || ''}
                                    onChange={(e) => updateField(idx, 'password', e.target.value)}
                                    className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    placeholder="******"
                                />
                            </div>

                            <div className="md:col-span-2">
                                <div className="flex items-center gap-2">
                                    <input
                                        id={`snmpEnabled-${idx}`}
                                        type="checkbox"
                                        checked={Boolean(dev.snmpEnabled || dev.connectionType === 'snmp')}
                                        onChange={(e) => updateField(idx, 'snmpEnabled', e.target.checked)}
                                    />
                                    <label htmlFor={`snmpEnabled-${idx}`} className="text-sm text-gray-700 dark:text-gray-300">
                                        Aktifkan monitoring SNMP
                                    </label>
                                </div>
                            </div>

                            {(dev.snmpEnabled || dev.connectionType === 'snmp') && (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">SNMP Host</label>
                                        <input
                                            type="text"
                                            value={dev.snmpHost || ''}
                                            onChange={(e) => updateField(idx, 'snmpHost', e.target.value)}
                                            className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            placeholder="Kosongkan untuk pakai Host/IP OLT"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">SNMP Port</label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={65535}
                                            value={dev.snmpPort ?? 161}
                                            onChange={(e) => updateField(idx, 'snmpPort', Number(e.target.value) || 161)}
                                            className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">SNMP Version</label>
                                        <select
                                            value={dev.snmpVersion || '2c'}
                                            onChange={(e) => updateField(idx, 'snmpVersion', e.target.value as '1' | '2c' | '3')}
                                            className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                        >
                                            <option value="2c">v2c</option>
                                            <option value="1">v1</option>
                                            <option value="3">v3</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">SNMP Community</label>
                                        <input
                                            type={showPasswords ? 'text' : 'password'}
                                            value={dev.snmpCommunity || 'public'}
                                            onChange={(e) => updateField(idx, 'snmpCommunity', e.target.value)}
                                            className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            placeholder="public"
                                        />
                                    </div>
                                    {supportsSnmpProfile(dev.model) ? (
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">SNMP Profile</label>
                                            <select
                                                value={dev.snmpProfile || 'auto'}
                                                onChange={(e) => updateField(idx, 'snmpProfile', e.target.value)}
                                                className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            >
                                                <option value="auto">Auto Detect (Hioso/C-DATA)</option>
                                                <option value="hioso-c">HIOSO_C (C-DATA Base)</option>
                                                <option value="hioso-b">HIOSO_B (BDCOM Base)</option>
                                                <option value="hioso-gpon">HIOSO_GPON (C-DATA GPON)</option>
                                                <option value="hioso-ha73">HIOSO_HA73</option>
                                                <option value="zte-c300-c320">ZTE C300/C320</option>
                                            </select>
                                        </div>
                                    ) : (
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">SNMP Profile</label>
                                            <div className="mt-1 px-3 py-2 border rounded bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-700 text-xs">
                                                Profile OID ONU belum tersedia untuk model ini. Monitoring ONU akan fallback ke Telnet.
                                            </div>
                                        </div>
                                    )}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">SNMP Timeout (ms)</label>
                                        <input
                                            type="number"
                                            min={500}
                                            max={60000}
                                            value={dev.snmpTimeoutMs ?? 5000}
                                            onChange={(e) => updateField(idx, 'snmpTimeoutMs', Number(e.target.value) || 5000)}
                                            className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">SNMP Retries</label>
                                        <input
                                            type="number"
                                            min={0}
                                            max={5}
                                            value={dev.snmpRetries ?? 1}
                                            onChange={(e) => updateField(idx, 'snmpRetries', Number(e.target.value) || 1)}
                                            className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                        />
                                    </div>

                                    {dev.snmpVersion === '3' && (
                                        <>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">SNMP v3 User</label>
                                                <input
                                                    type="text"
                                                    value={dev.snmpV3User || ''}
                                                    onChange={(e) => updateField(idx, 'snmpV3User', e.target.value)}
                                                    className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">SNMP v3 Auth Protocol</label>
                                                <select
                                                    value={dev.snmpV3AuthProtocol || 'sha'}
                                                    onChange={(e) => updateField(idx, 'snmpV3AuthProtocol', e.target.value as 'md5' | 'sha')}
                                                    className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                >
                                                    <option value="sha">SHA</option>
                                                    <option value="md5">MD5</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">SNMP v3 Auth Key</label>
                                                <input
                                                    type={showPasswords ? 'text' : 'password'}
                                                    value={dev.snmpV3AuthKey || ''}
                                                    onChange={(e) => updateField(idx, 'snmpV3AuthKey', e.target.value)}
                                                    className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">SNMP v3 Priv Protocol</label>
                                                <select
                                                    value={dev.snmpV3PrivProtocol || 'aes'}
                                                    onChange={(e) => updateField(idx, 'snmpV3PrivProtocol', e.target.value as 'des' | 'aes')}
                                                    className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                >
                                                    <option value="aes">AES</option>
                                                    <option value="des">DES</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">SNMP v3 Priv Key</label>
                                                <input
                                                    type={showPasswords ? 'text' : 'password'}
                                                    value={dev.snmpV3PrivKey || ''}
                                                    onChange={(e) => updateField(idx, 'snmpV3PrivKey', e.target.value)}
                                                    className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                />
                                            </div>
                                        </>
                                    )}

                                    {supportsSnmpProfile(dev.model) && (
                                        <>
                                            <div className="md:col-span-2">
                                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Override OID (Opsional)</p>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">Isi jika OLT Anda memakai branch OID berbeda dari profile default.</p>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">OID Name</label>
                                                <input
                                                    type="text"
                                                    value={dev.snmpOids?.name || ''}
                                                    onChange={(e) => updateSnmpOid(idx, 'name', e.target.value)}
                                                    className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono text-xs"
                                                    placeholder="1.3.6.1...."
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">OID Serial Number</label>
                                                <input
                                                    type="text"
                                                    value={dev.snmpOids?.sn || ''}
                                                    onChange={(e) => updateSnmpOid(idx, 'sn', e.target.value)}
                                                    className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono text-xs"
                                                    placeholder="1.3.6.1...."
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">OID Status</label>
                                                <input
                                                    type="text"
                                                    value={dev.snmpOids?.status || ''}
                                                    onChange={(e) => updateSnmpOid(idx, 'status', e.target.value)}
                                                    className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono text-xs"
                                                    placeholder="1.3.6.1...."
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">OID TX Power</label>
                                                <input
                                                    type="text"
                                                    value={dev.snmpOids?.tx || ''}
                                                    onChange={(e) => updateSnmpOid(idx, 'tx', e.target.value)}
                                                    className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono text-xs"
                                                    placeholder="1.3.6.1...."
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">OID RX Power</label>
                                                <input
                                                    type="text"
                                                    value={dev.snmpOids?.rx || ''}
                                                    onChange={(e) => updateSnmpOid(idx, 'rx', e.target.value)}
                                                    className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono text-xs"
                                                    placeholder="1.3.6.1...."
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Signal Divider</label>
                                                <input
                                                    type="number"
                                                    value={dev.snmpOids?.divider ?? ''}
                                                    onChange={(e) => updateSnmpOid(idx, 'divider', Number(e.target.value) || 1)}
                                                    className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                    min={1}
                                                />
                                            </div>
                                        </>
                                    )}
                                </>
                            )}

                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Deskripsi</label>
                                <textarea
                                    value={dev.description || ''}
                                    onChange={(e) => updateField(idx, 'description', e.target.value)}
                                    className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    placeholder="Catatan lokasi, akses VLAN manajemen, atau profil default."
                                    rows={2}
                                />
                            </div>
                            <div className="md:col-span-2">
                                <div className="flex items-center justify-between mb-2">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Lokasi OLT (untuk Map)</label>
                                    <button
                                        type="button"
                                        onClick={() => updateField(idx, 'location', undefined)}
                                        className="text-xs px-2 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                                    >
                                        Hapus Lokasi
                                    </button>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                                    <input
                                        type="number"
                                        step="any"
                                        value={dev.location?.lat ?? ''}
                                        onChange={(e) => {
                                            const lat = Number(e.target.value);
                                            if (!Number.isFinite(lat)) return;
                                            const lng = Number(dev.location?.lng ?? 0);
                                            updateField(idx, 'location', { lat, lng });
                                        }}
                                        className="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                        placeholder="Latitude"
                                    />
                                    <input
                                        type="number"
                                        step="any"
                                        value={dev.location?.lng ?? ''}
                                        onChange={(e) => {
                                            const lng = Number(e.target.value);
                                            if (!Number.isFinite(lng)) return;
                                            const lat = Number(dev.location?.lat ?? 0);
                                            updateField(idx, 'location', { lat, lng });
                                        }}
                                        className="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                        placeholder="Longitude"
                                    />
                                </div>
                                <MapPicker
                                    value={dev.location || null}
                                    onChange={(location) => updateField(idx, 'location', location)}
                                />
                            </div>
                        </div>
                        <div className="mt-4 flex justify-end">
                            <button
                                onClick={() => removeDevice(idx)}
                                type="button"
                                className="px-3 py-1.5 text-sm rounded bg-red-600 text-white hover:bg-red-700"
                            >
                                Hapus OLT
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default OltSettings;
