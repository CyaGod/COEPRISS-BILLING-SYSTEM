// COEPRISS Sinaloa - Billing & Stamping System Controller

// Application State
const state = {
    // Current Wizard Active Dossier (loaded from presets or created from scratch)
    activeExpediente: null,
    
    // Logged-in Employee Session Profiles
    currentUser: {
        id: 'brenda',
        name: 'Brenda González',
        role: 'Administrador de Facturación',
        avatar: 'BG'
    },

    // CSD Certificate State
    csd: {
        uploaded: true,
        certName: 'CSD_COEPRISS_2026.cer',
        keyName: 'CSD_COEPRISS_2026.key',
        expiry: '2028-09-12',
        password: ''
    },

    // In Process Dossiers (Expedientes) Mock Database
    expedientes: [
        {
            folio: 'REC-000245',
            cliente: 'Empresa Ejemplo, S.A. de C.V.',
            rfc: 'EEM010101XXX',
            regimenFiscal: '601 - General de Ley Personas Morales',
            codigoPostal: '80000',
            usoCfdi: 'G03 - Gastos en general',
            correo: 'facturacion@empresaejemplo.com',
            importe: 1160.00,
            fechaRecibo: '16/07/2026 10:22 a.m.',
            banco: 'BBVA México',
            fechaPago: '16/07/2026 09:15 a.m.',
            referencia: 'TRASPASO 2456',
            estatus: 'Recibido', // Recibido | Pago pendiente | Pago validado | Autorizado | Timbrado | Entregado
            tipoCfdi: 'ingreso',
            uuid: '',
            archivos: [
                { name: 'SAT_CSF_EEM01.pdf', type: 'Constancia de situación fiscal', status: 'Listo para escanear' },
                { name: 'RECIBO_CIS_245.pdf', type: 'Recibo del CIS', status: 'Listo para escanear' },
                { name: 'TRANSFERENCIA_BBVA_2456.jpg', type: 'Transferencia bancaria', status: 'Listo para escanear' }
            ],
            auditoria: [
                '[16/07/2026 10:22 a.m.] Trámite recibido. Creado por Brenda González.'
            ]
        },
        {
            folio: 'REC-000246',
            cliente: 'Sistemas Sinaloa, S.A. de C.V.',
            rfc: 'SPS090909AAA',
            regimenFiscal: '601 - General de Ley Personas Morales',
            codigoPostal: '81000',
            usoCfdi: 'G03 - Gastos en general',
            correo: 'proveedor@sistemasinaloa.mx',
            importe: 3450.00,
            fechaRecibo: '16/07/2026 05:40 p.m.',
            banco: 'Santander',
            fechaPago: '16/07/2026 11:20 a.m.',
            referencia: 'REF-9908',
            estatus: 'Pago pendiente',
            tipoCfdi: 'ingreso',
            uuid: '',
            archivos: [
                { name: 'SAT_CSF_SPS09.pdf', type: 'Constancia de situación fiscal', status: 'Listo para escanear' },
                { name: 'RECIBO_CIS_246.pdf', type: 'Recibo del CIS', status: 'Listo para escanear' },
                { name: 'DEPOSITO_SANTANDER.png', type: 'Transferencia bancaria', status: 'Listo para escanear' }
            ],
            auditoria: [
                '[16/07/2026 05:40 p.m.] Trámite recibido. Creado por Brenda González.'
            ]
        },
        {
            folio: 'REC-000247',
            cliente: 'Gas Sinaloa, S.A.',
            rfc: 'GSI121212BBB',
            regimenFiscal: '601 - General de Ley Personas Morales',
            codigoPostal: '80100',
            usoCfdi: 'G03 - Gastos en general',
            correo: 'contacto@gassinaloa.com',
            importe: 7800.00,
            fechaRecibo: '17/07/2026 09:05 a.m.',
            banco: 'Banamex',
            fechaPago: '17/07/2026 01:10 p.m.',
            referencia: 'REF-5431',
            estatus: 'Pago validado',
            tipoCfdi: 'ingreso',
            uuid: '',
            archivos: [
                { name: 'SAT_CSF_GSI12.pdf', type: 'Constancia de situación fiscal', status: 'Leído correctamente (OCR)' },
                { name: 'RECIBO_CIS_247.pdf', type: 'Recibo del CIS', status: 'Leído correctamente (OCR)' },
                { name: 'COMPROBANTE_BANAMEX.pdf', type: 'Transferencia bancaria', status: 'Leído correctamente (OCR)' }
            ],
            auditoria: [
                '[17/07/2026 09:05 a.m.] Trámite recibido. Creado por Brenda González.',
                '[17/07/2026 10:15 a.m.] Pago validado mediante API bancaria (Banamex). Estatus: Pago Validado.'
            ]
        }
    ],

    // Stamped Invoices Database
    facturas: [
        {
            folioInterno: 'F-00045',
            folioRecibo: 'REC-000245',
            cliente: 'Empresa Ejemplo, S.A. de C.V.',
            fecha: '16/07/2026 10:22 a.m.',
            importe: 1160.00,
            estatus: 'Timbrada',
            uuid: 'BAB3F6E2-4D78-4C1A-B06D-D7ABBD2F123'
        },
        {
            folioInterno: 'F-00044',
            folioRecibo: 'REC-000244',
            cliente: 'Juan Pérez López',
            fecha: '16/07/2026 10:10 a.m.',
            importe: 850.00,
            estatus: 'Timbrada',
            uuid: 'A1B2C3D4-E5F6-7A8B-9C0D-1E2F3A4B5C6D'
        },
        {
            folioInterno: 'F-00043',
            folioRecibo: 'REC-000243',
            cliente: 'Comercial del Norte, S.A. de C.V.',
            fecha: '16/07/2026 09:05 a.m.',
            importe: 1450.00,
            estatus: 'Timbrada',
            uuid: 'F1E2D3C4-B5A6-9F8E-7D6C-5B4A3F2E1D0C'
        },
        {
            folioInterno: 'F-00042',
            folioRecibo: 'REC-000242',
            cliente: 'María García Sánchez',
            fecha: '15/07/2026 04:35 p.m.',
            importe: 550.00,
            estatus: 'Timbrada',
            uuid: 'C3D4E5F6-A7B8-9C0D-1E2F-3A4B5C6D7E8F'
        }
    ],

    // Sent Emails Log Database
    historialCorreos: [
        {
            fecha: '16/07/2026 12:16 p.m.',
            destinatario: 'facturacion@empresaejemplo.com',
            folio: 'F-00045',
            adjuntos: 'FACTURA_REC000245.pdf, .xml',
            estatus: 'Entregado'
        }
    ],

    // Security & Audit Log
    bitacoraSeguridad: [
        {
            fecha: '20/07/2026 09:30 a.m.',
            usuario: 'Brenda González',
            accion: 'Inicio de sesión',
            detalles: 'Sesión iniciada con éxito en Culiacán, Sin.'
        },
        {
            fecha: '20/07/2026 09:32 a.m.',
            usuario: 'Brenda González',
            accion: 'Acceso a CSD',
            detalles: 'Verificación de vigencia de sello CSD_COEPRISS_2026.'
        }
    ],

    currentStep: 1,
    xmlUploaded: false,
    pdfUploaded: false,

    // Archivos reales seleccionados en el navegador. Se mantienen solo durante
    // la sesiÃ³n para no enviar documentos fiscales a un servicio externo.
    uploadedFiles: [],
    ocrWorker: null,
    ocrBusy: false
};

// Never present seed/demo data as production records.
Object.assign(state.currentUser, {
    id: '',
    name: 'Sin sesiÃ³n',
    role: 'AutenticaciÃ³n no configurada',
    avatar: '--'
});
state.csd = { uploaded: false, certName: '', keyName: '', expiry: '', password: '' };
state.expedientes = [];
state.facturas = [];
state.historialCorreos = [];
state.bitacoraSeguridad = [];

function sanitizeUnconfiguredUi() {
    const unavailablePanels = {
        'step-panel-4': 'Timbrado PAC no configurado. No se generaran XML, UUID ni CFDI fiscales desde este navegador.',
        'step-panel-5': 'Carga de comprobantes timbrados pendiente de configurar. No hay archivos fiscales disponibles.',
        'step-panel-6': 'No existe una factura timbrada real para mostrar.',
        'step-panel-7': 'No hay facturas persistentes. Conecte la base de datos antes de mostrar reportes.'
    };

    Object.entries(unavailablePanels).forEach(([id, message]) => {
        const panel = document.getElementById(id);
        if (!panel) return;
        panel.innerHTML = `<div class="app-card" style="margin-top: 20px; border-left: 4px solid var(--warning-color);"><h2 class="panel-title">Servicio no configurado</h2><p style="color: #6c757d; margin-top: 8px;">${message}</p></div>`;
    });

    [4, 5, 6, 7].forEach(step => {
        const node = document.querySelector(`.step-node[data-step="${step}"]`);
        if (node) {
            node.style.opacity = '0.45';
            node.style.pointerEvents = 'none';
            node.setAttribute('aria-disabled', 'true');
        }
    });

    const apiButton = document.getElementById('btn-api-banco');
    if (apiButton) {
        apiButton.disabled = false;
        apiButton.textContent = 'Consultar en Banxico CEP';
        apiButton.title = 'Abrir la consulta oficial del CEP de Banco de México';
    }
    const manualButton = document.getElementById('btn-manual-banco');
    if (manualButton) {
        manualButton.disabled = true;
        manualButton.textContent = 'Validacion externa pendiente';
    }

    const stampButton = document.getElementById('btn-pac-stamp');
    if (stampButton) {
        stampButton.disabled = true;
        stampButton.textContent = 'Timbrado PAC no configurado';
    }
    const csdPassword = document.getElementById('pac-csd-password');
    if (csdPassword) {
        csdPassword.value = '';
        csdPassword.disabled = true;
    }
    const csdStatus = document.getElementById('csd-status');
    if (csdStatus) {
        csdStatus.textContent = 'CSD no configurado. Las llaves privadas no se guardan en el navegador.';
        csdStatus.style.color = 'var(--warning-color)';
    }
    const pacCsdStatus = document.getElementById('lbl-pac-csd-status');
    if (pacCsdStatus) {
        pacCsdStatus.textContent = 'CSD no configurado';
        pacCsdStatus.style.color = 'var(--warning-color)';
    }

    const roleSelect = document.getElementById('select-user-role');
    if (roleSelect) roleSelect.disabled = true;
    document.querySelectorAll('button[onclick^="loadPresetDossier"]').forEach(button => button.remove());
    document.querySelectorAll('h3').forEach(title => {
        if (title.textContent.toLowerCase().includes('presets')) title.remove();
        if (title.textContent.toLowerCase().includes('simulaci')) title.textContent = 'Autenticacion no configurada';
    });

    const activityTitle = Array.from(document.querySelectorAll('h3')).find(title => title.textContent.includes('Actividad Reciente'));
    const activityList = activityTitle?.parentElement.querySelector('ul');
    if (activityList) activityList.innerHTML = '<li style="color: #6c757d;">Sin actividad persistente registrada.</li>';

    ['dash-timbradas-count', 'dash-proc-count', 'dash-correos-count'].forEach(id => {
        const counter = document.getElementById(id);
        const card = counter?.closest('.app-card');
        const caption = card?.querySelectorAll('span')[1];
        if (caption) caption.textContent = 'Sin datos persistentes';
    });

    const avatar = document.querySelector('.user-avatar-gold');
    const userName = document.querySelector('.user-name-top');
    const userRole = document.querySelector('.user-role-top');
    if (avatar) avatar.textContent = '--';
    if (userName) userName.textContent = 'Sin sesion';
    if (userRole) userRole.textContent = 'Autenticacion no configurada';
}

