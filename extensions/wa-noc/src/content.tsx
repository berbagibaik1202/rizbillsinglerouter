import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { request, type Customer, type Operator } from './api';
import { observeChat, type Chat } from './whatsapp';
import styles from './style.css?inline';

const text = (value: unknown) => value == null || value === '' ? '—' : String(value);
function Row({ label, value }: { label: string; value: unknown }) { return <div className="row"><span>{label}</span><strong>{text(value)}</strong></div>; }

function Provider({ title, op, id, refresh = 0, children }: { title: string; op: string; id: string; refresh?: number; children: (data: any) => React.ReactNode }) {
    const [data, setData] = useState<any>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        async function load() {
            try {
                if (!document.hidden) {
                    const result = await request(op, id);
                    if (!stopped) { setData(result); setError(''); }
                }
            } catch (failure) { if (!stopped) { setData(null); setError((failure as Error).message); } }
            finally { if (!stopped && refresh) timer = setTimeout(load, refresh); }
        }
        void load();
        return () => { stopped = true; clearTimeout(timer); };
    }, [op, id, refresh]);
    return <section><h3>{title}</h3>{error ? <p className="warning">{error}</p> : data ? <>
        {data.status && <span className={`badge ${data.status.toLowerCase()}`}>{data.status}</span>}
        {data.status === 'UNAVAILABLE' ? <p>{data.message}</p> : data.status === 'UNLINKED' ? <p>Perangkat belum dihubungkan di billing.</p> : children(data)}
        {data.sampledAt && <small>Diperiksa {new Date(data.sampledAt).toLocaleTimeString('id-ID')}</small>}
    </> : <p className="muted">Mengambil data…</p>}</section>;
}

function CustomerPanel({ customer, user, chat }: { customer: Customer; user: Operator; chat: Chat }) {
    const [tab, setTab] = useState('status');
    const [confirm, setConfirm] = useState(false);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [message, setMessage] = useState('');
    const [ping, setPing] = useState<any>(null);
    async function action(op: string) {
        if (busyRef.current) return;
        const currentTitle = document.querySelector('#main header span[title]')?.getAttribute('title')?.trim();
        if (currentTitle !== chat.label) { setMessage('Percakapan berubah. Pilih kembali pelanggan.'); setConfirm(false); return; }
        busyRef.current = true; setBusy(true); setMessage(''); setConfirm(false);
        try {
            const result = await request(op, customer.id, { confirm: true });
            if (op === 'ping') setPing(result);
            setMessage(result.message || 'Ping selesai.');
        } catch (error) { setMessage((error as Error).message); }
        finally { busyRef.current = false; setBusy(false); }
    }
    return <><section className="identity"><div className="eyebrow">{customer.id}</div><h2>{customer.name}</h2><Row label="Status billing" value={customer.status} /><Row label="Paket" value={`${customer.packageName || '—'} · ${customer.packageSpeed || '—'} Mbps`} /><Row label="PPPoE" value={customer.pppoeUsername} /></section>
        <nav>{['status', 'wifi', ...(user.permissions.includes('history') ? ['history'] : [])].map(value => <button key={value} className={tab === value ? 'selected' : 'secondary'} onClick={() => setTab(value)}>{value.toUpperCase()}</button>)}</nav>
        {tab === 'status' && <>
            <Provider title="Koneksi PPPoE" op="network" id={customer.id} refresh={15000}>{data => <><Row label="IP" value={data.ip} /><Row label="Uptime" value={data.uptime} /></>}</Provider>
            <Provider title="Traffic saat ini" op="traffic" id={customer.id} refresh={5000}>{data => <div className="traffic"><div><small>DOWNLOAD</small><strong>↓ {data.downloadMbps?.toFixed(2) ?? '—'}</strong><small>Mbps</small></div><div><small>UPLOAD</small><strong>↑ {data.uploadMbps?.toFixed(2) ?? '—'}</strong><small>Mbps</small></div></div>}</Provider>
            <Provider title="GenieACS / ONU" op="acs" id={customer.id} refresh={30000}>{data => <><Row label="Model" value={data.model} /><Row label="Serial" value={data.serial} /><Row label="RX power" value={data.rxPower == null ? null : `${data.rxPower} dBm`} /><Row label="Last inform" value={data.lastInform ? new Date(data.lastInform).toLocaleString('id-ID') : null} /><small>Status ACS dihitung dari waktu laporan terakhir perangkat.</small></>}</Provider>
            <section><h3>Pemeriksaan</h3><div className="actions">
                {user.permissions.includes('ping') && <button disabled={busy || !customer.pppoeUsername} onClick={() => void action('ping')}>Periksa ping</button>}
                {user.permissions.includes('reboot') && <button className="danger" disabled={busy || !customer.acsSerialNumber} onClick={() => setConfirm(true)}>Restart ONU</button>}
            </div>{busy && <p>Menjalankan tindakan…</p>}{ping && <><Row label="Target ping" value={ping.target} />{ping.samples.map((sample: any, index: number) => <Row key={index} label={`Paket ${index + 1}`} value={sample.time || sample.status || (sample.packetLoss != null ? `Loss ${sample.packetLoss}%` : 'Tidak ada balasan')} />)}</>}</section>
        </>}
        {tab === 'wifi' && <Provider title="WiFi pelanggan" op="wifi" id={customer.id}>{data => data.wifi?.length ? data.wifi.map((wifi: any, index: number) => <Row key={index} label={wifi.band ? `${wifi.band} GHz` : `WiFi ${index + 1}`} value={wifi.ssid} />) : <p>SSID belum tersedia dari perangkat.</p>}</Provider>}
        {tab === 'history' && <Provider title="Riwayat tindakan extension" op="history" id={customer.id}>{data => data.length ? data.map((entry: any) => <div className="event" key={entry.id}><strong>{entry.action} · {entry.result}</strong><small>{new Date(entry.created_at).toLocaleString('id-ID')}</small></div>) : <p>Belum ada tindakan.</p>}</Provider>}
        {message && <p role="status" className="notice">{message}</p>}
        {confirm && <section role="alertdialog" aria-modal="true" aria-label="Konfirmasi restart" className="confirmation"><h3>Restart ONU {customer.name}?</h3><p>{customer.id} · {customer.acsSerialNumber}</p><p>Internet pelanggan akan terputus sementara.</p><div className="actions"><button autoFocus className="secondary" onClick={() => setConfirm(false)}>Batal</button><button className="danger" disabled={busy} onClick={() => void action('reboot')}>Ya, restart ONU</button></div></section>}
    </>;
}

