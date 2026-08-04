/**
 * COEPRISS Billing System Server - Render Native Database Edition
 * Node.js + Express Server running 100% on Render infrastructure.
 * Zero external Google / Firebase dependencies.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const {
    getFullState,
    updateFullState,
    upsertExpedienteRender,
    authenticateUserRender
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Parsing Middlewares
app.use(helmet({
    contentSecurityPolicy: false // Allow inline scripts and assets
}));
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Health Check Endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'UP',
        service: 'COEPRISS Sinaloa Render Database Engine',
        timestamp: new Date().toISOString(),
        engine: 'Render Persistent Database Service'
    });
});

// Authentication API Route
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const authenticatedUser = authenticateUserRender(username, password);
    if (authenticatedUser) {
        res.json({ success: true, user: authenticatedUser });
    } else {
        res.status(401).json({ error: 'El usuario o la contraseña no son correctos.' });
    }
});

// GET Full Database State
app.get('/api/db', (req, res) => {
    res.json({
        success: true,
        data: getFullState()
    });
});

// POST Sync Database State
app.post('/api/sync', (req, res) => {
    try {
        const payload = req.body;
        const saved = updateFullState(payload);
        res.json({
            success: saved,
            timestamp: new Date().toISOString(),
            message: saved ? 'Datos guardados en la Base de Datos de Render con éxito.' : 'Error al guardar.'
        });
    } catch (err) {
        console.error('[RENDER SERVER ERROR] Sync error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST Single Expediente Write/Update
app.post('/api/expedientes', (req, res) => {
    try {
        const expediente = req.body;
        const result = upsertExpedienteRender(expediente);
        if (result) {
            res.json({ success: true, expediente: result });
        } else {
            res.status(400).json({ error: 'Datos de expediente no válidos.' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET Single Expediente by Folio
app.get('/api/expedientes/:folio', (req, res) => {
    const { folio } = req.params;
    const db = getFullState();
    const found = db.expedientes.find(e => (e.folio || e.id) === folio);
    if (found) {
        res.json({ success: true, expediente: found });
    } else {
        res.status(404).json({ error: 'Expediente no encontrado.' });
    }
});

// Serve Static Web Assets
app.use(express.static(path.join(__dirname)));

// SPA Fallback Route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Render Server
app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 COEPRISS RENDER DATABASE SERVER RUNNING ON PORT ${PORT}`);
    console.log(`👉 Live App: http://localhost:${PORT}`);
    console.log(`=======================================================`);
});
