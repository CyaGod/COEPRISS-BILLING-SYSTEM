if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
    process.env.DATABASE_URL = 'postgresql://coepriss_db_user:FnaT53yRYH4sn4T0ySn1AwJg4LseyjRK@dpg-d9onri0ae00c73b005k0-a/coepriss_db';
}
try { require('dotenv').config(); } catch (e) {}
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch (e) {}

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function limpiarBaseDeDatos() {
    console.log('=======================================================');
    console.log('🧹 COEPRISS SINALOA - LIMPIEZA DE DATOS PARA PRODUCCIÓN');
    console.log('=======================================================');

    try {
        console.log('\n⏳ Conectando a PostgreSQL...');
        await prisma.$connect();
        console.log('✅ Conexión establecida con la base de datos.');

        // 1. Conteo previo
        const facturasPrev = await prisma.factura.count().catch(() => 0);
        const expedientesPrev = await prisma.expediente.count().catch(() => 0);
        const archivosPrev = await prisma.archivo.count().catch(() => 0);
        const correosPrev = await prisma.historialCorreo.count().catch(() => 0);
        const clientesPrev = await prisma.cliente.count().catch(() => 0);
        const bitacoraPrev = await prisma.bitacoraSeguridad.count().catch(() => 0);
        const sesionesPrev = await prisma.sesion.count().catch(() => 0);
        const usuariosCount = await prisma.usuario.count().catch(() => 0);

        console.log('\n📊 Registros actuales encontrados:');
        console.log(`   - Facturas / CFDIs:   ${facturasPrev}`);
        console.log(`   - Expedientes:        ${expedientesPrev}`);
        console.log(`   - Archivos adjuntos:  ${archivosPrev}`);
        console.log(`   - Historial Correos:  ${correosPrev}`);
        console.log(`   - Clientes / Padrón:  ${clientesPrev}`);
        console.log(`   - Bitácora Seguridad: ${bitacoraPrev}`);
        console.log(`   - Sesiones activas:   ${sesionesPrev}`);
        console.log(`   - Usuarios del sistema (se conservan): ${usuariosCount}`);

        // 2. Eliminación de datos transaccionales
        console.log('\n⏳ Eliminando registros de prueba...');
        await prisma.historialCorreo.deleteMany({});
        await prisma.factura.deleteMany({});
        await prisma.archivo.deleteMany({});
        await prisma.expediente.deleteMany({});
        await prisma.cliente.deleteMany({});
        await prisma.bitacoraSeguridad.deleteMany({});
        await prisma.sesion.deleteMany({});

        // 3. Crear registro inicial limpio en bitácora
        const adminUser = await prisma.usuario.findFirst({
            where: { OR: [{ username: 'admin' }, { username: 'brenda.gonzalez' }] }
        });

        await prisma.bitacoraSeguridad.create({
            data: {
                usuarioId: adminUser ? adminUser.id : null,
                accion: 'INICIALIZACIÓN PRODUCCIÓN',
                detalles: 'Base de datos vaciada y preparada para operación real en producción.',
                resultado: 'EXITOSO'
            }
        });

        // 4. Limpiar JSON persistente local si existe
        const localDbFile = path.join(__dirname, '..', 'data', 'coepriss_render_database.json');
        if (fs.existsSync(localDbFile)) {
            try {
                const initialJson = {
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
                            usuario: 'Sistema COEPRISS',
                            accion: 'Inicialización de Producción',
                            detalles: 'Base de datos limpia y lista para facturación oficial en producción.'
                        }
                    ]
                };
                fs.writeFileSync(localDbFile, JSON.stringify(initialJson, null, 2), 'utf8');
                console.log('✅ Archivo JSON local reinicializado.');
            } catch (err) {
                console.warn('⚠️ No se pudo limpiar archivo JSON local:', err.message);
            }
        }

        console.log('\n=======================================================');
        console.log('🎉 BASE DE DATOS LIMPIA Y LISTA PARA PRODUCCIÓN');
        console.log('   - Facturas:          0');
        console.log('   - Expedientes:       0');
        console.log('   - Clientes:          0');
        console.log('   - Correos enviados:  0');
        console.log('   - Bitácora:          1 (Evento inicial)');
        console.log('   - Cuentas activas:   Conservadas intactas');
        console.log('=======================================================');

    } catch (error) {
        console.error('\n❌ Error al limpiar base de datos:', error.message);
    } finally {
        await prisma.$disconnect();
    }
}

limpiarBaseDeDatos();
