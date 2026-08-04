/**
 * COEPRISS Billing System Server - Google Firebase Multi-Shard Engine
 * Node.js + Express + Firebase Admin SDK Sharded Architecture.
 * Hosted on Render, connected 100% to Google Databases.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const {
    initializeShards,
    getShardForKey,
    writeExpedienteToShard,
    readExpedienteFromShard,
    queryAcrossAllShards,
    getSystemHealth
} = require('./shardRouter');

const {
    getDatabaseData,
    updateDatabaseData,
    upsertExpediente
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Parsing Middlewares
app.use(helmet({
    contentSecurityPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Initialize Google Firebase Multi-Shard Engine
const activeShardCount = initializeShards();
console.log(`[COEPRISS SERVER] Active Google Firebase Database Shards: ${activeShardCount}`);

// Health & System Monitoring Endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'UP',
        service: 'COEPRISS Sinaloa Google Cloud Billing Engine',
        timestamp: new Date().toISOString(),
        activeGoogleShards: activeShardCount
    });
});

app.get('/api/shards/health', (req, res) => {
    res.json(getSystemHealth());
});

// GET Full Database State
app.get('/api/db', async (req, res) => {
    try {
        if (activeShardCount > 0) {
            const result = await queryAcrossAllShards('expedientes', 3500);
            return res.json({
                success: true,
                source: 'Google Firebase Multi-Shard',
                data: {
                    expedientes: result.data || [],
                    facturas: [],
                    historialCorreos: [],
                    bitacoraSeguridad: []
                }
            });
        }
        res.json({
            success: true,
            source: 'Render Local Database',
            data: getDatabaseData()
        });
    } catch (err) {
        res.json({
            success: true,
            source: 'Render Fallback Database',
            data: getDatabaseData()
        });
    }
});

// POST Write/Sync Expedientes across Google Firebase Shards
app.post('/api/expedientes', async (req, res) => {
    try {
        const expediente = req.body;
        if (!expediente || (!expediente.folio && !expediente.id)) {
            return res.status(400).json({ error: 'El expediente debe contener un folio o ID válido.' });
        }

        // Always save to Render local fallback storage first for 0ms safety
        upsertExpediente(expediente);

        // If Google Firebase Shards are configured, route to Google Shard
        if (activeShardCount > 0) {
            const operationId = req.headers['x-operation-id'] || null;
            const result = await writeExpedienteToShard(expediente, operationId);
            return res.json({ success: true, googleShard: result });
        }

        res.json({ success: true, storage: 'Render Local' });
    } catch (err) {
        console.error('[SERVER ERROR] Expediente write error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET Single Expediente from Google Shard
app.get('/api/expedientes/:folio', async (req, res) => {
    const { folio } = req.params;
    try {
        if (activeShardCount > 0) {
            const result = await readExpedienteFromShard(folio);
            if (result.data) {
                return res.json({ success: true, expediente: result.data });
            }
        }
        const db = getDatabaseData();
        const found = db.expedientes.find(e => (e.folio || e.id) === folio);
        if (found) {
            return res.json({ success: true, expediente: found });
        }
        res.status(404).json({ error: 'Expediente no encontrado.' });
    } catch (err) {
        res.status(404).json({ error: 'Expediente no encontrado.', details: err.message });
    }
});

// POST Bulk Sync across Google Shards
app.post('/api/sync', async (req, res) => {
    try {
        const payload = req.body;
        updateDatabaseData(payload);

        if (activeShardCount > 0 && Array.isArray(payload.expedientes)) {
            const promises = payload.expedientes.map(exp => writeExpedienteToShard(exp));
            const results = await Promise.allSettled(promises);
            const successful = results.filter(r => r.status === 'fulfilled').length;
            return res.json({
                success: true,
                googleShardsActive: activeShardCount,
                successfulGoogleWrites: successful,
                timestamp: new Date().toISOString()
            });
        }

        res.json({
            success: true,
            storage: 'Render Local Database',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('[SERVER ERROR] Bulk sync error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Serve Static Front-End Assets
app.use(express.static(path.join(__dirname)));

// SPA Fallback Route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 COEPRISS GOOGLE CLOUD BILLING SERVER RUNNING ON PORT ${PORT}`);
    console.log(`👉 Live App: http://localhost:${PORT}`);
    console.log(`=======================================================`);
});
