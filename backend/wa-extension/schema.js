export async function migrateWaExtension(db) {
    const suffix = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    for (const statement of [
        `CREATE TABLE IF NOT EXISTS extension_sessions (
            id CHAR(36) PRIMARY KEY, user_id VARCHAR(255) NOT NULL,
            access_hash CHAR(64) NOT NULL UNIQUE, refresh_hash CHAR(64) NOT NULL UNIQUE,
            access_expires_at DATETIME NOT NULL, expires_at DATETIME NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX(user_id)
        )`,
        `CREATE TABLE IF NOT EXISTS extension_permissions (
            user_id VARCHAR(255) NOT NULL, permission VARCHAR(64) NOT NULL,
            allowed BOOLEAN NOT NULL DEFAULT TRUE, PRIMARY KEY(user_id, permission)
        )`,
        `CREATE TABLE IF NOT EXISTS customer_whatsapp_links (
            phone_number VARCHAR(20) PRIMARY KEY, customer_id VARCHAR(255) NOT NULL,
            verified_by VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX(customer_id)
        )`,
        `CREATE TABLE IF NOT EXISTS extension_audit_logs (
            id CHAR(36) PRIMARY KEY, user_id VARCHAR(255) NOT NULL,
            customer_id VARCHAR(255), action VARCHAR(64) NOT NULL,
            device VARCHAR(255), ip_address VARCHAR(64), result VARCHAR(32) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX(customer_id, created_at)
        )`,
        `CREATE TABLE IF NOT EXISTS extension_rate_limits (
            bucket_key CHAR(64) PRIMARY KEY, hits INT NOT NULL, expires_at DATETIME NOT NULL
        )`,
    ]) await db.query(`${statement} ${suffix}`);
}
