/* ============================================================
   OUI VENDOR MAP - IMPROVED
============================================================ */
const ouiVendorMap = {
    // Apple
    '000393': 'Apple', '000A95': 'Apple', '001451': 'Apple', '0016CB': 'Apple', '0017F2': 'Apple', 
    '0019E3': 'Apple', '001CB3': 'Apple', '001E52': 'Apple', '001FCB': 'Apple', '002241': 'Apple', 
    '002312': 'Apple', '002332': 'Apple', '0023DF': 'Apple', '002436': 'Apple', '002500': 'Apple', 
    '0025BC': 'Apple', '002608': 'Apple', '00264A': 'Apple', '0026B0': 'Apple', '00A040': 'Apple', 
    '00C610': 'Apple', '00F4B9': 'Apple', '04E536': 'Apple', '34159E': 'Apple', '34C059': 'Apple', 
    '38C986': 'Apple', '40A6D9': 'Apple', '48A195': 'Apple', '5CF938': 'Apple', '60F81D': 'Apple', 
    '685B35': 'Apple', '68967B': 'Apple', '68D93C': 'Apple', '6C4D73': 'Apple', '7014A6': 'Apple', 
    '70A2B3': 'Apple', '7C6D62': 'Apple', '80929F': 'Apple', '848506': 'Apple', '84B153': 'Apple', 
    'A860B6': 'Apple', 'ACBC32': 'Apple', 'F0B479': 'Apple', 'F437B7': 'Apple', 'FC253F': 'Apple', 
    
    // Samsung
    '0012FB': 'Samsung', '001599': 'Samsung', '001662': 'Samsung', '0017D5': 'Samsung', '0018AF': 'Samsung', 
    '00194A': 'Samsung', '001CB1': 'Samsung', '001E7D': 'Samsung', '001FCD': 'Samsung', '0021D3': 'Samsung', 
    '002399': 'Samsung', '002454': 'Samsung', '002637': 'Samsung', '0808C7': 'Samsung', '0C8BF2': 'Samsung', 
    '10D542': 'Samsung', '1867B0': 'Samsung', '20677C': 'Samsung', '283737': 'Samsung', '2C542D': 'Samsung', 
    '382DD3': 'Samsung', '3CBB7C': 'Samsung', '4844F7': 'Samsung', '503275': 'Samsung', '54880E': 'Samsung', 
    '5C0A5B': 'Samsung', '606BBD': 'Samsung', '60D0A9': 'Samsung', '6C8334': 'Samsung', '78471D': 'Samsung', 
    '7C0B46': 'Samsung', '8018A7': 'Samsung', '8425DB': 'Samsung', '88329B': 'Samsung', '90F1AA': 'Samsung', 
    '94350A': 'Samsung', '9803D8': 'Samsung', '9C0298': 'Samsung', 'A02B89': 'Samsung', 'A078BA': 'Samsung', 
    'A47A6A': 'Samsung', 'AC063C': 'Samsung', 'B0C4E5': 'Samsung', 'B407F9': 'Samsung', 'BC4486': 'Samsung', 
    'C01173': 'Samsung', 'C4731E': 'Samsung', 'C8BA94': 'Samsung', 'CCF957': 'Samsung', 'D0DF9A': 'Samsung', 
    'D48890': 'Samsung', 'D831CF': 'Samsung', 'DC0B34': 'Samsung', 'E85A8A': 'Samsung', 'EC1F72': 'Samsung', 
    'F02243': 'Samsung', 
    
    // Google
    '000782': 'Google', '001A11': 'Google', '188A21': 'Google', '3C5AB4': 'Google', '546009': 'Google', 
    '94EB2C': 'Google', 'A47E39': 'Google', 'DAA48F': 'Google', 'F88FCA': 'Google', 
    
    // Xiaomi
    '0C1D6E': 'Xiaomi', '14486B': 'Xiaomi', '28E31F': 'Xiaomi', '38218D': 'Xiaomi', '4C49E3': 'Xiaomi', 
    '508A52': 'Xiaomi', '58449B': 'Xiaomi', '64A200': 'Xiaomi', '745795': 'Xiaomi', '7C1D1C': 'Xiaomi', 
    '8C4500': 'Xiaomi', '9C99A0': 'Xiaomi', 'A08D16': 'Xiaomi', 'ACF6F7': 'Xiaomi', 'B0E235': 'Xiaomi', 
    'B44506': 'Xiaomi', 'C4618B': 'Xiaomi', 'CC50E3': 'Xiaomi', 'D49115': 'Xiaomi', 'DCEEFB': 'Xiaomi', 
    'F48D59': 'Xiaomi', 'FC64BA': 'Xiaomi', 
    
    // TP-LINK
    '001150': 'TP-LINK', '0023CD': 'TP-LINK', '14CF92': 'TP-LINK', '403F8C': 'TP-LINK', '6466B3': 'TP-LINK', 
    '8416F9': 'TP-LINK', '90F652': 'TP-LINK', 'B0487A': 'TP-LINK', 'C04A00': 'TP-LINK', 'E8DE27': 'TP-LINK', 
    
    // ZTE
    '001CDA': 'ZTE', '002293': 'ZTE', '00A0E1': 'ZTE', '081735': 'ZTE', '285D9E': 'ZTE', '48EE0C': 'ZTE', 
    '70288B': 'ZTE', '847A88': 'ZTE', 'C864C7': 'ZTE', 'F83DFF': 'ZTE', 
    
    // Huawei
    '009E1E': 'Huawei', '049FCA': 'Huawei', '08E84F': 'Huawei', '0C45B2': 'Huawei', '200B0E': 'Huawei', 
    '24DBAC': 'Huawei', '308730': 'Huawei', '404E36': 'Huawei', '4C1FCC': 'Huawei', '548998': 'Huawei', 
    '60DE44': 'Huawei', '707781': 'Huawei', '781DBA': 'Huawei', '80B686': 'Huawei', '8853D4': 'Huawei', 
    'A04238': 'Huawei', 'AC4E91': 'Huawei', 'B8BC1B': 'Huawei', 'CCA223': 'Huawei', 'D07AB6': 'Huawei', 
    'D46E0E': 'Huawei', 'E0247F': 'Huawei', 'F84A7F': 'Huawei',
};