function ChatPanel({ chat, user }: { chat: Chat; user: Operator }) {
    const [customer, setCustomer] = useState<Customer | null>(null);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Customer[]>([]);
    const [message, setMessage] = useState(chat.phone ? 'Mencari pelanggan…' : 'Nomor tidak terlihat. Cari dan pilih pelanggan secara manual.');
    const [phone, setPhone] = useState(chat.phone || '');
    const [mapping, setMapping] = useState(false);
    const [linkConfirm, setLinkConfirm] = useState(false);
    const requestVersion = useRef(0);
    useEffect(() => {
        const version = ++requestVersion.current;
        if (chat.phone) request<Customer>('lookup', undefined, { phone: chat.phone }).then(result => {
            if (version === requestVersion.current) { setCustomer(result); setMessage('Pelanggan ditemukan dari nomor WhatsApp.'); }
        }).catch(error => { if (version === requestVersion.current) setMessage(error.message); });
        return () => { requestVersion.current++; };
    }, [chat.phone]);
    async function search(event: React.FormEvent) {
        event.preventDefault(); const version = ++requestVersion.current; setMessage('Mencari…');
        try {
            const rows = await request<Customer[]>('search', undefined, { query });
            if (version === requestVersion.current) { setResults(rows); setMessage(rows.length ? 'Pilih pelanggan yang sesuai dengan percakapan.' : 'Pelanggan tidak ditemukan.'); }
        } catch (error) { if (version === requestVersion.current) setMessage((error as Error).message); }
    }
    return <><section><small>PERCAKAPAN AKTIF</small><h3>{chat.label}</h3><form className="search" onSubmit={search}><input aria-label="Cari pelanggan" placeholder="Nama / ID / HP / PPPoE / serial" minLength={2} maxLength={100} required value={query} onChange={event => setQuery(event.target.value)} /><button>Cari</button></form><p role="status" className="muted">{message}</p>
        {results.map(row => <button className="result secondary" key={row.id} onClick={() => { requestVersion.current++; setCustomer(row); setResults([]); setLinkConfirm(false); setMessage('Pelanggan dipilih manual. Pastikan identitasnya sesuai.'); }}>{row.name}<small>{row.id} · {row.pppoeUsername}</small></button>)}
        {customer && user.permissions.includes('map') && <details><summary>Hubungkan nomor WhatsApp</summary><label>Nomor WhatsApp<input value={phone} onChange={event => { setPhone(event.target.value); setLinkConfirm(false); }} placeholder="628…" /></label><button className="secondary" disabled={!phone || mapping} onClick={() => setLinkConfirm(true)}>Hubungkan</button>
            {linkConfirm && <div><p>Hubungkan {phone} dengan {customer.name} ({customer.id})?</p><button disabled={mapping} onClick={async () => {
                setMapping(true);
                try { await request('link', customer.id, { phone, confirm: true }); setMessage('Mapping tersimpan.'); }
                catch (error) { setMessage((error as Error).message); }
                finally { setMapping(false); setLinkConfirm(false); }
            }}>Ya, simpan mapping</button><button className="secondary" onClick={() => setLinkConfirm(false)}>Batal</button></div>}
        </details>}
    </section>{customer && <CustomerPanel key={customer.id} customer={customer} user={user} chat={chat} />}</>;
}