// Document Log Init
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initDragAndDrop();
    initDocumentPicker();
    
    // Render dynamic data in tables
    renderProcesoTable();
    renderCorreosTable();
    renderClientesTable();
    renderBitacoraTable();
    renderReportTable();
    updateDashboardCounts();
    sanitizeUnconfiguredUi();
    
    // Start at Dashboard
    goToPanel('panel-inicio');
});

// 1. Navigation & Panel Control
function initNavigation() {
    // Header Stepper Node Click
    const stepNodes = document.querySelectorAll('.step-node');
    stepNodes.forEach(node => {
        node.addEventListener('click', () => {
            const step = parseInt(node.getAttribute('data-step'));
            // If active dossier is loaded, allow navigation; otherwise warn
            if (state.activeExpediente) {
                goToStep(step);
            } else {
                showToast('Selecciona un preset de demostración para iniciar el expediente del trámite.', 'warning');
            }
        });
    });

    // Sidebar navigation interactive highlights
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(i => i.classList.remove('active', 'active-pulse'));
            
            const id = item.id;
            if (id === 'nav-inicio') {
                item.classList.add('active');
                goToPanel('panel-inicio');
            } else if (id === 'nav-solicitud') {
                item.classList.add('active-pulse');
                // A new request must start empty. Demo presets remain available
                // only through their explicit preset buttons below the dropzone.
                restartProcess();
            } else if (id === 'nav-proceso') {
                item.classList.add('active');
                renderProcesoTable();
                goToPanel('panel-proceso');
            } else if (id === 'nav-timbradas') {
                item.classList.add('active');
                renderReportTable();
                goToStep(7); // Wizard step 7 represents "Facturas timbradas"
            } else if (id === 'nav-correos') {
                item.classList.add('active');
                renderCorreosTable();
                goToPanel('panel-correos');
            } else if (id === 'nav-reportes') {
                item.classList.add('active');
                renderReportTable();
                goToStep(7); // Wizard step 7 is the general report
            } else if (id === 'nav-clientes') {
                item.classList.add('active');
                renderClientesTable();
                goToPanel('panel-clientes');
            } else if (id === 'nav-config') {
                item.classList.add('active');
                renderBitacoraTable();
                goToPanel('panel-config');
            }
        });
    });
}

// Redirect helpers
function triggerSidebarClick(navId) {
    const navEl = document.getElementById(navId);
    if (navEl) {
        navEl.click();
    }
}

function resumeFlowAtStep(wizardStep, folio) {
    // Find expediente
    const exp = state.expedientes.find(e => e.folio === folio);
    if (exp) {
        state.activeExpediente = exp;
        updatePreviewFields();
        updateStep2Fields();
        renderDocumentList();
        renderTimeline();
    }
    
    showToast(`Reanudando expediente ${folio} en el paso ${wizardStep}...`, 'info');
    
    // Highlight "Nueva solicitud" sidebar link
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active', 'active-pulse'));
    const navSolicitud = document.getElementById('nav-solicitud');
    if (navSolicitud) navSolicitud.classList.add('active-pulse');

    // Enable scan button if resuming
    const btnScan = document.getElementById('btn-scan');
    if (btnScan) btnScan.disabled = false;

    // Check payment validation button toggles
    updatePaymentValidationUI();

    goToStep(wizardStep);
}

function resendEmail(email, folio) {
    showToast('EnvÃ­o de correo no configurado: no se enviÃ³ ningÃºn mensaje.', 'warning');
    return;

    showToast(`Reenviando factura ${folio} a: ${email}...`, 'info');
    setTimeout(() => {
        showToast(`✓ Factura reenviada con éxito a: ${email}`, 'success');
        // Add log
        state.historialCorreos.unshift({
            fecha: getCurrentDateTimeString(),
            destinatario: email,
            folio: folio,
            adjuntos: `FACTURA_${folio.replace('-', '')}.pdf, .xml`,
            estatus: 'Entregado'
        });
        renderCorreosTable();
        updateDashboardCounts();
    }, 1000);
}

