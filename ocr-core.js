/**
 * COEPRISS Billing System - OCR Core Engine (ocr-core.js)
 * 
 * Modulo puro de extracción, clasificación documental, normalización SAT CFDI 4.0,
 * filtrado de candidatos y fusión inteligente para trámites de oficina COEPRISS.
 */

(function (global) {
    'use strict';

    // ─────────────────────────────────────────────
    // 1. UTILIDADES Y LIMPIEZA DE CADENAS
    // ─────────────────────────────────────────────

    function stripOcrAccents(value) {
        return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function cleanOcrValue(value) {
        return String(value || '')
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/[|]+/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^[.:\-,\s]+/, '')
            .replace(/[.,;:]$/, '');
    }

    function normalizeOcrRfc(value) {
        return cleanOcrValue(value).toUpperCase().replace(/[^A-Z0-9&Ñ]/g, '');
    }

    function normalizeOcrUuid(value) {
        return String(value || '')
            .toUpperCase()
            .replace(/[OQ]/g, '0')
            .replace(/[IL]/g, '1')
            .replace(/S/g, '5')
            .replace(/G/g, '6')
            .replace(/Z/g, '2')
            .replace(/B(?=[0-9A-F-]|$)/g, '8')
            .replace(/U/g, '0');
    }

    function normalizeOcrDate(value) {
        const cleanValue = cleanOcrValue(value);
        const isoMatch = cleanValue.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(.*)$/);
        if (isoMatch) {
            return `${isoMatch[3].padStart(2, '0')}/${isoMatch[2].padStart(2, '0')}/${isoMatch[1]}${isoMatch[4]}`;
        }
        return cleanValue;
    }

    function normalizeOcrConcept(value) {
        return cleanOcrValue(value)
            .replace(/[\[\]{}<>|]/g, ' ')
            .replace(/\bI\s+L(?:E|C)\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // ─────────────────────────────────────────────
    // 2. NORMALIZADORES DE CATÁLOGOS SAT CFDI 4.0
    // ─────────────────────────────────────────────

    function normalizeSatRegimen(val) {
        if (!val) return '';
        const clean = stripOcrAccents(String(val)).toUpperCase().replace(/[^A-Z0-9]/g, ' ');
        if (/\b601\b|GENERAL DE LEY/.test(clean)) return '601';
        if (/\b603\b|FINES NO LUCRATIVOS|PERSONAS MORALES CON FINES/.test(clean)) return '603';
        if (/\b605\b|SUELDOS|SALARIOS|ASIMILADOS/.test(clean)) return '605';
        if (/\b606\b|ARRENDAMIENTO/.test(clean)) return '606';
        if (/\b612\b|ACTIVIDADES EMPRESARIALES|PROFESIONALES/.test(clean)) return '612';
        if (/\b616\b|SIN OBLIGACIONES/.test(clean)) return '616';
        if (/\b621\b|INCORPORACION FISCAL|RIF/.test(clean)) return '621';
        if (/\b625\b|PLATAFORMAS/.test(clean)) return '625';
        if (/\b626\b|SIMPLIFICADO DE CONFIANZA|RESICO/.test(clean)) return '626';
        const num = clean.match(/\b(601|603|605|606|612|616|621|625|626)\b/);
        return num ? num[1] : '';
    }

    function normalizeSatUsoCfdi(val) {
        if (!val) return '';
        const clean = stripOcrAccents(String(val)).toUpperCase().replace(/[^A-Z0-9]/g, ' ');
        if (/\bG03\b|GASTOS EN GENERAL|GASTOS/.test(clean)) return 'G03';
        if (/\bG01\b|ADQUISICION DE MERCANCIAS|MERCANCIAS/.test(clean)) return 'G01';
        if (/\bG02\b|DEVOLUCIONES|DESCUENTOS/.test(clean)) return 'G02';
        if (/\bI01\b|CONSTRUCCIONES/.test(clean)) return 'I01';
        if (/\bI04\b|EQUIPO DE COMPUTO|COMPUTO/.test(clean)) return 'I04';
        if (/\bI08\b|MAQUINARIA/.test(clean)) return 'I08';
        if (/\bD01\b|HONORARIOS MEDICOS|MEDICOS/.test(clean)) return 'D01';
        if (/\bD02\b|INCAPACIDAD/.test(clean)) return 'D02';
        if (/\bD04\b|DONATIVOS/.test(clean)) return 'D04';
        if (/\bS01\b|SIN EFECTOS FISCALES|SIN EFECTOS/.test(clean)) return 'S01';
        if (/\bCP01\b|PAGOS/.test(clean)) return 'CP01';
        const code = clean.match(/\b(G01|G02|G03|I01|I04|I08|D01|D02|D04|S01|CP01)\b/);
        return code ? code[1] : '';
    }

    function normalizeSatFormaPago(val) {
        if (!val) return '';
        const clean = stripOcrAccents(String(val)).toUpperCase().replace(/[^A-Z0-9]/g, ' ');
        if (/\b03\b|TRANSFERENCIA|SPEI|ELECTRONICA|INTERBANCARIO/.test(clean)) return '03';
        if (/\b01\b|EFECTIVO/.test(clean)) return '01';
        if (/\b02\b|CHEQUE/.test(clean)) return '02';
        if (/\b04\b|TARJETA DE CREDITO|CREDITO/.test(clean)) return '04';
        if (/\b28\b|TARJETA DE DEBITO|DEBITO/.test(clean)) return '28';
        if (/\b99\b|POR DEFINIR/.test(clean)) return '99';
        const code = clean.match(/\b(01|02|03|04|28|99)\b/);
        return code ? code[1] : '';
    }

    function normalizeSatMetodoPago(val) {
        if (!val) return '';
        const clean = stripOcrAccents(String(val)).toUpperCase().replace(/[^A-Z0-9]/g, ' ');
        if (/\bPUE\b|UNA SOLA EXHIBICION|CONTADO/.test(clean)) return 'PUE';
        if (/\bPPD\b|PARCIALIDADES|DIFERIDO/.test(clean)) return 'PPD';
        return '';
    }

    // ─────────────────────────────────────────────
    // 3. CLASIFICACIÓN DOCUMENTAL INTELIGENTE
    // ─────────────────────────────────────────────

    function classifyDocumentText(rawText) {
        const p = stripOcrAccents(String(rawText || '')).toUpperCase();
        
        // 1. Digital CFDI Invoice / SAT Receipt
        if ((p.includes('FOLIO FISCAL') && p.includes('UUID')) || 
            (p.includes('SELLO DIGITAL DEL CFDI') || p.includes('SELLO DEL SAT') || p.includes('COMPROBANTE FISCAL DIGITAL'))) {
            return 'CFDI_FACTURA';
        }

        // 2. Bank Payment / SPEI Transfer Confirmation
        if ((p.includes('TRANSFERENCIA') || p.includes('SPEI') || p.includes('COMPROBANTE DE OPERACION') || p.includes('PAGO INTERBANCARIO') || p.includes('BBVA NET CASH')) &&
            (p.includes('CLAVE DE RASTREO') || p.includes('CUENTA DE RETIRO') || p.includes('CUENTA DE DEPOSITO') || p.includes('INSTITUCION EMISORA') || p.includes('HORA DE CAPTURA'))) {
            return 'COMPROBANTE_BANCARIO';
        }

        // 3. Coepriss CIS Payment Receipt
        if ((p.includes('COEPRISS') || p.includes('RIESGOS SANITARIOS') || p.includes('SECRETARIA DE SALUD')) &&
            (p.includes('RECIBO DE PAGO') || p.includes('TRAMITES Y SERVICIOS') || p.includes('DERECHOS Y SERVICIOS') || p.includes('ORDEN DE PAGO') || p.includes('LINEA DE CAPTURA') || p.includes('CUOTA UNITARIA'))) {
            return 'RECIBO_CIS';
        }

        // 4. SAT Constancia de Situación Fiscal
        if (p.includes('CEDULA DE IDENTIFICACION FISCAL') || 
            p.includes('CONSTANCIA DE SITUACION FISCAL') || 
            p.includes('REGISTRO FEDERAL DE CONTRIBUYENTES') || 
            (p.includes('DOMICILIO') && p.includes('REGIMENES:'))) {
            return 'CONSTANCIA_SAT';
        }

        return 'GENERICO';
    }

    // ─────────────────────────────────────────────
    // 4. PARSER ESPECIALIZADO: RECIBOS CIS COEPRISS
    // ─────────────────────────────────────────────

    function parseCisCoeprissReceipt(text, normalized, plain) {
        const result = {
            docType: 'RECIBO_CIS',
            municipio: '',
            folioRecibo: '',
            rfc: '',
            rfcSolicitante: '',
            razonSocial: '',
            concepto: '',
            importe: null,
            fechaExpedicion: '',
            fechaRecepcion: '',
            banco: 'BANORTE'
        };

        // 1. Municipio / Delegación
        const munMatch = plain.match(/\b(LOS\s+MOCHIS|CULIACAN|MAZATLAN|GUASAVE|GUAMUCHIL|NAVOLATO|ESCUINAPA|EL\s+FUERTE|CHOIX)\b/i);
        if (munMatch) result.municipio = cleanOcrValue(munMatch[1]);

        // 2. Folio CIS u Orden de Pago (ej. LMO-00084, 074673, AB-074673)
        const folioMatch = normalized.match(/(?:N[°O]\.?\s*(?:ORDEN\s+DE\s+PAGO|FOLIO(?:\s+DE\s+PAGO)?|RECIBO)|ORDEN\s+DE\s+PAGO|FOLIO\s*(?:DE\s+PAGO)?|RECIBO\s*N[°O]\.?)[\s:#-]*([A-Z0-9][A-Z0-9-]{3,18})\b/i)
            || plain.match(/(?:LMO|AB|LN|CIS)[-\s]?\d{4,8}\b/i);
        if (folioMatch) {
            const rawFolio = folioMatch[1] || folioMatch[0];
            if (!/INTERBANCARIO|FECHA|HORA|PAGO/i.test(rawFolio)) {
                result.folioRecibo = cleanOcrValue(rawFolio);
            }
        }

        // 3. RFC del Solicitante (Diferenciarlo del RFC de COEPRISS CEP130206LC4)
        const rfcPattern = '[A-Z&Ñ]{3,4}\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])[A-Z0-9]{2}[0-9A]';
        const rfcsFound = [...plain.matchAll(new RegExp(`\\b(${rfcPattern})\\b`, 'gi'))].map(m => m[1].toUpperCase());
        const clientRfc = rfcsFound.find(r => r !== 'CEP130206LC4');
        if (clientRfc) {
            result.rfc = clientRfc;
            result.rfcSolicitante = clientRfc;
        }

        // 4. Nombre o Razón Social
        const razonMatch = normalized.match(/(?:NOMBRE\s+O\s+RAZ[O0Ó]N\s+SOCIAL|CONTRIBUYENTE|SOLICITANTE)[\s:#-]*([^\n\r]{3,120}?)(?=\s*(?:S[IÍ]RVASE|DOMICILIO|CONCEPTO|TRAMITE|CLAVE|RFC|N[°O]|TELEFONO|FECHA|$))/i);
        if (razonMatch) {
            const cleanedRazon = cleanOcrValue(razonMatch[1]).replace(/^[:\-\s]+/, '');
            if (cleanedRazon.length >= 3 && !/^(RFC|CONCEPTO|DOMICILIO)/i.test(cleanedRazon)) {
                result.razonSocial = cleanedRazon;
            }
        }

        // 5. Concepto o Trámite
        const conceptoMatch = normalized.match(/(?:TR[AÁ]MITE\(S\)\s+A\s+PAGAR|POR\s+CONCEPTO\s+A\s+PAGAR|POR\s+CONCEPTO\s+DE|CONCEPTO|SERVICIO)[\s:#-]*([^\n\r]{6,240}?)(?=\s*(?:[•\*\-]|\bN[°O]\s+TR[AÁ]MITES\b|\bCUOTA\b|\bIMPORTE\b|\bTOTAL\b|\bMONTO\s+A\s+PAGAR\b|\bCANTIDAD\b|\bVALOR\b|\bSELLO\b|\bFIRMA\b|\bLA\s+PRESENTE\b|$))/i)
            || normalized.match(/(\d+[-.]\d+[-.]\s*[^\n\r]{8,200}?)(?=\s*(?:[•\*\-]|\bN[°O]\s+TR[AÁ]MITES\b|\bCUOTA\b|\bIMPORTE\b|\bTOTAL\b|\$|\bSELLO\b|$))/i);
        if (conceptoMatch) {
            result.concepto = cleanOcrValue(conceptoMatch[1] || conceptoMatch[0]);
        }

        // 6. Importe ($1,408.00)
        const importeMatch = normalized.match(/(?:MONTO\s+A\s+PAGAR|IMPORTE(?:\s+TOTAL)?|TOTAL(?:\s+M\.N\.)?|PRECIO\s+A\s+PAGAR|CUOTA)[\s:#-]*\$?\s*([\d,]+\.\d{2})\b/i)
            || normalized.match(/\$\s*([\d,]+\.\d{2})\b/);
        if (importeMatch) {
            const val = parseFloat(importeMatch[1].replace(/,/g, ''));
            if (Number.isFinite(val) && val > 0) result.importe = val;
        }

        // 7. Fecha de Expedición y Fecha Sello
        const fechaExpMatch = normalized.match(/(?:FECHA\s+(?:DE\s+)?EXPEDICI[OÓ0]N|EXPEDICI[OÓ0]N)[\s:#-]*(\d{1,2}[/-]\d{1,2}[/-]\d{4})/i);
        if (fechaExpMatch) result.fechaExpedicion = normalizeOcrDate(fechaExpMatch[1]);

        // Sello RECIBIDO date (e.g. 13 AGO 2026)
        const monthMap = { ene:'01', feb:'02', mar:'03', abr:'04', may:'05', jun:'06', jul:'07', ago:'08', sep:'09', oct:'10', nov:'11', dic:'12' };
        const selloMatch = normalized.match(/\b(\d{1,2})\s+(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC)\w*\s+(\d{4})\b[\s\S]{0,30}?(?:RECIBIDO)?/i)
            || normalized.match(/(?:RECIBIDO|FECHA)[\s\S]{0,30}?\b(\d{1,2})\s+(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC)\w*\s+(\d{4})\b/i);
        if (selloMatch) {
            const mNum = monthMap[selloMatch[2].toLowerCase().slice(0, 3)] || '01';
            result.fechaRecepcion = `${selloMatch[1].padStart(2, '0')}/${mNum}/${selloMatch[3]}`;
        }
        result.fechaPago = result.fechaRecepcion || result.fechaExpedicion || '';
        result.fechaRecibo = result.fechaExpedicion || result.fechaRecepcion || '';

        return result;
    }

    // ─────────────────────────────────────────────
    // 5. EXTRACTOR PRINCIPAL ROBUSTO
    // ─────────────────────────────────────────────

    function extractOcrLabelValue(source, startLabel, stopLabels, maxLength = 120) {
        if (!source || !startLabel) return '';
        const pattern = new RegExp(`(?:${startLabel})[\\s:#-]*([^\\n\\r]{1,${maxLength}}?)(?=\\s*(?:${stopLabels})|[\\n\\r]{2,}|$)`, 'i');
        const match = source.match(pattern);
        if (!match) return '';
        return cleanOcrValue(match[1]).replace(/^[:\-\s]+/, '');
    }

    function parseExtractedFields(text, sourceFileName = '') {
        const normalized = String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
        const plain = stripOcrAccents(normalized).toUpperCase();
        const docType = classifyDocumentText(plain);

        // Si es un Recibo CIS oficial de COEPRISS, usar su parser especializado de alta precisión
        if (docType === 'RECIBO_CIS') {
            const cisData = parseCisCoeprissReceipt(text, normalized, plain);
            if (cisData.rfc || cisData.folioRecibo || cisData.importe) {
                return {
                    ...cisData,
                    confidence: {
                        rfc: cisData.rfc ? 0.95 : 0,
                        razonSocial: cisData.razonSocial ? 0.90 : 0,
                        folioRecibo: cisData.folioRecibo ? 0.95 : 0,
                        concepto: cisData.concepto ? 0.92 : 0,
                        importe: cisData.importe ? 0.98 : 0,
                        fechaPago: cisData.fechaExpedicion ? 0.90 : 0
                    }
                };
            }
        }

        const rfcPattern = '[A-Z&Ñ]{3,4}\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])[A-Z0-9]{2}[0-9A]';
        const rfcEmisorMatch = plain.match(new RegExp(`(?:RFC\\s+(?:DEL\\s+)?(?:EMISOR|ORDENANTE|PAGADOR)|EMISOR)[^A-Z0-9]{0,30}(${rfcPattern})`, 'i'));
        const rfcReceptorMatch = plain.match(new RegExp(`(?:RFC\\s+(?:DEL\\s+)?(?:RECEPTOR|BENEFICIARIO|DESTINO|CLIENTE)|RECEPTOR|CLIENTE)[^A-Z0-9]{0,30}(${rfcPattern})`, 'i'));
        const genericRfcMatch = plain.match(new RegExp(`(?:RFC|CURP)[^A-Z0-9]{0,30}(${rfcPattern})`, 'i'))
            || plain.match(new RegExp(`\\b(${rfcPattern})\\b`, 'i'));

        const stopLabels = 'RFC|NOMBRE|CODIGO\\s+POSTAL|C\\.?P\\.?|REGIMEN|USO\\s+CFDI|FOLIO|EFECTO|CONCEPTOS|DESCRIPCION|MONEDA|FORMA\\s+DE\\s+PAGO|METODO\\s+DE\\s+PAGO|SUBTOTAL|TOTAL|SELLO';
        const bankStopLabels = 'INSTITUCION|BANCO|CODIGO|CLAVE|CUENTA|CLABE|MONTO|IMPORTE|REFERENCIA|FECHA|TOTAL|FOLIO|HORA';

        // 1. Razón Social y Nombre
        // SAT Constancia: Denominación/Razón Social: EDUCACION INTEGRAL AS
        let razonSocial = '';
        const satDenomMatch = plain.match(/(?:DENOMINACI[OÓ0]N\s*\/?\s*RAZ[OÓ0]N\s+SOCIAL|DENOMINACI[OÓ0]N\s+O\s+RAZ[OÓ0]N\s+SOCIAL)[\s:#-]*([^\n\r]{3,120}?)(?=\s*(?:R[EÉ]GIMEN\s+CAPITAL|NOMBRE\s+COMERCIAL|FECHA|$))/i);
        const satRegimenCapitalMatch = plain.match(/R[EÉ]GIMEN\s+CAPITAL[\s:#-]*([^\n\r]{3,60}?)(?=\s*(?:NOMBRE\s+COMERCIAL|FECHA|$))/i);

        if (satDenomMatch) {
            const baseName = cleanOcrValue(satDenomMatch[1]);
            const capital = satRegimenCapitalMatch ? cleanOcrValue(satRegimenCapitalMatch[1]) : '';
            if (capital && !baseName.toUpperCase().includes(capital.toUpperCase())) {
                razonSocial = `${baseName} ${capital}`.trim();
            } else {
                razonSocial = baseName;
            }
        }

        if (!razonSocial) {
            const receiverNameRaw = extractOcrLabelValue(plain, '(?:NOMBRE\\s*,?\\s*DENOMINACION\\s+O\\s+RAZON\\s+SOCIAL|RAZON\\s+SOCIAL|NOMBRE\\s+(?:DEL?\\s+)?(?:RECEPTOR|BENEFICIARIO|DESTINO|CLIENTE|CONTRIBUYENTE)|CONTRIBUYENTE|CLIENTE)', stopLabels, 140);
            razonSocial = cleanOcrValue(receiverNameRaw.replace(/\s+REGIM(?:E|EN|EN\s+FISCAL)?[\s\S]*$/i, ''));
        }

        // SAT Constancia Personas Físicas
        const satPrimerApellido = extractOcrLabelValue(plain, 'PRIMER\\s+APELLIDO', 'SEGUNDO\\s+APELLIDO|NOMBRE|RFC|CURP', 50);
        const satSegundoApellido = extractOcrLabelValue(plain, 'SEGUNDO\\s+APELLIDO', 'NOMBRE\\(S\\)|NOMBRE|RFC|CURP', 50);
        const satNombres = extractOcrLabelValue(plain, 'NOMBRE\\(S\\)|NOMBRES?', 'PRIMER\\s+APELLIDO|SEGUNDO\\s+APELLIDO|RFC|CURP|FECHA', 70);
        if (satNombres && satPrimerApellido) {
            razonSocial = [satNombres, satPrimerApellido, satSegundoApellido].filter(Boolean).join(' ');
        }

        // 2. Correo Electrónico (Con filtro estricto anti-SAT/Gobierno)
        let correoExtraido = '';
        const labeledEmailMatch = normalized.match(/(?:CORREO(?:\s+ELECTR[OÓ0]NICO)?(?:\s+REGISTRADO)?|E-?MAIL)[\s:#-]*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/i);
        if (labeledEmailMatch) {
            const em = labeledEmailMatch[1].toLowerCase();
            if (!/@sat\.gob\.mx|@shcp\.gob\.mx|@gob\.mx|denuncias@|quejas@/i.test(em)) {
                correoExtraido = em;
            }
        }
        if (!correoExtraido) {
            const allEmails = [...normalized.matchAll(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g)].map(m => m[1].toLowerCase());
            const clientEmail = allEmails.find(em => !/@sat\.gob\.mx|@shcp\.gob\.mx|@gob\.mx|denuncias@|quejas@|atencionalcontribuyente@/i.test(em));
            if (clientEmail) correoExtraido = clientEmail;
        }

        // 3. Código Postal
        const cpMatch = plain.match(/(?:CODIGO\s+POSTAL|C\.?P\.?|LUGAR\s+DE\s+EXPEDICION)[^0-9]{0,30}(\d{5})\b/i);
        const codigoPostal = cpMatch ? cpMatch[1] : '';

        // 4. Régimen Fiscal (Ignorando explícitamente "Régimen Capital")
        let regimenFiscal = '';
        const satRegimenTableMatch = plain.match(/REGIMENES\s*:\s*(?:REGIMEN\s+FECHA\s+INICIO\s+FECHA\s+FIN\s*)?([^\n\r0-9]{3,80})/i);
        if (satRegimenTableMatch && !/CAPITAL/i.test(satRegimenTableMatch[1])) {
            regimenFiscal = normalizeSatRegimen(satRegimenTableMatch[1]) || cleanOcrValue(satRegimenTableMatch[1]);
        }

        if (!regimenFiscal) {
            const regFiscalMatch = plain.match(/(?:REGIMEN(?:ES)?\s+FISCAL(?:ES)?|REGIMEN\s+FISCAL\s+RECEPTOR|REGIMEN\s+RECEPTOR)[^A-Z0-9]{0,30}([^\n\r]{3,80}?)(?=\s*(?:USO\s+CFDI|CODIGO|FOLIO|EXPORTACION|$))/i);
            if (regFiscalMatch && !/CAPITAL/i.test(regFiscalMatch[1])) {
                regimenFiscal = normalizeSatRegimen(regFiscalMatch[1]) || cleanOcrValue(regFiscalMatch[1]);
            }
        }

        // 5. Uso CFDI
        const usoCfdiMatch = plain.match(/(?:USO\s+CFDI|USO\s+DEL\s+CFDI)[^A-Z0-9]{0,20}([A-Z0-9\s-]{3,50}?)(?=\s*(?:FORMA|METODO|MONEDA|SUBTOTAL|TOTAL|$))/i);
        const usoCfdi = usoCfdiMatch ? (normalizeSatUsoCfdi(usoCfdiMatch[1]) || cleanOcrValue(usoCfdiMatch[1])) : '';

        // 6. Folio Fiscal UUID
        const uuidMatch = plain.match(/FOLIO\s+FISCAL\s*[:\-]?\s*([0-9A-Z]{8}(?:-[0-9A-Z]{4}){3}-[0-9A-Z]{12})/i)
            || plain.match(/(?:[?&]ID=|UUID\s*[:=])([0-9A-Z]{8}(?:-[0-9A-Z]{4}){3}-[0-9A-Z]{12})/i);
        const fiscalUuid = uuidMatch ? normalizeOcrUuid(uuidMatch[1]) : '';

        // 7. Bancos y Comprobantes de Pago
        const bankNames = [
            'BBVA', 'SANTANDER', 'BANAMEX', 'CITIBANAMEX', 'HSBC', 'BANORTE', 'SCOTIABANK',
            'BANCO DEL BIENESTAR', 'AZTECA', 'BANCOPPEL', 'STP', 'MERCADOPAGO', 'MERCADO PAGO',
            'NUBANK', 'NU MEXICO', 'BANREGIO', 'INBURSA', 'AFIRME', 'COMPARTAMOS',
            'BANJERCITO', 'CI BANCO', 'PAYPAL', 'BANCA MIFEL', 'MIFEL', 'BANSI', 'MULTIVA',
            'ACTINVER', 'HEY BANCO', 'ALBO', 'KLAR', 'STORI', 'CUENCA', 'RAPPIBANK',
            'SPIN BY OXXO', 'SPIN', 'CONEKTA', 'STRIPE', 'CLIP', 'BROXEL'
        ];
        const bank = bankNames.find(name => plain.includes(name)) || '';

        // Clave de Rastreo SPEI
        const trackingMatch = normalized.match(/(?:CLAVE\s+DE\s+RASTREO|RASTREO)[\s:#-]*([A-Z0-9]{10,35})\b/i);
        const claveRastreo = trackingMatch ? cleanOcrValue(trackingMatch[1]) : '';

        // Referencia bancaria
        let referencia = '';
        const refMatch = normalized.match(/(?:NUMERO\s+DE\s+REFERENCIA|NO\.?\s+REFERENCIA|REFERENCIA|REF\.?)[\s:#-]*([A-Z0-9]{3,25})\b/i);
        if (refMatch) {
            const rawRef = refMatch[1];
            if (!/HORA|FECHA|CANAL|INTERBANCARIO|SUCURSAL|OPERACION|CAPTURA/i.test(rawRef)) {
                referencia = cleanOcrValue(rawRef);
            }
        }
        if (!referencia && docType === 'COMPROBANTE_BANCARIO') {
            const altRefMatch = normalized.match(/(?:FOLIO\s+INTERBANCARIO|FOLIO\s+DE\s+FIRMA|FOLIO\s+[UÚ]NICO|CONCEPTO\s+DE\s+PAGO)[\s:#-]*([A-Z0-9]{4,30})/i);
            if (altRefMatch) referencia = cleanOcrValue(altRefMatch[1]);
        }

        // Fecha de Pago en comprobante bancario
        let fechaPago = '';
        if (docType === 'COMPROBANTE_BANCARIO' || docType === 'RECIBO_CIS') {
            const fechaBancoMatch = normalized.match(/(?:FECHA\s+DE\s+(?:APLICACI[OÓ0]N|CREACI[OÓ0]N|OPERACI[OÓ0]N|PAGO)|FECHA\s+Y\s+HORA|FECHA)[\s:#-]*(\d{1,2}[/-]\d{1,2}[/-]\d{4})/i);
            if (fechaBancoMatch) fechaPago = normalizeOcrDate(fechaBancoMatch[1]);
        }

        // Cuenta o CLABE
        const accountMatch = normalized.match(/(?:CUENTA\s+DE\s+DEP[OÓ0]SITO|CUENTA\s+BENEFICIARIA|CLABE|CUENTA\s+DESTINO)[\s:#-]*(\d{10,18})\b/i);
        const cuentaBeneficiaria = accountMatch ? accountMatch[1] : '';

        // 8. Importes
        const totalMatch = plain.match(/\bTOTAL(?:\s+A\s+PAGAR)?\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i)
            || normalized.match(/(?:IMPORTE(?:\s+(?:TOTAL|PAGADO))?|TOTAL)[\s:#-]*\$?\s*([\d,]+\.\d{2})\b/i);
        const importe = totalMatch ? parseFloat(totalMatch[1].replace(/,/g, '')) : null;

        // 9. Concepto
        const conceptLabel = extractOcrLabelValue(plain, 'DESCRIPCION|CONCEPTO|POR\\s+CONCEPTO\\s+DE', 'FORMA|METODO|SUBTOTAL|TOTAL|SELLO', 180);
        const concepto = normalizeOcrConcept(conceptLabel);

        // 10. Forma y Método de Pago
        const formaPagoRaw = extractOcrLabelValue(plain, 'FORMA\\s+DE\\s+PAGO', 'METODO|MONEDA|SUBTOTAL|TOTAL', 80);
        const formaPago = normalizeSatFormaPago(formaPagoRaw) || (docType === 'COMPROBANTE_BANCARIO' ? '03' : '');
        
        const metodoPagoRaw = extractOcrLabelValue(plain, 'METODO\\s+DE\\s+PAGO', 'SELLO|SUBTOTAL|TOTAL', 50);
        const metodoPago = normalizeSatMetodoPago(metodoPagoRaw) || 'PUE';

        const rfc = normalizeOcrRfc((rfcReceptorMatch || genericRfcMatch)?.[1] || '');

        return {
            docType,
            rfc,
            rfcEmisor: normalizeOcrRfc(rfcEmisorMatch?.[1] || ''),
            rfcReceptor: rfc,
            razonSocial,
            regimenFiscal,
            codigoPostal,
            usoCfdi,
            uuid: fiscalUuid,
            correo: correoExtraido,
            banco: bank,
            importe,
            referencia,
            claveRastreo,
            cuentaBeneficiaria,
            concepto,
            fechaPago,
            formaPago,
            metodoPago,
            confidence: {
                rfc: rfc ? 0.95 : 0,
                razonSocial: razonSocial ? 0.90 : 0,
                regimenFiscal: regimenFiscal ? 0.85 : 0,
                codigoPostal: codigoPostal ? 0.95 : 0,
                importe: importe ? 0.95 : 0
            }
        };
    }

    // ─────────────────────────────────────────────
    // 6. FUSIÓN INTELIGENTE CON PRIORIDAD DOCUMENTAL
    // ─────────────────────────────────────────────

    function mergeExtractedFieldSets(fieldSets) {
        if (!Array.isArray(fieldSets) || fieldSets.length === 0) return {};
        if (fieldSets.length === 1) return fieldSets[0];

        const merged = {};
        const evidence = {};
        const conflicts = {};

        // Document Priority weights
        const getPriority = (fs, field) => {
            const dt = fs.docType || 'GENERICO';
            if (field === 'rfc' || field === 'rfcReceptor') {
                if (dt === 'CONSTANCIA_SAT') return 100;
                if (dt === 'RECIBO_CIS') return 80;
                if (dt === 'CFDI_FACTURA') return 70;
                return 40;
            }
            if (field === 'razonSocial') {
                if (dt === 'CONSTANCIA_SAT') return 100;
                if (dt === 'RECIBO_CIS') return 85;
                return 40;
            }
            if (field === 'regimenFiscal' || field === 'codigoPostal') {
                if (dt === 'CONSTANCIA_SAT') return 100;
                if (dt === 'CFDI_FACTURA') return 80;
                return 30;
            }
            if (field === 'folioRecibo' || field === 'concepto') {
                if (dt === 'RECIBO_CIS') return 100;
                return 40;
            }
            if (field === 'importe') {
                if (dt === 'RECIBO_CIS') return 100;
                if (dt === 'COMPROBANTE_BANCARIO') return 90;
                return 50;
            }
            if (field === 'claveRastreo' || field === 'referencia' || field === 'banco' || field === 'cuentaBeneficiaria') {
                if (dt === 'COMPROBANTE_BANCARIO') return 100;
                return 40;
            }
            if (field === 'uuid') {
                if (dt === 'CFDI_FACTURA') return 100;
                return 50;
            }
            return 50;
        };

        const allKeys = new Set();
        fieldSets.forEach(fs => Object.keys(fs).forEach(k => {
            if (!k.startsWith('_') && k !== 'confidence' && k !== 'docType') allKeys.add(k);
        }));

        allKeys.forEach(field => {
            const validCandidates = fieldSets
                .map(fs => ({
                    val: fs[field],
                    priority: getPriority(fs, field),
                    source: fs._source || fs.sourceFile || fs.docType || 'Archivo',
                    docType: fs.docType
                }))
                .filter(c => c.val !== null && c.val !== undefined && c.val !== '');

            if (validCandidates.length === 0) return;

            // Sort by document priority descending
            validCandidates.sort((a, b) => b.priority - a.priority);
            merged[field] = validCandidates[0].val;
            evidence[field] = validCandidates[0];

            // Detect conflicts
            const distinctValues = [...new Set(validCandidates.map(c => String(c.val).toUpperCase().trim()))];
            if (distinctValues.length > 1 && (field === 'rfc' || field === 'razonSocial' || field === 'importe')) {
                conflicts[field] = validCandidates;
            }
        });

        // Smart defaults and cross-field fallbacks
        if (!merged.usoCfdi) {
            merged.usoCfdi = 'G03'; // Gastos en general standard for COEPRISS sanitary procedures
        }
        if (!merged.fechaPago) {
            merged.fechaPago = merged.fechaRecepcion || merged.fechaExpedicion || merged.fechaEmision || '';
        }
        if (!merged.referencia && merged.folioRecibo) {
            merged.referencia = merged.folioRecibo;
        }

        merged._evidence = evidence;
        merged._conflicts = conflicts;
        return merged;
    }

    function getRegimenLabel(code) {
        const map = {
            '601': 'General de Ley Personas Morales',
            '602': 'Régimen Simplificado de Ley Personas Morales',
            '603': 'Personas Morales con Fines no Lucrativos',
            '604': 'Régimen de Pequeños Contribuyentes',
            '605': 'Sueldos y Salarios e Ingresos Asimilados a Salarios',
            '606': 'Arrendamiento',
            '607': 'Régimen de Enajenación o Adquisición de Bienes',
            '608': 'Régimen de los Demás Ingresos',
            '609': 'Régimen de Consolidación',
            '610': 'Residentes en el Extranjero sin Establecimiento Permanente en México',
            '611': 'Ingresos por Dividendos (Socios y Accionistas)',
            '612': 'Personas Físicas con Actividades Empresariales y Profesionales',
            '613': 'Régimen Intermedio de las Personas Físicas con Actividades Empresariales',
            '614': 'Régimen de los Ingresos por Intereses',
            '615': 'Régimen de los Ingresos por Obtención de Premios',
            '616': 'Sin Obligaciones Fiscales',
            '617': 'PEMEX',
            '618': 'Régimen Simplificado de Ley Personas Físicas',
            '619': 'Ingresos por la Obtención de Préstamos',
            '620': 'Sociedades Cooperativas de Producción que Optan por Diferir sus Ingresos',
            '621': 'Incorporación Fiscal',
            '622': 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras PM',
            '623': 'Régimen Opcional para Grupos de Sociedades',
            '624': 'Régimen de los Coordinados',
            '625': 'Actividades Empresariales con Ingresos a través de Plataformas Tecnológicas',
            '626': 'Régimen Simplificado de Confianza (RESICO)'
        };
        return map[String(code)] || 'General';
    }

    function getUsoCfdiLabel(code) {
        const map = {
            'G01': 'Adquisición de mercancías',
            'G02': 'Devoluciones, descuentos o bonificaciones',
            'G03': 'Gastos en general',
            'I01': 'Construcciones',
            'I02': 'Mobiliario y equipo de oficina',
            'I04': 'Equipo de cómputo y accesorios',
            'I08': 'Otra maquinaria y equipo',
            'D01': 'Honorarios médicos, dentales y gastos hospitalarios',
            'D02': 'Gastos médicos por incapacidad o discapacidad',
            'D04': 'Donativos',
            'S01': 'Sin efectos fiscales',
            'CP01': 'Pagos'
        };
        return map[String(code)] || 'Gastos en general';
    }

    // Export module for browser & Node.js environments
    const OcrCore = {
        stripOcrAccents,
        cleanOcrValue,
        normalizeOcrRfc,
        normalizeOcrUuid,
        normalizeOcrDate,
        normalizeOcrConcept,
        normalizeSatRegimen,
        normalizeSatUsoCfdi,
        normalizeSatFormaPago,
        normalizeSatMetodoPago,
        getRegimenLabel,
        getUsoCfdiLabel,
        classifyDocumentText,
        parseCisCoeprissReceipt,
        parseExtractedFields,
        mergeExtractedFieldSets
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = OcrCore;
    }
    if (typeof window !== 'undefined') {
        window.OcrCore = OcrCore;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
