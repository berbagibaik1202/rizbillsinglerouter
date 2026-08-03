import PDFDocument from 'pdfkit';
import { formatBillingPeriod, formatDateDisplay, formatRupiah } from './utils.js';

const safeText = (value, fallback = '-') => {
    const text = String(value ?? '').trim();
    return text || fallback;
};

export const generateInvoicePdfBuffer = async ({
    settings,
    customer,
    invoice,
    packageName,
    notificationType = 'due',
    paymentMethod = '',
}) => {
    const appName = safeText(settings?.app?.appName, 'ISP Billing');
    const companyAddress = safeText(settings?.app?.companyAddress, '-');
    const companyPhone = safeText(settings?.app?.companyPhone, '-');
    const customerName = safeText(customer?.name, '-');
    const customerId = safeText(customer?.id, '-');
    const customerEmail = safeText(customer?.email, '-');
    const planName = safeText(packageName, 'N/A');
    const invoiceId = safeText(invoice?.id, '-');
    const period = formatBillingPeriod(invoice?.billingPeriodStart, invoice?.billingPeriodEnd);
    const amount = formatRupiah(Number(invoice?.amount || 0));
    const issueDate = formatDateDisplay(invoice?.issueDate);
    const dueDate = formatDateDisplay(invoice?.dueDate);
    const status = notificationType === 'paid' ? 'PAID / LUNAS' : 'JATUH TEMPO';

    return new Promise((resolve, reject) => {
        const chunks = [];
        const doc = new PDFDocument({ size: 'A4', margin: 50 });

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(18).text(appName, { align: 'left' });
        doc.moveDown(0.2);
        doc.fontSize(10).fillColor('#4b5563').text(`Alamat: ${companyAddress}`);
        doc.text(`Telepon: ${companyPhone}`);
        doc.moveDown();

        doc.fillColor('#111827').fontSize(16).text(
            notificationType === 'paid' ? 'FAKTUR PEMBAYARAN' : 'INVOICE TAGIHAN',
            { align: 'left' }
        );
        doc.moveDown();

        doc.fontSize(11);
        doc.text(`Invoice ID: ${invoiceId}`);
        doc.text(`Tanggal Terbit: ${issueDate}`);
        doc.text(`Jatuh Tempo: ${dueDate}`);
        doc.text(`Status: ${status}`);
        if (notificationType === 'paid' && paymentMethod) {
            doc.text(`Metode Bayar: ${safeText(paymentMethod)}`);
        }
        doc.moveDown();

        doc.fontSize(12).text('Data Pelanggan', { underline: true });
        doc.moveDown(0.3);
        doc.fontSize(11);
        doc.text(`Nama: ${customerName}`);
        doc.text(`ID Pelanggan: ${customerId}`);
        doc.text(`Email: ${customerEmail}`);
        doc.text(`Paket: ${planName}`);
        doc.text(`Periode Billing: ${period}`);
        doc.moveDown();

        doc.fontSize(12).text('Rincian Tagihan', { underline: true });
        doc.moveDown(0.3);
        doc.fontSize(11).text(`Total Tagihan: ${amount}`);
        doc.moveDown(2);

        doc.fontSize(10).fillColor('#6b7280').text(
            notificationType === 'paid'
                ? 'Dokumen ini merupakan konfirmasi pembayaran yang sah dari sistem billing.'
                : 'Silakan lakukan pembayaran sebelum tanggal jatuh tempo untuk menghindari suspend layanan.'
        );

        doc.end();
    });
};