/* ============================================================
   PATH CONSTANTS
============================================================ */
export const RX_POWER_PATHS = [ 
    'Device.PON.Interface.*.Optical.SignalLevel', 
    'Device.Optical.Interface.*.OpticalSignalLevel',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPONConnection.1.X_HW_OpticalModule.RXPower', 
    'InternetGatewayDevice.WANDevice.1.X_HW_OptModule.1.RXPower', 
    'InternetGatewayDevice.WANDevice.*.X_ZTE-COM_WANPONInterfaceConfig.RXPower', 
    'InternetGatewayDevice.WANDevice.*.X_GponInterafceConfig.RXPower', 
    'InternetGatewayDevice.WANDevice.*.X_FH_GponInterfaceConfig.RXPower', 
    'InternetGatewayDevice.WANDevice.*.X_CT-COM_GponInterfaceConfig.RXPower', 
    'InternetGatewayDevice.WANDevice.*.X_CT-COM_EponInterfaceConfig.RXPower', 
    'InternetGatewayDevice.X_ALU_OntOpticalParam.RXPower', 
    'InternetGatewayDevice.X_Huawei_GPON.RXPower', 
    'InternetGatewayDevice.WANDevice.1.X_CMCC_GponInterfaceConfig.RXPower', 
    'InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig.RXPower', 
    'InternetGatewayDevice.WANDevice.1.X_CU_WANEPONInterfaceConfig.OpticalTransceiver.RXPower' 
];

export const PPPOE_USERNAME_PATHS = [ 
    'InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*.Username', 
    'Device.PPP.Interface.*.Username' 
];

export const EXTERNAL_IP_PATHS = [ 
    'InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*.ExternalIPAddress', 
    'InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANIPConnection.*.ExternalIPAddress', 
    'Device.IP.Interface.*.IPv4Address.*.IPAddress' 
];

export const SSID_PATHS = [ 
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID",
        "InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID",
        "Device.WiFi.SSID.*.SSID",
];

export const PRODUCT_CLASS_PATHS = [ 
    // Standard TR-069 / TR-181
    "InternetGatewayDevice.DeviceInfo.ModelName",
    "Device.DeviceInfo.ModelName",
    "InternetGatewayDevice.DeviceInfo.ProductClass",
    "Device.DeviceInfo.ProductClass",
    
    // Huawei
    "InternetGatewayDevice.DeviceInfo.X_HW_DeviceName",
    "InternetGatewayDevice.DeviceInfo.X_HW_ProductClass",
    "InternetGatewayDevice.X_HW_sys.ProductClass",
    
    // ZTE
    "InternetGatewayDevice.DeviceInfo.X_ZTE-COM_DeviceModel",
    "InternetGatewayDevice.DeviceInfo.X_ZTE-COM_ModelName",
    "InternetGatewayDevice.X_ZTE-COM_DeviceInfo.ModelName",
    
    // China Telecom
    "InternetGatewayDevice.DeviceInfo.X_CT-COM_ModelName",
    "InternetGatewayDevice.DeviceInfo.X_CT-COM_ProductClass",

    // Fiberhome & Others
    "InternetGatewayDevice.X_FH_DeviceInfo.ModelName",
    "InternetGatewayDevice.DeviceInfo.X_FH_ModelName",
    
    // Generic Fallbacks
    "InternetGatewayDevice.DeviceInfo.ModelNumber",
    "Device.DeviceInfo.ModelNumber",
    "InternetGatewayDevice.DeviceInfo.Description",
    "Device.DeviceInfo.Description",
    
    // GenieACS internal
    "summary.modelName",
    "summary.productClass",
    "DeviceID.ProductClass",
    "_deviceId._ProductClass",
    "_deviceId.ProductClass",
    "DeviceID.ModelName"
];

/* ============================================================
   VALIDATORS & FORMATTERS - IMPROVED
============================================================ */
const isValidUsername = (v) => typeof v === "string" && v.length > 2 && v !== "N/A" && !v.includes("example");
const isValidIp = (v) => typeof v === "string" && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(v) && v !== "0.0.0.0";
const isValidRx = (v) => {
    if (v === null || v === undefined) return false;
    const strVal = String(v).replace(",", ".");
    return !isNaN(parseFloat(strVal)) && isFinite(strVal);
};
const isValidProductClass = (v) => typeof v === "string" && v.length > 1 && v !== "N/A";
const isValidSsid = (v) => typeof v === 'string' && v.length > 0 && v !== "N/A";

const formatRxPower = (rawValue) => {
    if (rawValue === null || rawValue === undefined || String(rawValue).trim() === "") return "N/A";
    
    let str = String(rawValue).trim().replace(",", ".").replace(/[a-zA-Z\s]/g, "");
    let val = parseFloat(str);
    
    if (isNaN(val) || val === 0) return "N/A";
    
    // Handle different formats of RX power values
    if (val < 0 && val >= -50) {
        // Already in dBm format
        return `${val.toFixed(2)} dBm`;
    } else if (val > 0 && val < 100) {
        // Assume it's in mW, convert to dBm
        const dBm = 10 * Math.log10(val / 1000);
        if (dBm >= -45 && dBm <= -1) return `${dBm.toFixed(2)} dBm`;
    } else if (Math.abs(val) >= 100) {
        // Handle values that might be scaled incorrectly
        let scaled = Math.abs(val);
        while (scaled > 100) scaled /= 10;
        const dBm = -scaled;
        if (dBm >= -45 && dBm <= -1) return `${dBm.toFixed(2)} dBm`;
    }
    
    return "N/A";
};

const enhanceHostname = (mac, originalHostname) => {
    const baseName = (typeof originalHostname === 'string' || typeof originalHostname === 'number')
        ? String(originalHostname)
        : '';
    const cleanBase = baseName.trim();

    // If hostname is actually a MAC-looking string, ignore it
    const safeBase = isMacLikeString(cleanBase) ? '' : cleanBase;

    const normalizedMac = normalizeMac(mac);
    if (!normalizedMac) return safeBase || 'Unknown Device';
    
    const cleanMac = normalizedMac;
    const oui = cleanMac.substring(0, 6);
    const vendor = ouiVendorMap[oui];

    if (!vendor) {
        const formattedMac = cleanMac.match(/.{1,2}/g)?.join(':');
        return safeBase || formattedMac || 'Unknown Device';
    }

    // If no hostname, use vendor; otherwise show "Vendor (hostname)"
    return safeBase ? `${vendor} (${safeBase})` : vendor;
};

