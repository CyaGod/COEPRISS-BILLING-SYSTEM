/**
 * COEPRISS Sinaloa - Backend API
 * Node.js + Express + Prisma ORM + PostgreSQL (Render)
 * Fase 3.0 - Sin Firebase, 100% Render
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'coepriss-sinaloa-super-secret-2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

// ─────────────────────────────────────────────
// MIDDLEWARES GLOBALES
// ─────────────────────────────────────────────

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate Limiting - protección contra brute force
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 20,
    message: { error: 'Demasiados intentos. Espera 15 minutos.' }
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 200,
    message: { error: 'Límite de solicitudes alcanzado. Intenta de nuevo en un momento.' }
});

// Upload config (archivos Excel + imágenes)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB máximo
    fileFilter: (req, file, cb) => {
        const allowed = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'image/jpeg',
            'image/png',
            'image/webp',
            'application/pdf'
        ];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Tipo de archivo no permitido.'));
    }
});

// ─────────────────────────────────────────────
// MIDDLEWARE DE AUTENTICACIÓN JWT
// ─────────────────────────────────────────────

function autenticarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: 'No autorizado. Token requerido.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Token inválido o expirado.' });
    }
}

function requiereRol(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user?.rol)) {
            return res.status(403).json({ error: 'No tienes permiso para realizar esta acción.' });
        }
        next();
    };
}

// ─────────────────────────────────────────────
// UTILITARIOS
// ─────────────────────────────────────────────

async function registrarBitacora(usuarioId, accion, detalles, ipAddress, resultado = 'EXITOSO') {
    try {
        await prisma.bitacoraSeguridad.create({
            data: { usuarioId, accion, detalles, ipAddress, resultado }
        });
    } catch (e) {
        console.warn('[BITACORA] No se pudo registrar evento:', e.message);
    }
}

// ─────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────

app.get('/health', async (req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({
            status: 'UP',
            service: 'COEPRISS Sinaloa API v3.0',
            database: 'PostgreSQL Render - CONECTADA',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(503).json({ status: 'ERROR', database: 'DESCONECTADA', error: err.message });
    }
});

// ─────────────────────────────────────────────
// AUTENTICACIÓN
// ─────────────────────────────────────────────

app.post('/api/auth/login', authLimiter, async (req, res) => {
    const { username, password } = req.body || {};
    const ip = req.ip;

    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña requeridos.' });
    }

    try {
        const usuario = await prisma.usuario.findUnique({
            where: { username: username.toLowerCase().trim() },
            include: { rol: true }
        });

        if (!usuario || !usuario.activo) {
            await registrarBitacora(null, 'LOGIN_FALLIDO', `Intento con usuario: ${username}`, ip, 'FALLIDO');
            return res.status(401).json({ error: 'El usuario o la contraseña no son correctos.' });
        }

        const passwordOk = await bcrypt.compare(password, usuario.passwordHash);
        if (!passwordOk) {
            await registrarBitacora(usuario.id, 'LOGIN_FALLIDO', 'Contraseña incorrecta', ip, 'FALLIDO');
            return res.status(401).json({ error: 'El usuario o la contraseña no son correctos.' });
        }

        // Actualizar último acceso
        await prisma.usuario.update({
            where: { id: usuario.id },
            data: { ultimoAcceso: new Date() }
        });

        const token = jwt.sign(
            { id: usuario.id, username: usuario.username, rol: usuario.rol.nombre, nombre: usuario.nombreCompleto },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        await registrarBitacora(usuario.id, 'LOGIN_EXITOSO', 'Inicio de sesión correcto', ip, 'EXITOSO');

        res.json({
            success: true,
            token,
            user: {
                id: usuario.id,
                username: usuario.username,
                nombre: usuario.nombreCompleto,
                rol: usuario.rol.nombre,
                avatar: usuario.nombreCompleto.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
            }
        });
    } catch (err) {
        console.error('[LOGIN ERROR]', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

app.post('/api/auth/logout', autenticarToken, async (req, res) => {
    await registrarBitacora(req.user.id, 'LOGOUT', 'Cierre de sesión', req.ip, 'EXITOSO');
    res.json({ success: true, message: 'Sesión cerrada correctamente.' });
});

app.get('/api/auth/me', autenticarToken, async (req, res) => {
    try {
        const usuario = await prisma.usuario.findUnique({
            where: { id: req.user.id },
            include: { rol: { include: { permisos: true } } },
            omit: { passwordHash: true }
        });
        res.json({ success: true, user: usuario });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────
// EXPEDIENTES
// ─────────────────────────────────────────────

app.get('/api/expedientes', autenticarToken, apiLimiter, async (req, res) => {
    const { page = 1, limit = 50, estatus, busqueda } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (estatus) where.estatus = estatus;
    if (busqueda) {
        where.OR = [
            { folio: { contains: busqueda, mode: 'insensitive' } },
            { receptorRfc: { contains: busqueda, mode: 'insensitive' } },
            { receptorNombre: { contains: busqueda, mode: 'insensitive' } },
            { cfdiUuid: { contains: busqueda, mode: 'insensitive' } }
        ];
    }

    try {
        const [total, expedientes] = await Promise.all([
            prisma.expediente.count({ where }),
            prisma.expediente.findMany({
                where,
                skip,
                take: parseInt(limit),
                orderBy: { createdAt: 'desc' },
                include: { usuario: { select: { nombreCompleto: true } }, empresa: { select: { razonSocial: true } } }
            })
        ]);

        res.json({ success: true, total, page: parseInt(page), limit: parseInt(limit), data: expedientes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/expedientes/:folio', autenticarToken, async (req, res) => {
    try {
        const expediente = await prisma.expediente.findUnique({
            where: { folio: req.params.folio },
            include: { facturas: true, archivos: true, correosEnviados: true }
        });
        if (!expediente) return res.status(404).json({ error: 'Expediente no encontrado.' });
        res.json({ success: true, data: expediente });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/expedientes', autenticarToken, apiLimiter, async (req, res) => {
    try {
        const data = req.body;
        const folio = data.folio || `COEP-${Date.now()}`;

        const expediente = await prisma.expediente.upsert({
            where: { folio },
            update: { ...sanitizeExpediente(data), updatedAt: new Date() },
            create: { folio, usuarioId: req.user.id, ...sanitizeExpediente(data) }
        });

        await registrarBitacora(req.user.id, 'EXPEDIENTE_GUARDADO', `Folio: ${folio}`, req.ip);
        res.json({ success: true, data: expediente });
    } catch (err) {
        console.error('[EXPEDIENTE ERROR]', err);
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/expedientes/:folio/estatus', autenticarToken, async (req, res) => {
    const { estatus } = req.body;
    try {
        const updated = await prisma.expediente.update({
            where: { folio: req.params.folio },
            data: { estatus }
        });
        await registrarBitacora(req.user.id, 'ESTATUS_ACTUALIZADO', `Folio: ${req.params.folio} → ${estatus}`, req.ip);
        res.json({ success: true, data: updated });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

function sanitizeExpediente(data) {
    const allowed = [
        'receptorRfc','receptorNombre','receptorEmail','receptorUsoCfdi',
        'receptorRegimenFiscal','receptorCodigoPostal','receptorDomicilio',
        'cfdiUuid','cfdiTotal','cfdiSubtotal','cfdiIva','cfdiConcepto',
        'cfdiMetodoPago','cfdiFormaPago','cfdiMoneda','cfdiTipoCambio',
        'cfdiSerie','cfdiFolio','cfdiVersion','cfdiCertificado','cfdiNoCertificado',
        'pagoMonto','pagoFecha','pagoBanco','pagoReferencia','pagoCuenta','pagoTipo',
        'transferenciaClabe','transferenciaMonto','transferenciaFecha',
        'transferenciaBanco','transferenciaReferencia',
        'estatus','observaciones','empresaId'
    ];
    return Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)));
}

// ─────────────────────────────────────────────
// FACTURAS
// ─────────────────────────────────────────────

app.get('/api/facturas', autenticarToken, apiLimiter, async (req, res) => {
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    try {
        const [total, facturas] = await Promise.all([
            prisma.factura.count(),
            prisma.factura.findMany({ skip, take: parseInt(limit), orderBy: { createdAt: 'desc' }, include: { expediente: { select: { folio: true, receptorNombre: true } } } })
        ]);
        res.json({ success: true, total, data: facturas });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/facturas', autenticarToken, async (req, res) => {
    try {
        const { expedienteId, folio, xmlContent, uuid, estatus } = req.body;
        const factura = await prisma.factura.create({
            data: { expedienteId, folio, xmlContent, uuid, estatus: estatus || 'GENERADA', usuarioId: req.user.id }
        });
        await registrarBitacora(req.user.id, 'FACTURA_CREADA', `Folio: ${folio}`, req.ip);
        res.json({ success: true, data: factura });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────
// IMPORTACIÓN DE EXCEL
// ─────────────────────────────────────────────

app.post('/api/excel/importar', autenticarToken, upload.single('archivo'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo.' });
    if (req.file.size > 200 * 1024) return res.status(413).json({ error: 'El archivo excede el límite de 200 KB.' });

    try {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        const resultados = { insertados: 0, errores: [], duplicados: 0 };
        const requiredCols = ['RFC', 'NOMBRE', 'TOTAL'];

        // Validar columnas requeridas
        if (rows.length === 0) return res.status(400).json({ error: 'El archivo Excel está vacío.' });
        const cols = Object.keys(rows[0]);
        const missing = requiredCols.filter(c => !cols.includes(c));
        if (missing.length) return res.status(400).json({ error: `Columnas requeridas faltantes: ${missing.join(', ')}` });

        for (const [i, row] of rows.entries()) {
            try {
                const folio = `EXCEL-${Date.now()}-${i}`;
                await prisma.expediente.create({
                    data: {
                        folio,
                        usuarioId: req.user.id,
                        receptorRfc: String(row['RFC'] || '').trim(),
                        receptorNombre: String(row['NOMBRE'] || '').trim(),
                        cfdiTotal: parseFloat(row['TOTAL']) || 0,
                        cfdiConcepto: String(row['CONCEPTO'] || '').trim(),
                        estatus: 'PENDIENTE'
                    }
                });
                resultados.insertados++;
            } catch (rowErr) {
                if (rowErr.code === 'P2002') {
                    resultados.duplicados++;
                } else {
                    resultados.errores.push({ fila: i + 2, error: rowErr.message });
                }
            }
        }

        await registrarBitacora(req.user.id, 'EXCEL_IMPORTADO', `${resultados.insertados} registros importados`, req.ip);
        res.json({ success: true, resultados });
    } catch (err) {
        console.error('[EXCEL ERROR]', err);
        res.status(500).json({ error: 'Error al procesar el archivo Excel.' });
    }
});

// ─────────────────────────────────────────────
// HISTORIAL DE CORREOS
// ─────────────────────────────────────────────

app.get('/api/correos', autenticarToken, async (req, res) => {
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    try {
        const [total, correos] = await Promise.all([
            prisma.historialCorreo.count(),
            prisma.historialCorreo.findMany({ skip, take: parseInt(limit), orderBy: { createdAt: 'desc' }, include: { usuario: { select: { nombreCompleto: true } } } })
        ]);
        res.json({ success: true, total, data: correos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/correos', autenticarToken, async (req, res) => {
    const { expedienteId, destinatario, asunto, cuerpo, estatus } = req.body;
    try {
        const correo = await prisma.historialCorreo.create({
            data: { expedienteId, destinatario, asunto, cuerpo, estatus: estatus || 'ENVIADO', usuarioId: req.user.id }
        });
        res.json({ success: true, data: correo });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────
// BITÁCORA DE SEGURIDAD
// ─────────────────────────────────────────────

app.get('/api/bitacora', autenticarToken, requiereRol('Administrador'), async (req, res) => {
    const { page = 1, limit = 100 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    try {
        const [total, registros] = await Promise.all([
            prisma.bitacoraSeguridad.count(),
            prisma.bitacoraSeguridad.findMany({ skip, take: parseInt(limit), orderBy: { createdAt: 'desc' }, include: { usuario: { select: { nombreCompleto: true } } } })
        ]);
        res.json({ success: true, total, data: registros });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────
// REPORTES
// ─────────────────────────────────────────────

app.get('/api/reportes/dashboard', autenticarToken, async (req, res) => {
    try {
        const [totalExpedientes, timbrados, pendientes, facturas] = await Promise.all([
            prisma.expediente.count(),
            prisma.expediente.count({ where: { estatus: 'TIMBRADO' } }),
            prisma.expediente.count({ where: { estatus: 'PENDIENTE' } }),
            prisma.factura.count()
        ]);
        res.json({ success: true, data: { totalExpedientes, timbrados, pendientes, facturas } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/reportes/excel', autenticarToken, async (req, res) => {
    try {
        const expedientes = await prisma.expediente.findMany({
            orderBy: { createdAt: 'desc' },
            include: { usuario: { select: { nombreCompleto: true } } }
        });

        const rows = expedientes.map(e => ({
            'Folio': e.folio,
            'RFC Receptor': e.receptorRfc || '',
            'Nombre': e.receptorNombre || '',
            'Total': e.cfdiTotal?.toString() || '0',
            'Estatus': e.estatus,
            'Usuario': e.usuario?.nombreCompleto || '',
            'Fecha': e.createdAt.toLocaleDateString('es-MX')
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, 'Expedientes');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', 'attachment; filename=COEPRISS_Reporte.xlsx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────
// GESTIÓN DE USUARIOS (Solo Administrador)
// ─────────────────────────────────────────────

app.get('/api/usuarios', autenticarToken, requiereRol('Administrador'), async (req, res) => {
    try {
        const usuarios = await prisma.usuario.findMany({
            select: { id: true, username: true, nombreCompleto: true, email: true, activo: true, ultimoAcceso: true, rol: { select: { nombre: true } } }
        });
        res.json({ success: true, data: usuarios });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/usuarios', autenticarToken, requiereRol('Administrador'), async (req, res) => {
    const { username, nombreCompleto, email, password, rolId } = req.body;
    try {
        const passwordHash = await bcrypt.hash(password, 12);
        const usuario = await prisma.usuario.create({
            data: { username, nombreCompleto, email, passwordHash, rolId }
        });
        await registrarBitacora(req.user.id, 'USUARIO_CREADO', `Nuevo usuario: ${username}`, req.ip);
        res.json({ success: true, data: { id: usuario.id, username: usuario.username } });
    } catch (err) {
        if (err.code === 'P2002') return res.status(409).json({ error: 'El usuario ya existe.' });
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────
// SINCRONIZACIÓN FRONTEND LEGACY
// ─────────────────────────────────────────────

app.get('/api/db', autenticarToken, async (req, res) => {
    try {
        const [expedientes, facturas, historialCorreos, bitacoraSeguridad] = await Promise.all([
            prisma.expediente.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
            prisma.factura.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
            prisma.historialCorreo.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
            prisma.bitacoraSeguridad.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
        ]);
        res.json({ success: true, data: { expedientes, facturas, historialCorreos, bitacoraSeguridad } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/sync', autenticarToken, async (req, res) => {
    const { expedientes = [], facturas = [], historialCorreos = [], bitacoraSeguridad = [] } = req.body || {};
    const results = { expedientes: 0, errores: 0 };

    for (const exp of expedientes) {
        try {
            const folio = exp.folio || exp.id || `SYNC-${Date.now()}`;
            await prisma.expediente.upsert({
                where: { folio },
                update: sanitizeExpediente(exp),
                create: { folio, usuarioId: req.user.id, ...sanitizeExpediente(exp) }
            });
            results.expedientes++;
        } catch (err) {
            results.errores++;
        }
    }

    res.json({ success: true, ...results, timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────────
// ARCHIVOS ESTÁTICOS Y SPA FALLBACK
// ─────────────────────────────────────────────

app.use(express.static(path.join(__dirname)));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ─────────────────────────────────────────────
// ARRANQUE DEL SERVIDOR
// ─────────────────────────────────────────────

async function startServer() {
    try {
        await prisma.$connect();
        console.log('✅ PostgreSQL Render conectado correctamente.');

        app.listen(PORT, () => {
            console.log(`=======================================================`);
            console.log(`🚀 COEPRISS SINALOA API v3.0 - PUERTO ${PORT}`);
            console.log(`👉 Base de Datos: PostgreSQL (Render)`);
            console.log(`👉 Autenticación: JWT + bcrypt`);
            console.log(`👉 ORM: Prisma`);
            console.log(`=======================================================`);
        });
    } catch (err) {
        console.error('❌ Error de conexión a PostgreSQL:', err.message);
        process.exit(1);
    }
}

startServer();
