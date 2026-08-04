// COEPRISS Sinaloa - Billing & Stamping System Controller

// Application State
const state = {
    // Current Wizard Active Dossier (loaded from presets or created from scratch)
    activeExpediente: null,
    
    // El usuario se obtiene exclusivamente de Firebase Authentication.
    currentUser: null,

    // CSD Certificate State
    csd: {
        uploaded: false,
        certName: '',
        keyName: '',
        expiry: '',
        password: ''
    },

    // Datos reales: se cargan desde Firebase después de autenticar al usuario.
    expedientes: [],
    facturas: [],
    historialCorreos: [],
    bitacoraSeguridad: [],

    currentStep: 1,
    xmlUploaded: false,
    pdfUploaded: false,

    // Archivos reales seleccionados en el navegador. Se mantienen solo durante
    // la sesión para no enviar documentos fiscales a un servicio externo.
    uploadedFiles: [],
    ocrWorker: null,
    ocrBusy: false,
    scanPreviewUrl: '',
    scanQuality: null,
    lastOcrFields: null
};

let inactivityTimer = null;
let inactivityListenersAttached = false;
let inactivityResetHandler = null;

// ── RENDER POSTGRESQL / JWT AUTH ENGINE ──
function getJwtToken() { return sessionStorage.getItem('coepriss_jwt') || null; }
function setJwtToken(t) { sessionStorage.setItem('coepriss_jwt', t); }
function clearJwtToken() { sessionStorage.removeItem('coepriss_jwt'); sessionStorage.removeItem('coepriss_user'); }
function getStoredUser() { try { return JSON.parse(sessionStorage.getItem('coepriss_user')); } catch { return null; } }
function storeUser(u) { sessionStorage.setItem('coepriss_user', JSON.stringify(u)); }
function apiFetch(url, options = {}) {
    const token = getJwtToken();
    return fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}), ...(options.headers || {}) } });
}

function getCloudData() {
    return {
        expedientes: state.expedientes,
        facturas: state.facturas,
        historialCorreos: state.historialCorreos,
        bitacoraSeguridad: state.bitacoraSeguridad
    };
}

function resetCloudCollections() {
    state.expedientes = [];
    state.facturas = [];
    state.historialCorreos = [];
    state.bitacoraSeguridad = [];
}

function renderCloudCollections() {
    renderProcesoTable();
    renderCorreosTable();
    renderClientesTable();
    renderBitacoraTable();
    renderReportTable();
    updateDashboardCounts();
}

// Render PostgreSQL Sync Controller (authenticated with JWT)
function initRenderDbSync() {
    apiFetch('/api/db')
        .then(res => res.json())
        .then(res => {
            if (res.success && res.data) {
                resetCloudCollections();
                if (Array.isArray(res.data.expedientes)) state.expedientes = res.data.expedientes;
                if (Array.isArray(res.data.facturas)) state.facturas = res.data.facturas;
                if (Array.isArray(res.data.historialCorreos)) state.historialCorreos = res.data.historialCorreos;
                if (Array.isArray(res.data.bitacoraSeguridad)) state.bitacoraSeguridad = res.data.bitacoraSeguridad;
                renderCloudCollections();
            }
        })
        .catch(err => console.info('[PostgreSQL Render] Datos en espera:', err.message));
}

function activateAuthenticatedSession(user) {
    const nombre = user.nombre || user.name || user.nombreCompleto || 'Usuario COEPRISS';
    state.currentUser = {
        id: user.id,
        name: nombre,
        role: user.rol || user.role || 'Administrador',
        avatar: user.avatar || nombre.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    };
    storeUser(state.currentUser);
    hideLoginError();
    showAuthenticatedUi();
    initRenderDbSync();
    initInactivityTimer();
}

// Zero-Delay optimistic write to PostgreSQL (Render) via JWT
async function saveDatabaseToStorage() {
    window.dispatchEvent(new Event('coepriss_db_updated'));
    const payload = getCloudData();
    apiFetch('/api/sync', { method: 'POST', body: JSON.stringify(payload) })
        .then(r => r.json())
        .then(r => { if (r.success) console.log('⚡ PostgreSQL Render: datos guardados correctamente.'); })
        .catch(err => console.info('[PostgreSQL Render] Guardado diferido:', err.message));
    return true;
}

function loadDatabaseFromStorage() {
    resetCloudCollections();
    initRenderDbSync();
}

// Session Guard: verifica JWT activo en PostgreSQL de Render
function checkAuthSession() {
    const token = getJwtToken();
    const user = getStoredUser();
    if (token && user) {
        apiFetch('/api/auth/me')
            .then(res => res.json())
            .then(res => {
                if (res.success) { activateAuthenticatedSession({ ...user, ...res.user }); }
                else { clearJwtToken(); showLoginUi(); }
            })
            .catch(() => activateAuthenticatedSession(user));
        return true;
    }
    showLoginUi();
    return false;
}

function handleLoginSubmit(event) {
    event.preventDefault();
    signInWithSystemPassword();
}

function getLoginCredentials() {
    const username = document.getElementById('login-username')?.value.trim().toLowerCase() || '';
    const password = document.getElementById('login-password')?.value || '';
    return { username, password };
}

function setLoginBusy(isBusy, message) {
    const loginButton = document.getElementById('btn-system-login');
    if (loginButton) {
        loginButton.disabled = isBusy;
        loginButton.querySelector('span').textContent = isBusy ? message : 'Ingresar';
    }
}

// Login via JWT contra PostgreSQL en Render
async function signInWithSystemPassword() {
    const { username, password } = getLoginCredentials();
    if (!username || !password) { showLoginError('Ingresa tu usuario y contraseña.'); return; }
    setLoginBusy(true, 'Ingresando…');
    hideLoginError();
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            showLoginError(data.error || 'El usuario o la contraseña no son correctos.');
            return;
        }
        setJwtToken(data.token);
        activateAuthenticatedSession(data.user);
        showToast(`Bienvenido(a) ${data.user.nombre} (${data.user.rol}).`, 'success');
    } catch (err) {
        showLoginError('No fue posible conectar con el servidor. Verifica tu conexión.');
    } finally {
        setLoginBusy(false);
    }
}

async function handleLogout() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch (e) {}
    clearJwtToken();
    state.currentUser = null;
    resetCloudCollections();
    showToast('Sesión cerrada correctamente.', 'info');
    showLoginUi();
}

function showLoginUi() {
    const loginContainer = document.getElementById('login-container');
    const appContainer = document.getElementById('app-main-container');
    if (loginContainer) loginContainer.style.display = 'flex';
    if (appContainer) appContainer.style.display = 'none';
}

function showAuthenticatedUi() {
    const loginContainer = document.getElementById('login-container');
    const appContainer = document.getElementById('app-main-container');
    if (loginContainer) loginContainer.style.display = 'none';
    if (appContainer) appContainer.style.display = 'flex';

    updateUserHeaderUi();
    renderCloudCollections();
    goToPanel('panel-inicio');
}

function showLoginError(msg) {
    const errBox = document.getElementById('login-error-msg');
    if (errBox) {
        errBox.textContent = msg;
        errBox.style.display = 'block';
    }
}

function hideLoginError() {
    const errBox = document.getElementById('login-error-msg');
    if (errBox) {
        errBox.style.display = 'none';
    }
}

function updateUserHeaderUi() {
    const u = state.currentUser;
    if (!u) return;

    document.querySelectorAll('.user-avatar-gold, .user-avatar').forEach(el => el.textContent = u.avatar || 'UA');
    document.querySelectorAll('.user-name-top, .user-name').forEach(el => el.textContent = u.name || 'Usuario autorizado');
    document.querySelectorAll('.user-role-top, .user-role').forEach(el => el.textContent = u.role || 'Usuario autorizado');
}

function initInactivityTimer() {
    if (!inactivityListenersAttached) {
        inactivityResetHandler = () => {
            if (!getJwtToken()) return;
            if (inactivityTimer) clearTimeout(inactivityTimer);
            inactivityTimer = setTimeout(() => {
                if (getJwtToken()) {
                    showToast('Su sesión ha expirado por inactividad.', 'warning');
                    handleLogout();
                }
            }, 900000); // 15 minutos
        };
        ['mousemove', 'keydown', 'click', 'scroll'].forEach(evt => {
            window.addEventListener(evt, inactivityResetHandler, { passive: true });
        });
        inactivityListenersAttached = true;
    }
    inactivityResetHandler();
}

function sanitizeUnconfiguredUi() {
    // Keep UI ready and responsive
    updateUserHeaderUi();
}

function initGlobalButtonActions() {
    const notificationButton = document.querySelector('.btn-notification');
    if (notificationButton) {
        notificationButton.type = 'button';
        notificationButton.setAttribute('aria-label', 'Notificaciones del sistema');
        notificationButton.addEventListener('click', event => {
            event.stopPropagation();
            showSystemNotifications();
        });
    }

    const filtersButton = Array.from(document.querySelectorAll('#step-panel-7 button'))
        .find(button => button.textContent.trim() === 'Filtros');
    if (filtersButton) {
        filtersButton.type = 'button';
        filtersButton.addEventListener('click', toggleReportFilters);
    }

    document.addEventListener('click', event => {
        const panel = document.getElementById('system-notifications-panel');
        if (panel && !panel.contains(event.target) && !notificationButton?.contains(event.target)) panel.remove();
    });
}

function showSystemNotifications() {
    const existing = document.getElementById('system-notifications-panel');
    if (existing) {
        existing.remove();
        return;
    }
    const button = document.querySelector('.btn-notification');
    if (!button) return;
    const panel = document.createElement('div');
    panel.id = 'system-notifications-panel';
    panel.className = 'system-notifications-panel';
    panel.innerHTML = [
        '<strong>Estado del sistema</strong>',
        '<div class="system-notice notice-ok">OCR local disponible</div>',
        '<div class="system-notice notice-warning">PAC y correo: requieren backend y credenciales</div>'
    ].join('');
    button.parentElement.appendChild(panel);
}

function openRequiredConfiguration(step) {
    const requirements = {
        4: 'Configura un backend y las credenciales Sandbox o productivas de un PAC autorizado.',
        5: 'Configura la recepcion segura del XML y PDF timbrados desde el backend.',
        6: 'Primero debe existir un UUID y archivos fiscales reales devueltos por el PAC.'
    };
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active', 'active-pulse'));
    document.getElementById('nav-config')?.classList.add('active');
    goToPanel('panel-config');
    showToast(requirements[step] || 'La funcion requiere configuracion de backend.', 'warning');
}

function goBackFromServiceStep(step) {
    if (!state.activeExpediente) {
        goToStep(1);
        showToast('Regresaste a recepcion porque aun no hay un documento procesado.', 'info');
        return;
    }
    goToStep(Math.max(1, step - 1));
}

function toggleReportFilters() {
    let panel = document.getElementById('report-filter-panel');
    if (panel) {
        panel.hidden = !panel.hidden;
        return;
    }
    const header = document.querySelector('#step-panel-7 .table-actions-header');
    if (!header) return;
    panel = document.createElement('div');
    panel.id = 'report-filter-panel';
    panel.className = 'report-filter-panel';
    panel.innerHTML = '<label>Estatus <select id="report-status-filter" class="form-control"><option value="">Todos</option><option value="timbrada">Timbrada</option><option value="entregada">Entregada</option></select></label><button type="button" class="btn btn-secondary" id="btn-clear-report-filters">Limpiar</button>';
    header.insertAdjacentElement('afterend', panel);
    document.getElementById('report-status-filter').addEventListener('change', filterReportTable);
    document.getElementById('btn-clear-report-filters').addEventListener('click', () => {
        const search = document.getElementById('search-report');
        const status = document.getElementById('report-status-filter');
        if (search) search.value = '';
        if (status) status.value = '';
        filterReportTable();
    });
}

function setReportPage(page) {
    if (page !== 1 || state.facturas.length === 0) {
        showToast('No hay mas paginas de resultados en esta sesion.', 'info');
        return;
    }
    showToast('Pagina 1 de resultados.', 'info');
}

