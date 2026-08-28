if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
    process.env.DATABASE_URL = 'postgresql://coepriss_db_user:FnaT53yRYH4sn4T0ySn1AwJg4LseyjRK@dpg-d9onri0ae00c73b005k0-a.oregon-postgres.render.com/coepriss_db';
}
try { require('dotenv').config(); } catch (e) {}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testConnection() {
    console.log('=======================================================');
    console.log('🔍 VERIFICACIÓN DE CONEXIÓN POSTGRESQL (COEPRISS)');
    console.log('=======================================================');
    console.log('URL de conexión:', process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@'));

    try {
        console.log('\n⏳ 1. Probando ping SELECT 1 en PostgreSQL...');
        const pingResult = await prisma.$queryRaw`SELECT 1 as ping, current_database() as db, version() as pg_version, now() as server_time`;
        console.log('✅ Ping exitoso:', pingResult);

        console.log('\n⏳ 2. Verificando tablas del modelo...');
        const [usuarios, roles, permisos, expedientes, facturas, clientes, correos, bitacora] = await Promise.all([
            prisma.usuario.count(),
            prisma.rol.count(),
            prisma.permiso.count(),
            prisma.expediente.count(),
            prisma.factura.count(),
            prisma.cliente.count(),
            prisma.historialCorreo.count(),
            prisma.bitacoraSeguridad.count()
        ]);

        console.log('✅ Tablas accesibles y operativas:');
        console.log(`   - Usuarios:           ${usuarios}`);
        console.log(`   - Roles:              ${roles}`);
        console.log(`   - Permisos:           ${permisos}`);
        console.log(`   - Expedientes:        ${expedientes}`);
        console.log(`   - Facturas:           ${facturas}`);
        console.log(`   - Clientes:           ${clientes}`);
        console.log(`   - Historial Correos:  ${correos}`);
        console.log(`   - Bitácora Seguridad: ${bitacora}`);

        console.log('\n⏳ 3. Verificando usuarios activos...');
        const userList = await prisma.usuario.findMany({
            select: { id: true, username: true, nombreCompleto: true, activo: true, rol: { select: { nombre: true } } }
        });
        console.log('✅ Usuarios encontrados en PostgreSQL:', userList);

        console.log('\n=======================================================');
        console.log('🎉 RESULTADO: POSTGRESQL CONECTADO Y OPERANDO AL 100%');
        console.log('=======================================================');

    } catch (err) {
        console.error('\n❌ Error al conectar con PostgreSQL:', err.message);
        if (err.code) console.error('Código de error:', err.code);
    } finally {
        await prisma.$disconnect();
    }
}

testConnection();
