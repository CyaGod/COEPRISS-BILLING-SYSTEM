/**
 * COEPRISS Sinaloa - Seed de Datos Iniciales
 * Crea usuarios, roles y permisos base en PostgreSQL de Render
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Iniciando seed de la base de datos COEPRISS en Render...');

    // Crear roles
    const rolAdmin = await prisma.rol.upsert({
        where: { nombre: 'Administrador' },
        update: {},
        create: {
            nombre: 'Administrador',
            descripcion: 'Acceso completo al sistema de facturación'
        }
    });

    const rolAuditor = await prisma.rol.upsert({
        where: { nombre: 'Auditor' },
        update: {},
        create: {
            nombre: 'Auditor',
            descripcion: 'Acceso de consulta y auditoría'
        }
    });

    // Crear permisos para Administrador
    const permisosAdmin = [
        { modulo: 'expedientes', accion: 'crear' },
        { modulo: 'expedientes', accion: 'leer' },
        { modulo: 'expedientes', accion: 'actualizar' },
        { modulo: 'expedientes', accion: 'eliminar' },
        { modulo: 'facturas', accion: 'crear' },
        { modulo: 'facturas', accion: 'leer' },
        { modulo: 'facturas', accion: 'cancelar' },
        { modulo: 'correos', accion: 'enviar' },
        { modulo: 'reportes', accion: 'exportar' },
        { modulo: 'usuarios', accion: 'gestionar' },
        { modulo: 'bitacora', accion: 'leer' }
    ];

    for (const p of permisosAdmin) {
        await prisma.permiso.upsert({
            where: { rolId_modulo_accion: { rolId: rolAdmin.id, modulo: p.modulo, accion: p.accion } },
            update: {},
            create: { rolId: rolAdmin.id, ...p }
        });
    }

    // Crear permisos para Auditor
    const permisosAuditor = [
        { modulo: 'expedientes', accion: 'leer' },
        { modulo: 'facturas', accion: 'leer' },
        { modulo: 'reportes', accion: 'exportar' },
        { modulo: 'bitacora', accion: 'leer' }
    ];

    for (const p of permisosAuditor) {
        await prisma.permiso.upsert({
            where: { rolId_modulo_accion: { rolId: rolAuditor.id, modulo: p.modulo, accion: p.accion } },
            update: {},
            create: { rolId: rolAuditor.id, ...p }
        });
    }

    // Hash de contraseñas con bcrypt
    const hashAdmin = await bcrypt.hash('SinaloaFacturas2026', 12);
    const hashAuditor = await bcrypt.hash('SinaloaAuditor2026', 12);

    // Crear usuarios
    const usuarioAdmin = await prisma.usuario.upsert({
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

    const usuarioAuditor = await prisma.usuario.upsert({
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

    // Configuración base
    await prisma.configuracion.upsert({
        where: { clave: 'SISTEMA_VERSION' },
        update: {},
        create: { clave: 'SISTEMA_VERSION', valor: '3.0.0', tipo: 'string' }
    });

    await prisma.configuracion.upsert({
        where: { clave: 'EMISOR_RFC' },
        update: {},
        create: { clave: 'EMISOR_RFC', valor: 'COE050606I21', tipo: 'string' }
    });

    await prisma.configuracion.upsert({
        where: { clave: 'EMISOR_NOMBRE' },
        update: {},
        create: { clave: 'EMISOR_NOMBRE', valor: 'COMISION ESTATAL PARA LA PROTECCION CONTRA RIESGOS SANITARIOS DE SINALOA', tipo: 'string' }
    });

    // Bitácora inicial
    await prisma.bitacoraSeguridad.create({
        data: {
            usuarioId: usuarioAdmin.id,
            accion: 'Inicialización del sistema',
            detalles: 'Base de datos PostgreSQL inicializada correctamente en Render.',
            resultado: 'EXITOSO'
        }
    });

    console.log('✅ Seed completado:');
    console.log(`   - Rol Admin creado (id: ${rolAdmin.id})`);
    console.log(`   - Rol Auditor creado (id: ${rolAuditor.id})`);
    console.log(`   - Usuario brenda.gonzalez (id: ${usuarioAdmin.id})`);
    console.log(`   - Usuario jose.perez (id: ${usuarioAuditor.id})`);
}

main()
    .catch(e => {
        console.error('❌ Error en seed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
