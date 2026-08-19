// ─────────────────────────────────────────────────────────────────────────────
// COEPRISS Sinaloa — Servicio Facturama
// Módulo de integración con la API de Facturama (PAC autorizado SAT)
// CFDI 4.0 — Autenticación: HTTP Basic Auth
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();

let fetchFn;
try {
    fetchFn = fetch; // Node 18+
} catch {
    fetchFn = require('node-fetch');
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN
// ─────────────────────────────────────────────────────────────────────────────

const SANDBOX = process.env.FACTURAMA_SANDBOX !== 'false'; // true por defecto (seguro)
const BASE_URL = SANDBOX
    ? 'https://apisandbox.facturama.mx'
    : 'https://api.facturama.mx';

const AUTH_HEADER = 'Basic ' + Buffer.from(
    `${process.env.FACTURAMA_USER}:${process.env.FACTURAMA_PASS}`
).toString('base64');

const EMISOR = {
    Rfc:          process.env.FACTURAMA_RFC_EMISOR       || 'CEP130206LC4',
    Name:         process.env.FACTURAMA_NOMBRE_EMISOR    || 'COMISION ESTATAL PARA LA PROTECCION CONTRA RIESGOS SANITARIOS DE SINALOA',
    FiscalRegime: process.env.FACTURAMA_REGIMEN_FISCAL   || '603',
};

const CP_EXPEDICION = process.env.FACTURAMA_CP_EXPEDICION || '80020';
const USO_CFDI      = process.env.FACTURAMA_USO_CFDI      || 'G03';
const FORMA_PAGO    = process.env.FACTURAMA_FORMA_PAGO    || '03';
const METODO_PAGO   = process.env.FACTURAMA_METODO_PAGO   || 'PUE';
const MONEDA        = process.env.FACTURAMA_MONEDA        || 'MXN';

// ─────────────────────────────────────────────────────────────────────────────
// HELPER HTTP
// ─────────────────────────────────────────────────────────────────────────────

async function facturamaRequest(method, path, body = null) {
    const options = {
        method,
        headers: {
            'Authorization': AUTH_HEADER,
            'Content-Type':  'application/json',
            'Accept':        'application/json',
        },
    };
    if (body) options.body = JSON.stringify(body);

    const url = `${BASE_URL}${path}`;
    console.log(`[FACTURAMA] ${method} ${url} (sandbox=${SANDBOX})`);

    const res = await fetchFn(url, options);
    const text = await res.text();

    let data;
    try {
        data = JSON.parse(text);
    } catch {
        data = { raw: text };
    }

    if (!res.ok) {
        let errMsg = '';
        if (data && data.ModelState) {
            errMsg = Object.values(data.ModelState).flat().join(' | ');
        } else if (data && (data.Message || data.message || data.error)) {
            errMsg = data.Message || data.message || data.error;
        } else {
            errMsg = `HTTP ${res.status}`;
        }
        const err = new Error(errMsg);
        err.status = res.status;
        err.data   = data;
        throw err;
    }

    return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTRUCCIÓN DEL CFDI 4.0 DESDE UN EXPEDIENTE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convierte un expediente de COEPRISS en el JSON que espera Facturama (CFDI 4.0).
 */
function buildCFDIPayload(expediente) {
    const totalBruto = parseFloat(expediente.cfdiTotal || 0);
    if (!totalBruto || totalBruto <= 0) {
        throw new Error('El expediente no tiene un monto (Total) válido para facturar.');
    }

    // Desglose fiscal: Total = Subtotal + IVA (16%)
    const subtotal = parseFloat((totalBruto / 1.16).toFixed(2));
    const iva      = parseFloat((totalBruto - subtotal).toFixed(2));

    const rfc     = (expediente.receptorRfc || '').toUpperCase().trim();
    const nombre  = (expediente.receptorNombre || '').trim();
    const cp      = (expediente.receptorCodigoPostal || CP_EXPEDICION).trim();
    const regimen = (expediente.receptorRegimenFiscal || (rfc.length === 12 ? '601' : '616')).trim();
    
    // Reglas SAT para uso de CFDI según régimen
    let usoCfdi = expediente.receptorUsoCfdi;
    if (!usoCfdi) {
        usoCfdi = (regimen === '616' || rfc === 'XAXX010101000') ? 'S01' : USO_CFDI;
    }

    if (!rfc)    throw new Error('El expediente no tiene RFC del receptor.');
    if (!nombre) throw new Error('El expediente no tiene Nombre/Razón Social del receptor.');

    const concepto = expediente.cfdiConcepto || 'Derechos de Trámite Sanitario COEPRISS';
    const folio    = String(expediente.cfdiFolio || expediente.folio || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '');

    const payload = {
        CfdiType:        'I',            // Ingreso
        NameId:          1,              // Factura
        ExpeditionPlace: CP_EXPEDICION,
        Exportation:     '01',           // No aplica
        PaymentForm:     expediente.cfdiFormaPago   || FORMA_PAGO,
        PaymentMethod:   expediente.cfdiMetodoPago  || METODO_PAGO,
        Currency:        expediente.cfdiMoneda      || MONEDA,
        Folio:           folio,
        Issuer: {
            Rfc:          EMISOR.Rfc,
            Name:         EMISOR.Name,
            FiscalRegime: EMISOR.FiscalRegime,
        },
        Receiver: {
            Rfc:          rfc,
            Name:         nombre,
            CfdiUse:      usoCfdi,
            FiscalRegime: regimen,
            TaxZipCode:   cp,
        },
        Items: [
            {
                ProductCode:         '90101501', // Servicios de regulación y cumplimiento gubernamental
                IdentificationNumber: folio,
                Description:          concepto,
                Unit:                 'Actividad',
                UnitCode:             'ACT',
                UnitPrice:            subtotal,
                Quantity:             1,
                Subtotal:             subtotal,
                TaxObject:            '02',       // Objeto de impuesto
                Taxes: [
                    {
                        Total:       iva,
                        Name:        'IVA',
                        Base:        subtotal,
                        Rate:        0.16,
                        IsRetention: false,
                    },
                ],
                Total: totalBruto,
            },
        ],
    };

    // Si es Factura Global (Público en General), SAT exige GlobalInformation
    if (rfc === 'XAXX010101000' && nombre.toUpperCase() === 'PUBLICO EN GENERAL') {
        const hoy = new Date();
        payload.GlobalInformation = {
            Periodicity: '01', // Diario
            Months:      String(hoy.getMonth() + 1).padStart(2, '0'),
            Year:        hoy.getFullYear(),
        };
    }

    if (expediente.cfdiSerie) {
        payload.Serie = expediente.cfdiSerie;
    }

    return payload;
}

// ─────────────────────────────────────────────────────────────────────────────
// API PÚBLICA DEL MÓDULO
// ─────────────────────────────────────────────────────────────────────────────

function getConfig() {
    return {
        sandbox:      SANDBOX,
        baseUrl:      BASE_URL,
        emisorRfc:    EMISOR.Rfc,
        emisorNombre: EMISOR.Name,
        cpExpedicion: CP_EXPEDICION,
    };
}

async function verificarConexion() {
    return facturamaRequest('GET', '/api/catalogs/PaymentForms');
}

async function validarExpediente(expediente) {
    const payload = buildCFDIPayload(expediente);

    let rfcInfo = null;
    try {
        rfcInfo = await facturamaRequest('GET', `/api/clients/validations/${payload.Receiver.Rfc}`);
    } catch (e) {
        rfcInfo = { warning: `Validación RFC: ${e.message}` };
    }

    return {
        valido:      true,
        payload,
        rfcInfo,
        sandbox:     SANDBOX,
        resumen: {
            emisor:    `${EMISOR.Rfc} — ${EMISOR.Name}`,
            receptor:  `${payload.Receiver.Rfc} — ${payload.Receiver.Name}`,
            concepto:  payload.Items[0].Description,
            subtotal:  payload.Items[0].UnitPrice,
            iva:       payload.Items[0].Taxes[0].Total,
            total:     payload.Items[0].Total,
            formaPago: payload.PaymentForm,
            usoCfdi:   payload.Receiver.CfdiUse,
        },
    };
}

async function timbrarCFDI(expediente) {
    const payload = buildCFDIPayload(expediente);
    const result  = await facturamaRequest('POST', '/3/cfdis', payload);

    const uuid = result.Complement?.TaxStamp?.Uuid || result.Uuid || null;

    // Obtener XML y PDF en base64
    const [xmlData, pdfData] = await Promise.all([
        descargarArchivo(result.Id, 'xml').catch(() => null),
        descargarArchivo(result.Id, 'pdf').catch(() => null),
    ]);

    return {
        id:         result.Id,
        uuid:       uuid,
        folio:      result.Folio,
        serie:      result.Serie,
        fecha:      result.Date,
        subtotal:   result.Subtotal,
        total:      result.Total,
        estatus:    result.Status || 'active',
        xmlBase64:  xmlData,
        pdfBase64:  pdfData,
        sandbox:    SANDBOX,
        datos:      result,
    };
}

async function descargarArchivo(id, formato) {
    const path = `/cfdi/${formato}/issued/${id}`;
    const options = {
        method: 'GET',
        headers: {
            'Authorization': AUTH_HEADER,
            'Accept':        'application/json',
        },
    };
    const url = `${BASE_URL}${path}`;
    const res = await fetchFn(url, options);
    if (!res.ok) throw new Error(`Error descargando ${formato}: HTTP ${res.status}`);

    const data = await res.json();
    if (data && data.Content) {
        return data.Content; // Ya viene en Base64
    }
    throw new Error(`Respuesta de Facturama no contiene el archivo ${formato}.`);
}

async function obtenerCFDI(id) {
    return facturamaRequest('GET', `/cfdi/issued/${id}`);
}

async function cancelarCFDI(id, motivo = '02') {
    return facturamaRequest('DELETE', `/cfdi/${id}?type=issued&motive=${motivo}`);
}

async function listarFacturas(pagina = 0, tamanio = 50) {
    return facturamaRequest('GET', `/cfdi?type=issued&page=${pagina}&pageSize=${tamanio}`);
}

module.exports = {
    getConfig,
    verificarConexion,
    validarExpediente,
    timbrarCFDI,
    descargarArchivo,
    obtenerCFDI,
    cancelarCFDI,
    listarFacturas,
    SANDBOX,
};
