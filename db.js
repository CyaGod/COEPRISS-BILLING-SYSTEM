/**
 * COEPRISS Sinaloa - Render Native Database Engine
 * Persistent file-backed JSON database engine for Render deployment.
 * Completely replaces external Google/Firebase dependencies.
 */

const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'coepriss_render_db.json');

// Initial default database state
const defaultDbState = {
    expedientes: [],
    facturas: [],
    historialCorreos: [],
    bitacoraSeguridad: [
        {
            fecha: new Date().toLocaleDateString('es-MX') + ' ' + new Date().toLocaletoLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
            usuario: 'Sistema',
            accion: 'Inicio de base de datos Render',
            detalles: 'Base de datos nativa en Render inicializada correctamente.'
        }
    ]
};

let dbState = { ...defaultDbState };

// Ensure data directory exists
function ensureDataDirectory() {
    if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
    }
}

// Load database from file
function loadDatabase() {
    ensureDataDirectory();
    try {
        if (fs.existsSync(DB_FILE)) {
            const raw = fs.readFileSync(DB_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            dbState = {
                expedientes: Array.isArray(parsed.expedientes) ? parsed.expedientes : [],
                facturas: Array.isArray(parsed.facturas) ? parsed.facturas : [],
                historialCorreos: Array.isArray(parsed.historialCorreos) ? parsed.historialCorreos : [],
                bitacoraSeguridad: Array.isArray(parsed.bitacoraSeguridad) ? parsed.bitacoraSeguridad : []
            };
            console.log(`[RENDER DB] Database loaded successfully (${dbState.expedientes.length} expedientes).`);
        } else {
            saveDatabase();
            console.log('[RENDER DB] New Render database initialized.');
        }
    } catch (err) {
        console.error('[RENDER DB] Error loading database, using default state:', err.message);
        dbState = { ...defaultDbState };
    }
}

// Save database to disk atomically
function saveDatabase() {
    ensureDataDirectory();
    try {
        const tmpFile = `${DB_FILE}.tmp`;
        fs.writeFileSync(tmpFile, JSON.stringify(dbState, null, 2), 'utf8');
        fs.renameSync(tmpFile, DB_FILE);
        return true;
    } catch (err) {
        console.error('[RENDER DB] Error saving database:', err.message);
        return false;
    }
}

// Get all collections
function getDatabaseData() {
    return dbState;
}

// Update database collections
function updateDatabaseData(newData) {
    if (!newData) return false;
    if (Array.isArray(newData.expedientes)) dbState.expedientes = newData.expedientes;
    if (Array.isArray(newData.facturas)) dbState.facturas = newData.facturas;
    if (Array.isArray(newData.historialCorreos)) dbState.historialCorreos = newData.historialCorreos;
    if (Array.isArray(newData.bitacoraSeguridad)) dbState.bitacoraSeguridad = newData.bitacoraSeguridad;
    return saveDatabase();
}

// Save or update single expediente
function upsertExpediente(expediente) {
    if (!expediente || (!expediente.folio && !expediente.id)) return false;
    const folio = expediente.folio || expediente.id;
    const index = dbState.expedientes.findIndex(e => (e.folio || e.id) === folio);
    
    const updated = {
        ...expediente,
        _updatedAt: new Date().toISOString()
    };

    if (index !== -1) {
        dbState.expedientes[index] = updated;
    } else {
        dbState.expedientes.unshift(updated);
    }
    saveDatabase();
    return updated;
}

// Initialize on require
loadDatabase();

module.exports = {
    loadDatabase,
    saveDatabase,
    getDatabaseData,
    updateDatabaseData,
    upsertExpediente
};