function initConfigurationControls() {
    const certificate = document.getElementById('csd-cer-file');
    const privateKey = document.getElementById('csd-key-file');
    const status = document.getElementById('csd-status');
    const updateCsdSelection = () => {
        if (!status) return;
        const selected = [certificate?.files?.[0]?.name, privateKey?.files?.[0]?.name].filter(Boolean);
        status.textContent = selected.length
            ? 'Seleccion local: ' + selected.join(' / ') + '. Pendiente de validacion por el backend.'
            : 'CSD no configurado. Selecciona .cer y .key; no se subiran desde esta pagina estatica.';
        status.style.color = selected.length === 2 ? 'var(--warning-color)' : '#6c757d';
    };
    certificate?.addEventListener('change', updateCsdSelection);
    privateKey?.addEventListener('change', updateCsdSelection);

    try {
        const saved = JSON.parse(sessionStorage.getItem('coepriss-session-config') || '{}');
        if (saved.smtpHost) document.getElementById('smtp-host').value = saved.smtpHost;
        if (saved.smtpPort) document.getElementById('smtp-port').value = saved.smtpPort;
    } catch (error) {
        console.info('No se pudo restaurar la configuracion de esta sesion:', error);
    }
}

// Document Log Init
document.addEventListener('DOMContentLoaded', () => {
    loadDatabaseFromStorage();
    const isAuthenticated = checkAuthSession();

    initNavigation();
    initDragAndDrop();
    initDocumentPicker();
    initGlobalButtonActions();
    initConfigurationControls();
    
    // Render dynamic data in tables
    renderProcesoTable();
    renderCorreosTable();
    renderClientesTable();
    renderBitacoraTable();
    renderReportTable();
    updateDashboardCounts();
    
    window.addEventListener('coepriss_db_updated', () => {
        renderCloudCollections();
    });

    if (isAuthenticated) {
        goToPanel('panel-inicio');
    }
});

// 1. Navigation & Panel Control
function initNavigation() {
    // Header Stepper Node Click
    const stepNodes = document.querySelectorAll('.step-node');
    stepNodes.forEach(node => {
        node.addEventListener('click', () => {
            const step = parseInt(node.getAttribute('data-step'));
            if (step === 1) {
                goToStep(1);
            } else if (step === 7) {
                renderReportTable();
                goToStep(7);
            } else if ([4, 5, 6].includes(step)) {
                goToStep(step);
                showToast('Este paso abre correctamente, pero requiere configurar el servicio real indicado.', 'warning');
            } else if (state.activeExpediente) {
                goToStep(step);
            } else {
                showToast('Primero carga y procesa un documento real para abrir este paso.', 'warning');
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
    showToast('Envío de correo no configurado: no se envió ningún mensaje.', 'warning');
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
            state.activeExpediente.estatus = 'Datos extraídos';
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
        usoCfdi: '',
        correo: '',
        importe: 0,
        importePago: null,
        fechaRecibo: getCurrentDateTimeString(),
        concepto: '',
        folioRecibo: '',
        banco: '',
        bancoEmisor: '',
        bancoReceptor: '',
        bancoEmisorCodigo: '',
        bancoReceptorCodigo: '',
        fechaPago: '',
        referencia: '',
        claveRastreo: '',
        cuentaBeneficiaria: '',
        formaPago: '',
        moneda: '',
        rfcEmisor: '',
        nombreEmisor: '',
        regimenFiscalEmisor: '',
        fechaEmision: '',
        fechaCertificacion: '',
        claveProdServ: '',
        cantidad: '',
        claveUnidad: '',
        unidad: '',
        valorUnitario: null,
        importeLinea: null,
        objetoImpuesto: '',
        metodoPago: '',
        subtotal: null,
        noSerieCsd: '',
        rfcProveedorCertificacion: '',
        noSerieCertificadoSat: '',
        estatus: 'Recibido',
        tipoCfdi: '',
        uuid: '',
        archivos: [],
        auditoria: [`[${getCurrentDateTimeString()}] Tramite recibido mediante carga de documentos.`]
    };
    state.expedientes.unshift(state.activeExpediente);
    renderProcesoTable();
    updateDashboardCounts();
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
        state.lastOcrFields = fields;
        applyExtractedFields(fields);
        const needsReview = !state.scanQuality || state.scanQuality.level !== 'alta' || countReliableOcrFields(fields) < 5;
        state.uploadedFiles.forEach(file => {
            file.status = needsReview ? 'OCR completado - requiere revision' : 'Leido correctamente (OCR local)';
        });
        if (state.activeExpediente) {
            state.activeExpediente.archivos.forEach(file => {
                file.status = needsReview ? 'OCR completado - requiere revision' : 'Leido correctamente (OCR local)';
            });
            state.activeExpediente.estatus = 'Pago pendiente';
            addAuditLogToActive('Documentos procesados mediante OCR local. Datos pendientes de confirmacion.');
            addSecurityLog('OCR local', `Lectura del expediente ${state.activeExpediente.folio} finalizada en el navegador.`);
        }
        renderDocumentList();
        updateStep2Fields();
        updateOcrResultAlert(fields);
        updatePreviewFields();
        renderTimeline();
        updatePaymentValidationUI();
        showToast('Lectura terminada. Revisa o corrige los datos extraídos antes de continuar.', 'info');
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
            allText += `\n${await recognizeImageWithFallback(uploaded.file, uploaded)}`;
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
    return enforceOcrQualityGate(parseExtractedFields(allText));
}

function enforceOcrQualityGate(fields) {
    if (!fields || state.scanQuality?.level !== 'baja') return fields;
    const hasFiscalAnchor = Boolean(fields.uuid) || Boolean(fields.rfcEmisor && fields.rfcReceptor);
    const hasBankAnchor = Boolean(
        (fields.claveRastreo || fields.referencia)
        && Number.isFinite(fields.importePago)
        && fields.fechaPago
    );
    const hasReceiptAnchor = Boolean(fields.folioRecibo && Number.isFinite(fields.importePago));
    if (hasFiscalAnchor || hasBankAnchor || hasReceiptAnchor) return fields;

    const rejected = {};
    Object.keys(fields).forEach(key => {
        if (key === 'confidence') return;
        rejected[key] = typeof fields[key] === 'number' ? null : '';
    });
    rejected.confidence = Object.fromEntries(Object.keys(fields.confidence || {}).map(key => [key, 0]));
    rejected.qualityRejected = true;
    return rejected;
}

// A full-page OCR pass can miss table cells because the borders confuse the
// page segmentation model. If that happens, read horizontal bands as a
// lightweight fallback. It keeps the work local to the employee's browser.
async function recognizeImageWithFallback(file, uploadedRecord = null) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;
    // A 480p photograph needs much more than the old 1.85x enlargement.
    // Scale adaptively until the photographed page is about 1800x2400, but
    // cap memory so the browser remains responsive on ordinary office PCs.
    const scale = Math.min(
        5.5,
        2600 / bitmap.width,
        3200 / bitmap.height,
        Math.max(1.85, 1800 / bitmap.width, 2400 / bitmap.height)
    );
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const sourceContext = canvas.getContext('2d');
    sourceContext.imageSmoothingEnabled = true;
    sourceContext.imageSmoothingQuality = 'high';
    sourceContext.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (typeof bitmap.close === 'function') bitmap.close();

    // First normalize the photograph like a document-scanner app: remove the
    // desk/hand margins and enlarge the sheet before Tesseract sees it.
    const scanCanvas = createDocumentScanCanvas(canvas);
    const quality = assessScanQuality(scanCanvas, originalWidth, originalHeight);
    state.scanQuality = quality;

    // Keep the corrected sheet so the employee can verify the framing and
    // compare every extracted value with the real source image.
    const readableCanvas = createEnhancedOcrCanvas(scanCanvas);
    // The preview preserves the real tones of the photographed sheet. The
    // stronger black-and-white enhancement is used only by Tesseract so the
    // employee does not mistake OCR artifacts for content in the source.
    const previewUrl = scanCanvas.toDataURL('image/jpeg', 0.94);
    state.scanPreviewUrl = previewUrl;
    if (uploadedRecord) {
        uploadedRecord.scanPreviewUrl = previewUrl;
        uploadedRecord.scanQuality = quality;
    }
    // Put the focused passes first. Tesseract can misread a small label in a
    // full-page photograph; parseExtractedFields keeps the first matching
    // value, so the cleaner regional reads must have priority.
    let text = '';

    // One full-page pass is not enough for two-column CFDIs. These focused
    // passes spend a little more local CPU, but prevent small labels and the
    // concepts/payment blocks from being lost in the page layout.
    const regions = quality.level === 'baja'
        ? [
            { name: 'encabezado izquierdo', left: 0.01, right: 0.52, top: 0.02, bottom: 0.38, psm: '6' },
            { name: 'encabezado derecho', left: 0.50, right: 0.99, top: 0.02, bottom: 0.38, psm: '6' },
            { name: 'conceptos', left: 0.01, right: 0.99, top: 0.28, bottom: 0.59, psm: '11' },
            { name: 'pago', left: 0.01, right: 0.99, top: 0.50, bottom: 0.76, psm: '6' },
            { name: 'certificacion', left: 0.01, right: 0.99, top: 0.70, bottom: 0.99, psm: '11' }
        ]
        : [
            { name: 'encabezado izquierdo', left: 0.01, right: 0.52, top: 0.02, bottom: 0.38, psm: '6' },
            { name: 'encabezado derecho', left: 0.50, right: 0.99, top: 0.02, bottom: 0.38, psm: '6' },
            { name: 'conceptos', left: 0.01, right: 0.99, top: 0.27, bottom: 0.60, psm: '11' },
            { name: 'pago', left: 0.01, right: 0.99, top: 0.50, bottom: 0.76, psm: '6' }
        ];
    for (const region of regions) {
        const regionCanvas = createOcrRegionCanvas(readableCanvas, region.top, region.bottom, region.left, region.right);
        const button = document.getElementById('btn-scan');
        if (button) button.textContent = `Leyendo zona ${region.name}...`;
        text += `\n${await recognizeCanvasOnce(regionCanvas, region.psm)}`;
        regionCanvas.width = 1;
        regionCanvas.height = 1;
    }

    // Keep one full-page pass as a safety net for labels that fall between
    // regions (for example footer metadata and long CFDI descriptions).
    const button = document.getElementById('btn-scan');
    if (button) button.textContent = 'Leyendo pagina completa...';
    text += `\n${await recognizeCanvasWithFallback(scanCanvas, quality.level === 'baja' ? '11' : '6')}`;

    // Mexican CFDI photographs normally include the SAT QR. When the
    // browser supports BarcodeDetector, it supplies an exact UUID/RFC/total
    // even when a character is visually ambiguous to OCR.
    const qrText = await detectQrText(scanCanvas);
    if (qrText) text += `\n${qrText}`;

    const firstFields = parseExtractedFields(text);

    // A second, high-contrast sparse-text pass helps photographs of CFDIs:
    // the first pass is better for tables, while PSM 11 is better for the
    // two-column header and the small fiscal metadata on the right.
    const hasFiscalCore = Boolean(firstFields.rfc && firstFields.razonSocial && firstFields.importe && firstFields.uuid);
    if (!hasFiscalCore) {
        text += `\n${await recognizeCanvasWithFallback(readableCanvas, '11')}`;
    }
    readableCanvas.width = 1;
    readableCanvas.height = 1;
    canvas.width = 1;
    canvas.height = 1;
    if (scanCanvas !== canvas) {
        scanCanvas.width = 1;
        scanCanvas.height = 1;
    }
    return text;
}

function createDocumentScanCanvas(sourceCanvas) {
    const bounds = estimateBrightDocumentBounds(sourceCanvas);
    if (!bounds) return sourceCanvas;

    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    if (width < sourceCanvas.width * 0.55 || height < sourceCanvas.height * 0.55) return sourceCanvas;

    if (bounds.corners) {
        const warped = warpDocumentQuadrilateral(sourceCanvas, bounds.corners);
        if (warped) return warped;
    }

    const canvas = document.createElement('canvas');
    const outputWidth = Math.min(2600, Math.max(1200, Math.round(width)));
    const outputHeight = Math.min(3200, Math.max(1600, Math.round(height * (outputWidth / width))));
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, outputWidth, outputHeight);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    if (Number.isFinite(bounds.topSlope)) {
        // A vertical shear deskews the photographed sheet without requiring a
        // heavy computer-vision library. It is enough for the mild camera
        // perspective common in phone captures and keeps memory predictable.
        const sourceScale = outputWidth / width;
        const margin = Math.max(8, Math.round(sourceCanvas.width * 0.008));
        context.setTransform(
            sourceScale,
            -bounds.topSlope * sourceScale,
            0,
            sourceScale,
            (-bounds.left + margin) * sourceScale,
            (bounds.topSlope * bounds.left - bounds.topAtLeft + margin) * sourceScale
        );
        context.drawImage(sourceCanvas, 0, 0);
    } else {
        context.drawImage(sourceCanvas, bounds.left, bounds.top, width, height, 0, 0, outputWidth, outputHeight);
    }
    return canvas;
}

function estimateBrightDocumentBounds(sourceCanvas) {
    const analysisScale = Math.min(1, 900 / Math.max(sourceCanvas.width, sourceCanvas.height));
    const width = Math.max(1, Math.round(sourceCanvas.width * analysisScale));
    const height = Math.max(1, Math.round(sourceCanvas.height * analysisScale));
    const analysis = document.createElement('canvas');
    analysis.width = width;
    analysis.height = height;
    const context = analysis.getContext('2d', { willReadFrequently: true });
    context.drawImage(sourceCanvas, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height).data;
    const gray = new Uint8Array(width * height);
    const samples = [];
    for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
        const value = Math.round((data[index] * 0.299) + (data[index + 1] * 0.587) + (data[index + 2] * 0.114));
        gray[pixel] = value;
        if ((pixel % 17) === 0) samples.push(value);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)] || 220;
    const threshold = Math.max(185, Math.min(225, median - 10));
    const rowStart = Math.floor(width * 0.08);
    const rowEnd = Math.ceil(width * 0.92);
    const colStart = Math.floor(height * 0.12);
    const colEnd = Math.ceil(height * 0.92);
    const rowScores = new Float32Array(height);
    const colScores = new Float32Array(width);

    for (let y = 0; y < height; y += 1) {
        let bright = 0;
        for (let x = rowStart; x < rowEnd; x += 1) bright += gray[(y * width) + x] >= threshold ? 1 : 0;
        rowScores[y] = bright / Math.max(1, rowEnd - rowStart);
    }
    for (let x = 0; x < width; x += 1) {
        let bright = 0;
        for (let y = colStart; y < colEnd; y += 1) bright += gray[(y * width) + x] >= threshold ? 1 : 0;
        colScores[x] = bright / Math.max(1, colEnd - colStart);
    }

    const firstRun = (scores, start, end, minimum) => {
        for (let index = start; index < end; index += 1) {
            let total = 0;
            for (let offset = 0; offset < 7 && index + offset < scores.length; offset += 1) total += scores[index + offset];
            if (total / 7 >= minimum) return index;
        }
        return -1;
    };
    const lastRun = (scores, start, end, minimum) => {
        for (let index = end; index >= start; index -= 1) {
            let total = 0;
            for (let offset = 0; offset < 7 && index - offset >= 0; offset += 1) total += scores[index - offset];
            if (total / 7 >= minimum) return index;
        }
        return -1;
    };

    const top = firstRun(rowScores, Math.floor(height * 0.04), Math.floor(height * 0.55), 0.58);
    const bottom = lastRun(rowScores, Math.floor(height * 0.45), height - 1, 0.52);
    const left = firstRun(colScores, Math.floor(width * 0.01), Math.floor(width * 0.45), 0.42);
    const right = lastRun(colScores, Math.floor(width * 0.55), width - 1, 0.42);
    analysis.width = 1;
    analysis.height = 1;
    if ([left, top, right, bottom].some(value => value < 0)) return null;

    const topLine = estimateDocumentTopLine(gray, width, height, top, left, right);
    const leftLine = estimateDocumentSideLine(gray, width, height, top, bottom, 'left', threshold);
    const rightLine = estimateDocumentSideLine(gray, width, height, top, bottom, 'right', threshold);

    let corners = null;
    if (topLine && leftLine && rightLine) {
        const topAtSide = sideLine => {
            let y = topLine.atLeft;
            for (let iteration = 0; iteration < 6; iteration += 1) {
                const x = (sideLine.slope * y) + sideLine.intercept;
                y = topLine.atLeft + (topLine.slope * (x - left));
            }
            return { x: (sideLine.slope * y) + sideLine.intercept, y };
        };
        const topLeft = topAtSide(leftLine);
        const topRight = topAtSide(rightLine);
        const bottomLeft = { x: (leftLine.slope * bottom) + leftLine.intercept, y: bottom };
        const bottomRight = { x: (rightLine.slope * bottom) + rightLine.intercept, y: bottom };
        const quadWidth = Math.min(topRight.x - topLeft.x, bottomRight.x - bottomLeft.x);
        const quadHeight = Math.min(bottomLeft.y - topLeft.y, bottomRight.y - topRight.y);
        if (quadWidth > width * 0.72 && quadHeight > height * 0.72) {
            corners = [topLeft, topRight, bottomRight, bottomLeft].map(point => ({
                x: Math.max(0, Math.min(sourceCanvas.width - 1, point.x / analysisScale)),
                y: Math.max(0, Math.min(sourceCanvas.height - 1, point.y / analysisScale))
            }));
        }
    }

    const marginX = Math.max(4, Math.round(width * 0.018));
    const marginY = Math.max(4, Math.round(height * 0.012));
    return {
        left: Math.max(0, Math.round((left - marginX) / analysisScale)),
        top: Math.max(0, Math.round((top - marginY) / analysisScale)),
        right: Math.min(sourceCanvas.width, Math.round((right + marginX) / analysisScale)),
        bottom: Math.min(sourceCanvas.height, Math.round((bottom + marginY) / analysisScale)),
        topSlope: topLine ? topLine.slope : NaN,
        topAtLeft: topLine ? topLine.atLeft / analysisScale : NaN,
        corners
    };
}