/* ============================================================
   HELPER FUNCTIONS - IMPROVED
============================================================ */

const unwrapAcsValue = (val, depth = 0) => {
    if (val === null || val === undefined || depth > 5) return val;
    
    if (Array.isArray(val)) {
        return val.length ? unwrapAcsValue(val[0], depth + 1) : undefined;
    }
    
    if (typeof val === "object") {
        if (val._value !== undefined) return unwrapAcsValue(val._value, depth + 1);
        if (val.value !== undefined) return unwrapAcsValue(val.value, depth + 1);
        if (val.$value !== undefined) return unwrapAcsValue(val.$value, depth + 1);
    }
    
    return val;
};

// Extract raw MAC value even if it comes as a nested object from ACS responses
const extractMacValue = (val, depth = 0) => {
    if (val === null || val === undefined || depth > 6) return null;

    const unwrapped = unwrapAcsValue(val, depth + 1);
    if (typeof unwrapped === 'string' || typeof unwrapped === 'number') {
        return String(unwrapped);
    }

    if (typeof unwrapped === 'object') {
        const candidateKeys = [
            '_value', 'value', '$value', 'Value', '_',
            'mac', 'MAC', 'macAddress', 'MACAddress',
            'physAddress', 'PhysAddress', 'address'
        ];

        for (const key of candidateKeys) {
            if (unwrapped[key] !== undefined) {
                const extracted = extractMacValue(unwrapped[key], depth + 1);
                if (extracted) return extracted;
            }
        }

        for (const child of Object.values(unwrapped)) {
            const extracted = extractMacValue(child, depth + 1);
            if (extracted) return extracted;
        }
    }

    return null;
};

const pickMacFromFields = (source, fields = []) => {
    if (!source || typeof source !== 'object') return null;
    for (const field of fields) {
        if (source[field] === undefined || source[field] === null) continue;
        const extracted = extractMacValue(source[field]);
        if (extracted && String(extracted).trim() !== '') {
            return extracted;
        }
    }
    return null;
};

const findMacAnywhere = (obj, depth = 0) => {
    if (!obj || depth > 6) return null;
    if (typeof obj === 'string') {
        const cleaned = obj.replace(/[^a-fA-F0-9:.-]/g, '');
        if (cleaned.length >= 12 && /[A-Fa-f0-9]{2}([:. -]?)[A-Fa-f0-9]{2}/.test(cleaned)) {
            return cleaned;
        }
    }
    if (typeof obj === 'object') {
        for (const val of Object.values(obj)) {
            const found = findMacAnywhere(val, depth + 1);
            if (found) return found;
        }
    }
    return null;
};

const findIpAnywhere = (obj, depth = 0) => {
    if (!obj || depth > 6) return null;
    if (typeof obj === 'string') {
        if (isValidIpString(obj)) return obj.trim();
    }
    if (typeof obj === 'object') {
        for (const val of Object.values(obj)) {
            const found = extractIpValue(val, depth + 1);
            if (found) return found;
        }
    }
    return null;
};

const findSignalAnywhere = (obj, depth = 0) => {
    if (!obj || depth > 6) return null;
    if (typeof obj === 'string' || typeof obj === 'number') {
        const sig = normalizeSignal(obj);
        if (sig) return sig;
    }
    if (typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
            const lower = key.toLowerCase();
            if (lower.includes('signal') || lower.includes('rssi')) {
                const candidate = normalizeSignal(obj[key]);
                if (candidate) return candidate;
            }
            const found = findSignalAnywhere(obj[key], depth + 1);
            if (found) return found;
        }
    }
    return null;
};

const findIpInIpv4List = (ipv4Obj) => {
    if (!ipv4Obj || typeof ipv4Obj !== 'object') return null;
    const entries = Object.values(ipv4Obj);
    for (const entry of entries) {
        const ip = extractIpValue(entry?.IPAddress) || extractIpValue(entry?.IPAddressValue);
        if (ip) return ip;
    }
    return null;
};

const findValueByKey = (obj, keys = [], depth = 0) => {
    if (!obj || depth > 6) return null;
    if (typeof obj !== 'object') return null;
    for (const key of Object.keys(obj)) {
        if (keys.includes(key.toLowerCase()) || keys.includes(key)) {
            const val = unwrapAcsValue(obj[key]);
            if (val !== undefined && val !== null && String(val).trim() !== '') return val;
        }
        const nested = findValueByKey(obj[key], keys, depth + 1);
        if (nested !== null && nested !== undefined) return nested;
    }
    return null;
};

const pickFirstValid = (...values) => {
    for (const v of values) {
        if (v === null || v === undefined) continue;
        const str = String(v).trim();
        if (str === '' || str.toUpperCase() === 'N/A') continue;
        if (isMacLikeString(str)) continue;
        return v;
    }
    return null;
};

const normalizeMac = (val) => {
    if (val === null || val === undefined) return null;
    const cleaned = String(val).replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
    if (cleaned.length >= 12) return cleaned.slice(0, 12);
    return cleaned || null;
};

const isMacLikeString = (val) => {
    if (typeof val !== 'string') return false;
    const cleaned = val.replace(/[^A-Fa-f0-9]/g, '');
    return cleaned.length >= 12 && cleaned.length <= 17;
};

const resolveHostInfo = (mac, hostsMap) => {
    if (!mac || !hostsMap) return {};
    const clean = mac.replace(/[^A-F0-9]/gi, '').toUpperCase();
    const direct = hostsMap.get(mac) || hostsMap.get(clean) || hostsMap.get(clean.toLowerCase()) || hostsMap.get(clean.match(/.{1,2}/g)?.join(':'));
    if (direct) return direct;

    for (const [key, val] of hostsMap.entries()) {
        const k = key.replace(/[^A-F0-9]/gi, '').toUpperCase();
        if (k === clean) return val;
    }
    return {};
};

