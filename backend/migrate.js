// backend/migrate.js
// This script is responsible for setting up and migrating the database schema.
// It should be run manually or as part of the development startup process.

import { fileURLToPath } from 'url';
import path from 'path';
import mysql from 'mysql2/promise'; // Import mysql2 directly for raw connection
import './env.js';

// Boilerplate for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import pool from './db.js';
import bcrypt from 'bcryptjs';
import { migrateWaExtension } from './wa-extension/schema.js';

console.log(`[DB Migration] Module loaded at ${new Date().toISOString()}`);
console.log(`[DB Migration] cwd: ${process.cwd()}`);
console.log(`[DB Migration] script file: ${fileURLToPath(import.meta.url)}`);
console.log(`[DB Migration] backend dir: ${__dirname}`);
console.log(`[DB Migration] env file: ${path.join(__dirname, '.env')}`);
console.log(`[DB Migration] DB_HOST=${process.env.DB_HOST || '(unset)'}`);
console.log(`[DB Migration] DB_PORT=${process.env.DB_PORT || '(unset)'}`);
console.log(`[DB Migration] DB_NAME=${process.env.DB_NAME || '(unset)'}`);
console.log(`[DB Migration] DB_USER=${process.env.DB_USER || '(unset)'}`);

const TABLE_ENGINE_AND_CHARSET = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

/**
 * A robust, decomposed function to ensure a foreign key constraint exists and is correctly formed.
 * It handles cleanup, data integrity, schema correction, and separate index/constraint creation.
 */
const ensureForeignKey = async ({
    connection, tableName, columnName, constraintName, referencedTable, referencedColumn, columnDefinition, onDelete = 'SET NULL'
}) => {
    // 1. Check if the constraint already exists.
    const [[fk]] = await connection.query(
        `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?;`,
        [tableName, constraintName]
    );

    if (fk) {
        return; // It's already there, we're good.
    }

    console.log(`[DB Schema] Foreign key '${constraintName}' missing. Starting DECOMPOSED creation process...`);
    const dedicatedIndexName = `idx_${tableName}_${columnName}`;

    // --- PHASE 1: FULL CLEANUP ---
    console.log(`[DB Schema] Dropping old constraint and index for '${constraintName}' if they exist...`);
    try { await connection.query(`ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${constraintName}\``); } catch (e) { if (e.errno !== 1091) throw e; }
    try { await connection.query(`ALTER TABLE \`${tableName}\` DROP INDEX \`${dedicatedIndexName}\``); } catch (e) { if (e.errno !== 1091) throw e; }
    // Also try dropping index with same name as constraint, which some versions of MySQL create
    try { await connection.query(`ALTER TABLE \`${tableName}\` DROP INDEX \`${constraintName}\``); } catch (e) { if (e.errno !== 1091) throw e; }

    // --- PHASE 2: DATA INTEGRITY ---
    console.log(`[DB Schema] Cleaning orphaned data in '${tableName}.${columnName}'...`);
    if (onDelete.toUpperCase().includes('SET NULL')) {
        await connection.query(
            `UPDATE \`${tableName}\` SET \`${columnName}\` = NULL 
             WHERE \`${columnName}\` IS NOT NULL AND \`${columnName}\` NOT IN (SELECT \`${referencedColumn}\` FROM \`${referencedTable}\`);`
        );
    } else { // For CASCADE, RESTRICT, etc., delete the whole row.
        await connection.query(
            `DELETE FROM \`${tableName}\`
             WHERE \`${columnName}\` IS NOT NULL AND \`${columnName}\` NOT IN (SELECT \`${referencedColumn}\` FROM \`${referencedTable}\`);`
        );
    }

    // --- PHASE 3: SCHEMA CORRECTION ---
    console.log(`[DB Schema] Ensuring '${tableName}.${columnName}' schema is correct...`);
    await connection.query(`ALTER TABLE \`${tableName}\` MODIFY COLUMN \`${columnName}\` ${columnDefinition}`);
    
    // --- PHASE 4: ADD INDEX SEPARATELY ---
    console.log(`[DB Schema] Adding index '${dedicatedIndexName}' separately...`);
    await connection.query(`ALTER TABLE \`${tableName}\` ADD INDEX \`${dedicatedIndexName}\` (\`${columnName}\`);`);

    // --- PHASE 5: ADD CONSTRAINT SEPARATELY ---
    console.log(`[DB Schema] Adding foreign key constraint '${constraintName}' separately...`);
    await connection.query(`
        ALTER TABLE \`${tableName}\`
        ADD CONSTRAINT \`${constraintName}\`
            FOREIGN KEY (\`${columnName}\`)
            REFERENCES \`${referencedTable}\`(\`${referencedColumn}\`)
            ON DELETE ${onDelete};
    `);
    
    console.log(`[DB Schema] Successfully created foreign key '${constraintName}'.`);
};

/**
 * Ensures that a column exists in a table. If not, it adds it.
 * @param {object} connection - The database connection object.
 * @param {string} tableName - The name of the table to check.
 * @param {string} columnName - The name of the column to check.
 * @param {string} columnDefinition - The SQL definition of the column to add.
 */
const checkAndAddColumn = async (connection, tableName, columnName, columnDefinition) => {
    const [columns] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\` LIKE ?`, [columnName]);
    if (columns.length === 0) {
        console.log(`[DB Schema] Column '${columnName}' missing in '${tableName}'. Adding...`);
        await connection.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${columnDefinition}`);
    }
};

const checkAndAddIndex = async (connection, tableName, indexName, columnName) => {
    const [indexes] = await connection.query(
        `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
        [tableName, indexName]
    );

    if (indexes.length > 0) {
        return;
    }

    console.log(`[DB Schema] Index '${indexName}' missing in '${tableName}'. Adding...`);
    await connection.query(`ALTER TABLE \`${tableName}\` ADD INDEX \`${indexName}\` (\`${columnName}\`)`);
};

