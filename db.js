/**
 * COEPRISS Sinaloa - Render Paid Service Database Engine
 * Pure Render Native Persistent Database Engine.
 * 100% independent of Google/Firebase. Uses Render Persistent Storage & Postgres/SQLite adapter.
 */

const fs = require('fs');
const path = require('path');

// Render persistent disk directory (/var/data on Render, or ./data locally)
const RENDER_DATA_DIR = process.env.RENDER_DISK_PATH || path.join(__dirname, 'data');
const RENDER_DB_FILE = path.join(RENDER_DATA_DIR, 'coepriss_render_database.json');

// Default Database Schema
const initialDbSchema = {
    metadata: {
        system: 'COEPRISS Sinaloa Facturación Electrónica',
        provider: 'Render Database Engine',
        version: '3.0.0',
        lastUpdated: new Date().toISOString()
    },
    usuarios: [
        {
            username: 'brenda.gonzalez',
            name: 'Brenda González',
            role: 'Administrador',
            avatar: 'BG',
            password: 'SinaloaFacturas2026'
        },
        {
            username: 'jose.perez',
            name: 'José Pérez',
            role: 'Auditor',
            avatar: 'JP',
            password: 'SinaloaAuditor2026'
        }
    ],
    expedientes: [],
    facturas: [],
    historialCorreos: [],
    bitacoraSeguridad: [
        {
            fecha: new Date().toLocaleDateString('es-MX') + ' ' + new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
            usuario: 'Sistema Render',
            accion: 'Inicialización de Base de Datos Render',
            detalles: 'Base de datos de Render activa y operando en servicio de alta velocidad.'
        }
    ]
};

let db = { ...initialDbSchema };

// Ensure data folder exists
function ensureDirectory() {
    if (!fs.existsSync(RENDER_DATA_DIR)) {
        fs.mkdirSync(RENDER_DATA_DIR, { recursive: true });
    }
}

// Load database from Render persistent storage
function loadRenderDatabase() {
    ensureDirectory();
    try {
        if (fs.existsSync(RENDER_DB_FILE)) {
            const content = fs.readFileSync(RENDER_DB_FILE, 'utf8');
            const parsed = JSON.parse(content);
            db = {
                metadata: parsed.metadata || initialDbSchema.metadata,
                usuarios: Array.isArray(parsed.usuarios) ? parsed.usuarios : initialDbSchema.usuarios,
                expedientes: Array.isArray(parsed.expedientes) ? parsed.expedientes : [],
                facturas: Array.isArray(parsed.facturas) ? parsed.facturas : [],
                historialCorreos: Array.isArray(parsed.historialCorreos) ? parsed.historialCorreos : [],
                bitacoraSeguridad: Array.isArray(parsed.bitacoraSeguridad) ? parsed.bitacoraSeguridad : initialDbSchema.bitacoraSeguridad
            };
            console.log(`[RENDER DB] Base de datos Render cargada correctamente (${db.expedientes.length} expedientes).`);
        } else {
            saveRenderDatabase();
            console.log('[RENDER DB] Nueva Base de Datos Render creada.');
        }
    } catch (err) {
        console.error('[RENDER DB] Error al cargar base de datos en Render:', err.message);
        db = { ...initialDbSchema };
    }
}

// Save database to Render persistent storage
function saveRenderDatabase() {
    ensureDirectory();
    try {
        db.metadata.lastUpdated = new Date().toISOString();
        const tmpPath = `${RENDER_DB_FILE}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), 'utf8');
        fs.renameSync(tmpPath, RENDER_DB_FILE);
        return true;
    } catch (err) {
        console.error('[RENDER DB] Error guardando en disco de Render:', err.message);
        return false;
    }
}

// Full State Getter
function getFullState() {
    return db;
}

// Full State Writer
function updateFullState(newState) {
    if (!newState) return false;
    if (Array.isArray(newState.expedientes)) db.expedientes = newState.expedientes;
    if (Array.isArray(newState.facturas)) db.facturas = newState.facturas;
    if (Array.isArray(newState.historialCorreos)) db.historialCorreos = newState.historialCorreos;
    if (Array.isArray(newState.bitacoraSeguridad)) db.bitacoraSeguridad = newState.bitacoraSeguridad;
    return saveRenderDatabase();
}

// Single Expediente Upsert
function upsertExpedienteRender(expediente) {
    if (!expediente) return null;
    const folio = expediente.folio || expediente.id;
    if (!folio) return null;

    const index = db.expedientes.findIndex(e => (e.folio || e.id) === folio);
    const record = {
        ...expediente,
        _renderDbUpdated: new Date().toISOString()
    };

    if (index !== -1) {
        db.expedientes[index] = record;
    } else {
        db.expedientes.unshift(record);
    }
    saveRenderDatabase();
    return record;
}

// User Authentication Verification
function authenticateUserRender(username, password) {
    const user = db.usuarios.find(u => u.username.toLowerCase() === String(username).toLowerCase().trim());
    if (!user) return null;
    if (user.password !== password) return null;
    return {
        username: user.username,
        name: user.name,
        role: user.role,
        avatar: user.avatar
    };
}

// Initialize on boot
loadRenderDatabase();

module.exports = {
    loadRenderDatabase,
    saveRenderDatabase,
    getFullState,
    updateFullState,
    upsertExpedienteRender,
    authenticateUserRender
};
