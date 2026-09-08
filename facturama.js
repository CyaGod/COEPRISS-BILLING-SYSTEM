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

function cleanSatRazonSocial(name, rfc = '') {
    if (!name) return '';
    let clean = name.trim().toUpperCase();
    // SAT CFDI 4.0: Para personas morales (RFC 12 caracteres), el SAT exige remover el régimen societario
    if (rfc && rfc.length === 12) {
        clean = clean
            .replace(/\b(S\.?A\.?\s+DE\s+C\.?V\.?|S\.?A\.?P\.?I\.?\s+DE\s+C\.?V\.?|S\.?A\.?P\.?I\.?|S\.?A\.?|S\.?\s+DE\s+R\.?L\.?\s+DE\s+C\.?V\.?|S\.?\s+DE\s+R\.?L\.?|S\.?C\.?|A\.?C\.?|ASOCIACION\s+CIVIL|SOCIEDAD\s+ANONIMA(\s+DE\s+CAPITAL\s+VARIABLE)?|I\.?A\.?P\.?|S\.?N\.?C\.?|S\.?C\.?S\.?)\b/gi, '')
            .replace(/[,.]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    return clean.trim() || name.trim().toUpperCase();
}

function stripAccents(str) {
    return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeSatRegimen(val) {
    if (!val) return '';
    const clean = stripAccents(String(val)).toUpperCase().replace(/[^A-Z0-9]/g, ' ');
    if (/\b601\b|GENERAL DE LEY/.test(clean)) return '601';
    if (/\b602\b|SIMPLIFICADO DE LEY PERSONAS MORALES/.test(clean)) return '602';
    if (/\b603\b|FINES NO LUCRATIVOS|PERSONAS MORALES CON FINES/.test(clean)) return '603';
    if (/\b604\b|PEQUENOS CONTRIBUYENTES/.test(clean)) return '604';
    if (/\b605\b|SUELDOS|SALARIOS|ASIMILADOS/.test(clean)) return '605';
    if (/\b606\b|ARRENDAMIENTO/.test(clean)) return '606';
    if (/\b607\b|ENAJENACION O ADQUISICION DE BIENES/.test(clean)) return '607';
    if (/\b608\b|DEMAS INGRESOS/.test(clean)) return '608';
    if (/\b609\b|CONSOLIDACION/.test(clean)) return '609';
    if (/\b610\b|RESIDENTES EN EL EXTRANJERO/.test(clean)) return '610';
    if (/\b611\b|DIVIDENDOS|SOCIOS Y ACCIONISTAS/.test(clean)) return '611';
    if (/\b612\b|ACTIVIDADES EMPRESARIALES Y PROFESIONALES|EMPRESARIALES Y PROFESIONALES|PERSONAS FISICAS CON ACTIVIDADES EMPRESARIALES/.test(clean)) return '612';
    if (/\b613\b|INTERMEDIO DE LAS PERSONAS FISICAS/.test(clean)) return '613';
    if (/\b614\b|INGRESOS POR INTERESES|INTERESES/.test(clean)) return '614';
    if (/\b615\b|OBTENCION DE PREMIOS|PREMIOS/.test(clean)) return '615';
    if (/\b616\b|SIN OBLIGACIONES/.test(clean)) return '616';
    if (/\b617\b|PEMEX/.test(clean)) return '617';
    if (/\b618\b|SIMPLIFICADO DE LEY PERSONAS FISICAS/.test(clean)) return '618';
    if (/\b619\b|OBTENCION DE PRESTAMOS|PRESTAMOS/.test(clean)) return '619';
    if (/\b620\b|SOCIEDADES COOPERATIVAS DE PRODUCCION|COOPERATIVAS/.test(clean)) return '620';
    if (/\b621\b|INCORPORACION FISCAL|RIF/.test(clean)) return '621';
    if (/\b622\b|AGRICOLAS|GANADERAS|SILVICOLAS|PESQUERAS|AGAPES/.test(clean)) return '622';
    if (/\b623\b|OPCIONAL PARA GRUPOS DE SOCIEDADES/.test(clean)) return '623';
    if (/\b624\b|COORDINADOS/.test(clean)) return '624';
    if (/\b625\b|PLATAFORMAS/.test(clean)) return '625';
    if (/\b626\b|SIMPLIFICADO DE CONFIANZA|RESICO/.test(clean)) return '626';
    const num = clean.match(/\b(60[1-9]|61[0-9]|62[0-6])\b/);
    return num ? num[1] : '';
}

function normalizeSatUsoCfdi(val) {
    if (!val) return '';
    const clean = stripAccents(String(val)).toUpperCase().replace(/[^A-Z0-9]/g, ' ');
    if (/\bG01\b|ADQUISICION DE MERCANCIAS|MERCANCIAS/.test(clean)) return 'G01';
    if (/\bG02\b|DEVOLUCIONES|DESCUENTOS|BONIFICACIONES/.test(clean)) return 'G02';
    if (/\bG03\b|GASTOS EN GENERAL|GASTOS/.test(clean)) return 'G03';
    if (/\bI01\b|CONSTRUCCIONES/.test(clean)) return 'I01';
    if (/\bI02\b|MOBILIARIO Y EQUIPO DE OFICINA/.test(clean)) return 'I02';
    if (/\bI03\b|EQUIPO DE TRANSPORTE/.test(clean)) return 'I03';
    if (/\bI04\b|EQUIPO DE COMPUTO|COMPUTO/.test(clean)) return 'I04';
    if (/\bI05\b|DADOS|TROQUELES|MOLDES|MATRICES|HERRAMENTAL/.test(clean)) return 'I05';
    if (/\bI06\b|COMUNICACIONES TELEFONICAS/.test(clean)) return 'I06';
    if (/\bI07\b|COMUNICACIONES SATELITALES/.test(clean)) return 'I07';
    if (/\bI08\b|OTRA MAQUINARIA|MAQUINARIA Y EQUIPO/.test(clean)) return 'I08';
    if (/\bD01\b|HONORARIOS MEDICOS|MEDICOS|HOSPITALARIOS/.test(clean)) return 'D01';
    if (/\bD02\b|GASTOS MEDICOS POR INCAPACIDAD|DISCAPACIDAD/.test(clean)) return 'D02';
    if (/\bD03\b|GASTOS FUNERALES/.test(clean)) return 'D03';
    if (/\bD04\b|DONATIVOS/.test(clean)) return 'D04';
    if (/\bD05\b|INTERESES REALES|CREDITOS HIPOTECARIOS/.test(clean)) return 'D05';
    if (/\bD06\b|APORTACIONES VOLUNTARIAS AL SAR|SAR/.test(clean)) return 'D06';
    if (/\bD07\b|SEGUROS DE GASTOS MEDICOS/.test(clean)) return 'D07';
    if (/\bD08\b|TRANSPORTACION ESCOLAR/.test(clean)) return 'D08';
    if (/\bD09\b|DEPOSITOS EN CUENTAS PARA EL AHORRO|PLANES DE PENSIONES/.test(clean)) return 'D09';
    if (/\bD10\b|SERVICIOS EDUCATIVOS|COLEGIATURAS/.test(clean)) return 'D10';
    if (/\bS01\b|SIN EFECTOS FISCALES|SIN EFECTOS/.test(clean)) return 'S01';
    if (/\bCP01\b|PAGOS/.test(clean)) return 'CP01';
    if (/\bCN01\b|NOMINA/.test(clean)) return 'CN01';
    const code = clean.match(/\b(G0[1-3]|I0[1-8]|D0[1-9]|D10|S01|CP01|CN01)\b/);
    return code ? code[1] : '';
}

function normalizeSatFormaPago(val) {
    if (!val) return '';
    const clean = stripAccents(String(val)).toUpperCase().replace(/[^A-Z0-9]/g, ' ');
    if (/\b03\b|TRANSFERENCIA|SPEI|ELECTRONICA DE FONDOS/.test(clean)) return '03';
    if (/\b01\b|EFECTIVO/.test(clean)) return '01';
    if (/\b02\b|CHEQUE/.test(clean)) return '02';
    if (/\b04\b|TARJETA DE CREDITO/.test(clean)) return '04';
    if (/\b05\b|MONEDERO ELECTRONICO/.test(clean)) return '05';
    if (/\b06\b|DINERO ELECTRONICO/.test(clean)) return '06';
    if (/\b08\b|VALES DE DESPENSA/.test(clean)) return '08';
    if (/\b12\b|DACION EN PAGO/.test(clean)) return '12';
    if (/\b13\b|SUBROGACION/.test(clean)) return '13';
    if (/\b14\b|CONSIGNACION/.test(clean)) return '14';
    if (/\b15\b|CONDONACION/.test(clean)) return '15';
    if (/\b17\b|COMPENSACION/.test(clean)) return '17';
    if (/\b23\b|NOVACION/.test(clean)) return '23';
    if (/\b24\b|CONFUSION/.test(clean)) return '24';
    if (/\b25\b|REMISION DE DEUDA/.test(clean)) return '25';
    if (/\b26\b|PRESCRIPCION|CADUCIDAD/.test(clean)) return '26';
    if (/\b27\b|SATISFACCION DEL ACREEDOR/.test(clean)) return '27';
    if (/\b28\b|TARJETA DE DEBITO/.test(clean)) return '28';
    if (/\b29\b|TARJETA DE SERVICIOS/.test(clean)) return '29';
    if (/\b30\b|APLICACION DE ANTICIPOS/.test(clean)) return '30';
    if (/\b31\b|INTERMEDIARIO/.test(clean)) return '31';
    if (/\b99\b|POR DEFINIR/.test(clean)) return '99';
    const code = clean.match(/\b(0[1-68]|1[2-57]|2[3-9]|3[01]|99)\b/);
    return code ? code[1] : '';
}

function normalizeSatMetodoPago(val) {
    if (!val) return '';
    const clean = stripAccents(String(val)).toUpperCase().replace(/[^A-Z0-9]/g, ' ');
    if (/\bPUE\b|UNA SOLA EXHIBICION|CONTADO/.test(clean)) return 'PUE';
    if (/\bPPD\b|PARCIALIDADES|DIFERIDO/.test(clean)) return 'PPD';
    return '';
}

/**
 * Convierte un expediente de COEPRISS en el JSON que espera Facturama (CFDI 4.0).
 */
function buildCFDIPayload(expediente) {
    if (!expediente) throw new Error('Se requiere el objeto expediente para construir el CFDI.');

    const totalBruto = parseFloat(expediente.cfdiTotal || expediente.importe || expediente.total || 0);
    if (!totalBruto || totalBruto <= 0) {
        throw new Error('El expediente no tiene un monto (Total) válido para facturar.');
    }

    // Desglose fiscal: Total = Subtotal + IVA (16%)
    const subtotal = parseFloat((totalBruto / 1.16).toFixed(2));
    const iva      = parseFloat((subtotal * 0.16).toFixed(2));

    const rfc     = (expediente.receptorRfc || expediente.rfc || '').toUpperCase().trim();
    const rawName = (expediente.receptorNombre || expediente.cliente || expediente.razonSocial || expediente.nombre || '').trim();
    const nombre  = cleanSatRazonSocial(rawName, rfc);
    const cp      = (expediente.receptorCodigoPostal || expediente.codigoPostal || expediente.cp || CP_EXPEDICION).trim();
    const rawRegimen = (expediente.receptorRegimenFiscal || expediente.regimenFiscal || expediente.regimen || '').trim();
    const regimen = normalizeSatRegimen(rawRegimen) || (rfc.length === 12 ? '601' : '616');
    
    // Reglas SAT para uso de CFDI según régimen
    const rawUso = (expediente.receptorUsoCfdi || expediente.usoCfdi || '').trim();
    let usoCfdi = normalizeSatUsoCfdi(rawUso);
    if (!usoCfdi) {
        usoCfdi = (regimen === '616' || rfc === 'XAXX010101000') ? 'S01' : USO_CFDI;
    }

    if (!rfc)    throw new Error('El expediente no tiene RFC del receptor.');
    if (!nombre) throw new Error('El expediente no tiene Nombre/Razón Social del receptor.');

    const concepto = expediente.cfdiConcepto || expediente.concepto || 'Derechos de Trámite Sanitario COEPRISS';
    const folio    = String(expediente.cfdiFolio || expediente.folio || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '');

    const paymentForm = normalizeSatFormaPago(expediente.cfdiFormaPago || expediente.formaPago) || FORMA_PAGO;
    const paymentMethod = normalizeSatMetodoPago(expediente.cfdiMetodoPago || expediente.metodoPago) || METODO_PAGO;

    const payload = {
        CfdiType:        'I',            // Ingreso
        NameId:          1,              // Factura
        ExpeditionPlace: CP_EXPEDICION,
        Exportation:     '01',           // No aplica
        PaymentForm:     paymentForm,
        PaymentMethod:   paymentMethod,
        Currency:        expediente.cfdiMoneda     || expediente.moneda      || MONEDA,
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

async function cancelarCFDI(id, motivo = '02', uuidReplacement = null) {
    let url = `/cfdi/${id}?type=issued&motive=${motivo}`;
    if (motivo === '01' && uuidReplacement) {
        url += `&uuidReplacement=${encodeURIComponent(uuidReplacement)}`;
    }
    return facturamaRequest('DELETE', url);
}

async function listarFacturas(pagina = 0, tamanio = 50) {
    return facturamaRequest('GET', `/cfdi?type=issued&page=${pagina}&pageSize=${tamanio}`);
}

/**
 * Busca si un CFDI ya fue emitido en Facturama recientemente para el mismo expediente
 * para reconciliar en caso de fallas de red, timeouts o caídas de servidor y evitar doble timbrado.
 *
 * ⚠️ REGLA DE SEGURIDAD: Valida obligatoriamente el FOLIO ÚNICO del expediente, RFC y Total exacto.
 */
async function reconciliarFacturaConPAC(expediente) {
    try {
        const folio = (expediente.folio || expediente.cfdiFolio || '').toString().trim();
        const rfc = (expediente.receptorRfc || expediente.rfc || '').toUpperCase().trim();
        const total = parseFloat(expediente.cfdiTotal || expediente.importe || 0);

        if (!folio || !rfc) return null;

        // 1. Consultar a Facturama buscando por la palabra clave del FOLIO ÚNICO
        let lista = await facturamaRequest('GET', `/cfdi?type=issued&page=0&pageSize=20&keyword=${encodeURIComponent(folio)}`).catch(() => null);
        
        // Si no arrojó resultados por folio, buscar por RFC como fallback de búsqueda (pero filtrando obligatoriamente por folio en el loop)
        if (!lista || !Array.isArray(lista) || lista.length === 0) {
            lista = await facturamaRequest('GET', `/cfdi?type=issued&page=0&pageSize=30&keyword=${encodeURIComponent(rfc)}`).catch(() => null);
        }
        if (!lista || !Array.isArray(lista) || lista.length === 0) {
            lista = await facturamaRequest('GET', `/cfdi?type=issued&page=0&pageSize=30`).catch(() => null);
        }

        if (!lista || !Array.isArray(lista)) return null;

        const folioNorm = folio.toUpperCase().replace(/\s+/g, '');

        for (const cfdi of lista) {
            const cfdiFolio = (cfdi.Folio || '').toString().trim().toUpperCase().replace(/\s+/g, '');
            const cfdiRfc = (cfdi.Receiver?.Rfc || cfdi.Rfc || '').toUpperCase().trim();
            const cfdiTotal = parseFloat(cfdi.Total || 0);

            // Validaciones obligatorias:
            // 1. Folio idéntico (o contenido en Folio/Serie)
            const folioMatch = cfdiFolio === folioNorm || cfdiFolio.endsWith(folioNorm) || (cfdi.Folio && cfdi.Folio.toString() === folio.toString());
            // 2. RFC idéntico
            const rfcMatch = cfdiRfc === rfc;
            // 3. Monto total exacto (tolerancia de 2 centavos por redondeo)
            const totalMatch = Math.abs(cfdiTotal - total) < 0.02;

            if (folioMatch && rfcMatch && totalMatch) {
                const uuid = cfdi.Complement?.TaxStamp?.Uuid || cfdi.Uuid || null;
                console.log(`[PAC RECONCILIACION] ✓ CFDI previo confirmado en Facturama para folio ${folio}: ID=${cfdi.Id}, Folio=${cfdi.Folio}, UUID=${uuid}`);
                
                const [xmlData, pdfData] = await Promise.all([
                    descargarArchivo(cfdi.Id, 'xml').catch(() => null),
                    descargarArchivo(cfdi.Id, 'pdf').catch(() => null),
                ]);

                return {
                    id:         cfdi.Id,
                    uuid:       uuid,
                    folio:      cfdi.Folio || folio,
                    serie:      cfdi.Serie,
                    fecha:      cfdi.Date,
                    subtotal:   cfdi.Subtotal,
                    total:      cfdi.Total,
                    estatus:    cfdi.Status || 'active',
                    xmlBase64:  xmlData,
                    pdfBase64:  pdfData,
                    sandbox:    SANDBOX,
                    reconciliado: true,
                    datos:      cfdi,
                };
            }
        }
        return null;
    } catch (err) {
        console.warn('[PAC RECONCILIACION ERROR]', err.message);
        return null;
    }
}

module.exports = {
    getConfig,
    verificarConexion,
    validarExpediente,
    timbrarCFDI,
    reconciliarFacturaConPAC,
    descargarArchivo,
    obtenerCFDI,
    cancelarCFDI,
    listarFacturas,
    normalizeSatRegimen,
    normalizeSatUsoCfdi,
    normalizeSatFormaPago,
    normalizeSatMetodoPago,
    SANDBOX,
};