const ensureColumnDefinitionContains = async (connection, tableName, columnName, columnDefinition, requiredSubstring) => {
    const [columns] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\` LIKE ?`, [columnName]);
    if (columns.length === 0) {
        return;
    }

    const currentType = String(columns[0].Type || columns[0].type || '').toLowerCase();
    if (currentType.includes(String(requiredSubstring || '').toLowerCase())) {
        return;
    }

    console.log(`[DB Schema] Column '${tableName}.${columnName}' needs update. Applying definition: ${columnDefinition}`);
    await connection.query(`ALTER TABLE \`${tableName}\` MODIFY COLUMN \`${columnName}\` ${columnDefinition}`);
};

const checkAndRenameColumn = async (connection, tableName, oldColumnName, newColumnName, columnDefinition) => {
    const [columns] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\` LIKE ?`, [oldColumnName]);
    if (columns.length > 0) {
        console.log(`[DB Schema] Column '${oldColumnName}' found in '${tableName}'. Renaming to '${newColumnName}'...`);
        await connection.query(`ALTER TABLE \`${tableName}\` CHANGE COLUMN \`${oldColumnName}\` \`${newColumnName}\` ${columnDefinition}`);
    }
};

const ensureEnumColumnIncludes = async (connection, tableName, columnName, allowedValues) => {
    const [columns] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\` LIKE ?`, [columnName]);
    if (columns.length === 0) {
        return;
    }

    const currentType = String(columns[0].Type || columns[0].type || '').toLowerCase();
    const nextType = `enum(${allowedValues.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(',')})`;
    const normalizedCurrent = currentType.replace(/\s+/g, '');
    const normalizedNext = nextType.replace(/\s+/g, '').toLowerCase();

    if (normalizedCurrent === normalizedNext) {
        return;
    }

    console.log(`[DB Schema] Updating enum values for '${tableName}.${columnName}'...`);
    await connection.query(`ALTER TABLE \`${tableName}\` MODIFY COLUMN \`${columnName}\` ${nextType} NOT NULL`);
};

/**
 * Checks for specific table corruption (Error 1932: Table doesn't exist in engine)
 * and drops the table if corrupted to allow recreation.
 */
const handleTableCorruption = async (connection, tableName) => {
    try {
        // Try a lightweight read to check engine status
        await connection.query(`SELECT 1 FROM \`${tableName}\` LIMIT 1`);
    } catch (e) {
        // Error 1932: Table doesn't exist in engine
        if (e.errno === 1932) {
            console.error(`[DB Recovery] Table '${tableName}' is corrupted (Error 1932). Dropping it to allow recreation...`);
            try {
                await connection.query(`DROP TABLE IF EXISTS \`${tableName}\``);
                console.log(`[DB Recovery] Corrupted table '${tableName}' dropped successfully.`);
            } catch (dropError) {
                console.error(`[DB Recovery] Failed to drop corrupted table '${tableName}':`, dropError);
            }
        }
    }
}

/**
 * Ensures that all required database tables exist and have the correct schema.
 */