function estimateDocumentSideLine(gray, width, height, top, bottom, side, threshold) {
    const points = [];
    const searchStart = side === 'left' ? 3 : Math.floor(width * 0.58);
    const searchEnd = side === 'left' ? Math.ceil(width * 0.42) : width - 4;
    for (let y = Math.max(top + 12, Math.floor(height * 0.18)); y < bottom - 8; y += 3) {
        let bestX = -1;
        let bestScore = 0;
        for (let x = searchStart; x < searchEnd; x += 2) {
            let inside = 0;
            let outside = 0;
            let count = 0;
            for (let offset = 4; offset <= 14; offset += 2) {
                const insideX = side === 'left' ? x + offset : x - offset;
                const outsideX = side === 'left' ? x - offset : x + offset;
                if (insideX < 0 || insideX >= width || outsideX < 0 || outsideX >= width) continue;
                inside += gray[(y * width) + insideX];
                outside += gray[(y * width) + outsideX];
                count += 1;
            }
            if (!count) continue;
            const score = (inside - outside) / count;
            const insideValue = inside / count;
            if (insideValue >= threshold - 18 && score > bestScore) {
                bestScore = score;
                bestX = x;
            }
        }
        if (bestX >= 0 && bestScore >= 22) points.push({ x: bestX, y });
    }
    if (points.length < 20) return null;

    const fit = values => {
        let sumY = 0;
        let sumX = 0;
        let sumYY = 0;
        let sumYX = 0;
        values.forEach(point => {
            sumY += point.y;
            sumX += point.x;
            sumYY += point.y * point.y;
            sumYX += point.y * point.x;
        });
        const denominator = (values.length * sumYY) - (sumY * sumY);
        if (Math.abs(denominator) < 0.001) return null;
        const slope = ((values.length * sumYX) - (sumY * sumX)) / denominator;
        const intercept = (sumX - (slope * sumY)) / values.length;
        return { slope, intercept };
    };
    const initial = fit(points);
    if (!initial || Math.abs(initial.slope) > 0.28) return null;
    const filtered = points.filter(point => Math.abs(point.x - ((initial.slope * point.y) + initial.intercept)) < width * 0.035);
    const refined = filtered.length >= 18 ? fit(filtered) : initial;
    return refined && Math.abs(refined.slope) <= 0.28 ? refined : null;
}

function warpDocumentQuadrilateral(sourceCanvas, corners) {
    if (!Array.isArray(corners) || corners.length !== 4) return null;
    const [topLeft, topRight, bottomRight, bottomLeft] = corners;
    const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    const measuredWidth = Math.max(distance(topLeft, topRight), distance(bottomLeft, bottomRight));
    const measuredHeight = Math.max(distance(topLeft, bottomLeft), distance(topRight, bottomRight));
    if (measuredWidth < 600 || measuredHeight < 800) return null;

    const scale = Math.min(1.15, 2300 / measuredWidth, 3000 / measuredHeight);
    const outputWidth = Math.max(1200, Math.round(measuredWidth * scale));
    const outputHeight = Math.max(1600, Math.round(measuredHeight * scale));
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    const source = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;
    const output = document.createElement('canvas');
    output.width = outputWidth;
    output.height = outputHeight;
    const outputContext = output.getContext('2d');
    const image = outputContext.createImageData(outputWidth, outputHeight);
    const target = image.data;

    for (let y = 0; y < outputHeight; y += 1) {
        const v = y / Math.max(1, outputHeight - 1);
        const leftX = topLeft.x + ((bottomLeft.x - topLeft.x) * v);
        const leftY = topLeft.y + ((bottomLeft.y - topLeft.y) * v);
        const rightX = topRight.x + ((bottomRight.x - topRight.x) * v);
        const rightY = topRight.y + ((bottomRight.y - topRight.y) * v);
        for (let x = 0; x < outputWidth; x += 1) {
            const u = x / Math.max(1, outputWidth - 1);
            const sourceX = Math.max(0, Math.min(sourceCanvas.width - 1, Math.round(leftX + ((rightX - leftX) * u))));
            const sourceY = Math.max(0, Math.min(sourceCanvas.height - 1, Math.round(leftY + ((rightY - leftY) * u))));
            const sourceIndex = ((sourceY * sourceCanvas.width) + sourceX) * 4;
            const targetIndex = ((y * outputWidth) + x) * 4;
            target[targetIndex] = source[sourceIndex];
            target[targetIndex + 1] = source[sourceIndex + 1];
            target[targetIndex + 2] = source[sourceIndex + 2];
            target[targetIndex + 3] = 255;
        }
    }
    outputContext.putImageData(image, 0, 0);
    return output;
}

function estimateDocumentTopLine(gray, width, height, top, left, right) {
    const sampleMean = (yStart, yEnd, xStart, xEnd) => {
        const y1 = Math.max(0, Math.floor(yStart));
        const y2 = Math.min(height, Math.ceil(yEnd));
        const x1 = Math.max(0, Math.floor(xStart));
        const x2 = Math.min(width, Math.ceil(xEnd));
        let sum = 0;
        let count = 0;
        for (let y = y1; y < y2; y += 1) {
            for (let x = x1; x < x2; x += 1) {
                sum += gray[(y * width) + x];
                count += 1;
            }
        }
        return count ? sum / count : 0;
    };

    let best = null;
    for (let slope = -0.06; slope <= 0.0601; slope += 0.01) {
        for (let atLeft = top - 25; atLeft <= top + 25; atLeft += 2) {
            const atRight = atLeft + (slope * (right - left));
            if (atRight < top - 35 || atRight > top + 35) continue;
            let score = 0;
            const sampleCount = 64;
            for (let index = 0; index < sampleCount; index += 1) {
                const x = left + 12 + ((right - left - 24) * index / (sampleCount - 1));
                const y = atLeft + (slope * (x - left));
                const above = sampleMean(y - 14, y - 4, x - 3, x + 4);
                const below = sampleMean(y + 4, y + 14, x - 3, x + 4);
                score += below - above;
            }
            if (!best || score > best.score) best = { score, slope, atLeft };
        }
    }
    return best && best.score > 250 ? best : null;
}

function createOcrRegionCanvas(sourceCanvas, topRatio, bottomRatio, leftRatio = 0, rightRatio = 1) {
    const top = Math.max(0, Math.floor(sourceCanvas.height * topRatio));
    const bottom = Math.min(sourceCanvas.height, Math.ceil(sourceCanvas.height * bottomRatio));
    const left = Math.max(0, Math.floor(sourceCanvas.width * leftRatio));
    const right = Math.min(sourceCanvas.width, Math.ceil(sourceCanvas.width * rightRatio));
    const padding = Math.max(8, Math.round(sourceCanvas.height * 0.008));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, right - left + (padding * 2));
    canvas.height = Math.max(1, bottom - top + (padding * 2));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
        sourceCanvas,
        Math.max(0, left - padding),
        Math.max(0, top - padding),
        Math.min(sourceCanvas.width - Math.max(0, left - padding), canvas.width),
        Math.min(sourceCanvas.height - Math.max(0, top - padding), canvas.height),
        0,
        0,
        canvas.width,
        canvas.height
    );
    return canvas;
}

async function recognizeCanvasOnce(canvas, pageSegMode = '6') {
    await state.ocrWorker.setParameters({ tessedit_pageseg_mode: pageSegMode, preserve_interword_spaces: '1' });
    const result = await state.ocrWorker.recognize(canvas);
    return result.data.text || '';
}