// Global panel switching (handles general views and wizard views)
function goToPanel(panelId) {
    // Hide all panels
    const panels = document.querySelectorAll('.step-panel');
    panels.forEach(panel => panel.classList.remove('active'));

    // Show selected panel
    const targetPanel = document.getElementById(panelId);
    if (targetPanel) {
        targetPanel.classList.add('active');
    }

    // Hide wizard stepper header for general panels, show for wizard steps
    const stepperHeader = document.getElementById('wizard-stepper-header');
    if (stepperHeader) {
        if (panelId.startsWith('step-panel-')) {
            stepperHeader.style.display = 'flex';
        } else {
            stepperHeader.style.display = 'none';
        }
    }

    // Update dynamic breadcrumbs
    updateBreadcrumb(panelId);

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateBreadcrumb(panelId) {
    const breadcrumbEl = document.getElementById('dynamic-breadcrumb');
    if (!breadcrumbEl) return;

    let path = 'Inicio';
    if (panelId === 'panel-inicio') {
        path = 'Inicio › <strong>Panel General</strong>';
    } else if (panelId === 'panel-proceso') {
        path = 'Inicio › <strong>En proceso</strong>';
    } else if (panelId === 'panel-correos') {
        path = 'Inicio › <strong>Historial de correos</strong>';
    } else if (panelId === 'panel-clientes') {
        path = 'Inicio › <strong>Clientes</strong>';
    } else if (panelId === 'panel-config') {
        path = 'Inicio › <strong>Configuración</strong>';
    } else if (panelId.startsWith('step-panel-')) {
        const stepNum = panelId.split('-').pop();
        const stepNames = {
            '1': 'Recepción',
            '2': 'Extracción',
            '3': 'Vista previa',
            '4': 'Generación XML',
            '5': 'Carga SAT',
            '6': 'Timbrado',
            '7': 'Reporte'
        };
        path = `Inicio › Nueva solicitud › <strong>Paso ${stepNum}: ${stepNames[stepNum]}</strong>`;
    }
    breadcrumbEl.innerHTML = path;
}

// Wizard-specific navigation (steps 1 to 7)
function goToStep(stepNumber) {
    if (stepNumber < 1 || stepNumber > 7) return;
    
    state.currentStep = stepNumber;
    
    // 1. Show correct wizard panel
    goToPanel(`step-panel-${stepNumber}`);

    // 2. Update Stepper Nodes UI
    const stepNodes = document.querySelectorAll('.step-node');
    stepNodes.forEach(node => {
        const nodeStep = parseInt(node.getAttribute('data-step'));
        node.classList.remove('active', 'completed');
        
        if (nodeStep === stepNumber) {
            node.classList.add('active');
        } else if (nodeStep < stepNumber) {
            node.classList.add('completed');
        }
    });

    // 3. Update Stepper Progress Line
    const progressLine = document.getElementById('stepper-progress');
    if (progressLine) {
        const percentage = ((stepNumber - 1) / 6) * 92;
        progressLine.style.width = `${percentage}%`;
    }

    // 4. Highlight correct sidebar link based on step
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active', 'active-pulse'));
    if (stepNumber === 7) {
        const navTimbradas = document.getElementById('nav-timbradas');
        if (navTimbradas) navTimbradas.classList.add('active');
    } else {
        const navSolicitud = document.getElementById('nav-solicitud');
        if (navSolicitud) navSolicitud.classList.add('active-pulse');
    }
}

// 2. Step 1: Laser Scan Animation
function startScanAnimationLegacyDemo() {
    const scanner = document.getElementById('laser-scanner');
    const scanBtn = document.getElementById('btn-scan');
    
    if (!scanner || !scanBtn) return;
    
    scanBtn.disabled = true;
    scanBtn.innerHTML = `
        <svg class="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width: 18px; height: 18px; animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.2)" stroke-width="4"></circle><path d="M4 12a8 8 0 018-8v8H4z" fill="currentColor"></path></svg>
        Escaneando documentos...
    `;
    scanner.style.display = 'block';
    
    showToast('Iniciando lectura óptica de documentos (OCR)...', 'info');

    // Simulate scan delay (1.8s)
    setTimeout(() => {
        scanner.style.display = 'none';
        scanBtn.disabled = false;
        scanBtn.innerHTML = `
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width: 18px; height: 18px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/></svg>
            Escanear / Leer documentos
        `;
        
        // Mark files as scanned (OCR)
        if (state.activeExpediente) {
            state.activeExpediente.archivos.forEach(file => file.status = 'Leído correctamente (OCR)');
            state.activeExpediente.estatus = 'Pago pendiente';
            addAuditLogToActive('Documentos leídos mediante OCR.');
            
            // Register safety log
            addSecurityLog('OCR Escaneo', `Escaneo de expediente ${state.activeExpediente.folio} finalizado.`);
        }

        showToast('Documentos procesados con éxito. Datos extraídos.', 'success');
        
        // Re-render views
        renderDocumentList();
        updateStep2Fields();
        updatePreviewFields();
        renderTimeline();
        updatePaymentValidationUI();
        
        goToStep(2);
    }, 1800);
}

// Real document picker and local OCR implementation.
function initDocumentPicker() {
    const dropzone = document.getElementById('dropzone-step1');
    const input = document.getElementById('document-file-input');
    if (!dropzone || !input) return;

    dropzone.addEventListener('click', event => {
        if (event.target !== input) input.click();
    });
    input.addEventListener('change', event => handleSelectedFiles(event.target.files));
}

function handleSelectedFiles(fileList) {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
    const files = Array.from(fileList || []);
    if (!files.length) return;

    files.forEach(file => {
        const extension = file.name.toLowerCase().split('.').pop();
        const validType = allowed.includes(file.type) || ['pdf', 'jpg', 'jpeg', 'png'].includes(extension);
        if (!validType) {
            showToast(`Formato no permitido: ${file.name}`, 'warning');
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            showToast(`El archivo ${file.name} supera el limite de 10 MB.`, 'warning');
            return;
        }
        if (state.uploadedFiles.some(item => item.name === file.name && item.file.size === file.size)) return;

        state.uploadedFiles.push({
            file,
            name: file.name,
            type: file.type === 'application/pdf' || extension === 'pdf' ? 'PDF' : 'Imagen',
            status: 'Listo para leer'
        });
    });

    createActiveExpedienteFromUploads();
    if (state.activeExpediente) {
        const existingNames = new Set(state.activeExpediente.archivos.map(item => item.name));
        state.uploadedFiles.forEach(uploaded => {
            if (!existingNames.has(uploaded.name)) {
                state.activeExpediente.archivos.push({
                    name: uploaded.name,
                    type: uploaded.type === 'PDF' ? 'Documento PDF' : 'Documento imagen',
                    status: uploaded.status
                });
            }
        });
    }
    renderDocumentList();
    const scanBtn = document.getElementById('btn-scan');
    if (scanBtn) scanBtn.disabled = state.uploadedFiles.length === 0;
    showToast(`${state.uploadedFiles.length} documento(s) listo(s) para OCR local.`, 'success');
}

function createActiveExpedienteFromUploads() {
    if (state.activeExpediente || !state.uploadedFiles.length) return;

    state.activeExpediente = {
        folio: `REC-${String(Date.now()).slice(-6)}`,
        cliente: 'Pendiente de lectura',
        rfc: '',
        regimenFiscal: '',
        codigoPostal: '',
        usoCfdi: 'G03 - Gastos en general',
        correo: '',
        importe: 0,
        fechaRecibo: getCurrentDateTimeString(),
        concepto: '',
        folioRecibo: '',
        banco: '',
        fechaPago: '',
        referencia: '',
        claveRastreo: '',
        cuentaBeneficiaria: '',
        estatus: 'Recibido',
        tipoCfdi: 'ingreso',
        uuid: '',
        archivos: [],
        auditoria: [`[${getCurrentDateTimeString()}] Tramite recibido mediante carga de documentos.`]
    };
    document.getElementById('lbl-cliente-correo').textContent = 'Pendiente de lectura';
    document.getElementById('lbl-cliente-fecha').textContent = state.activeExpediente.fechaRecibo;
}

async function startScanAnimation() {
    const scanner = document.getElementById('laser-scanner');
    const scanBtn = document.getElementById('btn-scan');
    if (!scanner || !scanBtn || state.ocrBusy) return;
    if (!state.uploadedFiles.length) {
        showToast('Selecciona al menos un PDF, JPG o PNG real.', 'warning');
        return;
    }

    state.ocrBusy = true;
    scanBtn.disabled = true;
    scanner.style.display = 'block';
    scanBtn.textContent = 'Leyendo documentos...';
    showToast('OCR local iniciado. Los documentos permanecen en este navegador.', 'info');

    try {
        const fields = await extractUploadedDocuments();
        applyExtractedFields(fields);
        state.uploadedFiles.forEach(file => { file.status = 'Leido correctamente (OCR local)'; });
        if (state.activeExpediente) {
            state.activeExpediente.archivos.forEach(file => { file.status = 'Leido correctamente (OCR local)'; });
            state.activeExpediente.estatus = 'Pago pendiente';
            addAuditLogToActive('Documentos procesados mediante OCR local. Datos pendientes de confirmacion.');
            addSecurityLog('OCR local', `Lectura del expediente ${state.activeExpediente.folio} finalizada en el navegador.`);
        }
        renderDocumentList();
        updateStep2Fields();
        updatePreviewFields();
        renderTimeline();
        updatePaymentValidationUI();
        showToast('⚠ Pago no validado. El comprobante fue leído, pero falta confirmación bancaria real.', 'error');
        showToast('Lectura terminada. Revisa los datos; el pago no está validado.', 'info');
        goToStep(2);
    } catch (error) {
        console.error('OCR error:', error);
        showToast(`No se pudo leer el documento: ${error.message || 'error desconocido'}`, 'error');
    } finally {
        scanner.style.display = 'none';
        state.ocrBusy = false;
        scanBtn.disabled = state.uploadedFiles.length === 0;
        scanBtn.textContent = 'Escanear / Leer documentos';
        if (state.ocrWorker) {
            await state.ocrWorker.terminate();
            state.ocrWorker = null;
        }
    }
}

async function extractUploadedDocuments() {
    if (!window.Tesseract) throw new Error('No se cargo el motor OCR.');
    if (!window.pdfjsLib) throw new Error('No se cargo el lector PDF.');

    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    // English traineddata is intentionally used for Mexican fiscal documents:
    // RFCs, amounts and references are alphanumeric, and it is more reliable
    // than the Spanish model on compressed/table-style bank receipts.
    state.ocrWorker = await Tesseract.createWorker('eng', 1, {
        logger: message => {
            if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
                const scanBtn = document.getElementById('btn-scan');
                if (scanBtn) scanBtn.textContent = `Leyendo OCR ${Math.round(message.progress * 100)}%...`;
            }
        }
    });
    await state.ocrWorker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });

    let allText = '';
    let pageCount = 0;
    for (const uploaded of state.uploadedFiles) {
        const isPdf = uploaded.type === 'PDF' || uploaded.name.toLowerCase().endsWith('.pdf');
        if (!isPdf) {
            allText += `\n${await recognizeImageWithFallback(uploaded.file)}`;
            pageCount += 1;
            continue;
        }

        const pdf = await window.pdfjsLib.getDocument({ data: await uploaded.file.arrayBuffer() }).promise;
        const pageLimit = Math.min(pdf.numPages, 3);
        for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str || '').join(' ').trim();
            if (pageText.replace(/\s/g, '').length >= 30) {
                allText += `\n${pageText}`;
            } else {
                const canvas = await renderPdfPageForOcr(page);
                // PSM 4 works better for scanned PDF pages with a full-page
                // document layout; image receipts keep the banded PSM 6 path.
                allText += `\n${await recognizeCanvasWithFallback(canvas, '4')}`;
                canvas.width = 1;
                canvas.height = 1;
            }
            pageCount += 1;
        }
        if (pdf.numPages > pageLimit) allText += '\n[Advertencia: el PDF supera el limite de 3 paginas.]';
    }

    if (!pageCount || allText.replace(/\s/g, '').length < 10) {
        throw new Error('No se detecto texto legible. Usa una imagen nitida y bien iluminada.');
    }
    return parseExtractedFields(allText);
}

// A full-page OCR pass can miss table cells because the borders confuse the
// page segmentation model. If that happens, read horizontal bands as a
// lightweight fallback. It keeps the work local to the employee's browser.
async function recognizeImageWithFallback(file) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const scale = Math.min(1.5, 1600 / bitmap.width, 1800 / bitmap.height);
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (typeof bitmap.close === 'function') bitmap.close();

    const text = await recognizeCanvasWithFallback(canvas, '6');
    canvas.width = 1;
    canvas.height = 1;
    return text;
}

async function recognizeCanvasWithFallback(canvas, pageSegMode = '6') {
    await state.ocrWorker.setParameters({ tessedit_pageseg_mode: pageSegMode });
    const firstPass = await state.ocrWorker.recognize(canvas);
    const firstText = firstPass.data.text || '';
    const firstFields = parseExtractedFields(firstText);
    const detectedFields = Object.values(firstFields.confidence).filter(value => value >= 0.65).length;
    if (detectedFields >= 3 || canvas.height < 500) return firstText;

    const bandCount = Math.min(8, Math.max(5, Math.ceil(canvas.height / 240)));
    const bandHeight = Math.ceil(canvas.height / bandCount);
    const overlap = Math.min(32, Math.ceil(bandHeight * 0.12));
    const pieces = [firstText];

    for (let y = 0; y < canvas.height; y += Math.max(1, bandHeight - overlap)) {
        const height = Math.min(bandHeight + overlap, canvas.height - y);
        const band = document.createElement('canvas');
        band.width = canvas.width;
        band.height = height;
        band.getContext('2d').drawImage(canvas, 0, y, canvas.width, height, 0, 0, band.width, band.height);
        const result = await state.ocrWorker.recognize(band);
        pieces.push(result.data.text || '');
        band.width = 1;
        band.height = 1;
    }

    return pieces.join('\n');
}

