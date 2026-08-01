/**
 * COEPRISS Multi-Shard Router & Quota Manager
 * High-performance, zero-delay FNV-1a deterministic sharding engine
 * supporting up to 10 parallel Firebase projects.
 */

const admin = require('firebase-admin');

// Shard Registry & Health State
const shardRegistry = [];
const activeApps = new Map();
const shardHealth = new Map(); // shardId -> { status, readCount, writeCount, lastError }

/**
 * FNV-1a Deterministic Hash Algorithm
 * Computes integer hash for shard index (0 to N-1)
 */
function computeShardHash(key, totalShards) {
    if (!key || totalShards <= 0) return 0;
    const strKey = String(key);
    let hash = 2166136261;
    for (let i = 0; i < strKey.length; i++) {
        hash ^= strKey.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0) % totalShards;
}

/**
 * Parse Service Account JSON from env var string
 */
function parseCredentials(envVarValue) {
    if (!envVarValue) return null;
    try {
        const cleaned = envVarValue.trim();
        if (cleaned.startsWith('{')) {
            return JSON.parse(cleaned);
        }
        return JSON.parse(Buffer.from(cleaned, 'base64').toString('utf-8'));
    } catch (e) {
        console.error('Error parsing Firebase credentials string:', e.message);
        return null;
    }
}

/**
 * Initialize all 10 Firebase Shards from Environment Variables
 */
function initializeShards() {
    shardRegistry.length = 0;

    for (let i = 1; i <= 10; i++) {
        const shardId = `shard-${String(i).padStart(2, '0')}`;
        const credEnv = process.env[`FIREBASE_CREDENTIALS_${i}`];
        
        shardHealth.set(shardId, {
            status: 'INITIALIZING',
            readCount: 0,
            writeCount: 0,
            lastError: null,
            lastUpdated: new Date().toISOString()
        });

        if (!credEnv) {
            shardHealth.get(shardId).status = 'DISABLED_NO_CREDS';
            continue;
        }

        const creds = parseCredentials(credEnv);
        if (!creds || !creds.project_id) {
            shardHealth.get(shardId).status = 'DISABLED_INVALID_CREDS';
            continue;
        }

        try {
            const dbUrl = process.env[`FIREBASE_DB_URL_${i}`] || 
                `https://${creds.project_id}-default-rtdb.firebaseio.com`;

            let app;
            const appName = `coepriss-shard-${i}`;
            
            const existingApps = admin.apps.filter(a => a && a.name === appName);
            if (existingApps.length > 0) {
                app = existingApps[0];
            } else {
                app = admin.initializeApp({
                    credential: admin.credential.cert(creds),
                    databaseURL: dbUrl
                }, appName);
            }

            activeApps.set(shardId, {
                app,
                db: app.database(),
                projectId: creds.project_id,
                databaseURL: dbUrl
            });

            shardRegistry.push({
                shardId,
                index: i - 1,
                projectId: creds.project_id,
                databaseURL: dbUrl
            });

            shardHealth.get(shardId).status = 'HEALTHY';
        } catch (err) {
            console.error(`Error initializing ${shardId}:`, err.message);
            shardHealth.get(shardId).status = 'ERROR';
            shardHealth.get(shardId).lastError = err.message;
        }
    }

    console.log(`⚡ Multi-Shard Engine active with ${shardRegistry.length} healthy shards.`);
    return shardRegistry.length;
}

/**
 * Resolve target Shard for a given key (folio / expedienteId / rfc)
 */
function getShardForKey(key) {
    if (shardRegistry.length === 0) {
        throw new Error('No active Firebase shards initialized.');
    }
    const idx = computeShardHash(key, shardRegistry.length);
    const target = shardRegistry[idx];
    return {
        shardInfo: target,
        client: activeApps.get(target.shardId)
    };
}

/**
 * Zero-Delay Single Expediente Writer with Idempotency Support
 */
