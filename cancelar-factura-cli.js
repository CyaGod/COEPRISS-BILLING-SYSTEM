#!/usr/bin/env node
require('dotenv').config();
const facturama = require('./facturama');

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log(`
===========================================================
  COEPRISS - Cancelador de CFDIs Facturama (CLI)
===========================================================
Uso:
  node cancelar-factura-cli.js <FacturamaId_o_UUID> [motivo] [uuidSustituto]

Motivos SAT:
  01 - Comprobante emitido con errores con relación (requiere uuidSustituto)
  02 - Comprobante emitido con errores sin relación (por defecto)
  03 - No se llevó a cabo la operación
  04 - Operación nominativa relacionada en una factura global

Ambiente actual: ${facturama.SANDBOX ? '⚠️ SANDBOX (Pruebas)' : '🚀 PRODUCCIÓN (SAT Oficial)'}
===========================================================
`);
        process.exit(1);
    }

    const id = args[0];
    const motivo = args[1] || '02';
    const uuidSustituto = args[2] || null;

    if (motivo === '01' && !uuidSustituto) {
        console.error('❌ Error: El motivo 01 requiere proporcionar el UUID de la factura sustituta.');
        process.exit(1);
    }

    console.log(`\n⏳ Solicitando cancelación a Facturama...`);
    console.log(`   - ID / UUID: ${id}`);
    console.log(`   - Motivo SAT: ${motivo}`);
    if (uuidSustituto) console.log(`   - UUID Sustituto: ${uuidSustituto}`);
    console.log(`   - Ambiente: ${facturama.SANDBOX ? 'SANDBOX' : 'PRODUCCIÓN'}\n`);

    try {
        const res = await facturama.cancelarCFDI(id, motivo, uuidSustituto);
        console.log('✅ Cancelación solicitada exitosamente ante el SAT:');
        console.log(JSON.stringify(res, null, 2));
    } catch (err) {
        console.error('❌ Error al cancelar:', err.message);
        if (err.data) console.error('Detalles:', JSON.stringify(err.data, null, 2));
    }
}

main();