async function renderPdfPageForOcr(page) {
    const baseViewport = page.getViewport({ scale: 1 });
    // Render scanned PDFs at a higher resolution so small RFCs and references
    // do not disappear before Tesseract receives the page canvas.
    const scale = Math.max(1.6, Math.min(2.2, 1800 / Math.max(baseViewport.width, baseViewport.height)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas;
}

function parseExtractedFields(text) {
    const normalized = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ');
    const upper = normalized.toUpperCase();
    const rfcMatch = upper.match(/\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/);
    const amountMatch = normalized.match(/(?:IMPORTE|TOTAL(?: A PAGAR)?|MONTO|DEPOSITO|PAGO)[^\d$]{0,40}\$?\s*([\d,]+(?:\.\d{1,2})?)/i) || normalized.match(/\$\s*([\d,]+\.\d{1,2})/);
    const folioReciboMatch = normalized.match(/(?:FOLIO\s+(?:DEL?\s+)?RECIBO|NO\.?\s+DE?\s+RECIBO)[\s:#-]*([A-Z0-9][A-Z0-9 ./_-]{3,45})/i);
    const referenceMatch = normalized.match(/(?:REFERENCIA|REF\.?|AUTORIZACION)[\s:#-]*([A-Z0-9][A-Z0-9 ./_-]{3,45})/i);
    const reasonMatch = normalized.match(/(?:RAZON SOCIAL|RAZON|NOMBRE|CONTRIBUYENTE)[\s:#-]*([^\n]{4,100})/i);
    const trackingMatch = normalized.match(/(?:CLAVE\s+DE\s+RASTREO|CLAVE\s+RASTREO|RASTREO)[\s:#-]*([A-Z0-9]{6,30})/i);
    const accountMatch = normalized.match(/(?:CUENTA\s+BENEFICIARIA|CLABE|CUENTA\s+DESTINO)[\s:#-]*(\d{10,20})/i);
    const conceptMatch = normalized.match(/(?:CONCEPTO|DESCRIPCION)[\s:#-]*([^\n]{4,120})/i);
    const dateMatch = normalized.match(/(?:FECHA(?:\s+PAGO)?|FECHA DE PAGO)[\s:#-]*(\d{1,2}[/-]\d{1,2}[/-]\d{4}(?:\s+\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?)?)/i);
    const bankNames = ['BBVA', 'SANTANDER', 'BANAMEX', 'CITIBANAMEX', 'HSBC', 'BANORTE', 'SCOTIABANK', 'BANCO DEL BIENESTAR', 'AZTECA', 'NU'];
    const bank = bankNames.find(name => upper.includes(name)) || '';
    const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : null;
    const razonSocial = reasonMatch ? cleanOcrValue(reasonMatch[1]) : '';
    const referencia = referenceMatch ? cleanOcrValue(referenceMatch[1]) : '';
    const concepto = conceptMatch ? cleanOcrValue(conceptMatch[1]) : '';
    const fechaPago = dateMatch ? cleanOcrValue(dateMatch[1]) : '';
    const folioRecibo = folioReciboMatch ? cleanOcrValue(folioReciboMatch[1]) : '';
    const claveRastreo = trackingMatch ? cleanOcrValue(trackingMatch[1]).replace(/[^A-Z0-9]/gi, '') : '';
    const cuentaBeneficiaria = accountMatch ? accountMatch[1].replace(/\D/g, '') : '';
    return {
        rfc: rfcMatch ? rfcMatch[0].toUpperCase() : '',
        razonSocial,
        banco: bank,
        importe: Number.isFinite(amount) ? amount : null,
        referencia,
        concepto,
        fechaPago,
        folioRecibo,
        claveRastreo,
        cuentaBeneficiaria,
        confidence: {
            rfc: rfcMatch ? 0.95 : 0,
            razonSocial: razonSocial ? 0.65 : 0,
            banco: bank ? 0.85 : 0,
            importe: Number.isFinite(amount) ? 0.8 : 0,
            referencia: referencia ? 0.7 : 0,
            concepto: concepto ? 0.8 : 0,
            fechaPago: fechaPago ? 0.75 : 0,
            folioRecibo: folioRecibo ? 0.8 : 0,
            claveRastreo: claveRastreo ? 0.85 : 0,
            cuentaBeneficiaria: cuentaBeneficiaria ? 0.85 : 0
        }
    };
}

function cleanOcrValue(value) {
    return value.replace(/\s+/g, ' ').replace(/[|]+/g, '').trim().replace(/[.,;:]$/, '');
}

function applyExtractedFields(fields) {
    if (!state.activeExpediente) createActiveExpedienteFromUploads();
    if (!state.activeExpediente) return;
    const dossier = state.activeExpediente;
    if (fields.rfc) dossier.rfc = fields.rfc;
    if (fields.razonSocial) dossier.cliente = fields.razonSocial;
    if (fields.banco) dossier.banco = fields.banco;
    if (Number.isFinite(fields.importe)) dossier.importe = fields.importe;
    if (fields.referencia) dossier.referencia = fields.referencia;
    if (fields.concepto) dossier.concepto = fields.concepto;
    if (fields.fechaPago) dossier.fechaPago = fields.fechaPago;
    if (fields.folioRecibo) dossier.folioRecibo = fields.folioRecibo;
    if (fields.claveRastreo) dossier.claveRastreo = fields.claveRastreo;
    if (fields.cuentaBeneficiaria) dossier.cuentaBeneficiaria = fields.cuentaBeneficiaria;
}

// Load presets of test invoices
function loadPresetDossier(presetIndex) {
    showToast('Los expedientes de demostraciÃ³n estÃ¡n deshabilitados. Carga un documento real.', 'warning');
    return;

    const defaultData = state.expedientes[presetIndex];
    if (!defaultData) return;
    
    // Deep clone the preset data to allow mutations
    state.activeExpediente = JSON.parse(JSON.stringify(defaultData));
    state.uploadedFiles = [];
    
    // Set view headers
    document.getElementById('lbl-cliente-correo').textContent = state.activeExpediente.correo;
    document.getElementById('lbl-cliente-fecha').textContent = state.activeExpediente.fechaRecibo;
    
    // A preset is only sample data. Do not allow a fake scan until a real file
    // is selected, otherwise the UI can look successful without OCR running.
    const btnScan = document.getElementById('btn-scan');
    if (btnScan) btnScan.disabled = state.uploadedFiles.length === 0;

    // Render files
    renderDocumentList();
    renderTimeline();

    showToast(`Preset "${state.activeExpediente.cliente}" cargado. Listo para escanear.`, 'success');
}

function renderDocumentList() {
    const listContainer = document.getElementById('doc-list-container');
    if (!listContainer || !state.activeExpediente) return;

    listContainer.innerHTML = '';
    state.activeExpediente.archivos.forEach(file => {
        const isPdf = file.name.endsWith('.pdf');
        const iconClass = isPdf ? 'doc-icon-pdf' : 'doc-icon-img';
        const iconSvg = isPdf 
            ? `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9.5 6H8v6H6.5v-1.5H5v-1.5h1.5V9H5V7.5h4.5V9zm5 4.5c0 .83-.67 1.5-1.5 1.5h-2.5V7.5H13c.83 0 1.5.67 1.5 1.5v4.5zm5-3H18v1.5h1.5V12H18v3h-1.5V7.5h3v2.5zm-6.5-1.5H11.5v3H13c.28 0 .5-.22.5-.5V9c0-.28-.22-.5-.5-.5z"/></svg>`
            : `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-4.86 8.86l-3 3.87L9 13.14 6 17h12l-3.86-5.14z"/></svg>`;

        const isScanned = file.status.includes('OCR');
        const badgeClass = isScanned ? 'badge-success' : 'badge-warning';
        const badgeIcon = isScanned 
            ? `<svg class="badge-icon" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>`
            : `<svg class="badge-icon-stroke" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;

        const docCard = document.createElement('div');
        docCard.className = 'doc-card';
        docCard.innerHTML = `
            <div class="doc-icon-container ${iconClass}">
                ${iconSvg}
            </div>
            <span class="doc-title">${file.type}</span>
            <span class="doc-filename"><a href="#" onclick="return false;">${file.name}</a></span>
            <span class="badge ${badgeClass} doc-status-badge">
                ${badgeIcon}
                ${file.status}
            </span>
            <button class="doc-view-btn" onclick="previewDocument('${file.name}', '${isPdf ? 'PDF' : 'Imagen'}')" style="position: absolute; bottom: 12px; right: 12px;">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
            </button>
        `;
        listContainer.appendChild(docCard);
    });
}

function updateStep2Fields() {
    if (!state.activeExpediente) return;
    const pending = 'Pendiente de lectura';
    const amount = Number(state.activeExpediente.importe);
    document.getElementById('val-rfc').textContent = state.activeExpediente.rfc;
    document.getElementById('val-razon').textContent = state.activeExpediente.cliente;
    document.getElementById('val-regimen').textContent = state.activeExpediente.regimenFiscal;
    document.getElementById('val-cp').textContent = state.activeExpediente.codigoPostal;
    document.getElementById('val-cfdi').textContent = state.activeExpediente.usoCfdi;
    document.getElementById('val-correo').textContent = state.activeExpediente.correo;

    // These values come from OCR only. The word "PAGADO" in a document is
    // not bank confirmation, so the validation status remains pending.
    document.getElementById('val-cis-folio').textContent = state.activeExpediente.folioRecibo || pending;
    document.getElementById('val-cis-fecha').textContent = state.activeExpediente.fechaPago || pending;
    document.getElementById('val-cis-concepto').textContent = state.activeExpediente.concepto || pending;
    document.getElementById('val-cis-importe').textContent = Number.isFinite(amount) && amount > 0
        ? `$${amount.toFixed(2)} MXN`
        : pending;

    document.getElementById('val-banco').textContent = state.activeExpediente.banco || pending;
    document.getElementById('val-banco-fecha').textContent = state.activeExpediente.fechaPago || pending;
    document.getElementById('val-banco-importe').textContent = Number.isFinite(amount) && amount > 0
        ? `$${amount.toFixed(2)} MXN`
        : pending;
    document.getElementById('val-banco-ref').textContent = state.activeExpediente.referencia || pending;
}

function formatBanxicoDate(value) {
    const match = String(value || '').match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (!match) return '';
    return `${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}-${match[3]}`;
}

function closeBanxicoCepModal() {
    document.getElementById('banxico-cep-modal')?.remove();
}

function openBanxicoCepModal() {
    if (!state.activeExpediente) return;
    closeBanxicoCepModal();

    const dossier = state.activeExpediente;
    const hasTrackingKey = Boolean(dossier.claveRastreo);
    const numericReference = /^\d{1,7}$/.test(String(dossier.referencia || '').trim());
    const criterionType = hasTrackingKey || !numericReference ? 'T' : 'R';
    const criterionValue = hasTrackingKey ? dossier.claveRastreo : (numericReference ? dossier.referencia : '');

    document.body.insertAdjacentHTML('beforeend', `
        <div class="cep-modal-backdrop" id="banxico-cep-modal" role="presentation">
            <section class="cep-modal" role="dialog" aria-modal="true" aria-labelledby="cep-modal-title">
                <header class="cep-modal-header">
                    <div>
                        <p class="cep-modal-eyebrow">Consulta oficial SPEI</p>
                        <h2 id="cep-modal-title">Comprobante Electrónico de Pago (CEP)</h2>
                    </div>
                    <button type="button" class="cep-modal-close" id="cep-modal-close" aria-label="Cerrar">&times;</button>
                </header>
                <div class="cep-modal-notice">
                    Banxico recibirá la consulta en su sitio oficial. Los campos detectados por OCR se cargan aquí; los datos que no estén en el comprobante deben confirmarse con el banco.
                </div>
                <form id="banxico-cep-form" class="cep-modal-form">
                    <div class="cep-form-grid">
                        <label>Fecha de operación
                            <input id="cep-fecha" type="text" readonly>
                        </label>
                        <label>Monto detectado
                            <input id="cep-monto" type="text" readonly>
                        </label>
                        <label>Criterio de búsqueda
                            <select id="cep-tipo-criterio">
                                <option value="T">Clave de rastreo</option>
                                <option value="R">Número de referencia</option>
                            </select>
                        </label>
                        <label><span id="cep-criterio-label">Clave de rastreo</span>
                            <input id="cep-criterio" type="text" maxlength="30" autocomplete="off" placeholder="Dato del estado de cuenta">
                        </label>
                    </div>
                    <div class="cep-form-grid">
                        <label>Banco emisor — código Banxico *
                            <input id="cep-emisor" type="text" inputmode="numeric" maxlength="6" placeholder="Ej. 40012">
                        </label>
                        <label>Banco receptor — código Banxico *
                            <input id="cep-receptor" type="text" inputmode="numeric" maxlength="6" placeholder="Ej. 40012">
                        </label>
                        <label>Cuenta beneficiaria (CLABE/tarjeta/celular)
                            <input id="cep-cuenta" type="text" inputmode="numeric" maxlength="20" placeholder="Opcional para consultar estado">
                        </label>
                        <label>Código de seguridad CAPTCHA
                            <input id="cep-captcha" type="text" maxlength="5" autocomplete="off" placeholder="Lo solicita Banxico">
                        </label>
                    </div>
                    <label class="cep-checkbox-row">
                        <input id="cep-receptor-participante" type="checkbox" value="1">
                        El beneficiario es directamente el banco receptor
                    </label>
                    <p class="cep-modal-help">Banco detectado por OCR: <strong id="cep-banco-detectado">No detectado</strong>. La consulta oficial puede solicitar CAPTCHA.</p>
                    <div class="cep-modal-actions">
                        <button type="button" class="btn btn-secondary" id="cep-modal-cancel">Cancelar</button>
                        <a class="btn btn-secondary" href="https://www.banxico.org.mx/cep/" target="_blank" rel="noopener">Abrir formulario oficial</a>
                        <button type="submit" class="btn btn-primary">Enviar consulta a Banxico</button>
                    </div>
                </form>
            </section>
        </div>
    `);

    document.getElementById('cep-fecha').value = formatBanxicoDate(dossier.fechaPago);
    document.getElementById('cep-monto').value = Number.isFinite(Number(dossier.importe)) && Number(dossier.importe) > 0
        ? Number(dossier.importe).toFixed(2)
        : '';
    document.getElementById('cep-tipo-criterio').value = criterionType;
    document.getElementById('cep-criterio').value = criterionValue;
    document.getElementById('cep-cuenta').value = dossier.cuentaBeneficiaria || '';
    document.getElementById('cep-banco-detectado').textContent = dossier.banco || 'No detectado';

    const updateCriterionLabel = () => {
        const isReference = document.getElementById('cep-tipo-criterio').value === 'R';
        const field = document.getElementById('cep-criterio');
        document.getElementById('cep-criterio-label').textContent = isReference ? 'Número de referencia' : 'Clave de rastreo';
        field.maxLength = isReference ? 7 : 30;
        field.placeholder = isReference ? 'Hasta 7 dígitos' : 'Hasta 30 caracteres alfanuméricos';
    };
    document.getElementById('cep-tipo-criterio').addEventListener('change', updateCriterionLabel);
    document.getElementById('cep-modal-close').addEventListener('click', closeBanxicoCepModal);
    document.getElementById('cep-modal-cancel').addEventListener('click', closeBanxicoCepModal);
    document.getElementById('banxico-cep-modal').addEventListener('click', event => {
        if (event.target.id === 'banxico-cep-modal') closeBanxicoCepModal();
    });
    document.getElementById('banxico-cep-form').addEventListener('submit', submitBanxicoCepForm);
    updateCriterionLabel();
    document.getElementById('cep-criterio').focus();
}

function submitBanxicoCepForm(event) {
    event.preventDefault();
    const get = id => document.getElementById(id)?.value.trim() || '';
    const fecha = get('cep-fecha');
    const tipoCriterio = get('cep-tipo-criterio');
    const criterio = get('cep-criterio');
    const emisor = get('cep-emisor');
    const receptor = get('cep-receptor');
    const cuenta = get('cep-cuenta');
    const monto = get('cep-monto');
    const captcha = get('cep-captcha');

    if (!fecha) {
        showToast('No se detectó la fecha de operación. Confírmala en el comprobante o en el estado de cuenta.', 'error');
        return;
    }
    const validCriterion = tipoCriterio === 'R' ? /^\d{1,7}$/.test(criterio) : /^[A-Za-z0-9]{1,30}$/.test(criterio);
    if (!validCriterion) {
        showToast(tipoCriterio === 'R' ? 'La referencia CEP debe contener de 1 a 7 dígitos.' : 'La clave de rastreo debe tener de 1 a 30 caracteres alfanuméricos.', 'error');
        return;
    }
    if (!/^\d{3,6}$/.test(emisor) || !/^\d{3,6}$/.test(receptor) || emisor === receptor) {
        showToast('Captura códigos Banxico válidos y diferentes para banco emisor y receptor.', 'error');
        return;
    }
    if (cuenta && !/^\d{10,20}$/.test(cuenta)) {
        showToast('La cuenta beneficiaria debe contener de 10 a 20 dígitos.', 'error');
        return;
    }
    if (cuenta && (!monto || !/^\d+(\.\d{1,2})?$/.test(monto))) {
        showToast('Captura un monto válido cuando uses cuenta beneficiaria.', 'error');
        return;
    }

    const targetName = `banxicoCep_${Date.now()}`;
    const targetWindow = window.open('', targetName);
    if (!targetWindow) {
        showToast('El navegador bloqueó la ventana de Banxico. Permite ventanas emergentes para este sitio.', 'error');
        return;
    }

    const fields = {
        fecha,
        tipoCriterio,
        criterio,
        emisor,
        receptor,
        cuenta,
        receptorParticipante: document.getElementById('cep-receptor-participante').checked ? '1' : '0',
        monto,
        captcha,
        tipoConsulta: cuenta && monto ? '1' : '0'
    };
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = 'https://www.banxico.org.mx/cep/valida.do';
    form.target = targetName;
    form.style.display = 'none';
    Object.entries(fields).forEach(([name, value]) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
    setTimeout(() => form.remove(), 1000);
    closeBanxicoCepModal();
    showToast('Consulta oficial abierta en Banxico. El resultado no se marcará como válido automáticamente.', 'info');
}

// 3. Step 2: Payment API and Manual Validation
function validatePaymentViaAPI() {
    if (!state.activeExpediente) return;

    openBanxicoCepModal();
}

function validatePaymentManual() {
    if (!state.activeExpediente) return;

    showToast('La validación manual solo puede registrarse cuando exista un proceso contable autorizado.', 'warning');
}

function updatePaymentValidationUI() {
    if (!state.activeExpediente) return;

    const valBox = document.getElementById('box-validacion-pago');
    const valTitle = document.getElementById('lbl-validacion-pago-title');
    const valDesc = document.getElementById('lbl-validacion-pago-desc');
    const valIcon = document.getElementById('icon-validacion-pago');
    const confirmBtn = document.getElementById('btn-confirm-step2');

    if (state.activeExpediente.estatus === 'Pago validado' || state.activeExpediente.estatus === 'Autorizado' || state.activeExpediente.estatus === 'Timbrado' || state.activeExpediente.estatus === 'Entregado') {
        valBox.classList.remove('payment-not-validated');
        valBox.style.borderColor = 'var(--success-color)';
        valBox.style.backgroundColor = 'var(--success-bg)';
        valTitle.textContent = 'Pago Conciliado y Validado';
        valTitle.style.color = 'var(--success-color)';
        valDesc.textContent = `confirmado en la cuenta estatal por $${state.activeExpediente.importe.toFixed(2)} MXN.`;
        valIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>`;
        valIcon.setAttribute('class', 'badge-icon text-success');
        valIcon.style.color = 'var(--success-color)';
        confirmBtn.disabled = false;
    } else {
        valBox.classList.add('payment-not-validated');
        valBox.style.borderColor = '#c92a2a';
        valBox.style.backgroundColor = '#fff5f5';
        valTitle.textContent = 'Pago no validado';
        valTitle.style.color = '#c92a2a';
        valDesc.textContent = 'No existe una confirmación bancaria real. El comprobante no autoriza el pago.';
        valIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/>`;
        valIcon.setAttribute('class', 'badge-icon-stroke text-danger');
        valIcon.style.color = '#c92a2a';
        confirmBtn.disabled = true;
    }
}

function confirmStep2() {
    if (!state.activeExpediente) return;
    
    state.activeExpediente.estatus = 'Autorizado';
    addAuditLogToActive('Trámite autorizado. Expediente listo para timbrar.');
    
    goToStep(3);
}

// Timeline auditoria
function renderTimeline() {
    const timeline = document.getElementById('timeline-expediente');
    if (!timeline || !state.activeExpediente) return;

    timeline.innerHTML = '';
    state.activeExpediente.auditoria.forEach(log => {
        const logItem = document.createElement('div');
        logItem.style.display = 'flex';
        logItem.style.gap = '10px';
        logItem.style.alignItems = 'flex-start';
        logItem.innerHTML = `
            <span style="color: var(--secondary-color); font-weight: 700;">•</span>
            <div>${log}</div>
        `;
        timeline.appendChild(logItem);
    });
}

function addAuditLogToActive(message) {
    if (state.activeExpediente) {
        state.activeExpediente.auditoria.push(`[${getCurrentDateTimeString()}] ${message}`);
    }
}

// 4. Step 3: CFDI Selection & Preview
function changeCfdiTipo(val) {
    if (!state.activeExpediente) return;
    
    state.activeExpediente.tipoCfdi = val;
    
    // Update preview labels
    if (val === 'pago') {
        showToast('Tipo de CFDI seleccionado: Complemento de Pago.', 'info');
    } else {
        showToast('Tipo de CFDI seleccionado: Ingreso (Factura por Derechos).', 'info');
    }
}

function updatePreviewFields() {
    if (!state.activeExpediente) return;
    
    document.querySelectorAll('.preview-rfc').forEach(el => el.textContent = state.activeExpediente.rfc);
    document.querySelectorAll('.preview-razon').forEach(el => el.textContent = state.activeExpediente.cliente);
    document.querySelectorAll('.preview-regimen').forEach(el => el.textContent = state.activeExpediente.regimenFiscal);
    document.querySelectorAll('.preview-cp').forEach(el => el.textContent = state.activeExpediente.codigoPostal);
    document.querySelectorAll('.preview-cfdi').forEach(el => el.textContent = state.activeExpediente.usoCfdi);
    document.querySelectorAll('.preview-correo').forEach(el => el.textContent = state.activeExpediente.correo);
    
    // Update XML details
    const xmlFilename = document.getElementById('pac-xml-filename');
    if (xmlFilename) {
        xmlFilename.textContent = `FACTURA_${state.activeExpediente.folio.replace('-', '')}.xml`;
    }
}

// 5. Step 4: PAC Automatic Timbrado
function stampInvoiceViaPAC() {
    if (!state.activeExpediente) return;

    showToast('Timbrado PAC no configurado. No se generÃ³ UUID, XML ni factura fiscal.', 'warning');
    return;

    const csdPassword = document.getElementById('pac-csd-password').value;
    if (!csdPassword) {
        showToast('Ingresa la contraseña del archivo CSD para firmar el XML.', 'warning');
        return;
    }

    const loaderBox = document.getElementById('pac-loading-box');
    const stampBtn = document.getElementById('btn-pac-stamp');
    const loadTitle = document.getElementById('pac-loading-title');
    const loadDesc = document.getElementById('pac-loading-desc');

    stampBtn.disabled = true;
    loaderBox.style.display = 'flex';

    // Simulated API call sequence
    setTimeout(() => {
        loadTitle.textContent = 'Generando firma con Sello CSD...';
        loadDesc.textContent = 'Sellando la cadena original del CFDI 4.0.';
        
        setTimeout(() => {
            loadTitle.textContent = 'Enviando a API del PAC...';
            loadDesc.textContent = 'Estableciendo comunicación segura cifrada.';
            
            setTimeout(() => {
                loadTitle.textContent = 'Factura Certificada ante el SAT';
                loadDesc.textContent = 'Obteniendo sello del SAT y UUID fiscal.';
                
                setTimeout(() => {
                    // Generate Mock Stamped Data
                    const mockUUID = generateMockUUID();
                    state.activeExpediente.uuid = mockUUID;
                    state.activeExpediente.estatus = 'Timbrado';
                    
                    addAuditLogToActive(`Factura timbrada con éxito vía PAC. Folio Fiscal UUID: ${mockUUID}.`);
                    
                    // Add invoice to report table database
                    const nextFolioInterno = `F-000${state.facturas.length + 42}`;
                    state.facturas.unshift({
                        folioInterno: nextFolioInterno,
                        folioRecibo: state.activeExpediente.folio,
                        cliente: state.activeExpediente.cliente,
                        fecha: getCurrentDateTimeString(),
                        importe: state.activeExpediente.importe,
                        estatus: 'Timbrada',
                        uuid: mockUUID
                    });

                    // Add safety log
                    addSecurityLog('Timbrado Automático PAC', `Factura ${nextFolioInterno} timbrada vía PAC. UUID: ${mockUUID}.`);

                    showToast('✓ ¡La factura ha sido timbrada con éxito vía PAC!', 'success');
                    
                    // Reset UI
                    loaderBox.style.display = 'none';
                    stampBtn.disabled = false;
                    
                    // Go to Step 6 (Stamped Details View)
                    openInvoicePreviewModal(nextFolioInterno, state.activeExpediente.cliente, `$${state.activeExpediente.importe.toFixed(2)}`);
                    goToStep(6);
                    
                    // Refresh logs
                    renderReportTable();
                    updateDashboardCounts();
                }, 800);
            }, 800);
        }, 800);
    }, 500);
}

function downloadXML() {
    if (!state.activeExpediente) return;

    showToast('XML no disponible: primero debe configurarse un PAC real o cargarse un XML timbrado.', 'warning');
    return;
    
    showToast('Generando archivo XML...', 'info');
    
    const mockXML = `<?xml version="1.0" encoding="utf-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="F" Folio="${state.activeExpediente.folio.split('-')[1]}" Fecha="2026-07-20T10:30:00" SubTotal="${(state.activeExpediente.importe / 1.16).toFixed(2)}" Total="${state.activeExpediente.importe.toFixed(2)}" Moneda="MXN" TipoDeComprobante="${state.activeExpediente.tipoCfdi === 'ingreso' ? 'I' : 'P'}" Exportacion="01" MetodoPago="PUE" LugarExpedicion="80000">
    <cfdi:Emisor Rfc="CEP050915XXX" Nombre="COMISION ESTATAL PARA LA PROTECCION CONTRA RIESGOS SANITARIOS DE SINALOA" RegimenFiscal="603"/>
    <cfdi:Receptor Rfc="${state.activeExpediente.rfc}" Nombre="${state.activeExpediente.cliente.toUpperCase()}" DomicilioFiscalReceptor="${state.activeExpediente.codigoPostal}" RegimenFiscalReceptor="601" UsoCFDI="G03"/>
    <cfdi:Conceptos>
        <cfdi:Concepto ClaveProdServ="90101500" Cantidad="1" ClaveUnidad="E48" Unidad="Servicio" Descripcion="Servicio de tramite de COEPRISS" ValorUnitario="${(state.activeExpediente.importe / 1.16).toFixed(2)}" Importe="${(state.activeExpediente.importe / 1.16).toFixed(2)}" ObjetoImp="02">
            <cfdi:Impuestos>
                <cfdi:Traslados>
                    <cfdi:Traslado Base="${(state.activeExpediente.importe / 1.16).toFixed(2)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${(state.activeExpediente.importe - (state.activeExpediente.importe / 1.16)).toFixed(2)}"/>
                </cfdi:Traslados>
            </cfdi:Impuestos>
        </cfdi:Concepto>
    </cfdi:Conceptos>
</cfdi:Comprobante>`;

    setTimeout(() => {
        triggerBrowserDownload(`FACTURA_${state.activeExpediente.folio.replace('-', '')}.xml`, mockXML, 'text/xml');
        showToast('✓ XML descargado correctamente.', 'success');
        addSecurityLog('Descarga XML', `Descarga de XML pre-generado para el trámite ${state.activeExpediente.folio}.`);
    }, 600);
}

function openSatPortal() {
    showToast('Abriendo portal oficial del SAT en una pestaña nueva...', 'info');
    addSecurityLog('Redirección SAT', 'Apertura del portal de facturación del SAT.');
    setTimeout(() => {
        window.open('https://www.sat.gob.mx/', '_blank');
    }, 800);
}

// 6. Step 5: Manual XML Stamping Upload
function removeUpload(type) {
    if (type === 'xml') {
        state.xmlUploaded = false;
        showToast('Archivo XML eliminado. Por favor, suba el archivo timbrado.', 'warning');
    } else if (type === 'pdf') {
        state.pdfUploaded = false;
        showToast('Archivo PDF eliminado. Por favor, suba el archivo timbrado.', 'warning');
    }
}

// Drag & drop simulation
function initDragAndDropLegacyDemo() {
    const dropzone = document.getElementById('dropzone-step1');
    if (!dropzone) return;

    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
        }, false);
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            showToast(`Archivo "${files[0].name}" cargado correctamente para análisis.`, 'success');
            
            // Generate dummy active dossier if none loaded
            if (!state.activeExpediente) {
                state.activeExpediente = {
                    folio: 'REC-000248',
                    cliente: 'Contribuyente Particular',
                    rfc: 'XAXX010101000',
                    regimenFiscal: '605 - Sueldos y Salarios',
                    codigoPostal: '80000',
                    usoCfdi: 'G03 - Gastos en general',
                    correo: 'correo@contribuyente.com',
                    importe: 500.00,
                    fechaRecibo: getCurrentDateTimeString(),
                    banco: 'Banco del Bienestar',
                    fechaPago: getCurrentDateTimeString(),
                    referencia: 'DEP-8890',
                    estatus: 'Recibido',
                    tipoCfdi: 'ingreso',
                    uuid: '',
                    archivos: [
                        { name: files[0].name, type: 'Documento cargado', status: 'Listo para escanear' }
                    ],
                    auditoria: [
                        `[${getCurrentDateTimeString()}] Trámite recibido. Creado por Brenda González.`
                    ]
                };
                document.getElementById('lbl-cliente-correo').textContent = state.activeExpediente.correo;
                document.getElementById('lbl-cliente-fecha').textContent = state.activeExpediente.fechaRecibo;
                
                const btnScan = document.getElementById('btn-scan');
                if (btnScan) btnScan.disabled = false;
            } else {
                state.activeExpediente.archivos.push({
                    name: files[0].name,
                    type: 'Archivo adicional',
                    status: 'Listo para escanear'
                });
            }
            renderDocumentList();
        }
    }, false);
}

// Override the original demo drop handler with real File objects.
function initDragAndDrop() {
    const dropzone = document.getElementById('dropzone-step1');
    if (!dropzone) return;
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, event => {
            event.preventDefault();
            dropzone.classList.add('dragover');
        });
    });
    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, event => {
            event.preventDefault();
            dropzone.classList.remove('dragover');
        });
    });
    dropzone.addEventListener('drop', event => handleSelectedFiles(event.dataTransfer.files));
}

// 7. Step 6: Invoice Preview & Stamped Verification
function openInvoicePreviewModal(folio = 'F-00045', clientName = '', totalVal = '$1,160.00') {
    if (!state.activeExpediente?.uuid) {
        showToast('No existe un CFDI timbrado real para previsualizar.', 'warning');
        return;
    }

    if (!clientName && state.activeExpediente) {
        clientName = state.activeExpediente.cliente;
    }
    
    // Find matching invoice uuid
    const matchedFac = state.facturas.find(f => f.folioInterno === folio);
    const mockUUID = matchedFac ? matchedFac.uuid : (state.activeExpediente ? state.activeExpediente.uuid : 'BAB3F6E2-4D78-4C1A-B06D-D7ABBD2F123');

    document.getElementById('pdf-folio').textContent = folio;
    document.getElementById('pdf-receptor-name').textContent = clientName;
    document.getElementById('pdf-receptor-rfc').textContent = clientName === (state.activeExpediente ? state.activeExpediente.cliente : '') ? state.activeExpediente.rfc : 'XAXX010101000';
    document.getElementById('pdf-receptor-regimen').textContent = clientName === (state.activeExpediente ? state.activeExpediente.cliente : '') ? (state.activeExpediente.regimenFiscal || 'Pendiente de confirmación') : '601';
    document.getElementById('pdf-receptor-cfdi').textContent = clientName === (state.activeExpediente ? state.activeExpediente.cliente : '') ? state.activeExpediente.usoCfdi : 'G03 - Gastos en general';
    
    // Set UUID in box
    const uuidBox = document.getElementById('pdf-uuid-val');
    if (uuidBox) {
        uuidBox.textContent = mockUUID;
    }

    const numericTotal = parseFloat(totalVal.replace('$', '').replace(',', ''));
    const numericSubtotal = numericTotal / 1.16;
    const numericIva = numericTotal - numericSubtotal;

    document.getElementById('pdf-unit-price').textContent = `$${numericSubtotal.toFixed(2)}`;
    document.getElementById('pdf-subtotal').textContent = `$${numericSubtotal.toFixed(2)}`;
    document.getElementById('pdf-iva').textContent = `$${numericIva.toFixed(2)}`;
    document.getElementById('pdf-total').textContent = totalVal;
    const conceptoPreview = document.getElementById('pdf-concepto');
    if (conceptoPreview) conceptoPreview.textContent = state.activeExpediente?.concepto || 'Servicio de trámite de COEPRISS Sinaloa';

    document.getElementById('modal-invoice-preview').classList.add('open');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('open');
}

function sendInvoiceByEmail() {
    if (!state.activeExpediente) return;

    showToast('EnvÃ­o de correo no configurado: no se enviÃ³ ningÃºn archivo.', 'warning');
    return;
    
    showToast(`Enviando factura por correo a: ${state.activeExpediente.correo}...`, 'info');
    
    setTimeout(() => {
        showToast(`✓ Factura enviada con éxito a: ${state.activeExpediente.correo}`, 'success');
        
        // Find folio Interno from state.facturas
        const matched = state.facturas.find(f => f.folioRecibo === state.activeExpediente.folio);
        const folioInterno = matched ? matched.folioInterno : 'F-00045';

        // Add history log
        state.historialCorreos.unshift({
            fecha: getCurrentDateTimeString(),
            destinatario: state.activeExpediente.correo,
            folio: folioInterno,
            adjuntos: `FACTURA_${state.activeExpediente.folio.replace('-', '')}.pdf, .xml`,
            estatus: 'Entregado'
        });

        // Add safety log
        addSecurityLog('Envío Correo', `Factura ${folioInterno} enviada a ${state.activeExpediente.correo}.`);

        renderCorreosTable();
        updateDashboardCounts();

        setTimeout(() => {
            closeModal('modal-invoice-preview');
            goToStep(7);
        }, 800);
    }, 1200);
}

// Helper to trigger dummy file download
function triggerDownload(filename) {
    showToast(`Archivo no disponible: ${filename}. Configure el PAC o cargue el documento real.`, 'warning');
    return;

    showToast(`Descargando archivo: ${filename}...`, 'info');
    setTimeout(() => {
        let content = '';
        let contentType = '';
        
        if (filename.endsWith('.pdf')) {
            content = `%PDF-1.5
1 0 obj
<< /Type /Catalog
   /Pages 2 0 R
>>
endobj
2 0 obj
<< /Type /Pages
   /Kids [3 0 R]
   /Count 1
>>
endobj
3 0 obj
<< /Type /Page
   /Parent 2 0 R
   /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>
   /MediaBox [0 0 595.28 841.89]
   /Contents 4 0 R
>>
endobj
4 0 obj
<< /Length 73 >>
stream
BT
/F1 20 Tf
70 750 Td
(COEPRISS SINALOA - FACTURA DIGITAL TIMBRADA) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000062 00000 n
0000000125 00000 n
0000000300 00000 n
trailer
<< /Size 5
   /Root 1 0 R
>>
startxref
420
%%EOF`;
            contentType = 'application/pdf';
        } else {
            content = `<cfdi:Comprobante Version="4.0" xmlns:cfdi="http://www.sat.gob.mx/cfd/4">
    <cfdi:Emisor Rfc="CEP050915XXX" Nombre="COMISION ESTATAL PARA LA PROTECCION CONTRA RIESGOS SANITARIOS DE SINALOA"/>
</cfdi:Comprobante>`;
            contentType = 'text/xml';
        }
        
        triggerBrowserDownload(filename, content, contentType);
        showToast(`✓ Descarga finalizada: ${filename}`, 'success');
    }, 800);
}

// Browser downloader
function triggerBrowserDownload(filename, text, mimeType) {
    const element = document.createElement('a');
    const file = new Blob([text], {type: mimeType});
    element.href = URL.createObjectURL(file);
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}

// 8. Step 7: Filter table and real CSV Excel Export
function filterReportTable() {
    const input = document.getElementById('search-report');
    const filter = input.value.toLowerCase();
    const table = document.getElementById('table-invoices');
    const tr = table.getElementsByTagName('tr');
    let matchesCount = 0;

    for (let i = 1; i < tr.length; i++) {
        let rowMatch = false;
        const tds = tr[i].getElementsByTagName('td');
        
        // Skip header and action column
        for (let j = 0; j < tds.length - 1; j++) {
            if (tds[j]) {
                const txtValue = tds[j].textContent || tds[j].innerText;
                if (txtValue.toLowerCase().indexOf(filter) > -1) {
                    rowMatch = true;
                    break;
                }
            }
        }

        if (rowMatch) {
            tr[i].style.display = '';
            matchesCount++;
        } else {
            tr[i].style.display = 'none';
        }
    }

    const showingText = document.getElementById('showing-results-text');
    if (showingText) {
        showingText.textContent = `Mostrando ${matchesCount} de ${tr.length - 1} resultados`;
    }
}

function exportReportToExcel() {
    showToast('Generando reporte Excel/CSV...', 'info');

    // Create a real CSV from table database
    let csvContent = '\uFEFF'; // UTF-8 BOM
    csvContent += 'Folio Interno,Folio Recibo,Cliente / Contribuyente,Fecha de Stamping,Importe,UUID Fiscal\n';

    let totalSum = 0;
    state.facturas.forEach(f => {
        csvContent += `"${f.folioInterno}","${f.folioRecibo}","${f.cliente}","${f.fecha}","${f.importe.toFixed(2)}","${f.uuid}"\n`;
        totalSum += f.importe;
    });

    csvContent += `\n,,TOTAL FACTURADO,,${totalSum.toFixed(2)},\n`;

    setTimeout(() => {
        triggerBrowserDownload('Reporte_Facturas_COEPRISS.csv', csvContent, 'text/csv;charset=utf-8;');
        showToast('✓ Reporte Excel (CSV) descargado con éxito.', 'success');
        addSecurityLog('Exportación Reporte', `Exportación de reporte de facturación (${state.facturas.length} registros).`);
    }, 800);
}

function restartProcess() {
    state.activeExpediente = null;
    state.uploadedFiles = [];
    state.ocrBusy = false;
    const input = document.getElementById('document-file-input');
    if (input) input.value = '';
    document.getElementById('lbl-cliente-correo').textContent = 'Seleccione un preset o arrastre archivos...';
    document.getElementById('lbl-cliente-fecha').textContent = '--/--/---- --:--';
    
    const btnScan = document.getElementById('btn-scan');
    if (btnScan) btnScan.disabled = true;
    
    // Clear dynamic Step 1 doc lists
    const listContainer = document.getElementById('doc-list-container');
    if (listContainer) {
        listContainer.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; color: #868e96; padding: 30px 0; font-size: 0.82rem;">
                Selecciona uno de los presets anteriores o arrastra archivos para iniciar el expediente.
            </div>
        `;
    }

    goToStep(1);
    showToast('Nueva solicitud de facturación iniciada.', 'info');
}

// Employee Role Switcher & Config Panel Management
function changeUserRole(roleId) {
    showToast('AutenticaciÃ³n y roles no configurados. No se cambiÃ³ la sesiÃ³n.', 'warning');
    return;

    if (roleId === 'brenda') {
        state.currentUser = {
            id: 'brenda',
            name: 'Brenda González',
            role: 'Administrador de Facturación',
            avatar: 'BG'
        };
    } else if (roleId === 'jose') {
        state.currentUser = {
            id: 'jose',
            name: 'José Pérez',
            role: 'Auditor Contable',
            avatar: 'JP'
        };
    }

    // Update Topbar
    document.querySelector('.user-avatar-gold').textContent = state.currentUser.avatar;
    document.querySelector('.user-name-top').textContent = state.currentUser.name;
    document.querySelector('.user-role-top').textContent = state.currentUser.role;

    // Add security log
    addSecurityLog('Cambio de Rol', `Sesión asumida por el usuario: ${state.currentUser.name}.`);
    renderBitacoraTable();

    showToast(`Rol cambiado: Bienvenido, ${state.currentUser.name}.`, 'success');
}

function saveConfiguration() {
    const smtpHost = document.getElementById('smtp-host').value;
    const smtpPort = document.getElementById('smtp-port').value;

    showToast('Guardando configuraciones...', 'info');

    setTimeout(() => {
        addSecurityLog('Configuración Actualizada', `Ajustes SMTP actualizados a ${smtpHost}:${smtpPort}.`);
        renderBitacoraTable();
        showToast('✓ Configuraciones generales guardadas correctamente.', 'success');
    }, 600);
}

// 9. Tables Dynamic Rendering Core Functions
function renderProcesoTable() {
    const tbody = document.getElementById('tbody-proceso');
    if (!tbody) return;

    tbody.innerHTML = '';
    // Show only non-completed dossiers (not Timbrado / Entregado)
    const inProcess = state.expedientes.filter(e => e.estatus !== 'Timbrado' && e.estatus !== 'Entregado');
    
    if (inProcess.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#868e96;">No hay solicitudes pendientes en proceso.</td></tr>`;
        return;
    }

    inProcess.forEach(e => {
        const tr = document.createElement('tr');
        
        let wizardStep = 1;
        if (e.estatus === 'Pago pendiente') wizardStep = 2;
        if (e.estatus === 'Pago validado') wizardStep = 3;
        if (e.estatus === 'Autorizado') wizardStep = 4;

        tr.innerHTML = `
            <td>${e.folio}</td>
            <td>${e.cliente}</td>
            <td>${e.fechaRecibo}</td>
            <td>
                <span class="badge badge-info">
                    <svg class="badge-icon-stroke" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    Fase ${wizardStep}: ${e.estatus}
                </span>
            </td>
            <td style="text-align: center;">
                <button class="btn btn-primary" onclick="resumeFlowAtStep(${wizardStep}, '${e.folio}')" style="padding: 6px 14px; font-size: 0.75rem;">Reanudar</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderCorreosTable() {
    const tbody = document.getElementById('tbody-correos');
    if (!tbody) return;

    tbody.innerHTML = '';
    state.historialCorreos.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${c.fecha}</td>
            <td>${c.destinatario}</td>
            <td class="col-folio">${c.folio}</td>
            <td>${c.adjuntos}</td>
            <td style="text-align: center;">
                <span class="badge badge-success">
                    <svg class="badge-icon" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
                    ${c.estatus}
                </span>
            </td>
            <td style="text-align: center;">
                <button class="btn btn-secondary" onclick="resendEmail('${c.destinatario}', '${c.folio}')" style="padding: 5px 10px; font-size: 0.72rem;">Reenviar</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderClientesTable() {
    const tbody = document.getElementById('tbody-clientes');
    if (!tbody) return;

    tbody.innerHTML = '';
    
    // Clients will come from the real database once authentication and
    // persistence are configured. Never seed the production UI with examples.
    const clients = [];

    clients.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-family: monospace; font-weight: 600;">${c.rfc}</td>
            <td class="col-cliente">${c.razon}</td>
            <td>${c.regimen}</td>
            <td>${c.cp}</td>
            <td>${c.email}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderBitacoraTable() {
    const tbody = document.getElementById('tbody-bitacora');
    if (!tbody) return;

    tbody.innerHTML = '';
    state.bitacoraSeguridad.forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="color: #6c757d;">${log.fecha}</td>
            <td style="font-weight: 600;">${log.usuario}</td>
            <td><span class="badge badge-pending">${log.accion || log.action}</span></td>
            <td style="color: #495057;">${log.detalles}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderReportTable() {
    const tbody = document.getElementById('tbody-report-invoices');
    if (!tbody) return;

    tbody.innerHTML = '';
    state.facturas.forEach(f => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="col-folio">${f.folioInterno}</td>
            <td>${f.folioRecibo}</td>
            <td class="col-cliente">${f.cliente}</td>
            <td style="color: #6c757d;">${f.fecha}</td>
            <td style="text-align: right; font-weight: 700; color: #212529;">$${f.importe.toFixed(2)}</td>
            <td style="text-align: center;">
                <span class="badge badge-success">
                    <svg class="badge-icon" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
                    ${f.estatus}
                </span>
            </td>
            <td style="text-align: center;">
                <div class="action-icon-group">
                    <button class="action-icon-btn btn-view" onclick="openInvoicePreviewModal('${f.folioInterno}', '${f.cliente}', '$${f.importe.toFixed(2)}')" title="Ver factura"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg></button>
                    <button class="action-icon-btn btn-dl-pdf" onclick="triggerDownload('FACTURA_${f.folioRecibo.replace('-', '')}.pdf')" title="Descargar PDF"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg></button>
                    <button class="action-icon-btn btn-dl-xml" onclick="triggerDownload('FACTURA_${f.folioRecibo.replace('-', '')}.xml')" title="Descargar XML"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg></button>
                    <button class="action-icon-btn btn-email" onclick="resendEmail('${state.activeExpediente ? state.activeExpediente.correo : 'facturacion@empresaejemplo.com'}', '${f.folioInterno}')" title="Enviar por correo"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    const showingText = document.getElementById('showing-results-text');
    if (showingText) {
        showingText.textContent = `Mostrando ${state.facturas.length} de ${state.facturas.length} resultados`;
    }
}

function updateDashboardCounts() {
    const timbradasEl = document.getElementById('dash-timbradas-count');
    const procEl = document.getElementById('dash-proc-count');
    const correosEl = document.getElementById('dash-correos-count');

    if (timbradasEl) timbradasEl.textContent = state.facturas.length;
    if (procEl) {
        // Dossiers in process are those not Timbrado or Entregado
        const procCount = state.expedientes.filter(e => e.estatus !== 'Timbrado' && e.estatus !== 'Entregado').length;
        procEl.textContent = procCount;
    }
    if (correosEl) correosEl.textContent = state.historialCorreos.length;
}

// 10. Audit logs and security helper functions
function addSecurityLog(action, details) {
    state.bitacoraSeguridad.unshift({
        fecha: getCurrentDateTimeString(),
        usuario: state.currentUser.name,
        action: action,
        detalles: details
    });
}

function generateMockUUID() {
    const chars = '0123456789ABCDEF';
    let uuid = '';
    for (let i = 0; i < 36; i++) {
        if (i === 8 || i === 13 || i === 18 || i === 23) {
            uuid += '-';
        } else {
            uuid += chars[Math.floor(Math.random() * 16)];
        }
    }
    return uuid;
}

function getCurrentDateTimeString() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'p.m.' : 'a.m.';
    hours = hours % 12;
    hours = hours ? hours : 12; // hour '0' should be '12'
    
    return `${day}/${month}/${year} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
}

// 11. Modal fiscal details update manual edits (Step 2 fallback)
function openEditModal() {
    if (!state.activeExpediente) return;
    document.getElementById('edit-rfc').value = state.activeExpediente.rfc;
    document.getElementById('edit-razon').value = state.activeExpediente.cliente;
    document.getElementById('edit-regimen').value = state.activeExpediente.regimenFiscal;
    document.getElementById('edit-cp').value = state.activeExpediente.codigoPostal;
    document.getElementById('edit-cfdi').value = state.activeExpediente.usoCfdi;
    document.getElementById('edit-correo').value = state.activeExpediente.correo;

    document.getElementById('modal-edit-fiscal').classList.add('open');
}

function saveFiscalData(event) {
    event.preventDefault();
    if (!state.activeExpediente) return;
    
    state.activeExpediente.rfc = document.getElementById('edit-rfc').value.trim().toUpperCase();
    state.activeExpediente.cliente = document.getElementById('edit-razon').value.trim();
    state.activeExpediente.regimenFiscal = document.getElementById('edit-regimen').value.trim();
    state.activeExpediente.codigoPostal = document.getElementById('edit-cp').value.trim();
    state.activeExpediente.usoCfdi = document.getElementById('edit-cfdi').value.trim();
    state.activeExpediente.correo = document.getElementById('edit-correo').value.trim();

    addAuditLogToActive('Datos fiscales modificados manualmente por el usuario.');
    addSecurityLog('Modificación Datos Fiscales', `Datos fiscales del expediente ${state.activeExpediente.folio} modificados.`);

    // Re-render
    updateStep2Fields();
    updatePreviewFields();
    renderTimeline();

    closeModal('modal-edit-fiscal');
    showToast('Datos fiscales actualizados correctamente.', 'success');
}

// Document Preview window
function previewDocument(docName, type) {
    showToast(`Abriendo visor de documentos para ${docName}...`, 'info');

    const dossier = state.activeExpediente;
    const hasExtractedData = dossier && (dossier.rfc || dossier.cliente || Number.isFinite(Number(dossier.importe)) && dossier.importe > 0);
    const previewName = hasExtractedData && dossier.cliente !== 'Pendiente de lectura' ? dossier.cliente : docName;
    const previewRfc = hasExtractedData && dossier.rfc ? dossier.rfc : 'OCR pendiente';
    const previewRegimen = hasExtractedData && dossier.regimenFiscal ? dossier.regimenFiscal : 'Pendiente de confirmación';
    const previewCfdi = hasExtractedData && dossier.usoCfdi ? dossier.usoCfdi : `Tipo de archivo: ${type}`;
    const numericTotal = hasExtractedData ? Number(dossier.importe) : NaN;

    document.getElementById('pdf-folio').textContent = hasExtractedData ? dossier.folio : 'RECIBO-CIS-MOCK';
    document.getElementById('pdf-receptor-name').textContent = previewName;
    document.getElementById('pdf-receptor-rfc').textContent = previewRfc;
    document.getElementById('pdf-receptor-regimen').textContent = previewRegimen;
    document.getElementById('pdf-receptor-cfdi').textContent = previewCfdi;
    const conceptoPreview = document.getElementById('pdf-concepto');
    if (conceptoPreview) conceptoPreview.textContent = hasExtractedData && dossier.concepto ? dossier.concepto : 'Información extraída del documento';

    const uuidBox = document.getElementById('pdf-uuid-val');
    if (uuidBox) {
        uuidBox.textContent = dossier?.uuid || 'PREVISUALIZACION-OCR-SIN-TIMBRAR';
    }

    if (Number.isFinite(numericTotal) && numericTotal > 0) {
        const subtotal = numericTotal / 1.16;
        const iva = numericTotal - subtotal;
        document.getElementById('pdf-unit-price').textContent = `$${subtotal.toFixed(2)}`;
        document.getElementById('pdf-subtotal').textContent = `$${subtotal.toFixed(2)}`;
        document.getElementById('pdf-iva').textContent = `$${iva.toFixed(2)}`;
        document.getElementById('pdf-total').textContent = `$${numericTotal.toFixed(2)}`;
    } else {
        document.getElementById('pdf-unit-price').textContent = '-';
        document.getElementById('pdf-subtotal').textContent = '-';
        document.getElementById('pdf-iva').textContent = '-';
        document.getElementById('pdf-total').textContent = '-';
    }

    setTimeout(() => {
        document.getElementById('modal-invoice-preview').classList.add('open');
    }, 400);
}

// Toast Notifications Helper
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconSvg = '';
    if (type === 'success') {
        iconSvg = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:18px;height:18px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
    } else if (type === 'info') {
        iconSvg = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:18px;height:18px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
    } else if (type === 'error') {
        iconSvg = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:18px;height:18px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v4m0 4h.01M10.29 3.86l-7.2 12.48A2 2 0 004.82 19h14.36a2 2 0 001.73-2.66l-7.2-12.48a2 2 0 00-3.42 0z"/></svg>`;
    } else if (type === 'warning') {
        iconSvg = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:18px;height:18px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`;
    }

    toast.innerHTML = `
        ${iconSvg}
        <span>${message}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-out');
        toast.addEventListener('animationend', () => {
            toast.remove();
        });
    }, 4000);
}
