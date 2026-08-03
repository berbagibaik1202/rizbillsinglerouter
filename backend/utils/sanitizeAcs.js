export function sanitizeAcs(val, depth = 0) {
    if (depth > 40) return null; // prevent infinite loop

    // primitives
    if (
        val === null ||
        val === undefined ||
        typeof val === "string" ||
        typeof val === "number" ||
        typeof val === "boolean"
    ) return val;

    // arrays
    if (Array.isArray(val)) {
        return val.map(v => sanitizeAcs(v, depth + 1));
    }

    // objects
    if (typeof val === "object") {

        // unwrap TR-069 value
        if (val._value !== undefined)
            return sanitizeAcs(val._value, depth + 1);

        // unwrap standard "value"
        if (val.value !== undefined)
            return sanitizeAcs(val.value, depth + 1);

        // unwrap TR-069 object block
        if (val._object !== undefined)
            return sanitizeAcs(val._object, depth + 1);

        // unwritable flags
        if (val._writable !== undefined)
            return sanitizeAcs(val._writable, depth + 1);

        // unwrap object that has only 1 key
        const keys = Object.keys(val);
        if (keys.length === 1)
            return sanitizeAcs(val[keys[0]], depth + 1);

        // full object sanitize
        const out = {};
        for (const k in val) {
            out[k] = sanitizeAcs(val[k], depth + 1);
        }
        return out;
    }

    return String(val);
}
