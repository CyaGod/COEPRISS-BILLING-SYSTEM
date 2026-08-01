/**
 * COEPRISS Billing System Server - High Performance Multi-Shard API
 * Node.js + Express + Firebase Admin SDK Sharded Architecture
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

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Parsing Middlewares
app.use(helmet({
    contentSecurityPolicy: false // Allow inline scripts for lightweight UI
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Initialize Multi-Shard Engine
const activeCount = initializeShards();
console.log(`[COEPRISS SERVER] Initialized with ${activeCount} active Firebase Shards.`);

// Health Check Endpoints
app.get('/health', (req, res) => {
    res.json({
        status: 'UP',
        service: 'COEPRISS Sinaloa Billing Engine',
        timestamp: new Date().toISOString(),
        activeShards: activeCount
    });
});

app.get('/api/shards/health', (req, res) => {
    res.json(getSystemHealth());
});

// Expedientes Sharded API Routes
app.post('/api/expedientes', async (req, res) => {
    try {
        const expediente = req.body;
        if (!expediente || (!expediente.folio && !expediente.id)) {
            return res.status(400).json({ error: 'El expediente debe contener un folio o ID válido.' });
        }
        const operationId = req.headers['x-operation-id'] || null;
        const result = await writeExpedienteToShard(expediente, operationId);
        res.json(result);
    } catch (err) {
        console.error('Error writing expediente to shard:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/expedientes/:folio', async (req, res) => {
    try {
        const { folio } = req.params;
        const result = await readExpedienteFromShard(folio);
        res.json(result);
    } catch (err) {
        res.status(404).json({ error: 'Expediente no encontrado.', details: err.message });
    }
});

app.get('/api/expedientes', async (req, res) => {
    try {
        const result = await queryAcrossAllShards('expedientes', 3500);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/sync', async (req, res) => {
    try {
        const { expedientes = [], facturas = [], historialCorreos = [], bitacoraSeguridad = [] } = req.body;
        
        // Write expedientes in parallel across shards
        const writePromises = expedientes.map(exp => writeExpedienteToShard(exp));
        const results = await Promise.allSettled(writePromises);
        
        const successful = results.filter(r => r.status === 'fulfilled').length;
        res.json({
            success: true,
            totalProcessed: expedientes.length,
            successfulWrites: successful,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
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
    console.log(`🚀 COEPRISS BILLING SERVER RUNNING ON PORT ${PORT}`);
    console.log(`👉 Live App: http://localhost:${PORT}`);
    console.log(`=======================================================`);
});
