export const parseCurrencyValue = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value !== 'string') {
        return 0;
    }
    const normalized = value
        .replace(/[^\d,.-]/g, '')
        .replace(/\./g, '')
        .replace(/,/g, '.');
    const parsed = parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
};

export interface BillDetail {
    periode?: string;
    period?: string;
    month?: string;
    periode_tagihan?: string;
    nilai_tagihan?: unknown;
    nilai?: unknown;
    tagihan?: unknown;
    admin?: unknown;
    fee?: unknown;
    denda?: unknown;
    penalty?: unknown;
    biaya_lain?: unknown;
    other?: unknown;
    meter_awal?: string;
    meter_akhir?: string;
}

export interface BillSummary {
    period: string;
    tagihan: number;
    admin: number;
    total: number;
    descDetails: any;
    detailList: BillDetail[];
    detailDendaSum: number;
    detailOtherSum: number;
}

export const cleanCustomerName = (name?: string | null) => {
    if (!name) return '';
    return String(name)
        .replace(/\*/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
};

export const summarizeBill = (billInfo: any): BillSummary | null => {
    if (!billInfo) return null;
    const descDetails = billInfo.desc ?? {};
    const descDetailList: BillDetail[] = Array.isArray(descDetails.detail) ? descDetails.detail : [];
    const detailTagihanSum = descDetailList.reduce(
        (sum: number, item: BillDetail) => sum + parseCurrencyValue(item.nilai_tagihan ?? item.nilai ?? 0),
        0
    );
    const detailAdminSumRaw = descDetailList.reduce(
        (sum: number, item: BillDetail) => sum + parseCurrencyValue(item.admin ?? item.fee ?? 0),
        0
    );
    const detailAdminSum = detailAdminSumRaw < 0 ? 0 : detailAdminSumRaw;
    const detailDendaSum = descDetailList.reduce(
        (sum: number, item: BillDetail) => sum + parseCurrencyValue(item.denda ?? item.penalty ?? 0),
        0
    );
    const detailOtherSum = descDetailList.reduce(
        (sum: number, item: BillDetail) => sum + parseCurrencyValue(item.biaya_lain ?? item.other ?? 0),
        0
    );
    const detailTotal = detailTagihanSum + detailAdminSum + detailDendaSum + detailOtherSum;

    const detailPeriods = descDetailList
        .map((detail: BillDetail) => (detail.periode ?? detail.period ?? detail.month ?? '').toString().trim())
        .filter(Boolean);
    const period =
        detailPeriods.length > 0
            ? detailPeriods.join(', ')
            : billInfo.periode ||
              billInfo.period ||
              billInfo.month ||
              descDetailList[0]?.periode ||
              '-';
    const tagihan =
        detailTagihanSum > 0
            ? detailTagihanSum
            : parseCurrencyValue(
                  billInfo.selling_price ??
                  billInfo.bill_amount ??
                  billInfo.price ??
                  billInfo.amount ??
                  billInfo.nominal ??
                  0
              );
    const adminRaw =
        detailAdminSum > 0 ? detailAdminSum : parseCurrencyValue(billInfo.admin ?? billInfo.fee ?? 0);
    const admin = adminRaw < 0 ? 0 : adminRaw;
    const providerTotal = parseCurrencyValue(
        billInfo.total_charge ?? billInfo.total ?? billInfo.amount ?? 0
    );
    const total =
        detailTotal > 0
            ? detailTotal
            : providerTotal > 0
            ? providerTotal
            : (tagihan + admin) > 0
            ? tagihan + admin
            : tagihan;

    return {
        period,
        tagihan,
        admin,
        total,
        descDetails,
        detailList: descDetailList,
        detailDendaSum,
        detailOtherSum,
    };
};
