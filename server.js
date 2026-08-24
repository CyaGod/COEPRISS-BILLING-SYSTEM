// Set default PostgreSQL connection string at line 1 before any module loading
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
    process.env.DATABASE_URL = 'postgresql://coepriss_db_user:FnaT53yRYH4sn4T0ySn1AwJg4LseyjRK@dpg-d9onri0ae00c73b005k0-a/coepriss_db';
}
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
const facturama = require('./facturama');

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
    if (!data || typeof data !== 'object') return {};
    const mapped = {
        receptorRfc: data.receptorRfc || data.rfc || null,
        receptorNombre: data.receptorNombre || data.cliente || null,
        receptorEmail: data.receptorEmail || data.correo || null,
        receptorUsoCfdi: data.receptorUsoCfdi || data.usoCfdi || 'G03',
        receptorRegimenFiscal: data.receptorRegimenFiscal || data.regimenFiscal || null,
        receptorCodigoPostal: data.receptorCodigoPostal || data.codigoPostal || null,
        receptorDomicilio: data.receptorDomicilio || data.domicilio || null,
        cfdiUuid: data.cfdiUuid || data.uuid || null,
        cfdiTotal: (data.cfdiTotal !== undefined && data.cfdiTotal !== null) ? parseFloat(data.cfdiTotal) : ((data.importe !== undefined && data.importe !== null) ? parseFloat(data.importe) : null),
        cfdiSubtotal: (data.cfdiSubtotal !== undefined && data.cfdiSubtotal !== null) ? parseFloat(data.cfdiSubtotal) : ((data.subtotal !== undefined && data.subtotal !== null) ? parseFloat(data.subtotal) : null),
        cfdiConcepto: data.cfdiConcepto || data.concepto || null,
        cfdiMetodoPago: data.cfdiMetodoPago || data.metodoPago || 'PUE',
        cfdiFormaPago: data.cfdiFormaPago || data.formaPago || '03',
        cfdiMoneda: data.cfdiMoneda || data.moneda || 'MXN',
        pagoMonto: (data.pagoMonto !== undefined && data.pagoMonto !== null) ? parseFloat(data.pagoMonto) : ((data.importePago !== undefined && data.importePago !== null) ? parseFloat(data.importePago) : null),
        pagoFecha: data.pagoFecha || data.fechaPago || null,
        pagoBanco: data.pagoBanco || data.banco || null,
        pagoReferencia: data.pagoReferencia || data.referencia || null,
        pagoCuenta: data.pagoCuenta || data.cuentaBeneficiaria || null,
        pagoTipo: data.pagoTipo || data.tipoPago || null,
        transferenciaClabe: data.transferenciaClabe || data.cuentaBeneficiaria || null,
        transferenciaBanco: data.transferenciaBanco || data.banco || null,
        transferenciaReferencia: data.transferenciaReferencia || data.claveRastreo || null,
        observaciones: data.observaciones || null,
        estatus: (data.estatus === 'TIMBRADA' || data.estatus === 'TIMBRADO') ? 'TIMBRADO' : (data.estatus || 'PENDIENTE')
    };
    return Object.fromEntries(Object.entries(mapped).filter(([_, v]) => v !== null && v !== undefined));
}

// ─────────────────────────────────────────────
// FACTURAS
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// FACTURAS
// ─────────────────────────────────────────────