const normalizeSignal = (val) => {
    const candidate = unwrapAcsValue(val);
    if (candidate === null || candidate === undefined) return null;

    if (typeof candidate === 'number') return `${candidate}`;
    if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed.length === 0) return null;

        // Drop obvious timestamps/ISO strings
        if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return null;

        // Keep dBm or numeric-looking values only
        const numericMatch = trimmed.match(/-?\d+(\.\d+)?/);
        if (numericMatch) {
            return numericMatch[0];
        }
        return null;
    }

    if (typeof candidate === 'object') {
        const fields = ['signal', 'SignalStrength', 'RSSI', 'value', '_value', '$value'];
        for (const key of fields) {
            if (candidate[key] !== undefined) {
                const nested = normalizeSignal(candidate[key]);
                if (nested) return nested;
            }
        }
    }

    return null;
};

const isValidIpString = (str) => {
    if (typeof str !== 'string') return false;
    const trimmed = str.trim();
    return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(trimmed) && !/^0\.0\.0\.0$/.test(trimmed);
};

const extractIpValue = (val, depth = 0) => {
    if (val === null || val === undefined || depth > 6) return null;
    const unwrapped = unwrapAcsValue(val);

    if (typeof unwrapped === 'string' && isValidIpString(unwrapped)) {
        return unwrapped.trim();
    }

    if (typeof unwrapped === 'object') {
        const candidateKeys = ['IPAddress', 'IP', 'address', 'ip'];
        for (const key of candidateKeys) {
            if (unwrapped[key] !== undefined) {
                const extracted = extractIpValue(unwrapped[key], depth + 1);
                if (extracted) return extracted;
            }
        }
        for (const child of Object.values(unwrapped)) {
            const extracted = extractIpValue(child, depth + 1);
            if (extracted) return extracted;
        }
    }

    return null;
};

const flattenObject = (obj, prefix = "", res = {}) => {
    if (!obj || typeof obj !== "object") return res;
    
    for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        
        const newKey = prefix ? `${prefix}.${key}` : key;
        const value = obj[key];
        
        if (typeof value === "object" && !Array.isArray(value) && value !== null) {
            if (key === "_value" || key === "value" || key === "$value") {
                res[prefix || key] = value;
            } else {
                flattenObject(value, newKey, res);
            }
        } else {
            res[newKey] = value;
        }
    }
    return res;
};

const createUnifiedParametersObject = (device) => {
    if (!device || typeof device !== "object") return {};
    
    let combined = {};
    
    // Copy top-level properties
    Object.assign(combined, device);
    
    // Merge common structures
    if (device.summary && typeof device.summary === "object") {
        Object.assign(combined, device.summary);
    }
    
    if (device.parameters && typeof device.parameters === "object") {
        Object.assign(combined, device.parameters);
    }
    
    // Handle nested device structures
    if (device.Device) {
        Object.assign(combined, { Device: device.Device });
    }
    
    if (device.InternetGatewayDevice) {
        Object.assign(combined, { InternetGatewayDevice: device.InternetGatewayDevice });
    }
    
    // Preserve device ID information
    if (device._deviceId) {
        Object.assign(combined, { _deviceId: device._deviceId });
    }
    
    return flattenObject(combined);
};

const getValueAndPathByPaths = (flatObj, paths, validator = () => true) => {
    if (!flatObj || typeof flatObj !== "object") {
        return { value: null, path: null };
    }
    
    for (const path of paths) {
        // Try exact match first
        const exactValue = unwrapAcsValue(flatObj[path] ?? flatObj[`${path}._value`]);
        if (exactValue !== undefined && exactValue !== null && String(exactValue).trim() !== "" && validator(exactValue)) {
            return { value: exactValue, path };
        }
        
        // Handle wildcard paths
        if (path.includes("*")) {
            const regex = new RegExp('^' + path.replace(/\./g, '\\.').replace(/\*/g, '\\d+') + '(\\._value)?$');
            
            for (const key in flatObj) {
                if (regex.test(key)) {
                    const val = unwrapAcsValue(flatObj[key]);
                    if (val !== undefined && val !== null && String(val).trim() !== "" && validator(val)) {
                        return { value: val, path: key.replace('._value', '') };
                    }
                }
            }
        }
    }
    
    return { value: null, path: null };
};

const findFuzzyValue = (flatObj, searchTerms, excludeTerms = [], validator = () => true) => {
    if (!flatObj || typeof flatObj !== "object") return undefined;
    
    for (const key in flatObj) {
        const lowerKey = key.toLowerCase();
        
        if (searchTerms.some(t => lowerKey.includes(t)) && 
            !excludeTerms.some(t => lowerKey.includes(t))) {
            
            const val = unwrapAcsValue(flatObj[key]);
            if (val !== undefined && val !== null && String(val).trim() !== "" && validator(val)) {
                return val;
            }
        }
    }
    
    return undefined;
};

const getValueByPath = (obj, path) => {
    if (!obj || !path) return undefined;
    
    try {
        const value = path.split('.').reduce((o, p) => (o && o[p] !== undefined) ? o[p] : undefined, obj);
        return unwrapAcsValue(value);
    } catch (error) {
        return undefined;
    }
};

