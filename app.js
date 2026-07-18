// COEPRISS Sinaloa - Billing & Stamping System Controller

// Application State
const state = {
    rfc: 'EEM010101XXX',
    razonSocial: 'Empresa Ejemplo, S.A. de C.V.',
    regimenFiscal: '601 - General de Ley Personas Morales',
    codigoPostal: '80000',
    usoCfdi: 'G03 - Gastos en general',
    correo: 'facturacion@empresaejemplo.com',
    currentStep: 1,
    xmlUploaded: true,
    pdfUploaded: true
};

// Document Load Init
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initDragAndDrop();
    
    // Start at Dashboard
    goToPanel('panel-inicio');
    updatePreviewFields();
});

// 1. Navigation & Panel Control
function initNavigation() {
    // Header Stepper Node Click
    const stepNodes = document.querySelectorAll('.step-node');
    stepNodes.forEach(node => {
        node.addEventListener('click', () => {
            const step = parseInt(node.getAttribute('data-step'));
            goToStep(step);
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
                goToStep(1); // Wizard step 1
            } else if (id === 'nav-proceso') {
                item.classList.add('active');
                goToPanel('panel-proceso');
            } else if (id === 'nav-timbradas') {
                item.classList.add('active');
                goToStep(7); // Wizard step 7 represents "Facturas timbradas"
            } else if (id === 'nav-correos') {
                item.classList.add('active');
                goToPanel('panel-correos');
            } else if (id === 'nav-reportes') {
                item.classList.add('active');
                goToStep(7); // Wizard step 7 is the general report
            } else if (id === 'nav-clientes') {
                item.classList.add('active');
                goToPanel('panel-clientes');
            } else if (id === 'nav-config') {
                item.classList.add('active');
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

function resumeFlowAtStep(wizardStep) {
    showToast(`Reanudando flujo en el paso ${wizardStep}...`, 'info');
    
    // Highlight "Nueva solicitud" sidebar link
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active', 'active-pulse'));
    const navSolicitud = document.getElementById('nav-solicitud');
    if (navSolicitud) navSolicitud.classList.add('active-pulse');

    goToStep(wizardStep);
}

function resendEmail(email, folio) {
    showToast(`Reenviando factura ${folio} a: ${email}...`, 'info');
    setTimeout(() => {
        showToast(`✓ Factura reenviada con éxito a: ${email}`, 'success');
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

    window.scrollTo({ top: 0, behavior: 'smooth' });
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
function startScanAnimation() {
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
        showToast('Documentos procesados con éxito. Datos extraídos.', 'success');
        goToStep(2);
        
        // Remove from pending in process tab as simulated state progression
        const dashProc = document.getElementById('dash-proc-count');
        if (dashProc) dashProc.textContent = '2';
    }, 1800);
}

// 3. Step 2: Edit Fiscal Data Modals
function openEditModal() {
    document.getElementById('edit-rfc').value = state.rfc;
    document.getElementById('edit-razon').value = state.razonSocial;
    document.getElementById('edit-regimen').value = state.regimenFiscal;
    document.getElementById('edit-cp').value = state.codigoPostal;
    document.getElementById('edit-cfdi').value = state.usoCfdi;
    document.getElementById('edit-correo').value = state.correo;

    document.getElementById('modal-edit-fiscal').classList.add('open');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('open');
}

function saveFiscalData(event) {
    event.preventDefault();
    
    state.rfc = document.getElementById('edit-rfc').value.trim().toUpperCase();
    state.razonSocial = document.getElementById('edit-razon').value.trim();
    state.regimenFiscal = document.getElementById('edit-regimen').value.trim();
    state.codigoPostal = document.getElementById('edit-cp').value.trim();
    state.usoCfdi = document.getElementById('edit-cfdi').value.trim();
    state.correo = document.getElementById('edit-correo').value.trim();

    // Update Step 2 View Fields
    document.getElementById('val-rfc').textContent = state.rfc;
    document.getElementById('val-razon').textContent = state.razonSocial;
    document.getElementById('val-regimen').textContent = state.regimenFiscal;
    document.getElementById('val-cp').textContent = state.codigoPostal;
    document.getElementById('val-cfdi').textContent = state.usoCfdi;
    document.getElementById('val-correo').textContent = state.correo;

    // Update Step 3 Preview Fields
    updatePreviewFields();

    closeModal('modal-edit-fiscal');
    showToast('Datos fiscales actualizados correctamente.', 'success');
}

function updatePreviewFields() {
    document.querySelectorAll('.preview-rfc').forEach(el => el.textContent = state.rfc);
    document.querySelectorAll('.preview-razon').forEach(el => el.textContent = state.razonSocial);
    document.querySelectorAll('.preview-regimen').forEach(el => el.textContent = state.regimenFiscal);
    document.querySelectorAll('.preview-cp').forEach(el => el.textContent = state.codigoPostal);
    document.querySelectorAll('.preview-cfdi').forEach(el => el.textContent = state.usoCfdi);
    document.querySelectorAll('.preview-correo').forEach(el => el.textContent = state.correo);
}

// 4. Step 4: Generación XML & SAT
function downloadXML() {
    showToast('Generando archivo XML...', 'info');
    
    const mockXML = `<?xml version="1.0" encoding="utf-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="F" Folio="00045" Fecha="2026-07-16T11:30:00" SubTotal="1000.00" Total="1160.00" Moneda="MXN" TipoDeComprobante="I" Exportacion="01" MetodoPago="PUE" LugarExpedicion="80000">
    <cfdi:Emisor Rfc="CEP050915XXX" Nombre="COMISION ESTATAL PARA LA PROTECCION CONTRA RIESGOS SANITARIOS DE SINALOA" RegimenFiscal="603"/>
    <cfdi:Receptor Rfc="${state.rfc}" Nombre="${state.razonSocial.toUpperCase()}" DomicilioFiscalReceptor="${state.codigoPostal}" RegimenFiscalReceptor="${state.regimenFiscal.split(' ')[0]}" UsoCFDI="${state.usoCfdi.split(' ')[0]}"/>
    <cfdi:Conceptos>
        <cfdi:Concepto ClaveProdServ="90101500" Cantidad="1" ClaveUnidad="E48" Unidad="Servicio" Descripcion="Servicio de tramite de COEPRISS" ValorUnitario="1000.00" Importe="1000.00" ObjetoImp="02">
            <cfdi:Impuestos>
                <cfdi:Traslados>
                    <cfdi:Traslado Base="1000.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="160.00"/>
                </cfdi:Traslados>
            </cfdi:Impuestos>
        </cfdi:Concepto>
    </cfdi:Conceptos>
</cfdi:Comprobante>`;

    setTimeout(() => {
        triggerBrowserDownload('FACTURA_REC000245.xml', mockXML, 'text/xml');
        showToast('✓ XML descargado correctamente.', 'success');
    }, 600);
}

function openSatPortal() {
    showToast('Abriendo portal oficial del SAT en una pestaña nueva...', 'info');
    setTimeout(() => {
        window.open('https://www.sat.gob.mx/', '_blank');
    }, 800);
}

// 5. Step 5: Carga de archivos timbrados
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
function initDragAndDrop() {
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
        }
    }, false);
}

// 6. Step 6: Factura Timbrada Actions
function openInvoicePreviewModal(folio = 'F-00045', clientName = state.razonSocial, totalVal = '$1,160.00') {
    document.getElementById('pdf-folio').textContent = folio;
    document.getElementById('pdf-receptor-name').textContent = clientName;
    document.getElementById('pdf-receptor-rfc').textContent = clientName === state.razonSocial ? state.rfc : 'XAXX010101000';
    document.getElementById('pdf-receptor-cfdi').textContent = clientName === state.razonSocial ? state.usoCfdi : 'G03 - Gastos en general';
    
    const numericTotal = parseFloat(totalVal.replace('$', '').replace(',', ''));
    const numericSubtotal = numericTotal / 1.16;
    const numericIva = numericTotal - numericSubtotal;

    document.getElementById('pdf-unit-price').textContent = `$${numericSubtotal.toFixed(2)}`;
    document.getElementById('pdf-subtotal').textContent = `$${numericSubtotal.toFixed(2)}`;
    document.getElementById('pdf-iva').textContent = `$${numericIva.toFixed(2)}`;
    document.getElementById('pdf-total').textContent = totalVal;

    document.getElementById('modal-invoice-preview').classList.add('open');
}

function sendInvoiceByEmail() {
    showToast(`Enviando factura por correo a: ${state.correo}...`, 'info');
    
    setTimeout(() => {
        showToast(`✓ Factura enviada con éxito a: ${state.correo}`, 'success');
        
        setTimeout(() => {
            goToStep(7);
        }, 800);
    }, 1200);
}

// Helper to trigger dummy download
function triggerDownload(filename) {
    showToast(`Descargando archivo: ${filename}...`, 'info');
    setTimeout(() => {
        let content = '';
        let contentType = '';
        
        if (filename.endsWith('.pdf')) {
            content = '%PDF-1.5 MOCK PDF DATA COEPRISS SINALOA BILLING';
            contentType = 'application/pdf';
        } else {
            content = '<cfdi:Comprobante Version="4.0" xmlns:cfdi="http://www.sat.gob.mx/cfd/4"/>';
            contentType = 'text/xml';
        }
        
        triggerBrowserDownload(filename, content, contentType);
        showToast(`✓ Descarga finalizada: ${filename}`, 'success');
    }, 800);
}

// Actual browser trigger downloader
function triggerBrowserDownload(filename, text, mimeType) {
    const element = document.createElement('a');
    const file = new Blob([text], {type: mimeType});
    element.href = URL.createObjectURL(file);
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}

// 7. Step 7: Filter table and dashboard controls
function filterReportTable() {
    const input = document.getElementById('search-report');
    const filter = input.value.toLowerCase();
    const table = document.getElementById('table-invoices');
    const tr = table.getElementsByTagName('tr');
    let matchesCount = 0;

    for (let i = 1; i < tr.length; i++) {
        let rowMatch = false;
        const tds = tr[i].getElementsByTagName('td');
        
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

function restartProcess() {
    goToStep(1);
    showToast('Nueva solicitud iniciada.', 'info');
}

// Custom Document Preview handler (Simulation)
function previewDocument(docName, type) {
    showToast(`Abriendo visor de documentos para ${docName}...`, 'info');
    
    document.getElementById('pdf-folio').textContent = 'RECIBO-CIS-MOCK';
    document.getElementById('pdf-receptor-name').textContent = docName;
    document.getElementById('pdf-receptor-rfc').textContent = 'DETALLE DOCUMENTO';
    document.getElementById('pdf-receptor-cfdi').textContent = `Tipo: ${type}`;
    document.getElementById('pdf-unit-price').textContent = '-';
    document.getElementById('pdf-subtotal').textContent = '-';
    document.getElementById('pdf-iva').textContent = '-';
    document.getElementById('pdf-total').textContent = '-';

    setTimeout(() => {
        document.getElementById('modal-invoice-preview').classList.add('open');
    }, 400);
}

// Toast Notification System
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
