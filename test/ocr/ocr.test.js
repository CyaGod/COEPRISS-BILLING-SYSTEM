/**
 * Test Suite: OCR Core Engine Unit & Integration Tests (test/ocr/ocr.test.js)
 * Tests running with Node.js built-in test runner (`node --test`)
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const OcrCore = require('../../ocr-core.js');

describe('COEPRISS Master OCR Engine Tests', () => {

    test('1. CIS COEPRISS Official Payment Receipt (Los Mochis Landscape Image Case)', () => {
        const cisReceiptText = `
        SECRETARIA DE SALUD DE SINALOA
        COMISION ESTATAL PARA LA PROTECCION CONTRA RIESGOS SANITARIOS DE SINALOA
        -RECIBO DE PAGO-
        -DERECHOS Y SERVICIOS-
        LOS MOCHIS
        Comisión Estatal para la Protección Contra Riesgos Sanitarios de Sinaloa
        Fecha de expedición: 12/08/2026   Vencimiento: 12/09/2026
        CEP 130206 LC4
        N° Folio de pago: 074673
        Nombre o Razón Social: COMERCIALIZADORA DEL PACIFICO ASOCIACION CIVIL
        RFC: EIA15081956A
        Sírvase a realizar el presente pago en BANCO BANORTE a la cuenta:
        Cuenta: 0123456789   Línea de captura: 074 1234 5678 9012 3456 7
        Por concepto a pagar: 1.0 - Constancia de condiciones sanitarias de un establecimiento
        • Cuota: 1
        • Cuota unitaria: $ 1,408.00
        • Precio a pagar: $ 1,408.00
        Total M.N.: $ 1,408.00
        La factura deberá solicitarse dentro de los 7 días posteriores
        [SELLO] SECRETARIA DE SALUD
        COMISION ESTATAL PARA LA PROTECCION CONTRA RIESGOS SANITARIOS
        13 AGO 2026
        RECIBIDO
        `;

        const docType = OcrCore.classifyDocumentText(cisReceiptText);
        assert.strictEqual(docType, 'RECIBO_CIS');

        const parsed = OcrCore.parseExtractedFields(cisReceiptText, 'recibo_cis.jpg');
        
        assert.strictEqual(parsed.rfc, 'EIA15081956A');
        assert.strictEqual(parsed.folioRecibo, '074673');
        assert.strictEqual(parsed.importe, 1408.00);
        assert.ok(parsed.razonSocial.includes('COMERCIALIZADORA'));
        assert.ok(parsed.concepto.includes('Constancia de condiciones sanitarias'));
        assert.strictEqual(parsed.fechaExpedicion, '12/08/2026');
        assert.strictEqual(parsed.fechaRecepcion, '13/08/2026');
        assert.strictEqual(parsed.banco, 'BANORTE');
    });

    test('2. SAT Constancia with Régimen Capital and institutional footer email', () => {
        const satText = `
        CÉDULA DE IDENTIFICACIÓN FISCAL
        RFC: EIA15081956A
        DENOMINACIÓN O RAZÓN SOCIAL: COMERCIALIZADORA DEL PACIFICO ASOCIACION CIVIL
        Régimen Capital: ASOCIACION CIVIL
        Nombre Comercial: COMERCIALIZADORA DEL PACIFICO
        Fecha de inicio de operaciones: 19 DE AGOSTO DE 2015
        Estatus en el padrón: ACTIVO
        DOMICILIO FISCAL:
        Código Postal: 80104
        Tipo de Vialidad: BOULEVARD
        Nombre de Vialidad: PEDRO INFANTE
        Número Exterior: 2900
        Colonia: DESARROLLO URBANO TRES RIOS
        Municipio: CULIACAN
        Entidad Federativa: SINALOA
        Regímenes:
        Régimen: Personas Morales con Fines no Lucrativos (603)
        Fecha de alta: 19/08/2015
        Sus datos personales son protegidos...
        Quejas y denuncias: denuncias@sat.gob.mx o llame a MarcaSAT
        Correo electrónico registrado: contacto@pacificocomercial.com
        `;

        const docType = OcrCore.classifyDocumentText(satText);
        assert.strictEqual(docType, 'CONSTANCIA_SAT');

        const parsed = OcrCore.parseExtractedFields(satText, 'constancia.pdf');

        assert.strictEqual(parsed.rfc, 'EIA15081956A');
        assert.strictEqual(parsed.codigoPostal, '80104');
        assert.strictEqual(parsed.regimenFiscal, '603'); // Must NOT be 'CAPITAL: ASOCIACION CIVIL'
        assert.notStrictEqual(parsed.correo, 'denuncias@sat.gob.mx'); // Must NOT pick denuncias
        assert.strictEqual(parsed.correo, 'contacto@pacificocomercial.com');
    });

    test('3. Bank SPEI Confirmation with clean reference & tracking key', () => {
        const bankText = `
        BANORTE
        COMPROBANTE DE TRANSFERENCIA INTERBANCARIA (SPEI)
        Fecha de operación: 12/08/2026
        Hora de captura en el canal: 17:29:41
        Importe: $1,408.00 MXN
        Comisión: $0.00
        IVA Comisión: $0.00
        Cuenta ordenante: 0123456789
        Institución emisora: BANORTE
        Institución receptora: BANORTE
        Cuenta beneficiaria: 072730001234567890
        Beneficiario: COEPRISS SINALOA
        RFC Beneficiario: CEP130206LC4
        Concepto del pago: PAGO DERECHOS SANITARIOS
        Referencia: 074673
        Clave de rastreo: 002601002608120000995530
        `;

        const docType = OcrCore.classifyDocumentText(bankText);
        assert.strictEqual(docType, 'COMPROBANTE_BANCARIO');

        const parsed = OcrCore.parseExtractedFields(bankText, 'pago_spei.pdf');

        assert.strictEqual(parsed.banco, 'BANORTE');
        assert.strictEqual(parsed.importe, 1408.00);
        assert.strictEqual(parsed.claveRastreo, '002601002608120000995530');
        assert.strictEqual(parsed.referencia, '074673'); // Must NOT be 'Hora de captura en el canal'
        assert.strictEqual(parsed.formaPago, '03');
    });

    test('4. Multi-document Fusion: CIS Recibo + SAT Constancia + SPEI Proof', () => {
        const doc1 = OcrCore.parseExtractedFields(`
            SECRETARIA DE SALUD DE SINALOA - COEPRISS
            RECIBO DE PAGO DERECHOS Y SERVICIOS
            LOS MOCHIS
            No. Folio: 074673
            RFC: EIA15081956A
            Nombre: COMERCIALIZADORA DEL PACIFICO
            Concepto: 1.0 - Constancia de condiciones sanitarias de un establecimiento
            Importe: $1,408.00
            Fecha: 12/08/2026
        `, 'recibo.jpg');
        doc1.sourceFile = 'recibo.jpg';

        const doc2 = OcrCore.parseExtractedFields(`
            CONSTANCIA DE SITUACION FISCAL - SAT
            RFC: EIA15081956A
            DENOMINACIÓN O RAZÓN SOCIAL: COMERCIALIZADORA DEL PACIFICO ASOCIACION CIVIL
            Código Postal: 80104
            Regímenes: Personas Morales con Fines no Lucrativos (603)
            Correo electrónico: facturacion@pacificocomercial.com
        `, 'constancia.pdf');
        doc2.sourceFile = 'constancia.pdf';

        const doc3 = OcrCore.parseExtractedFields(`
            BANORTE SPEI
            Clave de rastreo: 002601002608120000995530
            Referencia: 074673
            Importe: $1,408.00
        `, 'spei.pdf');
        doc3.sourceFile = 'spei.pdf';

        const merged = OcrCore.mergeExtractedFieldSets([doc1, doc2, doc3]);

        // Verified Expectations
        assert.strictEqual(merged.rfc, 'EIA15081956A');
        assert.strictEqual(merged.razonSocial, 'COMERCIALIZADORA DEL PACIFICO ASOCIACION CIVIL');
        assert.strictEqual(merged.codigoPostal, '80104');
        assert.strictEqual(merged.regimenFiscal, '603');
        assert.strictEqual(merged.correo, 'facturacion@pacificocomercial.com');
        assert.strictEqual(merged.folioRecibo, '074673');
        assert.ok(merged.concepto.includes('Constancia de condiciones sanitarias'));
        assert.strictEqual(merged.importe, 1408.00);
        assert.strictEqual(merged.claveRastreo, '002601002608120000995530');
    });

});