const _parseClientDevice = (devObject, hostsMap) => {
    if (!devObject || typeof devObject !== "object") return null;
    
    // Extract MAC address from various possible fields
    const rawMac = pickMacFromFields(devObject, [
        'AssociatedDeviceMACAddress',
        'MACAddress',
        'MacAddress',
        'HostNameMACAddress',
        'PhysAddress'
    ]) || findMacAnywhere(devObject);
    
    const mac = normalizeMac(rawMac);
    if (!mac) return null;

    const hostInfo = resolveHostInfo(mac, hostsMap);
    
    // Extract hostname from various possible fields
    const originalHostname = pickFirstValid(
        hostInfo.hostname,
        unwrapAcsValue(devObject.HostName),
        unwrapAcsValue(devObject.Hostname),
        unwrapAcsValue(devObject.X_HW_HostName),
        unwrapAcsValue(devObject.X_HW_AssociatedDevicedescriptions),
        unwrapAcsValue(devObject['X_ZTE-COM_AssociatedDeviceName']),
        unwrapAcsValue(devObject['X_ZTE-COM_DeviceName']),
        unwrapAcsValue(devObject.X_CT_COM_DeviceName),
        unwrapAcsValue(devObject.DeviceName),
        unwrapAcsValue(devObject.Name),
        unwrapAcsValue(findValueByKey(devObject, ['name', 'hostname', 'devicename']))
    ) || '';
    
    // Extract signal strength from various possible fields
    const signal = pickFirstValid(
        normalizeSignal(hostInfo.signal),
        normalizeSignal(devObject.SignalStrength),
        normalizeSignal(devObject.Signal),
        normalizeSignal(devObject.RSSI),
        normalizeSignal(devObject.AssociatedDeviceRssi),
        normalizeSignal(devObject['X_HW_RSSI']),
        normalizeSignal(devObject['X_ZTE-COM_RSSI']),
        normalizeSignal(devObject['X_CT-COM_RSSI']),
        normalizeSignal(devObject['X_FH_RSSI']),
        normalizeSignal(findSignalAnywhere(devObject)),
        normalizeSignal(findSignalAnywhere(hostInfo))
    );
                   
    // Extract IP address from various possible fields
    const ipAddress = pickFirstValid(
        hostInfo.ip,
        extractIpValue(devObject.AssociatedDeviceIPAddress),
        extractIpValue(devObject.IPAddress),
        extractIpValue(devObject.X_HW_IPAddress),
        extractIpValue(devObject['X_ZTE-COM_IPAddress']),
        extractIpValue(devObject['AssociatedDeviceIPAddress']),
        extractIpValue(devObject.IP),
        extractIpValue(findIpInIpv4List(devObject.IPv4Address)),
        extractIpValue(findIpAnywhere(devObject)),
        extractIpValue(findIpAnywhere(hostInfo))
    ) || 'N/A';

    return {
        mac,
        ip: ipAddress,
        hostname: enhanceHostname(mac, originalHostname),
        signal: signal ? String(signal) : 'N/A',
    };
};

const scanForModel = (flatObj) => {
    if (!flatObj || typeof flatObj !== "object") return null;
    
    const keys = Object.keys(flatObj);
    
    // Priority 1: Exact ModelName matches
    for (const key of keys) {
        if ((/ModelName$/i.test(key) || /ProductClass$/i.test(key)) && 
            !key.includes('HardwareVersion') && 
            isValidProductClass(unwrapAcsValue(flatObj[key]))) {
            return unwrapAcsValue(flatObj[key]);
        }
    }
    
    // Priority 2: Fuzzy search for model-related terms
    const modelValue = findFuzzyValue(
        flatObj, 
        ["modelname", "productclass", "modelnumber", "devicemodel"], 
        ["hardware", "serial", "version"],
        isValidProductClass
    );
    
    return modelValue || null;
};

const parseAssociated = (ssidName, deviceData, hostsMap) => {
    const devices = [];
    const seenMacs = new Set();
    
    const addDevice = (device) => {
        if (device && device.mac) {
            const macKey = device.mac.replace(/[^A-F0-9]/g, '');
            if (macKey && !seenMacs.has(macKey)) {
                devices.push({
                    ...device,
                    mac: normalizeMac(device.mac) || device.mac
                });
                seenMacs.add(macKey);
            }
        }
    };
    
    // Strategy 1: TR-098 & Vendor Extensions
    const igdWlanConfigs = deviceData?.InternetGatewayDevice?.LANDevice;
    if (igdWlanConfigs && typeof igdWlanConfigs === "object") {
        Object.values(igdWlanConfigs).forEach(lan => {
            if (lan && typeof lan === 'object' && lan.WLANConfiguration) {
                Object.values(lan.WLANConfiguration).forEach(wlan => {
                    const wlanSsid = unwrapAcsValue(wlan.SSID);
                    const matchesSsid = !ssidName || wlanSsid === ssidName;
                    if (wlan && matchesSsid) {
                        const potentialClientLists = [
                            wlan.AssociatedDevice,
                            wlan.AssociatedDevices,
                            wlan['X_HW_WlanAssociate'],
                            wlan['X_HW_UserDev'],
                            wlan['X_ZTE-COM_AssociatedHosts']?.AssociatedHost,
                            wlan['X_ZTE-COM_AssociatedHosts']?.AssociatedDevice,
                            wlan['X_ZTE-COM_AssociatedDevice'],
                            wlan['X_FH_AssociatedDevice'],
                            wlan['X_CT-COM_AssociatedDevice'],
                        ];

                        // Generic scanning for client devices
                        for (const key in wlan) {
                            const val = wlan[key];
                            if (!val || typeof val !== 'object' || Array.isArray(val) || key === '_object' || key === '_value') continue;
                            
                            const children = Object.values(val);
                            if (children.length > 0 && typeof children[0] === 'object') {
                                const sampleChild = children[0];
                                if (sampleChild && (
                                    sampleChild.MACAddress || 
                                    sampleChild.AssociatedDeviceMACAddress || 
                                    sampleChild.PhysAddress ||
                                    sampleChild.MacAddress
                                )) {
                                    potentialClientLists.push(val);
                                }
                            }
                        }
                        
                        for (const clientList of potentialClientLists) {
                            if (clientList && typeof clientList === 'object') {
                                Object.values(clientList).forEach(dev => addDevice(_parseClientDevice(dev, hostsMap)));
                            }
                        }
                    }
                });
            }
        });
    }

    // Strategy 2: TR-181 Hosts Table
    const deviceHosts = deviceData?.Device?.Hosts?.Host;
    if (deviceHosts && typeof deviceHosts === "object") {
        Object.values(deviceHosts).forEach(host => {
            const l2iface = unwrapAcsValue(host.Layer2Interface);
            if (!l2iface) return;

            let connectedSsidName = null;
            
            if (l2iface.includes('WiFi.SSID') || l2iface.includes('WiFi.AccessPoint')) {
                const resolvedSsid = getValueByPath(deviceData, `${l2iface}.SSID`) || 
                                     getValueByPath(deviceData, `${l2iface}.SSIDReference.SSID`);
                
                if (resolvedSsid === ssidName) {
                    connectedSsidName = ssidName;
                } else if (getValueByPath(deviceData, `${l2iface}.SSIDReference`)) {
                    const ssidRefPath = getValueByPath(deviceData, `${l2iface}.SSIDReference`);
                    if (ssidRefPath && getValueByPath(deviceData, `${ssidRefPath}.SSID`) === ssidName) {
                        connectedSsidName = ssidName;
                    }
                }
            }
            
            if (!ssidName || connectedSsidName === ssidName) {
                const rawMac = unwrapAcsValue(host.PhysAddress);
                const mac = normalizeMac(rawMac);
                
                if (mac && !seenMacs.has(mac)) {
                    const devObject = { 
                        MACAddress: mac, 
                        SignalStrength: unwrapAcsValue(host.SignalStrength), 
                        RSSI: unwrapAcsValue(host.RSSI)
                    };
                    addDevice(_parseClientDevice(devObject, hostsMap));
                }
            }
        });
    }
    
    // Strategy 3: TR-181 AccessPoint AssociatedDevice
    const wifiAccessPoints = deviceData?.Device?.WiFi?.AccessPoint;
    if (wifiAccessPoints && typeof wifiAccessPoints === "object") {
        Object.values(wifiAccessPoints).forEach(ap => {
            const ssidRef = unwrapAcsValue(ap.SSIDReference);
            if (ssidRef) {
                const ssidOfAp = getValueByPath(deviceData, `${ssidRef}.SSID`);
                if ((ssidOfAp === ssidName || !ssidName) && ap.AssociatedDevice && typeof ap.AssociatedDevice === 'object') {
                     Object.values(ap.AssociatedDevice).forEach(dev => addDevice(_parseClientDevice(dev, hostsMap)));
                }
            }
        });
    }

    return devices;
};