async function detectQrText(canvas) {
    if (!window.BarcodeDetector) return '';
    try {
        const formats = typeof window.BarcodeDetector.getSupportedFormats === 'function'
            ? await window.BarcodeDetector.getSupportedFormats()
            : ['qr_code'];
        if (!formats.includes('qr_code')) return '';
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const codes = await detector.detect(canvas);
        return codes.map(code => code.rawValue || '').filter(Boolean).join('\n');
    } catch (error) {
        console.info('QR fiscal no disponible en este navegador:', error);
        return '';
    }
}

function createEnhancedOcrCanvas(sourceCanvas) {
    const canvas = document.createElement('canvas');
    canvas.width = sourceCanvas.width;
    canvas.height = sourceCanvas.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(sourceCanvas, 0, 0);

    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    const histogram = new Uint32Array(256);
    for (let index = 0; index < data.length; index += 4) {
        const gray = Math.round((data[index] * 0.299) + (data[index + 1] * 0.587) + (data[index + 2] * 0.114));
        histogram[gray] += 1;
    }
    const pixelCount = Math.max(1, data.length / 4);
    const percentile = target => {
        let accumulated = 0;
        for (let value = 0; value < histogram.length; value += 1) {
            accumulated += histogram[value];
            if (accumulated >= pixelCount * target) return value;
        }
        return 255;
    };
    const blackPoint = Math.min(150, percentile(0.015));
    const whitePoint = Math.max(185, percentile(0.985));
    const range = Math.max(30, whitePoint - blackPoint);
    for (let index = 0; index < data.length; index += 4) {
        const gray = (data[index] * 0.299) + (data[index + 1] * 0.587) + (data[index + 2] * 0.114);
        const adjusted = Math.max(0, Math.min(255, ((gray - blackPoint) * 255) / range));
        data[index] = adjusted;
        data[index + 1] = adjusted;
        data[index + 2] = adjusted;
    }
    context.putImageData(image, 0, 0);

    // Unsharp masking makes thin strokes more distinct after a 480p image is
    // enlarged. It cannot invent missing pixels, but it improves separation
    // between similar glyphs without sending the document to any service.
    const blurred = document.createElement('canvas');
    blurred.width = canvas.width;
    blurred.height = canvas.height;
    const blurredContext = blurred.getContext('2d', { willReadFrequently: true });
    blurredContext.filter = 'blur(1.15px)';
    blurredContext.drawImage(canvas, 0, 0);
    blurredContext.filter = 'none';
    const blurredData = blurredContext.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 0; index < data.length; index += 4) {
        const base = data[index];
        const sharpened = Math.max(0, Math.min(255, base + ((base - blurredData[index]) * 0.68)));
        const cleaned = sharpened > 224 ? 255 : sharpened;
        data[index] = cleaned;
        data[index + 1] = cleaned;
        data[index + 2] = cleaned;
    }
    context.putImageData(image, 0, 0);
    blurred.width = 1;
    blurred.height = 1;
    return canvas;
}

function assessScanQuality(canvas, originalWidth, originalHeight) {
    const sampleScale = Math.min(1, 420 / Math.max(canvas.width, canvas.height));
    const width = Math.max(1, Math.round(canvas.width * sampleScale));
    const height = Math.max(1, Math.round(canvas.height * sampleScale));
    const sample = document.createElement('canvas');
    sample.width = width;
    sample.height = height;
    const context = sample.getContext('2d', { willReadFrequently: true });
    context.drawImage(canvas, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height).data;
    const gray = new Uint8Array(width * height);
    let minimum = 255;
    let maximum = 0;
    for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
        const value = Math.round((data[index] * 0.299) + (data[index + 1] * 0.587) + (data[index + 2] * 0.114));
        gray[pixel] = value;
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
    }
    let edgeTotal = 0;
    let edgeCount = 0;
    for (let y = 2; y < height - 1; y += 1) {
        for (let x = 2; x < width - 1; x += 1) {
            const index = (y * width) + x;
            edgeTotal += Math.abs((gray[index - 1] * 2) - gray[index - 2] - gray[index])
                + Math.abs((gray[index - width] * 2) - gray[index - (width * 2)] - gray[index]);
            edgeCount += 2;
        }
    }
    sample.width = 1;
    sample.height = 1;

    const shortSide = Math.min(originalWidth, originalHeight);
    const longSide = Math.max(originalWidth, originalHeight);
    const sharpness = edgeCount ? edgeTotal / edgeCount : 0;
    const contrast = maximum - minimum;
    let level = 'alta';
    if (longSide < 900 || shortSide < 600 || sharpness < 2.8 || contrast < 90) level = 'baja';
    else if (longSide < 1600 || shortSide < 900 || sharpness < 5.5 || contrast < 140) level = 'media';

    return {
        level,
        originalWidth,
        originalHeight,
        sharpness: Number(sharpness.toFixed(1)),
        contrast,
        label: level === 'alta'
            ? `Calidad alta (${originalWidth} x ${originalHeight}px)`
            : level === 'media'
                ? `Calidad media (${originalWidth} x ${originalHeight}px)`
                : `Calidad baja (${originalWidth} x ${originalHeight}px)`
    };
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

function stripOcrAccents(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function extractOcrLabelValue(source, labelPattern, stopPattern, maxLength = 180) {
    const expression = new RegExp(`(?:${labelPattern})\\s*[:\\-]?\\s*([\\s\\S]{1,${maxLength}}?)(?=\\s*(?:${stopPattern})\\s*[:\\-]?|$)`, 'i');
    const match = source.match(expression);
    return match ? cleanOcrValue(match[1] || '') : '';
}

function normalizeOcrDate(value) {
    const cleanValue = cleanOcrValue(value);
    const isoMatch = cleanValue.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(.*)$/);
    if (isoMatch) {
        return `${isoMatch[3].padStart(2, '0')}/${isoMatch[2].padStart(2, '0')}/${isoMatch[1]}${isoMatch[4]}`.trim();
    }
    return cleanValue;
}

