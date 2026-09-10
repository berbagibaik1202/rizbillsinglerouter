import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { request, type Operator } from './api';
import './style.css';

function Options() {
    const [backend, setBackend] = useState('https://billing.rizki-tech.com');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [user, setUser] = useState<Operator | null>(null);
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        request('config').then(config => setBackend(config.backend)).catch(error => setMessage(error.message));
        request<Operator>('me').then(setUser).catch(() => {});
    }, []);
    async function login(event: React.FormEvent) {
        event.preventDefault(); setBusy(true); setMessage('');
        try {
            const origin = new URL(backend).origin;
            if (!await chrome.permissions.request({ origins: [`${origin}/*`] })) throw new Error('Izin akses backend diperlukan untuk login.');
            setUser(await request<Operator>('login', undefined, { backend, username, password }));
            setMessage('Terhubung. Buka WhatsApp Web, lalu tekan Muat sesi pada sidebar.');
        } catch (error) { setMessage((error as Error).message); setUser(null); }
        finally { setPassword(''); setBusy(false); }
    }
    return <main className="options"><div className="eyebrow">RIZKITECH / CUSTOMER OPERATIONS</div><h1>WA NOC</h1><p>Hubungkan akun billing untuk memeriksa pelanggan dari WhatsApp Web.</p>
        {user ? <section><h2>Terhubung sebagai {user.username}</h2><p>Akses: {user.permissions.join(', ')}</p><button disabled={busy} onClick={async () => {
            setBusy(true);
            try { await request('logout'); setMessage('Logout berhasil.'); }
            catch (error) { setMessage(`Sesi lokal dihapus. ${(error as Error).message}`); }
            finally { setUser(null); setBusy(false); }
        }}>Logout</button></section> : <form onSubmit={login}>
            <label>Alamat backend<input type="url" required value={backend} onChange={event => setBackend(event.target.value)} /></label>
            <label>Username billing<input autoComplete="username" required maxLength={255} value={username} onChange={event => setUsername(event.target.value)} /></label>
            <label>Password<input type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={event => setPassword(event.target.value)} /></label>
            <button disabled={busy}>{busy ? 'Menghubungkan…' : 'Login'}</button>
        </form>}
        <p role="status">{message}</p><small>Sesi disimpan sementara selama browser terbuka. Password tidak disimpan oleh extension.</small>
    </main>;
}
createRoot(document.getElementById('root')!).render(<Options />);