export const migrateDatabase = async () => {
    let connection;
    try {
        console.log('[DB Migration] Verifying and migrating database schema...');
        
        // Attempt to connect using the pool. If the DB doesn't exist, we catch the error and create it.
        try {
            connection = await pool.getConnection();
        } catch (connErr) {
            // ER_BAD_DB_ERROR = 1049
            if (connErr.code === 'ER_BAD_DB_ERROR' || connErr.errno === 1049) {
                const dbName = process.env.DB_NAME || 'rizkitechbill';
                console.warn(`[DB Migration] Database '${dbName}' does not exist. Attempting to create it...`);
                
                // Create a temporary connection without a database selected
                const tempConnection = await mysql.createConnection({
                    host: process.env.DB_HOST || 'localhost',
                    user: process.env.DB_USER || 'root',
                    password: process.env.DB_PASSWORD || '',
                    port: process.env.DB_PORT || 3306,
                });

                await tempConnection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
                console.log(`[DB Migration] Database '${dbName}' created successfully.`);
                await tempConnection.end();

                // Retry getting a connection from the pool now that the DB exists
                connection = await pool.getConnection();
            } else {
                // Re-throw other errors
                throw connErr;
            }
        }

        console.log('Successfully connected to the MySQL database.');

        // --- PHASE 0: CHECK FOR CORRUPTION ---
        // Check known tables for engine corruption before attempting creation/alteration
        const tablesToCheck = [
            'packages', 'users', 'odps', 'odcs', 'pppoe_profiles', 
            'hotspot_profiles', 'acs_devices', 'pppoe_users', 'hotspot_users', 
            'settings', 'admin_notifications', 'system_flags', 'customers', 
            'hotspot_vouchers', 'whatsapp_logs', 'complaints', 'topup_requests', 
            'invoices', 'payments', 'package_changes', 'customer_commissions',
            'olt_ont_cache', 'cash_mutations', 'acs_sync_jobs', 'pppoe_sync_jobs', 'database_restore_jobs'
        ];
        
        for (const table of tablesToCheck) {
            await handleTableCorruption(connection, table);
        }

        // --- PHASE 1: CREATE ALL TABLES IF THEY DON'T EXIST (IN DEPENDENCY ORDER) ---
        await connection.query(`CREATE TABLE IF NOT EXISTS packages (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE, speed INT NOT NULL, price INT NOT NULL, pppoeProfile VARCHAR(255), useTax TINYINT(1) DEFAULT 1) ${TABLE_ENGINE_AND_CHARSET}`);
        await connection.query(`CREATE TABLE IF NOT EXISTS users (id VARCHAR(255) PRIMARY KEY, username VARCHAR(255) NOT NULL UNIQUE, password VARCHAR(255) NOT NULL, role VARCHAR(50) NOT NULL, balance DECIMAL(15, 2) DEFAULT 0.00, phone VARCHAR(50)) ${TABLE_ENGINE_AND_CHARSET}`);
        await migrateWaExtension(connection);
        await connection.query(`CREATE TABLE IF NOT EXISTS odps (id VARCHAR(255) PRIMARY KEY, name VARCHAR(255) NOT NULL, address TEXT, location JSON, parentId VARCHAR(255), lineColor VARCHAR(20), powerInput DECIMAL(5, 2), powerOutput DECIMAL(5, 2), totalPorts INT) ${TABLE_ENGINE_AND_CHARSET}`);
        await connection.query(`CREATE TABLE IF NOT EXISTS odcs (id VARCHAR(255) PRIMARY KEY, name VARCHAR(255) NOT NULL, address TEXT, location JSON, parentId VARCHAR(255), lineColor VARCHAR(20), powerInput DECIMAL(5, 2), powerOutput DECIMAL(5, 2), totalPorts INT) ${TABLE_ENGINE_AND_CHARSET}`);
        await connection.query(`CREATE TABLE IF NOT EXISTS pppoe_profiles (id VARCHAR(50) PRIMARY KEY, name VARCHAR(255) NOT NULL, localAddress VARCHAR(255), remoteAddressPool VARCHAR(255), rateLimit VARCHAR(255)) ${TABLE_ENGINE_AND_CHARSET}`);
        await connection.query(`CREATE TABLE IF NOT EXISTS hotspot_profiles (id VARCHAR(50) PRIMARY KEY, name VARCHAR(255) NOT NULL, rateLimit VARCHAR(255), sharedUsers INT, price INT, sellingPrice INT, duration_minutes INT) ${TABLE_ENGINE_AND_CHARSET}`);
        await connection.query(`CREATE TABLE IF NOT EXISTS acs_devices (serialNumber VARCHAR(255) PRIMARY KEY, productClass VARCHAR(255), ipAddress VARCHAR(45), pppoeUsername VARCHAR(255), rxPower VARCHAR(50), lastInform DATETIME, isOnline TINYINT(1), ssid1 VARCHAR(255), ssid5 VARCHAR(255), ssid1Connected INT, ssid5Connected INT, last_sync_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ${TABLE_ENGINE_AND_CHARSET}`);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS acs_sync_jobs (
                id VARCHAR(36) PRIMARY KEY,
                status ENUM('queued', 'running', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
                processed_count INT UNSIGNED NOT NULL DEFAULT 0,
                progress_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
                message TEXT NULL,
                error_message TEXT NULL,
                started_at DATETIME NULL,
                finished_at DATETIME NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ${TABLE_ENGINE_AND_CHARSET}
        `);
        await connection.query(`CREATE TABLE IF NOT EXISTS pppoe_users (id VARCHAR(50) PRIMARY KEY, name VARCHAR(255) UNIQUE NOT NULL, password VARCHAR(255), service VARCHAR(50), profile VARCHAR(255), comment VARCHAR(255), disabled TINYINT(1) DEFAULT 0, last_sync_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ${TABLE_ENGINE_AND_CHARSET}`);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS pppoe_sync_jobs (
                id VARCHAR(36) PRIMARY KEY,
                status ENUM('queued', 'running', 'completed', 'failed') NOT NULL DEFAULT 'queued',
                processed_count INT UNSIGNED NOT NULL DEFAULT 0,
                progress_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
                message TEXT NULL,
                error_message TEXT NULL,
                started_at DATETIME NULL,
                finished_at DATETIME NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ${TABLE_ENGINE_AND_CHARSET}
        `);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS database_restore_jobs (
                id VARCHAR(36) PRIMARY KEY,
                status ENUM('queued', 'running', 'completed', 'failed', 'canceled') NOT NULL DEFAULT 'queued',
                processed_count INT UNSIGNED NOT NULL DEFAULT 0,
                progress_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
                message TEXT NULL,
                error_message TEXT NULL,
                backup_path TEXT NULL,
                original_filename VARCHAR(255) NULL,
                worker_pid INT UNSIGNED NULL,
                total_statements INT UNSIGNED NOT NULL DEFAULT 0,
                started_at DATETIME NULL,
                finished_at DATETIME NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ${TABLE_ENGINE_AND_CHARSET}
        `);
        await connection.query(`CREATE TABLE IF NOT EXISTS hotspot_users (id VARCHAR(50) PRIMARY KEY, name VARCHAR(255) UNIQUE NOT NULL, password VARCHAR(255), profile VARCHAR(255), comment VARCHAR(255), disabled TINYINT(1) DEFAULT 0, last_sync_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ${TABLE_ENGINE_AND_CHARSET}`);
        await connection.query(`CREATE TABLE IF NOT EXISTS settings (settings_key VARCHAR(50) PRIMARY KEY, settings_value JSON NOT NULL) ${TABLE_ENGINE_AND_CHARSET}`);
        await connection.query(`CREATE TABLE IF NOT EXISTS admin_notifications (id INT AUTO_INCREMENT PRIMARY KEY, type ENUM('error', 'warning', 'info') NOT NULL, source VARCHAR(255) NOT NULL, message TEXT NOT NULL, related_entity_id VARCHAR(255) NULL, is_read BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ${TABLE_ENGINE_AND_CHARSET}`);
        await connection.query(`CREATE TABLE IF NOT EXISTS system_flags (flag VARCHAR(50) NOT NULL, date_value DATE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (flag, date_value)) ${TABLE_ENGINE_AND_CHARSET}`);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS olt_ont_cache (
                device_id VARCHAR(255) NOT NULL,
                frame INT NOT NULL,
                slot INT NOT NULL,
                port INT NOT NULL,
                onu_id INT NOT NULL,
                serial VARCHAR(255) DEFAULT '-',
                customer_name VARCHAR(255) DEFAULT '',
                description VARCHAR(255) DEFAULT '',
                status VARCHAR(64) DEFAULT 'unknown',
                power_rx FLOAT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (device_id, frame, slot, port, onu_id)
            ) ${TABLE_ENGINE_AND_CHARSET}`);
        
        // SAFE CREATION for 'customers' table. This will not delete existing data.
        await connection.query(`
            CREATE TABLE IF NOT EXISTS customers (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                nik VARCHAR(100),
                address TEXT,
                phone VARCHAR(50),
                email VARCHAR(255),
                packageId INT UNSIGNED NULL DEFAULT NULL,
                status VARCHAR(50) NOT NULL,
                location JSON,
                odpId VARCHAR(255),
                pppoeUsername VARCHAR(255),
                activeDate DATETIME,
                nextBillingStart DATE,
                previousPppoeProfile VARCHAR(255),
                acsSerialNumber VARCHAR(255),
                oltDeviceId VARCHAR(255),
                oltFrame INT,
                oltSlot INT,
                oltPort INT,
                oltOnuId INT,
                voucher_balance DECIMAL(15, 2) DEFAULT 0.00,
                billing_type ENUM('postpaid', 'fixed') DEFAULT 'postpaid'
            ) ${TABLE_ENGINE_AND_CHARSET}
        `);

        await connection.query(`CREATE TABLE IF NOT EXISTS hotspot_vouchers (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, username VARCHAR(255) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, profile VARCHAR(255) NOT NULL, duration_minutes INT, status VARCHAR(50) NOT NULL, created_at DATETIME, mikrotik_id VARCHAR(50), first_used_at DATETIME, expires_at DATETIME, sold_by_user_id VARCHAR(255), sold_by_customer_id VARCHAR(255)) ${TABLE_ENGINE_AND_CHARSET}`);
        await connection.query(`CREATE TABLE IF NOT EXISTS whatsapp_logs (id INT AUTO_INCREMENT PRIMARY KEY, recipient_number VARCHAR(50) NOT NULL, customer_id VARCHAR(255) NULL, message_body TEXT NOT NULL, status VARCHAR(20) NOT NULL, type VARCHAR(100), error_message TEXT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ${TABLE_ENGINE_AND_CHARSET}`);
        await connection.query(`CREATE TABLE IF NOT EXISTS complaints (id VARCHAR(255) PRIMARY KEY, customerId VARCHAR(255), customerName VARCHAR(255), dateSubmitted DATETIME, type VARCHAR(100), description TEXT, status VARCHAR(50), replies JSON, assignedTo VARCHAR(255), technicianNotes TEXT, photos JSON) ${TABLE_ENGINE_AND_CHARSET}`);
        
        // IMPORTANT: topup_requests table definition updated to allow NULL on customer_id and include user_id
        await connection.query(`CREATE TABLE IF NOT EXISTS topup_requests (id VARCHAR(255) PRIMARY KEY, customer_id VARCHAR(255) NULL, user_id VARCHAR(255) NULL, amount DECIMAL(15, 2) NOT NULL, status ENUM('pending', 'paid', 'failed') NOT NULL DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, paid_at TIMESTAMP NULL, tripay_reference VARCHAR(255)) ${TABLE_ENGINE_AND_CHARSET}`);
        
        await connection.query(`CREATE TABLE IF NOT EXISTS invoices (id VARCHAR(255) PRIMARY KEY, customerId VARCHAR(255), issueDate DATE, dueDate DATE, amount INT, status VARCHAR(50), notes TEXT, billingPeriodStart DATE, billingPeriodEnd DATE, tripayReference VARCHAR(255), paymentUrl VARCHAR(255), discount_amount INT DEFAULT 0) ${TABLE_ENGINE_AND_CHARSET}`);
        await connection.query(`CREATE TABLE IF NOT EXISTS payments (id VARCHAR(255) PRIMARY KEY, invoiceId VARCHAR(255), customerId VARCHAR(255), date DATETIME, amount INT, method VARCHAR(100), sold_by_user_id VARCHAR(255)) ${TABLE_ENGINE_AND_CHARSET}`);
        await connection.query(`CREATE TABLE IF NOT EXISTS cash_mutations (id VARCHAR(255) PRIMARY KEY, date DATETIME NOT NULL, direction ENUM('in','out') NOT NULL, category VARCHAR(100) NOT NULL, amount DECIMAL(15,2) NOT NULL, method VARCHAR(100) NULL, description TEXT NULL, reference_type VARCHAR(50) NULL, reference_id VARCHAR(255) NULL, customer_id VARCHAR(255) NULL, user_id VARCHAR(255) NULL, created_by VARCHAR(255) NULL, source ENUM('system','manual') NOT NULL DEFAULT 'system', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ${TABLE_ENGINE_AND_CHARSET}`);
        await connection.query(`CREATE TABLE IF NOT EXISTS package_changes (id INT AUTO_INCREMENT PRIMARY KEY, customer_id VARCHAR(255) NOT NULL, new_package_id INT UNSIGNED NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, processed_at TIMESTAMP NULL, UNIQUE KEY unique_pending_customer (customer_id, status)) ${TABLE_ENGINE_AND_CHARSET}`);
        await connection.query(`CREATE TABLE IF NOT EXISTS customer_commissions (id INT AUTO_INCREMENT PRIMARY KEY, customer_id VARCHAR(255) NOT NULL, voucher_id INT UNSIGNED, profit_amount DECIMAL(10, 2) NOT NULL, status ENUM('pending', 'applied') NOT NULL DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, applied_to_invoice_id VARCHAR(255)) ${TABLE_ENGINE_AND_CHARSET}`);
        
        // --- PPOB TABLES START ---
        await connection.query(`
            CREATE TABLE IF NOT EXISTS ppob_products (
                id INT AUTO_INCREMENT PRIMARY KEY,
                product_name VARCHAR(255) NOT NULL,
                product_code VARCHAR(100) NOT NULL UNIQUE,
                category VARCHAR(100),
                brand VARCHAR(100),
                price DECIMAL(15, 2) NOT NULL,
                selling_price DECIMAL(15, 2) NOT NULL,
                description TEXT,
                is_active BOOLEAN DEFAULT TRUE,
                product_type VARCHAR(20) DEFAULT 'prepaid',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ${TABLE_ENGINE_AND_CHARSET}
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS ppob_transactions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                transaction_ref_id VARCHAR(255) NOT NULL UNIQUE,
                customer_id VARCHAR(255) NOT NULL,
                product_code VARCHAR(100) NOT NULL,
                customer_no VARCHAR(100) NOT NULL,
                status ENUM('PENDING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'PENDING',
                selling_price DECIMAL(15, 2) NOT NULL,
                message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ${TABLE_ENGINE_AND_CHARSET}
        `);
        // --- PPOB TABLES END ---

        console.log("[DB Migration] All tables created if not exist.");

        // --- PHASE 1.5: VERIFY AND CONVERT STORAGE ENGINE TO INNODB ---
        console.log("[DB Migration] Verifying storage engines for foreign key compatibility...");
        const ensureInnoDB = async (tableName) => {
            const [[table]] = await connection.query(`SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,[tableName]);
            if (table && table.ENGINE.toLowerCase() !== 'innodb') {
                console.log(`[DB Schema] Table '${tableName}' is not using InnoDB. Converting...`);
                await connection.query(`ALTER TABLE \`${tableName}\` ENGINE = InnoDB`);
            }
        };
        const tablesWithFks = ['packages', 'customers', 'invoices', 'payments', 'cash_mutations', 'complaints', 'users', 'hotspot_vouchers', 'whatsapp_logs', 'topup_requests', 'customer_commissions', 'package_changes', 'ppob_products', 'ppob_transactions'];
        for (const tableName of tablesWithFks) await ensureInnoDB(tableName);

        // --- PHASE 2: VERIFY AND ADD MISSING COLUMNS ---
        console.log("[DB Migration] Verifying schemas for backwards compatibility...");
        
        // Check and add columns for each table
        await checkAndAddColumn(connection, 'packages', 'useTax', 'TINYINT(1) DEFAULT 1');
        await checkAndAddColumn(connection, 'users', 'balance', 'DECIMAL(15, 2) DEFAULT 0.00');
        await checkAndAddColumn(connection, 'users', 'phone', 'VARCHAR(50)');
        await checkAndAddColumn(connection, 'hotspot_profiles', 'price', 'INT');
        await checkAndAddColumn(connection, 'hotspot_profiles', 'sellingPrice', 'INT');
        await checkAndAddColumn(connection, 'hotspot_profiles', 'duration_minutes', 'INT');
        await checkAndAddColumn(connection, 'hotspot_vouchers', 'sold_by_user_id', 'VARCHAR(255) NULL');
        await checkAndAddColumn(connection, 'hotspot_vouchers', 'sold_by_customer_id', 'VARCHAR(255) NULL');
        await checkAndAddColumn(connection, 'whatsapp_logs', 'type', 'VARCHAR(100)');
        await checkAndAddColumn(connection, 'whatsapp_logs', 'error_message', 'TEXT NULL');
        await checkAndAddColumn(connection, 'whatsapp_logs', 'provider_message_id', 'VARCHAR(255) NULL');
        await checkAndAddColumn(connection, 'whatsapp_logs', 'transport', "VARCHAR(20) NULL");
        await checkAndAddColumn(connection, 'whatsapp_logs', 'sent_at', 'DATETIME NULL');
        await checkAndAddColumn(connection, 'whatsapp_logs', 'delivered_at', 'DATETIME NULL');
        await checkAndAddColumn(connection, 'complaints', 'replies', 'JSON');
        await checkAndAddColumn(connection, 'complaints', 'assignedTo', 'VARCHAR(255) NULL');
        await checkAndAddColumn(connection, 'complaints', 'technicianNotes', 'TEXT');
        await checkAndAddColumn(connection, 'complaints', 'photos', 'JSON');
        await checkAndAddColumn(connection, 'invoices', 'tripayReference', 'VARCHAR(255)');
        await checkAndAddColumn(connection, 'ppob_products', 'product_type', "VARCHAR(20) DEFAULT 'prepaid'");
        await checkAndAddColumn(connection, 'invoices', 'paymentUrl', 'VARCHAR(255)');
        await checkAndAddColumn(connection, 'invoices', 'discount_amount', 'INT DEFAULT 0');
        await checkAndAddColumn(connection, 'payments', 'sold_by_user_id', 'VARCHAR(255) NULL');
        await checkAndAddColumn(connection, 'cash_mutations', 'method', 'VARCHAR(100) NULL');
        await checkAndAddColumn(connection, 'cash_mutations', 'description', 'TEXT NULL');
        await checkAndAddColumn(connection, 'cash_mutations', 'reference_type', 'VARCHAR(50) NULL');
        await checkAndAddColumn(connection, 'cash_mutations', 'reference_id', 'VARCHAR(255) NULL');
        await checkAndAddColumn(connection, 'cash_mutations', 'customer_id', 'VARCHAR(255) NULL');
        await checkAndAddColumn(connection, 'cash_mutations', 'user_id', 'VARCHAR(255) NULL');
        await checkAndAddColumn(connection, 'cash_mutations', 'created_by', 'VARCHAR(255) NULL');
        await checkAndAddColumn(connection, 'cash_mutations', 'source', "ENUM('system', 'manual') NOT NULL DEFAULT 'system'");
        await checkAndAddColumn(connection, 'acs_devices', 'ssid5', 'VARCHAR(255)');
        await checkAndAddColumn(connection, 'acs_devices', 'ssid1Connected', 'INT');
        await checkAndAddColumn(connection, 'acs_devices', 'ssid5Connected', 'INT');
        await checkAndAddIndex(connection, 'acs_devices', 'idx_acs_devices_lastInform', 'lastInform');
        await checkAndAddIndex(connection, 'acs_devices', 'idx_acs_devices_last_sync_at', 'last_sync_at');
        await checkAndAddIndex(connection, 'customers', 'idx_customers_acsSerialNumber', 'acsSerialNumber');
        await checkAndAddColumn(connection, 'acs_sync_jobs', 'status', "ENUM('queued', 'running', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'queued'");
        await ensureColumnDefinitionContains(
            connection,
            'acs_sync_jobs',
            'status',
            "ENUM('queued', 'running', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'queued'",
            'cancelled'
        );
        await checkAndAddColumn(connection, 'acs_sync_jobs', 'processed_count', 'INT UNSIGNED NOT NULL DEFAULT 0');
        await checkAndAddColumn(connection, 'acs_sync_jobs', 'progress_percent', 'TINYINT UNSIGNED NOT NULL DEFAULT 0');
        await checkAndAddColumn(connection, 'acs_sync_jobs', 'message', 'TEXT NULL');
        await checkAndAddColumn(connection, 'acs_sync_jobs', 'error_message', 'TEXT NULL');
        await checkAndAddColumn(connection, 'acs_sync_jobs', 'started_at', 'DATETIME NULL');
        await checkAndAddColumn(connection, 'acs_sync_jobs', 'finished_at', 'DATETIME NULL');
        await checkAndAddColumn(connection, 'acs_sync_jobs', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
        await checkAndAddColumn(connection, 'acs_sync_jobs', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
        await checkAndAddColumn(connection, 'pppoe_sync_jobs', 'status', "ENUM('queued', 'running', 'completed', 'failed') NOT NULL DEFAULT 'queued'");
        await checkAndAddColumn(connection, 'pppoe_sync_jobs', 'processed_count', 'INT UNSIGNED NOT NULL DEFAULT 0');
        await checkAndAddColumn(connection, 'pppoe_sync_jobs', 'progress_percent', 'TINYINT UNSIGNED NOT NULL DEFAULT 0');
        await checkAndAddColumn(connection, 'pppoe_sync_jobs', 'message', 'TEXT NULL');
        await checkAndAddColumn(connection, 'pppoe_sync_jobs', 'error_message', 'TEXT NULL');
        await checkAndAddColumn(connection, 'pppoe_sync_jobs', 'started_at', 'DATETIME NULL');
        await checkAndAddColumn(connection, 'pppoe_sync_jobs', 'finished_at', 'DATETIME NULL');
        await checkAndAddColumn(connection, 'pppoe_sync_jobs', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
        await checkAndAddColumn(connection, 'pppoe_sync_jobs', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
        await checkAndAddColumn(connection, 'database_restore_jobs', 'status', "ENUM('queued', 'running', 'completed', 'failed') NOT NULL DEFAULT 'queued'");
        await checkAndAddColumn(connection, 'database_restore_jobs', 'processed_count', 'INT UNSIGNED NOT NULL DEFAULT 0');
        await checkAndAddColumn(connection, 'database_restore_jobs', 'progress_percent', 'TINYINT UNSIGNED NOT NULL DEFAULT 0');
        await checkAndAddColumn(connection, 'database_restore_jobs', 'message', 'TEXT NULL');
        await checkAndAddColumn(connection, 'database_restore_jobs', 'error_message', 'TEXT NULL');
        await checkAndAddColumn(connection, 'database_restore_jobs', 'backup_path', 'TEXT NULL');
        await checkAndAddColumn(connection, 'database_restore_jobs', 'original_filename', 'VARCHAR(255) NULL');
        await checkAndAddColumn(connection, 'database_restore_jobs', 'worker_pid', 'INT UNSIGNED NULL');
        await checkAndAddColumn(connection, 'database_restore_jobs', 'total_statements', 'INT UNSIGNED NOT NULL DEFAULT 0');
        await checkAndAddColumn(connection, 'database_restore_jobs', 'started_at', 'DATETIME NULL');
        await checkAndAddColumn(connection, 'database_restore_jobs', 'finished_at', 'DATETIME NULL');
        await checkAndAddColumn(connection, 'database_restore_jobs', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
        await checkAndAddColumn(connection, 'database_restore_jobs', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
        await ensureEnumColumnIncludes(connection, 'database_restore_jobs', 'status', ['queued', 'running', 'completed', 'failed', 'canceled']);
        await checkAndAddColumn(connection, 'customers', 'voucher_balance', 'DECIMAL(15, 2) DEFAULT 0.00');
        await checkAndAddColumn(connection, 'customers', 'nextBillingStart', 'DATE');
        await checkAndAddColumn(connection, 'customers', 'billing_type', "ENUM('postpaid', 'fixed') DEFAULT 'postpaid'");
        await checkAndAddColumn(connection, 'customers', 'oltDeviceId', 'VARCHAR(255) NULL');
        await checkAndAddColumn(connection, 'customers', 'oltFrame', 'INT NULL');
        await checkAndAddColumn(connection, 'customers', 'oltSlot', 'INT NULL');
        await checkAndAddColumn(connection, 'customers', 'oltPort', 'INT NULL');
        await checkAndAddColumn(connection, 'customers', 'oltOnuId', 'INT NULL');
        await checkAndAddIndex(connection, 'customers', 'idx_customers_acsSerialNumber', 'acsSerialNumber');
        await checkAndAddIndex(connection, 'customers', 'idx_customers_olt', 'oltDeviceId, oltFrame, oltSlot, oltPort, oltOnuId');
        await checkAndAddColumn(connection, 'topup_requests', 'user_id', 'VARCHAR(255) NULL');
        await checkAndAddColumn(connection, 'ppob_transactions', 'sn', 'VARCHAR(255) NULL');
        await checkAndAddColumn(connection, 'customers', 'nik', 'VARCHAR(100)');
        await checkAndAddColumn(connection, 'admin_notifications', 'key', 'VARCHAR(255) NULL');

        // --- CRITICAL FIX: Ensure topup_requests.customer_id is NULLABLE ---
        const [[topupCol]] = await connection.query(
            `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'topup_requests' AND COLUMN_NAME = 'customer_id'`
        );
        if (topupCol && topupCol.IS_NULLABLE === 'NO') {
            console.log("[DB Migration] Fix: 'topup_requests.customer_id' is currently NOT NULL. Making it nullable...");
            try {
                await connection.query("ALTER TABLE `topup_requests` MODIFY COLUMN `customer_id` VARCHAR(255) NULL");
            } catch (e) {
                console.log("[DB Migration] Could not modify column directly, will handle in foreign key creation");
            }
        }

        // --- PHASE 3: ADD/VERIFY FOREIGN KEYS ---
        console.log("[DB Migration] Verifying foreign keys with robust method...");
        
        // Check if ppob_transactions has user_id column and rename it to customer_id if needed
        const [[ppobUserCol]] = await connection.query(`SHOW COLUMNS FROM \`ppob_transactions\` LIKE 'user_id'`);
        if (ppobUserCol) {
            console.log("[DB Migration] Renaming 'user_id' to 'customer_id' in ppob_transactions...");
            await connection.query(`ALTER TABLE \`ppob_transactions\` CHANGE COLUMN \`user_id\` \`customer_id\` VARCHAR(255) NOT NULL`);
        }

        await ensureForeignKey({ connection, tableName: 'customers', columnName: 'packageId', constraintName: 'fk_customers_packageId', referencedTable: 'packages', referencedColumn: 'id', columnDefinition: 'INT UNSIGNED NULL DEFAULT NULL', onDelete: 'SET NULL' });
        await ensureForeignKey({ connection, tableName: 'hotspot_vouchers', columnName: 'sold_by_user_id', constraintName: 'fk_hotspot_vouchers_sold_by_user_id', referencedTable: 'users', referencedColumn: 'id', columnDefinition: 'VARCHAR(255) NULL DEFAULT NULL', onDelete: 'SET NULL' });
        await ensureForeignKey({ connection, tableName: 'hotspot_vouchers', columnName: 'sold_by_customer_id', constraintName: 'fk_hotspot_vouchers_sold_by_customer_id', referencedTable: 'customers', referencedColumn: 'id', columnDefinition: 'VARCHAR(255) NULL DEFAULT NULL', onDelete: 'SET NULL' });
        await ensureForeignKey({ connection, tableName: 'whatsapp_logs', columnName: 'customer_id', constraintName: 'fk_whatsapp_logs_customer_id', referencedTable: 'customers', referencedColumn: 'id', columnDefinition: 'VARCHAR(255) NULL DEFAULT NULL', onDelete: 'SET NULL' });
        await ensureForeignKey({ connection, tableName: 'complaints', columnName: 'customerId', constraintName: 'fk_complaints_customerId', referencedTable: 'customers', referencedColumn: 'id', columnDefinition: 'VARCHAR(255) NULL DEFAULT NULL', onDelete: 'CASCADE' });
        await ensureForeignKey({ connection, tableName: 'complaints', columnName: 'assignedTo', constraintName: 'fk_complaints_assignedTo', referencedTable: 'users', referencedColumn: 'id', columnDefinition: 'VARCHAR(255) NULL DEFAULT NULL', onDelete: 'SET NULL' });
        
        // Modified Topup Requests Constraints to support optional Customer ID and User ID
        await ensureForeignKey({ connection, tableName: 'topup_requests', columnName: 'customer_id', constraintName: 'fk_topup_requests_customer_id', referencedTable: 'customers', referencedColumn: 'id', columnDefinition: 'VARCHAR(255) NULL', onDelete: 'CASCADE' });
        await ensureForeignKey({ connection, tableName: 'topup_requests', columnName: 'user_id', constraintName: 'fk_topup_requests_user_id', referencedTable: 'users', referencedColumn: 'id', columnDefinition: 'VARCHAR(255) NULL', onDelete: 'CASCADE' });

        await ensureForeignKey({ connection, tableName: 'invoices', columnName: 'customerId', constraintName: 'fk_invoices_customerId', referencedTable: 'customers', referencedColumn: 'id', columnDefinition: 'VARCHAR(255) NULL DEFAULT NULL', onDelete: 'CASCADE' });
        await ensureForeignKey({ connection, tableName: 'payments', columnName: 'customerId', constraintName: 'fk_payments_customerId', referencedTable: 'customers', referencedColumn: 'id', columnDefinition: 'VARCHAR(255) NULL DEFAULT NULL', onDelete: 'SET NULL' });
        await ensureForeignKey({ connection, tableName: 'payments', columnName: 'sold_by_user_id', constraintName: 'fk_payments_sold_by_user_id', referencedTable: 'users', referencedColumn: 'id', columnDefinition: 'VARCHAR(255) NULL DEFAULT NULL', onDelete: 'SET NULL' });
        await ensureForeignKey({ connection, tableName: 'cash_mutations', columnName: 'customer_id', constraintName: 'fk_cash_mutations_customer_id', referencedTable: 'customers', referencedColumn: 'id', columnDefinition: 'VARCHAR(255) NULL DEFAULT NULL', onDelete: 'SET NULL' });
        await ensureForeignKey({ connection, tableName: 'cash_mutations', columnName: 'user_id', constraintName: 'fk_cash_mutations_user_id', referencedTable: 'users', referencedColumn: 'id', columnDefinition: 'VARCHAR(255) NULL DEFAULT NULL', onDelete: 'SET NULL' });
        await ensureForeignKey({ connection, tableName: 'cash_mutations', columnName: 'created_by', constraintName: 'fk_cash_mutations_created_by', referencedTable: 'users', referencedColumn: 'id', columnDefinition: 'VARCHAR(255) NULL DEFAULT NULL', onDelete: 'SET NULL' });
        await ensureForeignKey({ connection, tableName: 'customer_commissions', columnName: 'customer_id', constraintName: 'fk_customer_commissions_customer_id', referencedTable: 'customers', referencedColumn: 'id', columnDefinition: 'VARCHAR(255) NOT NULL', onDelete: 'CASCADE' });
        await ensureForeignKey({ connection, tableName: 'customer_commissions', columnName: 'voucher_id', constraintName: 'fk_customer_commissions_voucher_id', referencedTable: 'hotspot_vouchers', referencedColumn: 'id', columnDefinition: 'INT UNSIGNED NULL DEFAULT NULL', onDelete: 'SET NULL' });
        await ensureForeignKey({ connection, tableName: 'customer_commissions', columnName: 'applied_to_invoice_id', constraintName: 'fk_customer_commissions_applied_to_invoice_id', referencedTable: 'invoices', referencedColumn: 'id', columnDefinition: 'VARCHAR(255) NULL DEFAULT NULL', onDelete: 'SET NULL' });
        await ensureForeignKey({ connection, tableName: 'package_changes', columnName: 'customer_id', constraintName: 'fk_package_changes_customer_id', referencedTable: 'customers', referencedColumn: 'id', columnDefinition: 'VARCHAR(255) NOT NULL', onDelete: 'CASCADE' });
        await ensureForeignKey({ connection, tableName: 'package_changes', columnName: 'new_package_id', constraintName: 'fk_package_changes_new_package_id', referencedTable: 'packages', referencedColumn: 'id', columnDefinition: 'INT UNSIGNED NOT NULL', onDelete: 'CASCADE' });
        
        // --- PPOB FOREIGN KEYS START ---
        // Drop legacy FK jika masih mengarah ke users
        try {
            const [[fkUser]] = await connection.query(`
                SELECT CONSTRAINT_NAME 
                FROM information_schema.KEY_COLUMN_USAGE 
                WHERE TABLE_SCHEMA = DATABASE() 
                  AND TABLE_NAME = 'ppob_transactions' 
                  AND CONSTRAINT_NAME = 'fk_ppob_transactions_user_id'
            `);
            if (fkUser) {
                console.log("[DB Schema] Dropping legacy FK 'fk_ppob_transactions_user_id' on ppob_transactions...");
                await connection.query(`ALTER TABLE ppob_transactions DROP FOREIGN KEY fk_ppob_transactions_user_id`);
            }
        } catch (e) {
            console.warn("[DB Schema] Unable to drop legacy fk_ppob_transactions_user_id:", e.message);
        }

        await ensureForeignKey({
            connection, 
            tableName: 'ppob_transactions', 
            columnName: 'product_code', 
            constraintName: 'fk_ppob_transactions_product_code', 
            referencedTable: 'ppob_products', 
            referencedColumn: 'product_code',
            columnDefinition: 'VARCHAR(100) NOT NULL',
            onDelete: 'CASCADE' 
        });

        await ensureForeignKey({
            connection, 
            tableName: 'ppob_transactions', 
            columnName: 'customer_id', 
            constraintName: 'fk_ppob_transactions_customer_id',
            referencedTable: 'customers', 
            referencedColumn: 'id', 
            columnDefinition: 'VARCHAR(255) NOT NULL',
            onDelete: 'CASCADE' 
        });
        // --- PPOB FOREIGN KEYS END ---

        // --- Column MODIFICATIONS ---
        const [passwordColumns] = await connection.query("SHOW COLUMNS FROM `users` LIKE 'password'");
        if (passwordColumns.length > 0 && !passwordColumns[0].Type.includes('varchar(255)')) {
             console.log("[DB Schema] Column 'password' in 'users' is not varchar(255). Altering...");
             await connection.query("ALTER TABLE `users` MODIFY COLUMN `password` VARCHAR(255) NOT NULL");
        }

        // --- PHASE 4: SEED INITIAL DATA ---
        console.log("[DB Migration] Seeding initial data if necessary...");
        const [[userCount]] = await connection.query('SELECT COUNT(*) as count FROM users');
        if (userCount.count === 0) {
            console.log("[DB Seeding] 'users' table is empty. Creating default 'demo' admin user...");
            const hashedPassword = await bcrypt.hash('demo', 10);
            const newId = `user-demo-${Date.now()}`;
            await connection.query('INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)',[newId, 'demo', hashedPassword, 'admin']);
            console.log("[DB Seeding] Default user 'demo' with password 'demo' created.");
        }

        console.log("[DB Migration] All table schemas are up to date.");

    } catch (error) {
        console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        console.error('!!! FAILED TO VERIFY/MIGRATE DB TABLES !!!');
        console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        console.error(error);
        throw error;
    } finally {
        if (connection) connection.release();
    }
};

const isDirectExecution = (() => {
    if (!process.argv[1]) {
        return false;
    }

    return path.resolve(process.argv[1]) === __filename;
})();

if (isDirectExecution) {
    (async () => {
        try {
            await migrateDatabase();
            console.log('Migration process completed successfully.');
            process.exitCode = 0;
        } catch (error) {
            console.error('Migration process failed.');
            process.exitCode = 1;
        } finally {
            try {
                await pool.end();
                console.log('[DB Migration] MySQL pool closed.');
            } catch (poolError) {
                console.warn('[DB Migration] Failed to close MySQL pool:', poolError?.message || poolError);
            }
        }
    })();
}