app.get('/api/facturas', autenticarToken, apiLimiter, async (req, res) => {
    const { page = 1, limit = 100, estatus, desde, hasta, busqueda } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    try {
        const where = {};
        if (estatus && estatus.trim() && estatus.toUpperCase() !== 'TODOS') {
            where.estatus = estatus.toUpperCase().trim();
        }
        if (desde || hasta) {
            where.createdAt = {};
            if (desde) {
                const d = new Date(desde);
                d.setHours(0, 0, 0, 0);
                where.createdAt.gte = d;
            }
            if (hasta) {
                const h = new Date(hasta);
                h.setHours(23, 59, 59, 999);
                where.createdAt.lte = h;
            }
        }
        if (busqueda && busqueda.trim()) {
            const b = busqueda.trim();
            where.OR = [
                { folio: { contains: b, mode: 'insensitive' } },
                { uuid: { contains: b, mode: 'insensitive' } },
                { expediente: { receptorNombre: { contains: b, mode: 'insensitive' } } },
                { expediente: { receptorRfc: { contains: b, mode: 'insensitive' } } },
                { expediente: { folio: { contains: b, mode: 'insensitive' } } }
            ];
        }

        const [total, facturas] = await Promise.all([
            prisma.factura.count({ where }),
            prisma.factura.findMany({
                where,
                skip,
                take: parseInt(limit),
                orderBy: { createdAt: 'desc' },
                include: {
                    expediente: {
                        select: {
                            folio: true,
                            receptorNombre: true,
                            receptorRfc: true,
                            receptorEmail: true,
                            cfdiTotal: true,
                            cfdiSubtotal: true,
                            cfdiIva: true,
                            cfdiConcepto: true,
                            cfdiMetodoPago: true,
                            cfdiFormaPago: true
                        }
                    },
                    usuario: { select: { nombreCompleto: true } }
                }
            })
        ]);
        res.json({ success: true, total, data: facturas });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/facturas', autenticarToken, async (req, res) => {
    try {
        const { expedienteId, folio, xmlContent, uuid, estatus, facturamaId } = req.body;
        const factura = await prisma.factura.create({
            data: { expedienteId, folio, xmlContent, uuid, facturamaId, estatus: estatus || 'GENERADA', usuarioId: req.user.id }
        });
        await registrarBitacora(req.user.id, 'FACTURA_CREADA', `Folio: ${folio}`, req.ip);
        res.json({ success: true, data: factura });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────
// DIRECTORIO DE CLIENTES
// ─────────────────────────────────────────────

app.get('/api/clientes', autenticarToken, async (req, res) => {
    try {
        const { q, page = 1, limit = 100 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const where = { activo: true };
        if (q && q.trim()) {
            const b = q.trim();
            where.OR = [
                { rfc: { contains: b, mode: 'insensitive' } },
                { razonSocial: { contains: b, mode: 'insensitive' } },
                { email: { contains: b, mode: 'insensitive' } },
                { codigoPostal: { contains: b, mode: 'insensitive' } }
            ];
        }
        const [total, clientes] = await Promise.all([
            prisma.cliente.count({ where }),
            prisma.cliente.findMany({
                where,
                skip,
                take: parseInt(limit),
                orderBy: { updatedAt: 'desc' }
            })
        ]);
        res.json({ success: true, total, data: clientes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/clientes/:rfc', autenticarToken, async (req, res) => {
    try {
        const rfc = req.params.rfc.toUpperCase().trim();
        const cliente = await prisma.cliente.findUnique({
            where: { rfc }
        });
        if (!cliente) return res.status(404).json({ success: false, error: 'Cliente no registrado en el directorio.' });
        res.json({ success: true, data: cliente });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/clientes', autenticarToken, async (req, res) => {
    try {
        const {
            rfc,
            razonSocial,
            regimenFiscal,
            codigoPostal,
            usoCfdi,
            formaPago,
            email,
            telefono,
            domicilio
        } = req.body || {};

        if (!rfc || !rfc.trim()) {
            return res.status(400).json({ error: 'El RFC es obligatorio.' });
        }
        if (!razonSocial || !razonSocial.trim()) {
            return res.status(400).json({ error: 'La Razón Social / Nombre es obligatoria.' });
        }

        const rfcNorm = rfc.toUpperCase().trim();
        const data = {
            rfc:           rfcNorm,
            razonSocial:   razonSocial.trim(),
            regimenFiscal: regimenFiscal ? String(regimenFiscal).trim() : null,
            codigoPostal:  codigoPostal ? String(codigoPostal).trim() : null,
            usoCfdi:       usoCfdi ? String(usoCfdi).trim() : null,
            formaPago:     formaPago ? String(formaPago).trim() : null,
            email:         email ? String(email).trim() : null,
            telefono:      telefono ? String(telefono).trim() : null,
            domicilio:     domicilio ? String(domicilio).trim() : null,
            activo:        true
        };

        const cliente = await prisma.cliente.upsert({
            where: { rfc: rfcNorm },
            update: data,
            create: data
        });

        await registrarBitacora(req.user.id, 'CLIENTE_GUARDADO', `RFC: ${rfcNorm} - ${razonSocial}`, req.ip);
        res.json({ success: true, data: cliente });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/clientes/:id', autenticarToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await prisma.cliente.update({
            where: { id },
            data: { activo: false }
        });
        await registrarBitacora(req.user.id, 'CLIENTE_ELIMINADO', `ID: ${id}`, req.ip);
        res.json({ success: true });
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
// CORREOS ELECTRÓNICOS Y BREVO API
// ─────────────────────────────────────────────

/**
 * Helper para enviar correo transaccional con la API REST de Brevo.
 */
async function enviarCorreoBrevo({ destinatario, nombreDestinatario, asunto, cuerpoHtml, adjuntos = [] }) {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
        throw new Error('BREVO_API_KEY no configurada en las variables de entorno.');
    }
    const senderEmail = process.env.BREVO_SENDER_EMAIL || 'coepriss1@gmail.com';
    const senderName  = process.env.BREVO_SENDER_NAME  || 'COEPRISS Sinaloa - Facturación';

    const payload = {
        sender: { name: senderName, email: senderEmail },
        to: [{ email: destinatario, name: nombreDestinatario || destinatario }],
        subject: asunto,
        htmlContent: cuerpoHtml,
    };

    if (adjuntos && adjuntos.length > 0) {
        payload.attachment = adjuntos.map(a => ({
            name: a.name,
            content: String(a.content || '').replace(/^data:[^;]+;base64,/, '').trim()
        }));
    }

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
            'api-key': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.message || data.error || `Error en Brevo API (HTTP ${res.status})`);
    }
    return data;
}

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

app.post('/api/correo/enviar', autenticarToken, async (req, res) => {
    const {
        expedienteId,
        destinatario,
        nombreDestinatario,
        asunto,
        mensaje,
        facturamaId,
        uuid,
        incluirXml = true,
        incluirPdf = true,
        xmlBase64,
        pdfBase64
    } = req.body || {};

    if (!destinatario || !destinatario.includes('@')) {
        return res.status(400).json({ error: 'Dirección de correo electrónico inválida.' });
    }

    try {
        let expediente = null;
        let factura = null;
        if (expedienteId) {
            expediente = await prisma.expediente.findFirst({
                where: { OR: [{ folio: String(expedienteId) }, { id: parseInt(expedienteId) || 0 }] },
                include: { facturas: { orderBy: { createdAt: 'desc' }, take: 1 } }
            });
            if (expediente && expediente.facturas.length > 0) {
                factura = expediente.facturas[0];
            }
        }

        const effectiveFacturamaId = facturamaId || factura?.facturamaId || null;
        const effectiveUuid = uuid || factura?.uuid || expediente?.cfdiUuid || 'N/A';
        const clientName = nombreDestinatario || expediente?.receptorNombre || 'Contribuyente';

        const adjuntos = [];

        // Obtener XML
        if (incluirXml) {
            let xmlData = xmlBase64;
            if (!xmlData && effectiveFacturamaId) {
                xmlData = await facturama.descargarArchivo(effectiveFacturamaId, 'xml').catch(() => null);
            }
            if (!xmlData && factura?.xmlContent) {
                xmlData = Buffer.from(factura.xmlContent, 'utf-8').toString('base64');
            }
            if (xmlData) {
                adjuntos.push({
                    name: `COEPRISS_${expedienteId || 'Factura'}.xml`,
                    content: xmlData
                });
            }
        }

        // Obtener PDF
        if (incluirPdf) {
            let pdfData = pdfBase64;
            if (!pdfData && effectiveFacturamaId) {
                pdfData = await facturama.descargarArchivo(effectiveFacturamaId, 'pdf').catch(() => null);
            }
            if (pdfData) {
                adjuntos.push({
                    name: `COEPRISS_${expedienteId || 'Factura'}.pdf`,
                    content: pdfData
                });
            }
        }

        const emailSubject = asunto || `Comprobante Fiscal Digital (CFDI) - COEPRISS Sinaloa - Folio ${expedienteId || ''}`;
        const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 650px; margin: auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; background: #ffffff;">
                <div style="background: #1B365D; color: #ffffff; padding: 24px; text-align: center;">
                    <h2 style="margin: 0; font-size: 1.4rem; color: #ffffff; letter-spacing: 1px;">COEPRISS SINALOA</h2>
                    <p style="margin: 6px 0 0; font-size: 0.85rem; color: #D4AF37; font-weight: bold;">Comisión Estatal para la Protección contra Riesgos Sanitarios</p>
                </div>
                <div style="padding: 24px; color: #333333; line-height: 1.6;">
                    <h3 style="color: #1B365D; margin-top: 0;">Estimado(a) ${clientName},</h3>
                    <p>Le hacemos llegar adjunto su Comprobante Fiscal Digital por Internet (CFDI 4.0) correspondiente a los trámites realizados ante esta Comisión.</p>
                    
                    ${mensaje ? `<div style="background: #f8f9fa; border-left: 4px solid #D4AF37; padding: 12px; margin: 16px 0; font-size: 0.9rem;">${mensaje}</div>` : ''}

                    <div style="background: #f1f5f9; border-radius: 6px; padding: 16px; margin: 20px 0;">
                        <table style="width: 100%; font-size: 0.88rem; border-collapse: collapse;">
                            <tr><td style="color: #64748b; padding: 4px 0; width: 140px;">Folio / Trámite:</td><td style="font-weight: bold;">${expediente?.folio || expedienteId || '—'}</td></tr>
                            <tr><td style="color: #64748b; padding: 4px 0;">RFC Receptor:</td><td style="font-weight: bold;">${expediente?.receptorRfc || '—'}</td></tr>
                            <tr><td style="color: #64748b; padding: 4px 0;">Folio Fiscal (UUID):</td><td style="font-family: monospace; font-size: 0.82rem; word-break: break-all;">${effectiveUuid}</td></tr>
                            ${expediente?.cfdiTotal ? `<tr><td style="color: #64748b; padding: 4px 0;">Importe Total:</td><td style="font-weight: bold; color: #1B365D; font-size: 1rem;">$${parseFloat(expediente.cfdiTotal).toFixed(2)} MXN</td></tr>` : ''}
                        </table>
                    </div>

                    <p style="font-size: 0.85rem; color: #64748b;">En los archivos adjuntos a este correo encontrará las versiones oficiales <strong>XML</strong> y <strong>PDF</strong> con sello digital del SAT.</p>
                    <p style="font-size: 0.85rem; color: #64748b;">Si tiene dudas o requiere aclaraciones, favor de comunicarse a las oficinas de COEPRISS Sinaloa.</p>
                </div>
                <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px; text-align: center; font-size: 0.75rem; color: #94a3b8;">
                    COEPRISS Sinaloa — Blvd. Alfonso G. Calderón #2193, C.P. 80020, Culiacán, Sinaloa, México.<br>
                    Este es un mensaje institucional automático generado por el Sistema de Facturación Electrónica.
                </div>
            </div>
        `;

        const brevoResult = await enviarCorreoBrevo({
            destinatario,
            nombreDestinatario: clientName,
            asunto: emailSubject,
            cuerpoHtml: emailHtml,
            adjuntos
        });

        // Registrar en historial de correos de la BD
        const registroCorreo = await prisma.historialCorreo.create({
            data: {
                expedienteId: expediente?.id || null,
                usuarioId:    req.user.id,
                destinatario,
                asunto:       emailSubject,
                cuerpo:       mensaje || `Envío CFDI (${adjuntos.length} adjuntos)`,
                estatus:      'ENVIADO'
            }
        });

        await registrarBitacora(
            req.user.id,
            'CORREO_ENVIADO',
            `Destinatario: ${destinatario} | Folio: ${expedienteId || 'N/A'} | Adjuntos: ${adjuntos.length} | BrevoId: ${brevoResult.messageId || 'OK'}`,
            req.ip,
            'EXITOSO'
        );

        res.json({
            success: true,
            message: 'Correo enviado exitosamente vía Brevo.',
            messageId: brevoResult.messageId || null,
            registroId: registroCorreo.id,
            adjuntosEnviados: adjuntos.map(a => a.name)
        });

    } catch (err) {
        console.error('[CORREO ENVIAR ERROR]', err);
        if (req.user?.id) {
            await prisma.historialCorreo.create({
                data: {
                    usuarioId:    req.user.id,
                    destinatario: destinatario || 'desconocido',
                    asunto:       asunto || 'Error en envío',
                    cuerpo:       err.message,
                    estatus:      'FALLIDO',
                    errorDetalle: err.message
                }
            }).catch(() => {});
        }
        res.status(500).json({ success: false, error: err.message });
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
// REPORTES Y EXPORTACIÓN EXCEL
// ─────────────────────────────────────────────

app.get('/api/reportes/dashboard', autenticarToken, async (req, res) => {
    try {
        const [totalExpedientes, timbrados, pendientes, facturas, totalClientes] = await Promise.all([
            prisma.expediente.count(),
            prisma.expediente.count({ where: { estatus: 'TIMBRADO' } }),
            prisma.expediente.count({ where: { estatus: 'PENDIENTE' } }),
            prisma.factura.count(),
            prisma.cliente.count({ where: { activo: true } })
        ]);
        res.json({ success: true, data: { totalExpedientes, timbrados, pendientes, facturas, totalClientes } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/reportes/excel', autenticarToken, async (req, res) => {
    try {
        const { estatus, desde, hasta, busqueda } = req.query;
        const where = {};
        if (estatus && estatus.trim() && estatus.toUpperCase() !== 'TODOS') {
            where.estatus = estatus.toUpperCase().trim();
        }
        if (desde || hasta) {
            where.createdAt = {};
            if (desde) {
                const d = new Date(desde);
                d.setHours(0, 0, 0, 0);
                where.createdAt.gte = d;
            }
            if (hasta) {
                const h = new Date(hasta);
                h.setHours(23, 59, 59, 999);
                where.createdAt.lte = h;
            }
        }
        if (busqueda && busqueda.trim()) {
            const b = busqueda.trim();
            where.OR = [
                { folio: { contains: b, mode: 'insensitive' } },
                { receptorNombre: { contains: b, mode: 'insensitive' } },
                { receptorRfc: { contains: b, mode: 'insensitive' } }
            ];
        }

        const expedientes = await prisma.expediente.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                usuario: { select: { nombreCompleto: true } },
                facturas: { select: { uuid: true, estatus: true, fechaTimbrado: true, folio: true }, take: 1 }
            }
        });

        const rows = expedientes.map(e => ({
            'Folio Interno': e.folio,
            'RFC Receptor': e.receptorRfc || '',
            'Nombre / Razón Social': e.receptorNombre || '',
            'Régimen Fiscal': e.receptorRegimenFiscal || '',
            'Código Postal': e.receptorCodigoPostal || '',
            'Uso CFDI': e.receptorUsoCfdi || '',
            'Concepto': e.cfdiConcepto || '',
            'Total': parseFloat(e.cfdiTotal || 0).toFixed(2),
            'Estatus': e.estatus,
            'UUID Fiscal': e.facturas[0]?.uuid || e.cfdiUuid || '',
            'Fecha Registro': e.createdAt.toLocaleDateString('es-MX'),
            'Usuario': e.usuario?.nombreCompleto || ''
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, 'Reporte COEPRISS');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', 'attachment; filename=COEPRISS_Reporte_Facturacion.xlsx');
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
        const [rawExpedientes, rawFacturas, historialCorreos, bitacoraSeguridad] = await Promise.all([
            prisma.expediente.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
            prisma.factura.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
            prisma.historialCorreo.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
            prisma.bitacoraSeguridad.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
        ]);

        const expedientes = rawExpedientes.map(e => ({
            ...e,
            rfc: e.receptorRfc || '',
            cliente: e.receptorNombre || '',
            correo: e.receptorEmail || '',
            codigoPostal: e.receptorCodigoPostal || '',
            regimenFiscal: e.receptorRegimenFiscal || '',
            usoCfdi: e.receptorUsoCfdi || 'G03',
            importe: e.cfdiTotal ? parseFloat(e.cfdiTotal) : 0,
            concepto: e.cfdiConcepto || '',
            formaPago: e.cfdiFormaPago || '03',
            metodoPago: e.cfdiMetodoPago || 'PUE',
            banco: e.pagoBanco || e.transferenciaBanco || '',
            claveRastreo: e.transferenciaReferencia || '',
            referencia: e.pagoReferencia || '',
            cuentaBeneficiaria: e.pagoCuenta || e.transferenciaClabe || '',
            fechaPago: e.pagoFecha || '',
            fechaRecibo: e.createdAt ? new Date(e.createdAt).toLocaleDateString('es-MX') : ''
        }));

        const facturas = rawFacturas.map(f => ({
            ...f,
            folioInterno: f.folio,
            importe: f.xmlContent ? undefined : 0
        }));

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
// FACTURAMA — INTEGRACIÓN PAC
// ─────────────────────────────────────────────

/**
 * GET /api/facturama/estado
 * Retorna el ambiente activo (sandbox/producción) y datos del emisor.
 * Verifica conexión con Facturama.
 */
app.get('/api/facturama/estado', autenticarToken, async (req, res) => {
    try {
        const config = facturama.getConfig();
        let cuenta = null;
        try {
            cuenta = await facturama.verificarConexion();
        } catch (e) {
            cuenta = { error: e.message };
        }
        res.json({
            success: true,
            sandbox:      config.sandbox,
            ambiente:     config.sandbox ? 'SANDBOX (Pruebas)' : 'PRODUCCION (Real)',
            baseUrl:      config.baseUrl,
            emisorRfc:    config.emisorRfc,
            emisorNombre: config.emisorNombre,
            conectado:    Array.isArray(cuenta) || (!cuenta?.error),
        });
    } catch (err) {
        console.error('[FACTURAMA/ESTADO]', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/facturama/test
 * Valida los datos del expediente para timbrado SIN emitir ninguna factura.
 * Body: { expedienteId } o { expediente: { ... } }
 */
app.post('/api/facturama/test', autenticarToken, async (req, res) => {
    try {
        let expediente = req.body.expediente;

        // Si viene solo el id, buscarlo en BD
        if (!expediente && req.body.expedienteId) {
            expediente = await prisma.expediente.findUnique({
                where: { folio: req.body.expedienteId }
            });
            if (!expediente) return res.status(404).json({ error: 'Expediente no encontrado.' });
        }

        if (!expediente) return res.status(400).json({ error: 'Se requiere expediente o expedienteId.' });

        const resultado = await facturama.validarExpediente(expediente);
        res.json({ success: true, ...resultado });
    } catch (err) {
        console.error('[FACTURAMA/TEST]', err);
        res.status(400).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/facturama/timbrar
 * Timbra el CFDI y guarda el resultado en la base de datos.
 * Body: { expedienteId: string, confirmarProduccion?: boolean }
 *
 * ⚠️ En modo PRODUCCIÓN requiere confirmarProduccion: true
 */
app.post('/api/facturama/timbrar', autenticarToken, async (req, res) => {
    const { expedienteId, confirmarProduccion } = req.body || {};

    // Protección anti-accidente: en producción exigir confirmación explícita
    if (!facturama.SANDBOX && !confirmarProduccion) {
        return res.status(403).json({
            error: 'En modo PRODUCCIÓN se requiere confirmarProduccion: true en el body.',
            sandbox: false,
        });
    }

    if (!expedienteId) return res.status(400).json({ error: 'Se requiere expedienteId.' });

    try {
        // Buscar expediente en BD
        let expediente = await prisma.expediente.findUnique({
            where: { folio: expedienteId }
        });

        if (!expediente && req.body.expediente) {
            const d = req.body.expediente;
            expediente = await prisma.expediente.upsert({
                where: { folio: expedienteId },
                update: {
                    receptorRfc: d.rfc || d.receptorRfc,
                    receptorNombre: d.cliente || d.receptorNombre,
                    receptorRegimenFiscal: d.regimenFiscal || d.receptorRegimenFiscal,
                    receptorCodigoPostal: d.codigoPostal || d.receptorCodigoPostal,
                    receptorUsoCfdi: d.usoCfdi || d.receptorUsoCfdi || 'G03',
                    cfdiTotal: parseFloat(d.importe || d.cfdiTotal || 0),
                    cfdiSubtotal: parseFloat(d.subtotal || (d.importe ? d.importe / 1.16 : 0)),
                    cfdiConcepto: d.concepto || d.cfdiConcepto,
                    cfdiFormaPago: d.formaPago || d.cfdiFormaPago || '03',
                    cfdiMetodoPago: d.metodoPago || d.cfdiMetodoPago || 'PUE',
                    receptorEmail: d.correo || d.receptorEmail
                },
                create: {
                    folio: expedienteId,
                    usuarioId: req.user.id,
                    estatus: 'PENDIENTE',
                    receptorRfc: d.rfc || d.receptorRfc,
                    receptorNombre: d.cliente || d.receptorNombre,
                    receptorRegimenFiscal: d.regimenFiscal || d.receptorRegimenFiscal,
                    receptorCodigoPostal: d.codigoPostal || d.receptorCodigoPostal,
                    receptorUsoCfdi: d.usoCfdi || d.receptorUsoCfdi || 'G03',
                    cfdiTotal: parseFloat(d.importe || d.cfdiTotal || 0),
                    cfdiSubtotal: parseFloat(d.subtotal || (d.importe ? d.importe / 1.16 : 0)),
                    cfdiConcepto: d.concepto || d.cfdiConcepto,
                    cfdiFormaPago: d.formaPago || d.cfdiFormaPago || '03',
                    cfdiMetodoPago: d.metodoPago || d.cfdiMetodoPago || 'PUE',
                    receptorEmail: d.correo || d.receptorEmail
                }
            });
        }

        if (!expediente) return res.status(404).json({ error: `Expediente ${expedienteId} no encontrado.` });

        // Verificar que no tenga ya una factura timbrada
        const facturaExistente = await prisma.factura.findFirst({
            where: { expedienteId: expediente.id, estatus: 'TIMBRADA' }
        });
        if (facturaExistente) {
            return res.status(409).json({
                error: `Este expediente ya tiene una factura timbrada: UUID ${facturaExistente.uuid}`,
                uuid: facturaExistente.uuid,
            });
        }

        console.log(`[FACTURAMA/TIMBRAR] Iniciando timbrado para expediente ${expedienteId} (sandbox=${facturama.SANDBOX})`);

        // Timbrar vía Facturama
        const resultado = await facturama.timbrarCFDI(expediente);

        // Guardar en base de datos
        const factura = await prisma.factura.create({
            data: {
                expedienteId:    expediente.id,
                usuarioId:       req.user.id,
                folio:           resultado.folio || expedienteId,
                uuid:            resultado.uuid,
                facturamaId:     resultado.id ? String(resultado.id) : null,
                xmlContent:      resultado.xmlBase64
                    ? Buffer.from(resultado.xmlBase64, 'base64').toString('utf-8')
                    : null,
                estatus:         'TIMBRADA',
                fechaTimbrado:   new Date(),
                cadenaOriginal:  resultado.datos?.OriginalString || null,
                noCertificadoSat: resultado.datos?.NoCertificadoSAT || null,
            }
        });

        // Actualizar estatus del expediente
        await prisma.expediente.update({
            where: { folio: expedienteId },
            data: {
                estatus:   'TIMBRADO',
                cfdiUuid:  resultado.uuid,
                cfdiTotal: parseFloat(expediente.cfdiTotal || 0),
            }
        });

        // Auto-guardar / actualizar en el Directorio de Clientes
        if (expediente.receptorRfc && expediente.receptorNombre) {
            const rfcNorm = expediente.receptorRfc.toUpperCase().trim();
            await prisma.cliente.upsert({
                where: { rfc: rfcNorm },
                update: {
                    razonSocial:   expediente.receptorNombre.trim(),
                    regimenFiscal: expediente.receptorRegimenFiscal || undefined,
                    codigoPostal:  expediente.receptorCodigoPostal || undefined,
                    usoCfdi:       expediente.receptorUsoCfdi || undefined,
                    formaPago:     expediente.cfdiFormaPago || undefined,
                    email:         expediente.receptorEmail || undefined,
                    activo:        true
                },
                create: {
                    rfc:           rfcNorm,
                    razonSocial:   expediente.receptorNombre.trim(),
                    regimenFiscal: expediente.receptorRegimenFiscal || null,
                    codigoPostal:  expediente.receptorCodigoPostal || null,
                    usoCfdi:       expediente.receptorUsoCfdi || null,
                    formaPago:     expediente.cfdiFormaPago || null,
                    email:         expediente.receptorEmail || null,
                    activo:        true
                }
            }).catch(e => console.warn('[CLIENTE AUTO-SAVE ERROR]', e.message));
        }

        // Registrar en bitácora
        await registrarBitacora(
            req.user.id,
            'CFDI_TIMBRADO',
            `Expediente: ${expedienteId} | UUID: ${resultado.uuid} | Sandbox: ${facturama.SANDBOX} | Folio Facturama: ${resultado.id}`,
            req.ip,
            'EXITOSO'
        );

        res.json({
            success:    true,
            sandbox:    resultado.sandbox,
            facturaId:  factura.id,
            facturamaId: resultado.id,
            uuid:       resultado.uuid,
            folio:      resultado.folio,
            serie:      resultado.serie,
            fecha:      resultado.fecha,
            subtotal:   resultado.subtotal,
            total:      resultado.total,
            xmlBase64:  resultado.xmlBase64,
            pdfBase64:  resultado.pdfBase64,
        });

    } catch (err) {
        console.error('[FACTURAMA/TIMBRAR ERROR]', err);

        await registrarBitacora(
            req.user.id,
            'CFDI_ERROR',
            `Expediente: ${expedienteId} | Error: ${err.message} | Sandbox: ${facturama.SANDBOX}`,
            req.ip,
            'FALLIDO'
        ).catch(() => {});

        const status = err.status || 500;
        res.status(status).json({
            success: false,
            error:   err.message,
            detalles: err.data || null,
        });
    }
});

/**
 * GET /api/facturama/descargar/:facturamaId/:formato
 * Descarga el XML o PDF de una factura directamente desde Facturama.
 * :formato = 'xml' | 'pdf'
 */
app.get('/api/facturama/descargar/:facturamaId/:formato', autenticarToken, async (req, res) => {
    const { facturamaId, formato } = req.params;
    if (!['xml', 'pdf'].includes(formato)) {
        return res.status(400).json({ error: 'Formato debe ser xml o pdf.' });
    }
    try {
        const base64 = await facturama.descargarArchivo(facturamaId, formato);
        const buffer = Buffer.from(base64, 'base64');

        const contentType = formato === 'pdf' ? 'application/pdf' : 'application/xml';
        const filename    = `COEPRISS_${facturamaId}.${formato}`;

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (err) {
        console.error('[FACTURAMA/DESCARGAR]', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/facturama/cancelar/:facturamaId
 * Cancela un CFDI. Solo Administrador.
 * Body: { motivo: '01'|'02'|'03'|'04', uuid: string }
 */
app.delete('/api/facturama/cancelar/:facturamaId', autenticarToken, requiereRol('Administrador'), async (req, res) => {
    const { facturamaId } = req.params;
    const { motivo = '02', uuid } = req.body || {};

    try {
        const resultado = await facturama.cancelarCFDI(facturamaId, motivo);

        // Actualizar estatus en BD si viene uuid
        if (uuid) {
            await prisma.factura.updateMany({
                where: { uuid },
                data:  { estatus: 'CANCELADA' }
            }).catch(() => {});
        }

        await registrarBitacora(
            req.user.id,
            'CFDI_CANCELADO',
            `FacturamaId: ${facturamaId} | UUID: ${uuid || 'N/A'} | Motivo: ${motivo}`,
            req.ip,
            'EXITOSO'
        );

        res.json({ success: true, resultado });
    } catch (err) {
        console.error('[FACTURAMA/CANCELAR]', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/facturama/listar
 * Lista las facturas emitidas en Facturama.
 */
app.get('/api/facturama/listar', autenticarToken, async (req, res) => {
    try {
        const { pagina = 0, tamanio = 50 } = req.query;
        const resultado = await facturama.listarFacturas(parseInt(pagina), parseInt(tamanio));
        res.json({ success: true, data: resultado, sandbox: facturama.SANDBOX });
    } catch (err) {
        console.error('[FACTURAMA/LISTAR]', err);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────
// ARCHIVOS ESTÁTICOS Y SPA FALLBACK
// ─────────────────────────────────────────────

app.use(express.static(path.join(__dirname)));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let dbEngine = 'Local Render Storage';

async function autoSeedDatabase() {
    try {
        const count = await prisma.usuario.count().catch(() => 0);
        if (count === 0) {
            console.log('🌱 Base de datos sin usuarios. Creando roles y cuentas iniciales...');
            const rolAdmin = await prisma.rol.upsert({
                where: { nombre: 'Administrador' },
                update: {},
                create: { nombre: 'Administrador', descripcion: 'Acceso completo al sistema' }
            });
            const rolAuditor = await prisma.rol.upsert({
                where: { nombre: 'Auditor' },
                update: {},
                create: { nombre: 'Auditor', descripcion: 'Acceso de consulta' }
            });

            const hashAdmin = await bcrypt.hash('SinaloaFacturas2026', 12);
            const hashAuditor = await bcrypt.hash('SinaloaAuditor2026', 12);

            // Usuario admin
            await prisma.usuario.upsert({
                where: { username: 'admin' },
                update: { passwordHash: hashAdmin },
                create: {
                    username: 'admin',
                    nombreCompleto: 'Administrador del Sistema',
                    email: 'admin@coepriss.gob.mx',
                    passwordHash: hashAdmin,
                    rolId: rolAdmin.id
                }
            });

            // Usuario Brenda González
            await prisma.usuario.upsert({
                where: { username: 'brenda.gonzalez' },
                update: { passwordHash: hashAdmin },
                create: {
                    username: 'brenda.gonzalez',
                    nombreCompleto: 'Brenda González',
                    email: 'brenda.gonzalez@coepriss.gob.mx',
                    passwordHash: hashAdmin,
                    rolId: rolAdmin.id
                }
            });

            // Usuario José Pérez
            await prisma.usuario.upsert({
                where: { username: 'jose.perez' },
                update: { passwordHash: hashAuditor },
                create: {
                    username: 'jose.perez',
                    nombreCompleto: 'José Pérez',
                    email: 'jose.perez@coepriss.gob.mx',
                    passwordHash: hashAuditor,
                    rolId: rolAuditor.id
                }
            });

            console.log('✅ Cuentas creadas exitosamente: admin, brenda.gonzalez, jose.perez');
        }
    } catch (err) {
        console.warn('⚠️ Nota sobre auto-seed:', err.message);
    }
}

async function startServer() {
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '') {
        try {
            await prisma.$connect();
            dbEngine = 'PostgreSQL (Render)';
            console.log('✅ Base de Datos PostgreSQL conectada correctamente en Render.');
            await autoSeedDatabase();
        } catch (err) {
            console.warn('⚠️ No se pudo conectar a PostgreSQL:', err.message);
            console.log('👉 Ejecutando con Motor de Almacenamiento Local de Render.');
        }
    } else {
        console.log('ℹ️ DATABASE_URL no definida. Usando Motor de Almacenamiento Nativo de Render.');
    }

    app.listen(PORT, () => {
        console.log(`=======================================================`);
        console.log(`🚀 COEPRISS SINALOA API v3.0 - PUERTO ${PORT}`);
        console.log(`👉 Base de Datos: ${dbEngine}`);
        console.log(`👉 Autenticación: JWT + bcrypt`);
        console.log(`=======================================================`);
    });
}

startServer();