function parseExtractedFields(text) {
    const normalized = String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
    const plain = stripOcrAccents(normalized).toUpperCase();
    // Phone photos often insert a dot or space in an RFC (for example
    // CEP130206L.C4). Normalize that OCR artifact after matching it.
    const rfcPattern = '[A-Z&N]{3,4}\\s*\\d{6}[A-Z0-9](?:\\s*\\.\\s*)?[A-Z0-9]{1,2}';
    const rfcEmisorMatch = plain.match(new RegExp(`RFC\\s+EMISOR\\s*[:\\-]?\\s*(${rfcPattern})`, 'i'));
    const rfcReceptorMatch = plain.match(new RegExp(`RFC\\s+RECEPTOR\\s*[:\\-]?\\s*(${rfcPattern})`, 'i'));
    // Only accept an unlabeled RFC when it appears after an RFC label. A
    // random tracking key can have the same letter/number shape as an RFC.
    const genericRfcMatch = plain.match(new RegExp(`(?:^|\\n)\\s*RFC(?:\\s+(?:DEL|DE)?\\s*[A-Z ]+?)?\\s*[:\\-]?\\s*(\\b${rfcPattern}\\b)`, 'im'));

    const stopLabels = 'RFC\\s+RECEPTOR|NOMBRE\\s+RECEPTOR|CODIGO\\s+POSTAL|REGIMEN\\s+FISCAL|USO\\s+CFDI|FOLIO\\s+FISCAL|EFECTO\\s+DE\\s+COMPROBANTE|CONCEPTOS|DESCRIPCION|MONEDA|FORMA\\s+DE\\s+PAGO|METODO\\s+DE\\s+PAGO|SUBTOTAL|TOTAL|SELLO\\s+DIGITAL';
    const bankStopLabels = 'INSTITUCION\\s+(?:EMISORA?|RECEPTORA?)|BANCO\\s+(?:EMISOR|RECEPTOR|ORIGEN|DESTINO)|CODIGO|CLAVE|CUENTA|CLABE|MONTO|IMPORTE|REFERENCIA|FECHA|TOTAL|FOLIO';
    const receiverNameRaw = extractOcrLabelValue(plain, 'NOMBRE\\s+(?:DEL?\\s+)?RECEPTOR', stopLabels, 120);
    const receiverName = cleanOcrValue(receiverNameRaw.replace(/\s+REGIM(?:E|EN|EN\s+FISCAL)?[\s\S]*$/i, ''));
    const nombreEmisor = extractOcrLabelValue(plain, 'NOMBRE\\s+(?:DEL?\\s+)?EMISOR', 'RFC\\s+RECEPTOR|NOMBRE\\s+RECEPTOR|FOLIO\\s+FISCAL|NO\\.?\\s+DE\\s+SERIE|CODIGO\\s+POSTAL|EFECTO\\s+DE\\s+COMPROBANTE', 160);
    const legalName = extractOcrLabelValue(plain, 'RAZON\\s+SOCIAL', stopLabels, 120);
    const razonSocial = receiverName || legalName;
    const codigoPostal = (plain.match(/CODIGO\s+POSTAL(?:\s+DEL)?(?:\s+RECEPTOR)?\s*[:\-]?\s*(\d{5})/i) || [])[1] || '';
    const receiverRegimenFiscal = extractOcrLabelValue(plain, '(?:REGIMEN\\s+FISCAL\\s+RECEPTOR|RECEPTOR\\s*[:\\-]?\\s*REGIMEN\\s+FISCAL)', 'RECEPTOR|USO\\s+CFDI|CODIGO\\s+POSTAL|RFC|NOMBRE|CONCEPTOS', 100);
    const regimenFiscal = receiverRegimenFiscal || extractOcrLabelValue(plain, 'REGIMEN\\s+FISCAL', 'USO\\s+CFDI|CODIGO\\s+POSTAL|EXPORTACION|FOLIO\\s+FISCAL|RFC|NOMBRE|CONCEPTOS', 100);
    const regimenFiscalEmisor = extractOcrLabelValue(plain, 'REGIMEN\\s+FISCAL(?!\\s+RECEPTOR)', 'EXPORTACION|FOLIO\\s+FISCAL|CONCEPTOS|USO\\s+CFDI|CODIGO\\s+POSTAL|RFC|NOMBRE', 100);
    const usoCfdi = extractOcrLabelValue(plain, 'USO\\s+CFDI', 'CONCEPTOS|FOLIO\\s+FISCAL|REGIMEN\\s+FISCAL|MONEDA|FORMA\\s+DE\\s+PAGO', 80);
    const tipoCfdi = extractOcrLabelValue(plain, 'EFECTO\\s+DE\\s+COMPROBANTE', 'REGIMEN\\s+FISCAL|EXPORTACION|FOLIO\\s+FISCAL|CONCEPTOS|DESCRIPCION|NOMBRE|RFC|CODIGO\\s+POSTAL', 40);
    const uuidMatch = plain.match(/FOLIO\s+FISCAL\s*[:\-]?\s*([0-9A-Z]{8}(?:-[0-9A-Z]{4}){3}-[0-9A-Z]{12})/i);
    const qrUuidMatch = plain.match(/(?:[?&]ID=|UUID\s*[:=])([0-9A-Z]{8}(?:-[0-9A-Z]{4}){3}-[0-9A-Z]{12})/i);
    const uuidCandidate = normalizeOcrUuid((qrUuidMatch || uuidMatch)?.[1] || '');
    const fiscalUuid = /^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(uuidCandidate) ? uuidCandidate : '';
    const qrRfcEmisorMatch = plain.match(/[?&]RE=([A-Z&N]{3,4}\d{6}[A-Z0-9]{2,3})/i);
    const qrRfcReceptorMatch = plain.match(/[?&]RR=([A-Z&N]{3,4}\d{6}[A-Z0-9]{2,3})/i);
    const bancoEmisor = extractOcrLabelValue(plain, '(?:INSTITUCION|BANCO)\\s+(?:EMISORA?|ORIGEN)(?:\\s+DEL\\s+PAGO)?', bankStopLabels, 80);
    const bancoReceptor = extractOcrLabelValue(plain, '(?:INSTITUCION|BANCO)\\s+(?:RECEPTORA?|DESTINO)(?:\\s+DEL\\s+PAGO)?', bankStopLabels, 80);
    const bancoEmisorCodigoMatch = plain.match(/(?:CODIGO|CLAVE)\s+(?:DE\s+)?(?:BANCO|INSTITUCION)\s+(?:EMISOR|EMISORA|ORIGEN)[^0-9]{0,30}(\d{3,6})/i);
    const bancoReceptorCodigoMatch = plain.match(/(?:CODIGO|CLAVE)\s+(?:DE\s+)?(?:BANCO|INSTITUCION)\s+(?:RECEPTOR|RECEPTORA|DESTINO)[^0-9]{0,30}(\d{3,6})/i);
    const bankDocumentContext = /INSTITUCION\s+(?:EMISORA?|RECEPTORA?)|CLAVE\s+DE\s+RASTREO|CUENTA\s+BENEFICIARIA/i.test(plain);

    const totalMatch = plain.match(/\bTOTAL(?:\s+A\s+PAGAR)?\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i);
    // Do not use the bare word "PAGO": it can be followed by an account
    // number or date and would produce a false, very large amount.
    const explicitPaymentAmountMatch = normalized.match(/(?:MONTO(?:\s+(?:DEL|DE)?\s*PAGO)?|IMPORTE\s+(?:PAGADO|DEL\s+PAGO)|DEPOSITO)[^\d$\n]{0,60}\$?\s*([\d,]+(?:\.\d{1,2})?)/i)
        || (bankDocumentContext ? normalized.match(/IMPORTE\s*[:\-]?[^\d$\n]{0,20}\$?\s*([\d,]+(?:\.\d{1,2})?)/i) : null);
    const currencyMatches = [...normalized.matchAll(/\$\s*([\d,]+\.\d{1,2})/g)];
    const currencyMatch = currencyMatches.length ? currencyMatches[currencyMatches.length - 1] : null;
    const qrAmountMatch = plain.match(/[?&]TT=([\d,]+(?:\.\d+)?)/i);
    const amountMatch = qrAmountMatch || totalMatch || explicitPaymentAmountMatch || currencyMatch;
    const paymentAmount = explicitPaymentAmountMatch ? Number(explicitPaymentAmountMatch[1].replace(/,/g, '')) : null;
    const subtotalMatch = plain.match(/\bSUBTOTAL\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i);
    const folioReciboMatch = normalized.match(/(?:FOLIO\s+(?:DEL?\s+)?RECIBO|NO\.?\s+DE?\s+RECIBO)[\s:#-]*([A-Z0-9][A-Z0-9 ./_-]{3,45})/i);
    const numericReferenceMatch = normalized.match(/(?:NUMERO\s+DE\s+REFERENCIA|REFERENCIA|REF\.?)[\s:#-]*(\d{1,7})(?!\d)/i);
    const referenceMatch = normalized.match(/(?:REFERENCIA|REF\.?|AUTORIZACION)[\s:#-]*([A-Z0-9][A-Z0-9 ./_-]{3,45})/i);
    const trackingMatch = normalized.match(/(?:CLAVE\s+DE\s+RASTREO|CLAVE\s+RASTREO|RASTREO)[\s:#-]*([A-Z0-9]{6,30})/i);
    const accountMatch = normalized.match(/(?:CUENTA\s+BENEFICIARIA|CLABE|CUENTA\s+DESTINO)[\s:#-]*(\d{10,18})/i);
    const productCodeMatch = plain.match(/(?:CONCEPTOS|CLAVE\s+DEL\s+PRODUCTO)[\s\S]{0,1400}?\b(\d{8})\b/i);
    const quantityMatch = plain.match(/CONCEPTOS[\s\S]{0,1400}?\b(1(?:\.0+)?)\b[\s\S]{0,500}?\bE(?:48|51|A)\b/i)
        || plain.match(/CONCEPTOS[\s\S]{0,350}?\b(1(?:\.0+)?)\b/i);
    const unitCodeMatch = plain.match(/\b(E48|E51|H87|ACT|KGM|LTR|XUN)\b/i);
    const unitMatch = plain.match(/\b(?:E48|E51|H87|ACT|KGM|LTR|XUN)\b\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ]{3,45}?)(?=\s+(?:\$?\d|NO\s+OBJETO|DESCRIPCION|MONEDA|SUBTOTAL|TOTAL))/i);
    const lineImportMatch = plain.match(/\b([\d,]+\.\d{4,})\b/);
    const objectTaxMatch = plain.match(/\b(NO\s+OBJETO\s+DE\s+IMPUESTO|OBJETO\s+DE\s+IMPUESTO)\b/i);
    const conceptLabel = extractOcrLabelValue(plain, 'DESCRIPCION|CONCEPTO|DESCRIP(?:CION|EIGN|PEIGN|PIGN|PCION)', 'N(?:U|A|I)MERO\\s+DE\\s+PEDIMENTO|N(?:U|A|I)MERO\\s+DE\\s+CUENTA|MONEDA|FORMA\\s+DE\\s+PAGO|METODO\\s+DE\\s+PAGO|SUBTOTAL|TOTAL|SELLO\\s+DIGITAL', 220);
    const conceptFallbackMatch = normalized.match(/((?:SOLICITUD|PAGO|TRAMITE|DERECHOS)[\s\S]{12,220}?)(?=\s*(?:N(?:U|A|I)MERO\s+DE\s+PEDIMENTO|N(?:U|A|I)MERO\s+DE\s+CUENTA|MONEDA|SUBTOTAL|TOTAL|SELLO\s+DIGITAL)|$)/i) || normalized.match(/(SERVICIO\s+DE[\s\S]{12,220}?)(?=\s*(?:N(?:U|A|I)MERO\s+DE\s+PEDIMENTO|N(?:U|A|I)MERO\s+DE\s+CUENTA|MONEDA|SUBTOTAL|TOTAL|SELLO\s+DIGITAL)|$)/i);
    const conceptBase = normalizeOcrConcept(conceptLabel || (conceptFallbackMatch ? conceptFallbackMatch[1] : ''));
    const conceptDateMatch = normalized.match(/(?:REALIZO|REALIZÓ)[\s\S]{0,40}?(\d{1,2}[/-]\d{1,2}[/-]\d{4})/i);
    const concept = conceptDateMatch && !conceptBase.includes(conceptDateMatch[1])
        ? `${conceptBase} ${conceptDateMatch[1]}`.trim()
        : conceptBase;
    const formaPagoRaw = extractOcrLabelValue(plain, 'FORMA\\s+DE\\s+PAGO', 'METODO\\s+DE\\s+PAGO|MONEDA|SUBTOTAL|TOTAL|CONCEPTOS', 100);
    const formaPagoKnown = formaPagoRaw.match(/TRANSFERENCIA\s+ELECTRONICA\s+DE\s+FONDOS(?:\s*\(INCLUYE\s+SPEI\))?/i);
    const formaPago = formaPagoKnown
        ? cleanOcrValue(formaPagoKnown[0])
        : cleanOcrValue(formaPagoRaw).replace(/\s+\$?[\d,.]+[\s\S]*$/, '').slice(0, 100);
    const monedaDetectada = extractOcrLabelValue(plain, 'MONEDA', 'FORMA\\s+DE\\s+PAGO|METODO\\s+DE\\s+PAGO|SUBTOTAL|TOTAL|CONCEPTOS', 40);
    const moneda = /PESO\s+MEXICANO|P\s*EM(?:\s|$)/i.test(plain) ? 'PESO MEXICANO' : monedaDetectada;
    const datePattern = '(?:\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{4})(?:\\s+\\d{1,2}:\\d{2}(?::\\d{2})?)?';
    const emissionDateMatch = plain.match(new RegExp(`(?:FECHA\\s+Y\\s+HORA\\s+DE\\s+EMISION|FECHA\\s+DE\\s+EMISION|FECHA\\s+EMISION|FECHA\\s*Y\\s*HORA\\s*DE(?!\\s*CERTIFICACION))[^0-9]{0,60}(?:\\d{5}\\s+)?(${datePattern})`, 'i'));
    const paymentDateMatch = plain.match(new RegExp(`(?:FECHA\\s+DE\\s+(?:OPERACION|PAGO)|FECHA\\s+PAGO)[^0-9]{0,40}(${datePattern})`, 'i'));
    const fechaEmision = emissionDateMatch ? normalizeOcrDate(emissionDateMatch[1]) : '';
    const bankNames = ['BBVA', 'SANTANDER', 'BANAMEX', 'CITIBANAMEX', 'HSBC', 'BANORTE', 'SCOTIABANK', 'BANCO DEL BIENESTAR', 'AZTECA'];
    const bank = bankNames.find(name => plain.includes(name)) || '';
    const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : null;
    const referencia = numericReferenceMatch ? cleanOcrValue(numericReferenceMatch[1]) : (referenceMatch ? cleanOcrValue(referenceMatch[1]) : '');
    const fechaPago = paymentDateMatch ? normalizeOcrDate(paymentDateMatch[1]) : '';
    const folioRecibo = folioReciboMatch ? cleanOcrValue(folioReciboMatch[1]) : '';
    const claveRastreo = trackingMatch ? cleanOcrValue(trackingMatch[1]).replace(/[^A-Z0-9]/gi, '') : '';
    const cuentaBeneficiaria = accountMatch ? accountMatch[1].replace(/\D/g, '') : '';
    const bancoDetectado = bank || bancoEmisor || bancoReceptor;
    const rfcEmisor = normalizeOcrRfc((qrRfcEmisorMatch || rfcEmisorMatch)?.[1] || '');
    const rfcReceptor = normalizeOcrRfc((qrRfcReceptorMatch || rfcReceptorMatch)?.[1] || '');
    const genericRfc = normalizeOcrRfc(genericRfcMatch?.[1] || '');
    const rfc = rfcReceptor || rfcEmisor || genericRfc;
    const noSerieCsdMatch = plain.match(/NO\.?\s+DE\s+SERIE\s+DEL\s+CSD[^0-9]{0,30}(\d{10,20})/i);
    const rfcProveedorMatch = plain.match(/RFC\s+DEL\s+PROVEEDOR\s+DE\s+CERTIFICACION[^A-Z0-9]{0,30}([A-Z&N]{3,4}\d{6}[A-Z0-9]{2,3})/i);
    const noSerieSatMatch = plain.match(/NO\.?\s+DE\s+SERIE\s+DEL\s+CERTIFICADO\s+SAT[^0-9]{0,30}(\d{10,20})/i);
    const certificationDateMatch = plain.match(new RegExp(`FECHA\\s+Y\\s+HORA\\s+DE\\s+CERTIFICACION[^0-9]{0,30}(${datePattern})`, 'i'));
    const valorUnitarioMatch = plain.match(/(?:UNIDAD\s+DE\s+SERVICIO|E48|E51|H87|ACT|KGM|LTR|XUN)[\s\S]{0,80}?\b(\d{1,12}(?:\.\d{1,6})?)\b/i);
    const valorUnitario = valorUnitarioMatch ? Number(valorUnitarioMatch[1].replace(/,/g, '')) : null;
    const importeLinea = lineImportMatch ? Number(lineImportMatch[1].replace(/,/g, '')) : null;
    const subtotal = subtotalMatch ? Number(subtotalMatch[1].replace(/,/g, '')) : null;
    const metodoPagoRaw = extractOcrLabelValue(plain, 'METODO\\s+DE\\s+PAGO', 'SELLO\\s+DIGITAL|CONCEPTOS|MONEDA|FORMA\\s+DE\\s+PAGO|SUBTOTAL|TOTAL', 80);
    const metodoPagoKnown = metodoPagoRaw.match(/PAGO\s+EN\s+(?:UNA\s+SOLA\s+EXHIBICI[O0E]N|PARCIALIDADES\s+O\s+DIFERIDO)/i);
    const metodoPago = metodoPagoKnown
        ? (/EXHIBICI/i.test(metodoPagoKnown[0]) ? 'PAGO EN UNA SOLA EXHIBICION' : cleanOcrValue(metodoPagoKnown[0]))
        : cleanOcrValue(metodoPagoRaw).replace(/\s+\$?[\d,.]+[\s\S]*$/, '').slice(0, 80);

    return {
        rfc,
        rfcEmisor,
        rfcReceptor,
        razonSocial,
        nombreEmisor,
        regimenFiscal,
        regimenFiscalEmisor,
        codigoPostal,
        usoCfdi,
        tipoCfdi,
        efectoComprobante: tipoCfdi,
        uuid: fiscalUuid,
        banco: bancoDetectado,
        bancoEmisor,
        bancoReceptor,
        bancoEmisorCodigo: bancoEmisorCodigoMatch ? bancoEmisorCodigoMatch[1] : '',
        bancoReceptorCodigo: bancoReceptorCodigoMatch ? bancoReceptorCodigoMatch[1] : '',
        importe: Number.isFinite(amount) ? amount : null,
        importePago: Number.isFinite(paymentAmount) ? paymentAmount : null,
        subtotal: Number.isFinite(subtotal) ? subtotal : null,
        referencia,
        concepto: concept,
        fechaEmision,
        fechaPago,
        fechaCertificacion: certificationDateMatch ? normalizeOcrDate(certificationDateMatch[1]) : '',
        folioRecibo,
        claveRastreo,
        cuentaBeneficiaria,
        formaPago,
        moneda,
        claveProdServ: productCodeMatch ? productCodeMatch[1] : '',
        cantidad: quantityMatch ? quantityMatch[1] : '',
        claveUnidad: unitCodeMatch ? unitCodeMatch[1] : '',
        unidad: unitMatch ? cleanOcrValue(unitMatch[1]) : '',
        valorUnitario: Number.isFinite(valorUnitario) ? valorUnitario : null,
        importeLinea: Number.isFinite(importeLinea) ? importeLinea : null,
        objetoImpuesto: objectTaxMatch ? cleanOcrValue(objectTaxMatch[1]) : '',
        metodoPago,
        noSerieCsd: noSerieCsdMatch ? noSerieCsdMatch[1] : '',
        rfcProveedorCertificacion: rfcProveedorMatch ? normalizeOcrRfc(rfcProveedorMatch[1]) : '',
        noSerieCertificadoSat: noSerieSatMatch ? noSerieSatMatch[1] : '',
        confidence: {
            rfc: rfc ? 0.95 : 0,
            rfcEmisor: rfcEmisor ? 0.95 : 0,
            rfcReceptor: rfcReceptor ? 0.95 : 0,
            razonSocial: razonSocial ? 0.9 : 0,
            nombreEmisor: nombreEmisor ? 0.9 : 0,
            regimenFiscal: regimenFiscal ? 0.8 : 0,
            regimenFiscalEmisor: regimenFiscalEmisor ? 0.8 : 0,
            codigoPostal: codigoPostal ? 0.95 : 0,
            usoCfdi: usoCfdi ? 0.85 : 0,
            tipoCfdi: tipoCfdi ? 0.8 : 0,
            uuid: fiscalUuid ? 0.98 : 0,
            banco: bancoDetectado ? 0.85 : 0,
            bancoEmisor: bancoEmisor ? 0.85 : 0,
            bancoReceptor: bancoReceptor ? 0.85 : 0,
            bancoEmisorCodigo: bancoEmisorCodigoMatch ? 0.95 : 0,
            bancoReceptorCodigo: bancoReceptorCodigoMatch ? 0.95 : 0,
            importe: Number.isFinite(amount) ? 0.95 : 0,
            importePago: Number.isFinite(paymentAmount) ? 0.95 : 0,
            subtotal: Number.isFinite(subtotal) ? 0.95 : 0,
            referencia: referencia ? 0.7 : 0,
            concepto: concept ? 0.85 : 0,
            fechaEmision: fechaEmision ? 0.9 : 0,
            fechaPago: fechaPago ? 0.9 : 0,
            folioRecibo: folioRecibo ? 0.8 : 0,
            claveRastreo: claveRastreo ? 0.85 : 0,
            cuentaBeneficiaria: cuentaBeneficiaria ? 0.85 : 0,
            formaPago: formaPago ? 0.85 : 0,
            moneda: moneda ? 0.85 : 0,
            claveProdServ: productCodeMatch ? 0.85 : 0,
            cantidad: quantityMatch ? 0.7 : 0,
            claveUnidad: unitCodeMatch ? 0.8 : 0,
            unidad: unitMatch ? 0.75 : 0,
            valorUnitario: Number.isFinite(valorUnitario) ? 0.8 : 0,
            importeLinea: Number.isFinite(importeLinea) ? 0.8 : 0,
            objetoImpuesto: objectTaxMatch ? 0.8 : 0,
            metodoPago: metodoPago ? 0.85 : 0,
            noSerieCsd: noSerieCsdMatch ? 0.85 : 0,
            rfcProveedorCertificacion: rfcProveedorMatch ? 0.9 : 0,
            noSerieCertificadoSat: noSerieSatMatch ? 0.85 : 0
        }
    };
}

function cleanOcrValue(value) {
    return String(value || '').replace(/\s+/g, ' ').replace(/[|]+/g, '').trim().replace(/[.,;:]$/, '');
}

function normalizeOcrRfc(value) {
    return cleanOcrValue(value).toUpperCase().replace(/[ .]/g, '');
}

function normalizeOcrUuid(value) {
    // These substitutions are safe inside a hexadecimal UUID: the letters
    // O/Q, I/L, S, G and Z cannot be valid UUID digits, but are common OCR
    // confusions for 0, 1, 5, 6 and 2 respectively.
    return String(value || '').toUpperCase().replace(/[OQ]/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/G/g, '6').replace(/Z/g, '2');
}

function normalizeOcrConcept(value) {
    return cleanOcrValue(value)
        .replace(/[\[\]{}<>|]/g, ' ')
        .replace(/\bI\s+L(?:E|C)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function applyExtractedFields(fields) {
    if (!state.activeExpediente) createActiveExpedienteFromUploads();
    if (!state.activeExpediente) return;
    const dossier = state.activeExpediente;
    if (fields.rfc) dossier.rfc = fields.rfc;
    if (fields.razonSocial) dossier.cliente = fields.razonSocial;
    if (fields.banco) dossier.banco = fields.banco;
    if (Number.isFinite(fields.importe)) dossier.importe = fields.importe;
    if (Number.isFinite(fields.importePago)) dossier.importePago = fields.importePago;
    if (fields.referencia) dossier.referencia = fields.referencia;
    if (fields.concepto) dossier.concepto = fields.concepto;
    if (fields.fechaPago) dossier.fechaPago = fields.fechaPago;
    if (fields.folioRecibo) dossier.folioRecibo = fields.folioRecibo;
    if (fields.regimenFiscal) dossier.regimenFiscal = fields.regimenFiscal;
    if (fields.codigoPostal) dossier.codigoPostal = fields.codigoPostal;
    if (fields.usoCfdi) dossier.usoCfdi = fields.usoCfdi;
    if (fields.tipoCfdi) dossier.tipoCfdi = fields.tipoCfdi.toLowerCase().includes('egreso') ? 'egreso' : 'ingreso';
    if (fields.uuid) dossier.uuid = fields.uuid;
    if (fields.bancoEmisor) dossier.bancoEmisor = fields.bancoEmisor;
    if (fields.bancoReceptor) dossier.bancoReceptor = fields.bancoReceptor;
    if (fields.bancoEmisorCodigo) dossier.bancoEmisorCodigo = fields.bancoEmisorCodigo;
    if (fields.bancoReceptorCodigo) dossier.bancoReceptorCodigo = fields.bancoReceptorCodigo;
    if (fields.claveRastreo) dossier.claveRastreo = fields.claveRastreo;
    if (fields.cuentaBeneficiaria) dossier.cuentaBeneficiaria = fields.cuentaBeneficiaria;
    if (fields.formaPago) dossier.formaPago = fields.formaPago;
    if (fields.moneda) dossier.moneda = fields.moneda;
    if (fields.rfcEmisor) dossier.rfcEmisor = fields.rfcEmisor;
    if (fields.nombreEmisor) dossier.nombreEmisor = fields.nombreEmisor;
    if (fields.regimenFiscalEmisor) dossier.regimenFiscalEmisor = fields.regimenFiscalEmisor;
    if (fields.fechaEmision) dossier.fechaEmision = fields.fechaEmision;
    if (fields.fechaCertificacion) dossier.fechaCertificacion = fields.fechaCertificacion;
    if (fields.claveProdServ) dossier.claveProdServ = fields.claveProdServ;
    if (fields.cantidad) dossier.cantidad = fields.cantidad;
    if (fields.claveUnidad) dossier.claveUnidad = fields.claveUnidad;
    if (fields.unidad) dossier.unidad = fields.unidad;
    if (Number.isFinite(fields.valorUnitario)) dossier.valorUnitario = fields.valorUnitario;
    if (Number.isFinite(fields.importeLinea)) dossier.importeLinea = fields.importeLinea;
    if (fields.objetoImpuesto) dossier.objetoImpuesto = fields.objetoImpuesto;
    if (fields.metodoPago) dossier.metodoPago = fields.metodoPago;
    if (Number.isFinite(fields.subtotal)) dossier.subtotal = fields.subtotal;
    if (fields.noSerieCsd) dossier.noSerieCsd = fields.noSerieCsd;
    if (fields.rfcProveedorCertificacion) dossier.rfcProveedorCertificacion = fields.rfcProveedorCertificacion;
    if (fields.noSerieCertificadoSat) dossier.noSerieCertificadoSat = fields.noSerieCertificadoSat;
}

// Load presets of test invoices
function loadPresetDossier(presetIndex) {
    showToast('Los expedientes de demostración están deshabilitados. Carga un documento real.', 'warning');
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

function countReliableOcrFields(fields) {
    if (!fields || !fields.confidence) return 0;
    return Object.values(fields.confidence).filter(value => Number(value) >= 0.8).length;
}

function updateOcrResultAlert(fields) {
    const alert = document.getElementById('ocr-result-alert');
    if (!alert) return;
    const labels = alert.querySelectorAll('span');
    const title = labels[0];
    const description = labels[1];
    const quality = state.scanQuality;
    const reliableFields = countReliableOcrFields(fields);
    const fiscalCore = [fields?.rfc, fields?.razonSocial, fields?.importe].filter(Boolean).length;
    const needsReview = !quality || quality.level !== 'alta' || fiscalCore < 3 || reliableFields < 5;

    alert.classList.toggle('ocr-needs-review', needsReview);
    if (needsReview) {
        if (title) title.textContent = fields?.qualityRejected
            ? 'Resolucion insuficiente: datos dudosos descartados'
            : 'Lectura incompleta: documento no confirmado';
        if (description) {
            const qualityText = quality?.label || 'calidad no determinada';
            description.textContent = fields?.qualityRejected
                ? `${qualityText}. No se encontro un UUID/RFC o una clave bancaria verificable. Toma otra foto mas cerca.`
                : `${qualityText}. Revisa los campos en rojo; el OCR no sustituye la confirmacion fiscal o bancaria.`;
        }
    } else {
        if (title) title.textContent = 'Datos detectados con buena legibilidad';
        if (description) description.textContent = 'Compara los valores con la hoja encuadrada antes de continuar.';
    }

    let previewButton = document.getElementById('btn-view-scan');
    if (!previewButton) {
        previewButton = document.createElement('button');
        previewButton.type = 'button';
        previewButton.id = 'btn-view-scan';
        previewButton.className = 'scan-preview-button';
        previewButton.textContent = 'Ver hoja encuadrada';
        previewButton.addEventListener('click', () => openScanPreview());
        alert.appendChild(previewButton);
    }
    previewButton.hidden = !state.scanPreviewUrl;
}

function showScanPreview(previewUrl, quality = null) {
    const image = document.getElementById('scan-preview-image');
    const badge = document.getElementById('scan-quality-badge');
    const details = document.getElementById('scan-quality-details');
    if (!image || !badge || !details || !previewUrl) return;
    image.src = previewUrl;
    badge.className = 'scan-quality-badge';
    if (quality?.level === 'baja') badge.classList.add('quality-low');
    if (quality?.level === 'media') badge.classList.add('quality-medium');
    badge.textContent = quality?.label || 'Imagen original';
    details.textContent = quality
        ? `Encuadre automatico aplicado. Nitidez estimada: ${quality.sharpness}; contraste: ${quality.contrast}.`
        : 'Archivo real seleccionado; el encuadre se mostrara despues de ejecutar el OCR.';
    document.getElementById('modal-scan-preview')?.classList.add('open');
}

function openScanPreview(docName = '') {
    const uploaded = docName
        ? state.uploadedFiles.find(item => item.name === docName)
        : state.uploadedFiles.find(item => item.scanPreviewUrl) || state.uploadedFiles[0];
    const previewUrl = uploaded?.scanPreviewUrl || state.scanPreviewUrl;
    const quality = uploaded?.scanQuality || state.scanQuality;
    if (previewUrl) {
        showScanPreview(previewUrl, quality);
        return;
    }
    if (!uploaded?.file) {
        showToast('No hay una imagen real disponible para mostrar.', 'warning');
        return;
    }
    const isPdf = uploaded.type === 'PDF' || uploaded.name.toLowerCase().endsWith('.pdf');
    if (isPdf) {
        const objectUrl = URL.createObjectURL(uploaded.file);
        const opened = window.open(objectUrl, '_blank', 'noopener,noreferrer');
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
        if (!opened) showToast('El navegador bloqueo la vista del PDF. Permite ventanas emergentes para verlo.', 'warning');
        return;
    }
    const reader = new FileReader();
    reader.onload = () => showScanPreview(String(reader.result || ''), null);
    reader.onerror = () => showToast('No se pudo abrir la imagen seleccionada.', 'error');
    reader.readAsDataURL(uploaded.file);
}

function updateStep2Fields() {
    if (!state.activeExpediente) return;
    const pending = 'Pendiente de lectura';
    document.getElementById('val-rfc').textContent = state.activeExpediente.rfc;
    document.getElementById('val-razon').textContent = state.activeExpediente.cliente;
    document.getElementById('val-regimen').textContent = state.activeExpediente.regimenFiscal;
    document.getElementById('val-cp').textContent = state.activeExpediente.codigoPostal;
    document.getElementById('val-cfdi').textContent = state.activeExpediente.usoCfdi;
    document.getElementById('val-correo').textContent = state.activeExpediente.correo;

    const setDetected = (id, value) => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value || 'No detectado';
            element.classList.toggle('ocr-field-missing', !value);
        }
    };
    const formatDetectedAmount = value => value !== null && value !== '' && Number.isFinite(Number(value))
        ? `$${Number(value).toFixed(2)} MXN`
        : 'No detectado';
    setDetected('val-rfc-emisor', state.activeExpediente.rfcEmisor);
    setDetected('val-nombre-emisor', state.activeExpediente.nombreEmisor);
    setDetected('val-regimen-emisor', state.activeExpediente.regimenFiscalEmisor);
    setDetected('val-tipo-cfdi', state.activeExpediente.tipoCfdi ? state.activeExpediente.tipoCfdi.toUpperCase() : '');
    setDetected('val-fecha-emision', state.activeExpediente.fechaEmision);
    setDetected('val-uuid', state.activeExpediente.uuid);
    setDetected('val-metodo-pago', state.activeExpediente.metodoPago);
    setDetected('val-moneda', state.activeExpediente.moneda);
    setDetected('val-subtotal', formatDetectedAmount(state.activeExpediente.subtotal));
    setDetected('val-clave-prodserv', state.activeExpediente.claveProdServ);
    setDetected('val-cantidad-unidad', [state.activeExpediente.cantidad, state.activeExpediente.claveUnidad, state.activeExpediente.unidad].filter(Boolean).join(' / '));
    const lineValues = [
        state.activeExpediente.valorUnitario !== null && state.activeExpediente.valorUnitario !== '' && Number.isFinite(Number(state.activeExpediente.valorUnitario)) ? `$${Number(state.activeExpediente.valorUnitario).toFixed(2)}` : '',
        state.activeExpediente.importeLinea !== null && state.activeExpediente.importeLinea !== '' && Number.isFinite(Number(state.activeExpediente.importeLinea)) ? `$${Number(state.activeExpediente.importeLinea).toFixed(2)}` : ''
    ].filter(Boolean);
    setDetected('val-valores-linea', lineValues.length ? lineValues.join(' / ') + ' MXN' : '');
    setDetected('val-objeto-impuesto', state.activeExpediente.objetoImpuesto);
    const certificateValues = [state.activeExpediente.noSerieCsd, state.activeExpediente.rfcProveedorCertificacion, state.activeExpediente.noSerieCertificadoSat].filter(Boolean);
    setDetected('val-certificados', certificateValues.length ? certificateValues.join(' / ') : '');

    // These values come from OCR only. The word "PAGADO" in a document is
    // not bank confirmation, so the validation status remains pending.
    document.getElementById('val-cis-folio').textContent = state.activeExpediente.folioRecibo || pending;
    document.getElementById('val-cis-fecha').textContent = state.activeExpediente.fechaPago || pending;
    document.getElementById('val-cis-concepto').textContent = state.activeExpediente.concepto || pending;
    const paymentAmount = Number(state.activeExpediente.importePago);
    document.getElementById('val-cis-importe').textContent = Number.isFinite(paymentAmount) && paymentAmount > 0
        ? `$${paymentAmount.toFixed(2)} MXN`
        : pending;

    document.getElementById('val-banco').textContent = state.activeExpediente.banco || pending;
    document.getElementById('val-banco-fecha').textContent = state.activeExpediente.fechaPago || pending;
    document.getElementById('val-banco-importe').textContent = Number.isFinite(paymentAmount) && paymentAmount > 0
        ? `$${paymentAmount.toFixed(2)} MXN`
        : pending;
    document.getElementById('val-banco-ref').textContent = state.activeExpediente.referencia || pending;
    document.getElementById('val-banco-clave').textContent = state.activeExpediente.claveRastreo || pending;
    document.getElementById('val-banco-cuenta').textContent = state.activeExpediente.cuentaBeneficiaria || pending;
    document.getElementById('val-banco-forma').textContent = state.activeExpediente.formaPago || pending;
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
                            <input id="cep-fecha" type="text" maxlength="10" placeholder="DD-MM-AAAA" autocomplete="off">
                        </label>
                        <label>Monto detectado
                            <input id="cep-monto" type="text" inputmode="decimal" maxlength="18" placeholder="Ej. 704.00" autocomplete="off">
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
                            <input id="cep-cuenta" type="text" inputmode="numeric" maxlength="18" placeholder="Opcional para consultar estado">
                        </label>
                    </div>
                    <label class="cep-checkbox-row">
                        <input id="cep-receptor-participante" type="checkbox" value="0">
                        El beneficiario es directamente el banco receptor
                    </label>
                    <div class="cep-captcha-card">
                        <div class="cep-captcha-heading">
                            <div>
                                <strong>Imagen de seguridad oficial de Banxico</strong>
                                <span>Escribe exactamente el código que aparece en la imagen.</span>
                            </div>
                            <button type="button" class="btn btn-secondary cep-captcha-reload" id="cep-captcha-reload">Intentar otra imagen</button>
                        </div>
                        <div class="cep-captcha-content">
                            <img id="cep-captcha-image" alt="CAPTCHA oficial de Banxico">
                            <label>Código de seguridad *
                                <input id="cep-captcha" type="text" maxlength="5" autocomplete="off" placeholder="Código de la imagen" required>
                            </label>
                        </div>
                        <p class="cep-modal-help">Por seguridad, este CAPTCHA no se omite ni se resuelve automáticamente. Si necesitas cambiarlo, usa “Intentar otra imagen”.</p>
                    </div>
                    <p class="cep-modal-help">Datos detectados por OCR: banco emisor <strong id="cep-banco-emisor-detectado">No detectado</strong>, banco receptor <strong id="cep-banco-receptor-detectado">No detectado</strong>, forma de pago <strong id="cep-forma-pago-detectada">No detectada</strong>.</p>
                    <p class="cep-modal-help">El OCR no puede inventar los códigos Banxico: confirma emisor, receptor, fecha, referencia/clave y CLABE con el comprobante bancario.</p>
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
    document.getElementById('cep-monto').value = Number.isFinite(Number(dossier.importePago)) && Number(dossier.importePago) > 0
        ? Number(dossier.importePago).toFixed(2)
        : '';
    document.getElementById('cep-tipo-criterio').value = criterionType;
    document.getElementById('cep-criterio').value = criterionValue;
    document.getElementById('cep-cuenta').value = dossier.cuentaBeneficiaria || '';
    document.getElementById('cep-emisor').value = dossier.bancoEmisorCodigo || '';
    document.getElementById('cep-receptor').value = dossier.bancoReceptorCodigo || '';
    document.getElementById('cep-banco-emisor-detectado').textContent = dossier.bancoEmisor || dossier.banco || 'No detectado';
    document.getElementById('cep-banco-receptor-detectado').textContent = dossier.bancoReceptor || 'No detectado';
    document.getElementById('cep-forma-pago-detectada').textContent = dossier.formaPago || 'No detectada';

    const refreshBanxicoCaptcha = () => {
        const image = document.getElementById('cep-captcha-image');
        if (image) image.src = `https://www.banxico.org.mx/cep/stickyImg?b_capt=${Date.now()}`;
    };

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
    document.getElementById('cep-captcha-reload').addEventListener('click', () => {
        document.getElementById('cep-captcha').value = '';
        refreshBanxicoCaptcha();
    });
    document.getElementById('banxico-cep-modal').addEventListener('click', event => {
        if (event.target.id === 'banxico-cep-modal') closeBanxicoCepModal();
    });
    document.getElementById('banxico-cep-form').addEventListener('submit', submitBanxicoCepForm);
    updateCriterionLabel();
    refreshBanxicoCaptcha();
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

    if (!/^\d{2}-\d{2}-\d{4}$/.test(fecha)) {
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
    if (cuenta && !/^\d{10,18}$/.test(cuenta)) {
        showToast('La cuenta beneficiaria debe contener de 10 a 18 dígitos.', 'error');
        return;
    }
    if (cuenta && (!monto || !/^\d+(\.\d{1,2})?$/.test(monto))) {
        showToast('Captura un monto válido cuando uses cuenta beneficiaria.', 'error');
        return;
    }
    if (!captcha || !/^[A-Za-z0-9]{1,5}$/.test(captcha)) {
        showToast('Escribe el código de la imagen oficial de seguridad de Banxico.', 'error');
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
        receptorParticipante: document.getElementById('cep-receptor-participante').checked ? '0' : '',
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

    showToast('No se cambio el estatus: falta evidencia bancaria y autorizacion contable identificable.', 'warning');
}

function updatePaymentValidationUI() {
    const confirmBtn = document.getElementById('btn-confirm-step2');
    if (!confirmBtn) return;

    const hasExpediente = Boolean(state.activeExpediente);
    confirmBtn.disabled = !hasExpediente;
    confirmBtn.classList.remove('btn-business-blocked');
    confirmBtn.title = hasExpediente
        ? 'Confirma que revisaste los datos del expediente antes de continuar.'
        : 'Carga y procesa un documento para continuar.';
}

function confirmStep2() {
    if (!state.activeExpediente) return;

    state.activeExpediente.estatus = 'Datos confirmados';
    addAuditLogToActive('Datos del expediente confirmados manualmente por el usuario.');
    saveDatabaseToStorage();
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
    showToast('Timbrado PAC no configurado. No se generó UUID, XML ni factura fiscal.', 'warning');
}

function downloadXML() {
    if (!state.activeExpediente) return;
    showToast('XML no disponible: primero debe configurarse un PAC real o cargarse un XML timbrado.', 'warning');
}

function openSatPortal() {
    const opened = window.open('https://www.sat.gob.mx/', '_blank', 'noopener,noreferrer');
    if (!opened) {
        showToast('El navegador bloqueo la pestaña del SAT. Permite ventanas emergentes para este sitio.', 'error');
        return;
    }
    showToast('Portal oficial del SAT abierto en una pestaña nueva.', 'info');
    addSecurityLog('Redirección SAT', 'Apertura del portal de facturación del SAT.');
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
function openInvoicePreviewModal(folio = '', clientName = '', totalVal = '') {
    if (!state.activeExpediente?.uuid) {
        showToast('No existe un CFDI timbrado real para previsualizar.', 'warning');
        return;
    }

    if (!clientName && state.activeExpediente) {
        clientName = state.activeExpediente.cliente;
    }
    
    // Solo se muestran datos devueltos por un PAC real o cargados como CFDI timbrado.
    const matchedFac = state.facturas.find(f => f.folioInterno === folio);
    const uuid = matchedFac ? matchedFac.uuid : state.activeExpediente.uuid;

    document.getElementById('pdf-folio').textContent = folio;
    document.getElementById('pdf-receptor-name').textContent = clientName;
    document.getElementById('pdf-receptor-rfc').textContent = state.activeExpediente.rfc || 'Pendiente de confirmación';
    document.getElementById('pdf-receptor-regimen').textContent = state.activeExpediente.regimenFiscal || 'Pendiente de confirmación';
    document.getElementById('pdf-receptor-cfdi').textContent = state.activeExpediente.usoCfdi || 'Pendiente de confirmación';
    
    // Set UUID in box
    const uuidBox = document.getElementById('pdf-uuid-val');
    if (uuidBox) {
        uuidBox.textContent = uuid;
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
    document.getElementById(modalId)?.classList.remove('open');
}

function sendInvoiceByEmail() {
    if (!state.activeExpediente) return;
    showToast('Envío de correo no configurado: no se envió ningún archivo.', 'warning');
}

// Descargas de CFDI solo se habilitarán al recibir archivos reales del backend PAC.
function triggerDownload(filename) {
    showToast(`Archivo no disponible: ${filename}. Configure el PAC o cargue el documento real.`, 'warning');
}

// Browser downloader
function triggerBrowserDownload(filename, text, mimeType) {
    const element = document.createElement('a');
    const file = new Blob([text], {type: mimeType});
    const objectUrl = URL.createObjectURL(file);
    element.href = objectUrl;
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

// 8. Step 7: Filter table and real CSV Excel Export
function filterReportTable() {
    const input = document.getElementById('search-report');
    const filter = (input?.value || '').toLowerCase();
    const statusFilter = (document.getElementById('report-status-filter')?.value || '').toLowerCase();
    const table = document.getElementById('table-invoices');
    const rows = table?.querySelectorAll('tbody tr[data-invoice-row="true"]') || [];
    let matchesCount = 0;

    rows.forEach(row => {
        const matchesText = !filter || row.textContent.toLowerCase().includes(filter);
        const matchesStatus = !statusFilter || row.dataset.status === statusFilter;
        if (matchesText && matchesStatus) {
            row.style.display = '';
            matchesCount++;
        } else {
            row.style.display = 'none';
        }
    });

    const showingText = document.getElementById('showing-results-text');
    if (showingText) {
        showingText.textContent = `Mostrando ${matchesCount} de ${state.facturas.length} resultados`;
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

    triggerBrowserDownload('Reporte_Facturas_COEPRISS.csv', csvContent, 'text/csv;charset=utf-8;');
    showToast('✓ Reporte Excel (CSV) descargado con éxito.', 'success');
    addSecurityLog('Exportación Reporte', `Exportación de reporte de facturación (${state.facturas.length} registros).`);
}

function restartProcess() {
    state.activeExpediente = null;
    state.uploadedFiles = [];
    state.ocrBusy = false;
    state.scanPreviewUrl = '';
    state.scanQuality = null;
    state.lastOcrFields = null;
    const input = document.getElementById('document-file-input');
    if (input) input.value = '';
    document.getElementById('lbl-cliente-correo').textContent = 'Carga un documento real para iniciar...';
    document.getElementById('lbl-cliente-fecha').textContent = '--/--/---- --:--';
    
    const btnScan = document.getElementById('btn-scan');
    if (btnScan) btnScan.disabled = false;
    
    // Clear dynamic Step 1 doc lists
    const listContainer = document.getElementById('doc-list-container');
    if (listContainer) {
        listContainer.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; color: #868e96; padding: 30px 0; font-size: 0.82rem;">
                Arrastra o selecciona archivos reales para iniciar el expediente.
            </div>
        `;
    }

    goToStep(1);
    showToast('Nueva solicitud de facturación iniciada.', 'info');
}

// Employee Role Switcher & Config Panel Management
function changeUserRole(roleId) {
    showToast('Autenticación y roles no configurados. No se cambió la sesión.', 'warning');
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
    const smtpHost = document.getElementById('smtp-host').value.trim();
    const smtpPort = document.getElementById('smtp-port').value.trim();
    if (!smtpHost || !/^\d{2,5}$/.test(smtpPort) || Number(smtpPort) > 65535) {
        showToast('Captura un servidor SMTP y un puerto valido.', 'error');
        return;
    }
    try {
        sessionStorage.setItem('coepriss-session-config', JSON.stringify({ smtpHost, smtpPort }));
        addSecurityLog('Configuración local', `SMTP guardado para esta sesion: ${smtpHost}:${smtpPort}.`);
        renderBitacoraTable();
        showToast('Configuracion guardada en esta sesion. El envio requiere conectar el backend SMTP.', 'success');
    } catch (error) {
        showToast('El navegador no permitio guardar la configuracion de esta sesion.', 'error');
    }
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
    if (state.historialCorreos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-table-cell">No hay correos enviados en esta sesion.</td></tr>';
        return;
    }
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

    if (clients.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-table-cell">No hay clientes persistentes. La base de datos aun no esta conectada.</td></tr>';
        return;
    }

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
    if (state.facturas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-table-cell">No hay facturas timbradas reales en esta sesion.</td></tr>';
    }
    state.facturas.forEach(f => {
        const statusClass = ['Timbrada', 'Entregada'].includes(String(f.estatus)) ? 'badge-success' : 'badge-warning';
        const tr = document.createElement('tr');
        tr.dataset.invoiceRow = 'true';
        tr.dataset.status = String(f.estatus || '').toLowerCase();
        tr.innerHTML = `
            <td class="col-folio">${f.folioInterno}</td>
            <td>${f.folioRecibo}</td>
            <td class="col-cliente">${f.cliente}</td>
            <td style="color: #6c757d;">${f.fecha}</td>
            <td style="text-align: right; font-weight: 700; color: #212529;">$${f.importe.toFixed(2)}</td>
            <td style="text-align: center;">
                <span class="badge ${statusClass}">
                    <svg class="badge-icon" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
                    ${f.estatus}
                </span>
            </td>
            <td style="text-align: center;">
                <div class="action-icon-group">
                    <button class="action-icon-btn btn-view" onclick="openInvoicePreviewModal('${f.folioInterno}', '${f.cliente}', '$${f.importe.toFixed(2)}')" title="Ver factura"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg></button>
                    <button class="action-icon-btn btn-dl-pdf" onclick="triggerDownload('FACTURA_${f.folioRecibo.replace('-', '')}.pdf')" title="Descargar PDF"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg></button>
                    <button class="action-icon-btn btn-dl-xml" onclick="triggerDownload('FACTURA_${f.folioRecibo.replace('-', '')}.xml')" title="Descargar XML"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg></button>
                    <button class="action-icon-btn btn-email" onclick="resendEmail('${f.correo || ''}', '${f.folioInterno}')" title="Enviar por correo"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 00-2-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    const showingText = document.getElementById('showing-results-text');
    if (showingText) {
        showingText.textContent = `Mostrando ${state.facturas.length} de ${state.facturas.length} resultados`;
    }
    const pagination = document.querySelector('#step-panel-7 .pagination');
    if (pagination) {
        pagination.innerHTML = '<li class="page-item active"><a href="#" onclick="setReportPage(1); return false;" aria-label="Pagina 1">1</a></li>';
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
        usuario: state.currentUser?.name || 'Usuario no autenticado',
        action: action,
        detalles: details
    });
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

// 11. Edición manual completa del expediente (Step 2)
const EXPEDIENTE_TEXT_EDIT_FIELDS = [
    ['edit-rfc', 'rfc', true],
    ['edit-razon', 'cliente'],
    ['edit-regimen', 'regimenFiscal'],
    ['edit-cp', 'codigoPostal'],
    ['edit-cfdi', 'usoCfdi'],
    ['edit-correo', 'correo'],
    ['edit-rfc-emisor', 'rfcEmisor', true],
    ['edit-nombre-emisor', 'nombreEmisor'],
    ['edit-regimen-emisor', 'regimenFiscalEmisor'],
    ['edit-tipo-cfdi', 'tipoCfdi', false, true],
    ['edit-fecha-emision', 'fechaEmision'],
    ['edit-fecha-certificacion', 'fechaCertificacion'],
    ['edit-uuid', 'uuid', true],
    ['edit-metodo-pago', 'metodoPago'],
    ['edit-moneda', 'moneda', true],
    ['edit-clave-prodserv', 'claveProdServ'],
    ['edit-cantidad', 'cantidad'],
    ['edit-clave-unidad', 'claveUnidad', true],
    ['edit-unidad', 'unidad'],
    ['edit-objeto-impuesto', 'objetoImpuesto'],
    ['edit-no-serie-csd', 'noSerieCsd'],
    ['edit-rfc-proveedor', 'rfcProveedorCertificacion', true],
    ['edit-no-serie-sat', 'noSerieCertificadoSat'],
    ['edit-folio-recibo', 'folioRecibo'],
    ['edit-fecha-pago', 'fechaPago'],
    ['edit-concepto', 'concepto'],
    ['edit-banco', 'banco'],
    ['edit-banco-emisor', 'bancoEmisor'],
    ['edit-banco-receptor', 'bancoReceptor'],
    ['edit-banco-emisor-codigo', 'bancoEmisorCodigo'],
    ['edit-banco-receptor-codigo', 'bancoReceptorCodigo'],
    ['edit-referencia', 'referencia'],
    ['edit-clave-rastreo', 'claveRastreo', true],
    ['edit-cuenta-beneficiaria', 'cuentaBeneficiaria'],
    ['edit-forma-pago', 'formaPago']
];

const EXPEDIENTE_AMOUNT_EDIT_FIELDS = [
    ['edit-subtotal', 'subtotal', 'subtotal'],
    ['edit-importe', 'importe', 'total del CFDI'],
    ['edit-valor-unitario', 'valorUnitario', 'valor unitario'],
    ['edit-importe-linea', 'importeLinea', 'importe de la partida'],
    ['edit-importe-pago', 'importePago', 'importe pagado']
];

function formatEditableAmount(value) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '';
}

function openEditModal() {
    if (!state.activeExpediente) {
        showToast('No hay un expediente activo seleccionado.', 'warning');
        return;
    }
    const dossier = state.activeExpediente;
    const modal = document.getElementById('modal-edit-fiscal');

    if (modal) {
        modal.querySelectorAll('details').forEach(details => { details.open = true; });
    }

    EXPEDIENTE_TEXT_EDIT_FIELDS.forEach(([id, field]) => {
        const input = document.getElementById(id);
        if (input) input.value = dossier[field] ?? '';
    });
    EXPEDIENTE_AMOUNT_EDIT_FIELDS.forEach(([id, field]) => {
        const input = document.getElementById(id);
        if (input) input.value = formatEditableAmount(dossier[field]);
    });

    if (modal) modal.classList.add('open');
}

function parseManualAmount(input, fieldLabel) {
    const raw = input.value.trim();
    if (!raw) return { value: null };
    const amount = Number(raw.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(amount) || amount < 0) {
        input.focus();
        showToast(`Captura un ${fieldLabel} válido.`, 'error');
        return { error: true };
    }
    return { value: amount };
}

async function saveFiscalData(event) {
    event.preventDefault();
    if (!state.activeExpediente) return;

    const rfcInput = document.getElementById('edit-rfc');
    const razonInput = document.getElementById('edit-razon');
    if (!rfcInput.value.trim() || !razonInput.value.trim()) {
        const missingInput = !rfcInput.value.trim() ? rfcInput : razonInput;
        missingInput.focus();
        showToast('Completa RFC y razón social antes de guardar.', 'error');
        return;
    }

    const emailInput = document.getElementById('edit-correo');
    const email = emailInput.value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        emailInput.focus();
        showToast('Captura un correo electrónico válido o déjalo vacío.', 'error');
        return;
    }

    const dossier = state.activeExpediente;
    for (const [id, field, uppercase, lowercase] of EXPEDIENTE_TEXT_EDIT_FIELDS) {
        const input = document.getElementById(id);
        let value = input ? input.value.trim() : '';
        if (uppercase) value = value.toUpperCase();
        if (lowercase) value = value.toLowerCase();
        dossier[field] = value;
    }

    for (const [id, field, label] of EXPEDIENTE_AMOUNT_EDIT_FIELDS) {
        const input = document.getElementById(id);
        const parsed = parseManualAmount(input, label);
        if (parsed.error) return;
        dossier[field] = parsed.value;
    }

    // Sync state.expedientes array so all tables and database records reflect the edits!
    const idx = state.expedientes.findIndex(e => e.folio === dossier.folio);
    if (idx !== -1) {
        state.expedientes[idx] = { ...dossier };
    }

    addAuditLogToActive('Todos los datos del expediente fueron modificados y confirmados manualmente por el usuario.');
    addSecurityLog('Modificación manual', `Datos del expediente ${dossier.folio} actualizados correctamente.`);
    
    updateStep2Fields();
    updatePreviewFields();
    renderProcesoTable();
    renderReportTable();
    renderTimeline();
    updatePaymentValidationUI();
    closeModal('modal-edit-fiscal');

    saveDatabaseToStorage();
    showToast('✅ Todos los datos del expediente fueron actualizados y guardados en la base de datos.', 'success');
}

// La vista previa sólo abre el archivo original seleccionado por el usuario.
function previewDocument(docName) {
    const realUpload = state.uploadedFiles.find(item => item.name === docName);
    if (realUpload) {
        openScanPreview(docName);
        return;
    }
    showToast('No existe un archivo real asociado a este registro.', 'warning');
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