async function writeExpedienteToShard(expediente, operationId = null) {
    const key = expediente.folio || expediente.id || 'GLOBAL';
    const { shardInfo, client } = getShardForKey(key);
    const health = shardHealth.get(shardInfo.shardId);

    if (health.status === 'EXHAUSTED' || health.status === 'DISABLED') {
        throw new Error(`Shard ${shardInfo.shardId} is currently unavailable.`);
    }

    const payload = {
        ...expediente,
        _shardId: shardInfo.shardId,
        _updatedAt: new Date().toISOString(),
        _operationId: operationId || `op_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    };

    try {
        await client.db.ref(`expedientes/${payload.folio}`).set(payload);
        health.writeCount += 1;
        health.status = 'HEALTHY';
        return { success: true, shardId: shardInfo.shardId, payload };
    } catch (err) {
        health.lastError = err.message;
        if (err.message.includes('quota') || err.message.includes('resource-exhausted')) {
            health.status = 'EXHAUSTED';
        }
        throw err;
    }
}

/**
 * Fast Single Expediente Reader
 */
async function readExpedienteFromShard(folio) {
    const { shardInfo, client } = getShardForKey(folio);
    const health = shardHealth.get(shardInfo.shardId);

    try {
        const snapshot = await client.db.ref(`expedientes/${folio}`).once('value');
        health.readCount += 1;
        return {
            success: true,
            shardId: shardInfo.shardId,
            data: snapshot.val()
        };
    } catch (err) {
        health.lastError = err.message;
        throw err;
    }
}

/**
 * Parallel Administrative Query Across All Shards
 * Uses Promise.allSettled() with 3000ms timeout per shard for zero-lag merging
 */
async function queryAcrossAllShards(path = 'expedientes', timeoutMs = 3000) {
    if (shardRegistry.length === 0) {
        return { success: true, results: [], partial: false };
    }

    const shardPromises = shardRegistry.map(shard => {
        const client = activeApps.get(shard.shardId);
        const health = shardHealth.get(shard.shardId);

        return new Promise(async (resolve) => {
            const timer = setTimeout(() => {
                resolve({ shardId: shard.shardId, status: 'TIMEOUT', data: null });
            }, timeoutMs);

            try {
                const snapshot = await client.db.ref(path).once('value');
                clearTimeout(timer);
                health.readCount += 1;
                resolve({ shardId: shard.shardId, status: 'OK', data: snapshot.val() });
            } catch (err) {
                clearTimeout(timer);
                health.lastError = err.message;
                resolve({ shardId: shard.shardId, status: 'ERROR', error: err.message, data: null });
            }
        });
    });

    const settled = await Promise.allSettled(shardPromises);
    const combinedData = [];
    const shardStatuses = {};
    let hasFailures = false;

    settled.forEach((res, i) => {
        const shardId = shardRegistry[i].shardId;
        if (res.status === 'fulfilled' && res.value.status === 'OK' && res.value.data) {
            shardStatuses[shardId] = 'OK';
            const val = res.value.data;
            if (Array.isArray(val)) {
                combinedData.push(...val.filter(Boolean));
            } else if (typeof val === 'object') {
                combinedData.push(...Object.values(val).filter(Boolean));
            }
        } else {
            hasFailures = true;
            shardStatuses[shardId] = res.value ? res.value.status : 'REJECTED';
        }
    });

    return {
        success: true,
        totalItems: combinedData.length,
        partial: hasFailures,
        shardStatuses,
        data: combinedData
    };
}

/**
 * Health check summary for monitoring endpoint
 */
function getSystemHealth() {
    const healthArray = [];
    shardHealth.forEach((val, key) => {
        healthArray.push({
            shardId: key,
            ...val
        });
    });
    return {
        timestamp: new Date().toISOString(),
        totalShards: shardRegistry.length,
        healthyShards: healthArray.filter(h => h.status === 'HEALTHY').length,
        shards: healthArray
    };
}

module.exports = {
    initializeShards,
    computeShardHash,
    getShardForKey,
    writeExpedienteToShard,
    readExpedienteFromShard,
    queryAcrossAllShards,
    getSystemHealth,
    shardRegistry
};