/* ============================================================
   MAIN PARSER FUNCTION - IMPROVED
============================================================ */
// Tambahkan function ini di file yang sama dengan parseDeviceDetails
export const convertToLegacyFormat = (parsedDetails) => {
    console.log('🔄 Converting to legacy format...');
    
    // Determine if device is online (simple heuristic)
    const isOnline = parsedDetails.general?.uptime !== 'N/A' && 
                    parsedDetails.general?.uptime !== undefined;
    
    // Convert WLAN structure
    const wlanConfigs = (parsedDetails.wlan || [])
        .map((wlan) => {
            // Hanya gunakan path yang benar-benar ada di data ACS untuk menghindari fault 9003/9007
            const keyPath = (typeof wlan.keyPath === 'string' && wlan.keyPath.length > 0) ? wlan.keyPath : '';
            let ssidPath = (typeof wlan.ssidPath === 'string' && wlan.ssidPath.length > 0) ? wlan.ssidPath : '';

            // Derivasi SSID dari keyPath jika formatnya jelas (KeyPassphrase / PreSharedKey)
            if (!ssidPath && keyPath.includes('KeyPassphrase')) {
                ssidPath = keyPath.replace('KeyPassphrase', 'SSID');
            } else if (!ssidPath && keyPath.includes('PreSharedKey')) {
                ssidPath = keyPath.replace(/PreSharedKey(\.\\d+)?\.PreSharedKey/, 'SSID');
            }

            // Kalau tidak punya path SSID maupun key yang valid, abaikan entri ini agar tidak mengirim parameter invalid
            if (!ssidPath && !keyPath) return null;

            const ssidVal = (typeof wlan.ssid === 'string') ? wlan.ssid : '';
            const keyVal = (typeof wlan.key === 'string') ? wlan.key : '';

            return {
                ssidPath,
                keyPath,
                ssid: ssidVal,
                key: keyVal,
                associatedDevices: wlan.associatedDevices || [],
                band: wlan.band
            };
        })
        .filter(Boolean);

    // Get RX power from WAN connections
    let rxPower = null;
    if (parsedDetails.wan && parsedDetails.wan.length > 0) {
        const firstWan = parsedDetails.wan[0];
        if (firstWan.rxPower && typeof firstWan.rxPower === 'string') {
            // Extract numeric value from formatted string like "-25.5 dBm"
            const match = firstWan.rxPower.match(/(-?\d+\.?\d*)/);
            rxPower = match ? parseFloat(match[1]) : null;
        }
    }

    const result = {
        isOnline: isOnline,
        model: parsedDetails.general?.model || 'Unknown',
        rxPower: rxPower,
        wlanConfigs: wlanConfigs,
        // Include full parsed data for debugging
        _fullDetails: parsedDetails
    };

    console.log('✅ Converted legacy format:', {
        isOnline: result.isOnline,
        model: result.model,
        rxPower: result.rxPower,
        wlanConfigsCount: result.wlanConfigs.length,
        wlanConfigs: result.wlanConfigs
    });

    return result;
};
export const parseDeviceDetails = (deviceData, simple = false) => {
    // Enhanced input validation
    if (!deviceData || typeof deviceData !== "object" || Object.keys(deviceData).length === 0) {
        return {
            general: { 
                model: 'N/A',
                firmware: 'N/A',
                uptime: 'N/A',
                hardwareVersion: 'N/A'
            },
            wan: [],
            wlan: [],
            lan: { 
                ip: 'N/A', 
                subnet: 'N/A', 
                connectedHosts: [] 
            },
            raw: deviceData || {}
        };
    }

    const params = createUnifiedParametersObject(deviceData);
    
    // Enhanced model detection with fallbacks
    const modelResult = getValueAndPathByPaths(params, PRODUCT_CLASS_PATHS, isValidProductClass);
    const modelName = modelResult.value || 
                     scanForModel(params) ||
                     findFuzzyValue(params, ["productclass", "modelname", "modelnumber"], [], isValidProductClass) ||
                     'N/A';

    // Simplified parsing for performance
    if (simple) {
        const rxPowerValue = getValueAndPathByPaths(params, RX_POWER_PATHS, isValidRx).value;
        
        return {
            general: { 
                model: modelName
            },
            wan: [{ 
                rxPower: formatRxPower(rxPowerValue), 
                username: getValueAndPathByPaths(params, PPPOE_USERNAME_PATHS, isValidUsername).value, 
                ip: getValueAndPathByPaths(params, EXTERNAL_IP_PATHS, isValidIp).value 
            }],
            wlan: [{ 
                ssid: getValueAndPathByPaths(params, SSID_PATHS, isValidSsid).value 
            }],
        };
    }

    // Full detailed parsing
    const details = {
        general: {
            firmware: getValueAndPathByPaths(params, [
                'InternetGatewayDevice.DeviceInfo.SoftwareVersion', 
                'Device.DeviceInfo.SoftwareVersion'
            ]).value || 'N/A',
            uptime: getValueAndPathByPaths(params, [
                'InternetGatewayDevice.DeviceInfo.UpTime', 
                'Device.DeviceInfo.UpTime'
            ]).value || 'N/A',
            model: modelName,
            hardwareVersion: getValueAndPathByPaths(params, [
                'InternetGatewayDevice.DeviceInfo.HardwareVersion', 
                'Device.DeviceInfo.HardwareVersion'
            ]).value || 'N/A'
        },
        wan: [],
        wlan: [],
        lan: {
            ip: getValueAndPathByPaths(params, [
                'InternetGatewayDevice.LANDevice.*.LANHostConfigManagement.IPInterface.*.IPAddress', 
                'Device.IP.Interface.*.IPv4Address.*.IPAddress'
            ]).value || 'N/A',
            subnet: getValueAndPathByPaths(params, [
                'InternetGatewayDevice.LANDevice.*.LANHostConfigManagement.IPInterface.*.IPInterfaceSubnetMask', 
                'Device.IP.Interface.*.IPv4Address.*.Subnet'
            ]).value || 'N/A',
            connectedHosts: []
        },
        raw: deviceData,
    };

    // LAN Hosts parsing
    const allHosts = [];
    const seenMacs = new Set();
    
    const processHost = (host) => {
        if (host && typeof host === 'object') {
            const rawMac = pickMacFromFields(host, ['MACAddress', 'PhysAddress']) || findMacAnywhere(host);
            const mac = normalizeMac(rawMac);
            
            if (mac && !seenMacs.has(mac)) {
                const originalHostname = unwrapAcsValue(host.HostName);
                const hostSignal = pickFirstValid(
                    normalizeSignal(unwrapAcsValue(host.SignalStrength)),
                    normalizeSignal(unwrapAcsValue(host.Signal)),
                    normalizeSignal(unwrapAcsValue(host.RSSI)),
                    normalizeSignal(unwrapAcsValue(host['X_HW_RSSI'])),
                    normalizeSignal(unwrapAcsValue(host['X_ZTE-COM_RSSI'])),
                    normalizeSignal(unwrapAcsValue(host['X_CT-COM_RSSI'])),
                    normalizeSignal(unwrapAcsValue(host['X_FH_RSSI'])),
                    normalizeSignal(findSignalAnywhere(host))
                );
                const hostIp = pickFirstValid(
                    extractIpValue(host.IPAddress),
                    extractIpValue(host.IP),
                    extractIpValue(host['X_HW_IPAddress']),
                    extractIpValue(host['X_ZTE-COM_IPAddress']),
                    extractIpValue(findIpInIpv4List(host.IPv4Address)),
                    extractIpValue(findIpAnywhere(host))
                );
                allHosts.push({
                    mac,
                    ip: hostIp || 'N/A',
                    hostname: enhanceHostname(mac, originalHostname),
                    signal: hostSignal,
                    active: unwrapAcsValue(host.Active) === true || 
                            unwrapAcsValue(host.Active) === '1' ||
                            unwrapAcsValue(host.Active) === 'true'
                });
                seenMacs.add(mac);
            }
        }
    };
    
    // Process hosts from different data structures
    const igdLanHosts = deviceData?.InternetGatewayDevice?.LANDevice;
    if (igdLanHosts && typeof igdLanHosts === "object") {
        Object.values(igdLanHosts).forEach((lan) => {
            if (lan?.Hosts?.Host && typeof lan.Hosts.Host === "object") {
                Object.values(lan.Hosts.Host).forEach(processHost);
            }
        });
    }
    
    const deviceHosts = deviceData?.Device?.Hosts?.Host;
    if (deviceHosts && typeof deviceHosts === "object") {
        Object.values(deviceHosts).forEach(processHost);
    }
    
    details.lan.connectedHosts = allHosts;
    const hostsMap = new Map();
    allHosts.forEach(h => {
        const upper = h.mac.toUpperCase();
        const lower = h.mac.toLowerCase();
        const colonMac = upper.match(/.{1,2}/g)?.join(':');

        hostsMap.set(upper, h);
        hostsMap.set(lower, h);
        if (colonMac) {
            hostsMap.set(colonMac.toUpperCase(), h);
            hostsMap.set(colonMac.toLowerCase(), h);
        }
    });

    // WAN Connection parsing
    const rawRxPower = getValueAndPathByPaths(params, RX_POWER_PATHS, isValidRx).value;
    const formattedRxPower = formatRxPower(rawRxPower);

    // TR-098 WANDevice parsing
    const igdWan = deviceData?.InternetGatewayDevice?.WANDevice;
    if (igdWan && typeof igdWan === "object") {
        Object.keys(igdWan).forEach((wanKey) => {
            const wan = igdWan[wanKey];
            if (wan?.WANConnectionDevice && typeof wan.WANConnectionDevice === "object") {
                Object.keys(wan.WANConnectionDevice).forEach((connKey) => {
                    const conn = wan.WANConnectionDevice[connKey];
                    
                    // PPPoE Connections
                    if (conn.WANPPPConnection && typeof conn.WANPPPConnection === "object") {
                        Object.keys(conn.WANPPPConnection).forEach((pppKey) => {
                            const ppp = conn.WANPPPConnection[pppKey];
                            const basePath = `InternetGatewayDevice.WANDevice.${wanKey}.WANConnectionDevice.${connKey}.WANPPPConnection.${pppKey}`;
                            
                            details.wan.push({
                                type: 'PPPoE',
                                status: unwrapAcsValue(ppp.ConnectionStatus) || 'Unknown',
                                username: unwrapAcsValue(ppp.Username),
                                usernamePath: `${basePath}.Username`,
                                passwordPath: `${basePath}.Password`,
                                ip: unwrapAcsValue(ppp.ExternalIPAddress),
                                dns: unwrapAcsValue(ppp.DNSServers),
                                rxPower: formattedRxPower
                            });
                        });
                    }
                    
                    // IP Connections
                    if (conn.WANIPConnection && typeof conn.WANIPConnection === "object") {
                        Object.keys(conn.WANIPConnection).forEach((ipKey) => {
                            const ip = conn.WANIPConnection[ipKey];
                            
                            details.wan.push({
                                type: 'IP',
                                status: unwrapAcsValue(ip.ConnectionStatus) || 'Unknown',
                                ip: unwrapAcsValue(ip.ExternalIPAddress),
                                dns: unwrapAcsValue(ip.DNSServers),
                                rxPower: formattedRxPower
                            });
                        });
                    }
                });
            }
        });
    }
    
    // TR-181 PPP Interface parsing
    const devicePpp = deviceData?.Device?.PPP?.Interface;
    if (devicePpp && typeof devicePpp === "object") {
        Object.keys(devicePpp).forEach((pppKey) => {
            const ppp = devicePpp[pppKey];
            if (ppp?.Username) {
                const basePath = `Device.PPP.Interface.${pppKey}`;
                details.wan.push({
                    type: 'PPPoE',
                    status: unwrapAcsValue(ppp.Status) || 'Unknown',
                    username: unwrapAcsValue(ppp.Username),
                    usernamePath: `${basePath}.Username`,
                    passwordPath: `${basePath}.Password`,
                    ip: null, 
                    dns: null,
                    rxPower: formattedRxPower
                });
            }
        });
    }

    // WLAN SSID parsing (tampilkan semua SSID apa pun namanya)
    const foundSsids = [];

    // TR-181 WiFi parsing (Modern)
    const wifiRoot = deviceData?.Device?.WiFi;
    if (wifiRoot && typeof wifiRoot === "object") {
        if (wifiRoot.SSID && typeof wifiRoot.SSID === "object") {
            Object.keys(wifiRoot.SSID).forEach(ssidKey => {
                const ssidConfig = wifiRoot.SSID[ssidKey];
                const ssid = unwrapAcsValue(ssidConfig.SSID);
                const isEnabled = unwrapAcsValue(ssidConfig.Enable) === true || 
                                 String(unwrapAcsValue(ssidConfig.Enable)).toLowerCase() === 'true' || 
                                 unwrapAcsValue(ssidConfig.Status) === 'Up';
                
                if (ssid || isEnabled !== null) {
                    // Find corresponding Access Point
                    let ap = wifiRoot.AccessPoint?.[ssidKey];
                    if (!ap && wifiRoot.AccessPoint) {
                        ap = Object.values(wifiRoot.AccessPoint).find(
                            p => unwrapAcsValue(p.SSIDReference) === `Device.WiFi.SSID.${ssidKey}.`
                        );
                    }
                    
                    const apKey = ap ? Object.keys(wifiRoot.AccessPoint).find(k => wifiRoot.AccessPoint[k] === ap) : null;
                    const security = ap?.Security;

                        foundSsids.push({
                            name: `Wi-Fi ${ssidKey}`,
                            status: unwrapAcsValue(ssidConfig.Status) || 'Unknown',
                            enabled: isEnabled,
                            ssid: ssid || `SSID ${ssidKey}`,
                            ssidPath: `Device.WiFi.SSID.${ssidKey}.SSID`,
                            security: unwrapAcsValue(security?.ModeEnabled),
                            key: unwrapAcsValue(security?.KeyPassphrase),
                            keyPath: apKey ? `Device.WiFi.AccessPoint.${apKey}.Security.KeyPassphrase` : '',
                            associatedDevices: parseAssociated(ssid, deviceData, hostsMap)
                    });
                }
            });
        }
    }
    
    // TR-098 WLAN parsing (Legacy)
    const igdLanHostsForWlan = deviceData?.InternetGatewayDevice?.LANDevice;
    if (igdLanHostsForWlan && typeof igdLanHostsForWlan === "object") {
        Object.keys(igdLanHostsForWlan).forEach(lanKey => {
            const wlanRoot = igdLanHostsForWlan[lanKey]?.WLANConfiguration;
            if (wlanRoot && typeof wlanRoot === "object") {
                Object.keys(wlanRoot).forEach(wifiKey => {
                    const wifi = wlanRoot[wifiKey];
                    const ssid = unwrapAcsValue(wifi.SSID);
                    const isEnabled = unwrapAcsValue(wifi.Enable) === true || 
                                     String(unwrapAcsValue(wifi.Enable)).toLowerCase() === 'true' || 
                                     unwrapAcsValue(wifi.Status) === 'Up';
                    
                    if (ssid || isEnabled !== null) {
                        const basePath = `InternetGatewayDevice.LANDevice.${lanKey}.WLANConfiguration.${wifiKey}`;
                        let keyInfo = { 
                            key: unwrapAcsValue(wifi.KeyPassphrase), 
                            path: `${basePath}.KeyPassphrase` 
                        };
                        
                        // Fallback to PreSharedKey if KeyPassphrase not found
                        if (!keyInfo.key && wifi.PreSharedKey && typeof wifi.PreSharedKey === "object") {
                            const keyIndex = Object.keys(wifi.PreSharedKey)[0];
                            if (keyIndex) {
                                keyInfo = { 
                                    key: unwrapAcsValue(wifi.PreSharedKey[keyIndex]?.PreSharedKey), 
                                    path: `${basePath}.PreSharedKey.${keyIndex}.PreSharedKey` 
                                };
                            }
                        }
                        
                        const mapKey = `${basePath}.SSID`;
                        foundSsids.push({
                            name: `Wi-Fi ${wifiKey}`,
                            status: unwrapAcsValue(wifi.Status) || 'Unknown',
                            enabled: isEnabled,
                            ssid: ssid || `SSID ${wifiKey}`,
                            ssidPath: `${basePath}.SSID`,
                            security: unwrapAcsValue(wifi.BeaconType),
                            key: keyInfo.key,
                            keyPath: keyInfo.path,
                            associatedDevices: parseAssociated(ssid, deviceData, hostsMap)
                        });
                    }
                });
            }
        });
    }
    
    details.wlan = foundSsids;

    return details;
};