class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() { return this.state.failed ? <p>Panel gagal ditampilkan. Tutup dan buka kembali panel NOC.</p> : this.props.children; }
}

function App() {
    const [open, setOpen] = useState(true);
    const [chat, setChat] = useState<Chat | null>(null);
    const [user, setUser] = useState<Operator | null>(null);
    const [message, setMessage] = useState('Memuat sesi…');
    async function session() {
        try {
            const operator = await request<Operator>('me');
            setUser(operator.permissions.includes('view') ? operator : null);
            setMessage(operator.permissions.includes('view') ? '' : 'Akses WA NOC dicabut.');
        }
        catch (error) { setUser(null); setMessage((error as Error).message); }
    }
    useEffect(() => observeChat(setChat), []);
    useEffect(() => { void session(); const timer = setInterval(() => { if (!document.hidden) void session(); }, 30000); return () => clearInterval(timer); }, []);
    useEffect(() => {
        const root = document.documentElement;
        const oldMargin = root.style.marginRight;
        // Reserve room so the panel does not cover the WhatsApp send button.
        root.style.marginRight = open && window.innerWidth >= 800 ? '370px' : oldMargin;
        return () => { root.style.marginRight = oldMargin; };
    }, [open]);
    return open ? <aside className="sidebar"><header className="top"><div><div className="eyebrow">RIZKITECH</div><strong>WA NOC</strong></div><div><button className="secondary" aria-label="Pengaturan" onClick={() => void request('openOptions')}>⚙</button><button className="secondary" aria-label="Tutup panel" onClick={() => setOpen(false)}>×</button></div></header>
        <div className="scroll"><Boundary key={chat?.key || 'empty'}>{!user ? <section><h2>Masuk ke billing</h2><p>{message}</p><button onClick={() => void request('openOptions')}>Buka login</button><button className="secondary" onClick={() => void session()}>Muat sesi</button></section> : chat ? <ChatPanel key={`${user.username}:${chat.key}`} chat={chat} user={user} /> : <section><h2>Buka percakapan pelanggan</h2><p>Panel mengikuti percakapan aktif. Jika nomor tidak terlihat, gunakan pencarian manual.</p></section>}</Boundary></div>
        <footer>{user?.username || 'Belum login'} · RizkiTech Billing</footer>
    </aside> : <button className="launcher" onClick={() => setOpen(true)}>RizkiTech NOC</button>;
}

if (!document.getElementById('rizkitech-wa-noc')) {
    const host = document.createElement('div'); host.id = 'rizkitech-wa-noc';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style'); style.textContent = styles;
    const root = document.createElement('div'); shadow.append(style, root); document.body.append(host);
    createRoot(root).render(<App />);
}
