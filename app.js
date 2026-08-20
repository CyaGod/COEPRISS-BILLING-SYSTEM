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

    // Datos reales: se cargan desde el backend después de autenticar al usuario.
    expedientes: [],
    facturas: [],
    clientes: [],
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
    state.clientes = [];
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
async function initRenderDbSync() {
    try {
        const res = await apiFetch('/api/db');
        const data = await res.json();
        if (data.success && data.data) {
            resetCloudCollections();
            if (Array.isArray(data.data.expedientes)) state.expedientes = data.data.expedientes;
            if (Array.isArray(data.data.facturas)) state.facturas = data.data.facturas;
            if (Array.isArray(data.data.historialCorreos)) state.historialCorreos = data.data.historialCorreos;
            if (Array.isArray(data.data.bitacoraSeguridad)) state.bitacoraSeguridad = data.data.bitacoraSeguridad;
        }

        // Cargar directorio de clientes
        await loadClientes();
        renderCloudCollections();
    } catch (err) {
        console.info('[PostgreSQL Render] Datos en espera:', err.message);
    }
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

    // 5. Al navegar a los pasos correspondientes:
    if (stepNumber === 3) {
        updateStep3UIFromActiveExpediente();
    } else if (stepNumber === 4) {
        initStep4FacturamaBadge();
    } else if (stepNumber === 6) {
        updateStep6ComprobanteUI();
    } else if (stepNumber === 7) {
        renderReportTable();
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
    const ocrLogger = message => {
        if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
            const scanBtn = document.getElementById('btn-scan');
            if (scanBtn) scanBtn.textContent = `Leyendo OCR ${Math.round(message.progress * 100)}%...`;
        }
    };
    try {
        state.ocrWorker = await Tesseract.createWorker(['spa', 'eng'], 1, { logger: ocrLogger });
    } catch (e) {
        state.ocrWorker = await Tesseract.createWorker('eng', 1, { logger: ocrLogger });
    }
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

// ─────────────────────────────────────────────
// 4. STEP 3: EDICIÓN RÁPIDA Y DATOS DEL CFDI 4.0
// ─────────────────────────────────────────────

function updateStep3UIFromActiveExpediente() {
    if (!state.activeExpediente) return;
    const d = state.activeExpediente;

    const rfcInput = document.getElementById('step3-rfc');
    const razonInput = document.getElementById('step3-razon');
    const cpInput = document.getElementById('step3-cp');
    const regimenSelect = document.getElementById('step3-regimen');
    const usoCfdiSelect = document.getElementById('step3-uso-cfdi');
    const correoInput = document.getElementById('step3-correo');
    const formaPagoSelect = document.getElementById('step3-forma-pago');
    const metodoPagoSelect = document.getElementById('step3-metodo-pago');
    const conceptoInput = document.getElementById('step3-concepto');
    const totalInput = document.getElementById('step3-total');

    if (rfcInput && d.rfc) rfcInput.value = d.rfc;
    if (razonInput && d.cliente) razonInput.value = d.cliente;
    if (cpInput && d.codigoPostal) cpInput.value = d.codigoPostal;
    if (regimenSelect && d.regimenFiscal) regimenSelect.value = d.regimenFiscal;
    if (usoCfdiSelect && d.usoCfdi) usoCfdiSelect.value = d.usoCfdi;
    if (correoInput && d.correo) correoInput.value = d.correo;
    if (formaPagoSelect && d.formaPago) formaPagoSelect.value = d.formaPago;
    if (metodoPagoSelect && d.metodoPago) metodoPagoSelect.value = d.metodoPago;
    if (conceptoInput && d.concepto) conceptoInput.value = d.concepto;

    const totalVal = parseFloat(d.importe || d.total || d.cfdiTotal || d.importePago || 0);
    if (totalInput && totalVal > 0) {
        totalInput.value = totalVal.toFixed(2);
    }
    updateStep3Summary(totalVal);

    // Verificar si ya existe en clientes
    if (d.rfc) buscarClientePorRfc(d.rfc, false);
}

function onStep3RfcChange(val) {
    if (!state.activeExpediente) return;
    const rfcClean = (val || '').toUpperCase().trim();
    state.activeExpediente.rfc = rfcClean;
    const rfcInput = document.getElementById('step3-rfc');
    if (rfcInput && rfcInput.value !== rfcClean) rfcInput.value = rfcClean;

    if (rfcClean.length >= 12) {
        buscarClientePorRfc(rfcClean, false);
    }
}

async function buscarClientePorRfc(rfc, notifyIfNotFound = true) {
    if (!rfc || rfc.trim().length < 10) {
        if (notifyIfNotFound) showToast('Ingresa un RFC válido de al menos 10 caracteres.', 'warning');
        return;
    }
    const rfcNorm = rfc.toUpperCase().trim();
    const badge = document.getElementById('badge-cliente-encontrado');

    // 1. Buscar en memoria local
    let cliente = (state.clientes || []).find(c => c.rfc?.toUpperCase() === rfcNorm);

    // 2. Si no está en memoria, buscar en backend
    if (!cliente) {
        try {
            const res = await apiFetch(`/api/clientes/${rfcNorm}`);
            const data = await res.json();
            if (data.success && data.data) cliente = data.data;
        } catch (e) {}
    }

    if (cliente) {
        if (badge) badge.style.display = 'inline-block';
        const razonInput = document.getElementById('step3-razon');
        const cpInput = document.getElementById('step3-cp');
        const regimenSelect = document.getElementById('step3-regimen');
        const usoCfdiSelect = document.getElementById('step3-uso-cfdi');
        const correoInput = document.getElementById('step3-correo');
        const formaPagoSelect = document.getElementById('step3-forma-pago');

        if (razonInput && cliente.razonSocial) { razonInput.value = cliente.razonSocial; syncStep3Field('cliente', cliente.razonSocial); }
        if (cpInput && cliente.codigoPostal) { cpInput.value = cliente.codigoPostal; syncStep3Field('codigoPostal', cliente.codigoPostal); }
        if (regimenSelect && cliente.regimenFiscal) { regimenSelect.value = cliente.regimenFiscal; syncStep3Field('regimenFiscal', cliente.regimenFiscal); }
        if (usoCfdiSelect && cliente.usoCfdi) { usoCfdiSelect.value = cliente.usoCfdi; syncStep3Field('usoCfdi', cliente.usoCfdi); }
        if (correoInput && cliente.email) { correoInput.value = cliente.email; syncStep3Field('correo', cliente.email); }
        if (formaPagoSelect && cliente.formaPago) { formaPagoSelect.value = cliente.formaPago; syncStep3Field('formaPago', cliente.formaPago); }

        if (notifyIfNotFound) showToast(`✓ Datos del cliente ${cliente.razonSocial} autocompletados desde el Directorio.`, 'success');
    } else {
        if (badge) badge.style.display = 'none';
        if (notifyIfNotFound) showToast(`RFC ${rfcNorm} no encontrado en el Directorio de Clientes. Se registrará automáticamente al timbrar.`, 'info');
    }
}

function syncStep3Field(field, val) {
    if (!state.activeExpediente) return;
    state.activeExpediente[field] = val;
}

function onStep3TotalChange(val) {
    const num = parseFloat(val) || 0;
    if (state.activeExpediente) {
        state.activeExpediente.importe = num;
        state.activeExpediente.total = num;
        state.activeExpediente.cfdiTotal = num;
    }
    updateStep3Summary(num);
}

function updateStep3Summary(total) {
    const totalNum = parseFloat(total) || 0;
    const subtotal = totalNum / 1.16;
    const iva = totalNum - subtotal;

    const subtotalEl = document.getElementById('step3-resumen-subtotal');
    const ivaEl = document.getElementById('step3-resumen-iva');
    const totalEl = document.getElementById('step3-resumen-total');

    if (subtotalEl) subtotalEl.textContent = `$${subtotal.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (ivaEl) ivaEl.textContent = `$${iva.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (totalEl) totalEl.textContent = `$${totalNum.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    if (state.activeExpediente) {
        state.activeExpediente.subtotal = subtotal;
    }
}

async function proceedToStep4() {
    if (!state.activeExpediente) {
        showToast('Primero carga y procesa un documento para iniciar el trámite.', 'warning');
        return;
    }
    const d = state.activeExpediente;

    // Obtener valores actuales de los inputs
    d.rfc = (document.getElementById('step3-rfc')?.value || d.rfc || '').toUpperCase().trim();
    d.cliente = (document.getElementById('step3-razon')?.value || d.cliente || '').trim();
    d.codigoPostal = (document.getElementById('step3-cp')?.value || d.codigoPostal || '').trim();
    d.regimenFiscal = document.getElementById('step3-regimen')?.value || d.regimenFiscal || '626';
    d.usoCfdi = document.getElementById('step3-uso-cfdi')?.value || d.usoCfdi || 'G03';
    d.correo = (document.getElementById('step3-correo')?.value || d.correo || '').trim();
    d.formaPago = document.getElementById('step3-forma-pago')?.value || d.formaPago || '03';
    d.metodoPago = document.getElementById('step3-metodo-pago')?.value || d.metodoPago || 'PUE';
    d.concepto = (document.getElementById('step3-concepto')?.value || d.concepto || 'Derechos de Trámite Sanitario COEPRISS').trim();
    d.importe = parseFloat(document.getElementById('step3-total')?.value || d.importe || 0);

    // Validaciones de negocio SAT 4.0
    if (!d.rfc || d.rfc.length < 12 || d.rfc.length > 13) {
        showToast('Captura un RFC válido (12 caracteres para Personas Morales o 13 para Físicas).', 'error');
        document.getElementById('step3-rfc')?.focus();
        return;
    }
    if (!d.cliente) {
        showToast('Captura el Nombre o Razón Social del receptor.', 'error');
        document.getElementById('step3-razon')?.focus();
        return;
    }
    if (!d.codigoPostal || !/^\d{5}$/.test(d.codigoPostal)) {
        showToast('El Código Postal fiscal debe contener exactamente 5 dígitos.', 'error');
        document.getElementById('step3-cp')?.focus();
        return;
    }
    if (!d.importe || d.importe <= 0) {
        showToast('El importe total a facturar debe ser mayor a $0.00.', 'error');
        document.getElementById('step3-total')?.focus();
        return;
    }

    // Persistir cambios en BD antes de timbrar
    try {
        await apiFetch('/api/expedientes', {
            method: 'POST',
            body: JSON.stringify({
                folio: d.folio,
                receptorRfc: d.rfc,
                receptorNombre: d.cliente,
                receptorRegimenFiscal: d.regimenFiscal,
                receptorCodigoPostal: d.codigoPostal,
                receptorUsoCfdi: d.usoCfdi,
                cfdiTotal: d.importe,
                cfdiSubtotal: d.subtotal || (d.importe / 1.16),
                cfdiConcepto: d.concepto,
                cfdiFormaPago: d.formaPago,
                cfdiMetodoPago: d.metodoPago,
                receptorEmail: d.correo
            })
        });
    } catch (e) {
        console.warn('[EXPEDIENTE PRE-SAVE ERROR]', e.message);
    }

    goToStep(4);
}

// ─────────────────────────────────────────────
// 5. STEP 4: TIMBRADO PAC FACTURAMA & ACCIONES
// ─────────────────────────────────────────────

let _lastStampResult = null;

async function initStep4FacturamaBadge() {
    const badgeEl = document.getElementById('facturama-ambiente-badge');
    if (!badgeEl) return;

    badgeEl.textContent = 'Verificando conexión con Facturama...';
    badgeEl.style.background = '#f0f0f0';
    badgeEl.style.color = '#666';

    try {
        const res = await apiFetch('/api/facturama/estado');
        const data = await res.json();

        if (data.sandbox) {
            badgeEl.innerHTML = '🧪 <strong>MODO SANDBOX</strong> — Las facturas son de prueba oficial (Facturama Test PAC).';
            badgeEl.style.background = '#d4edda';
            badgeEl.style.color = '#155724';
            badgeEl.style.borderColor = '#c3e6cb';
        } else {
            badgeEl.innerHTML = '⚡ <strong>MODO PRODUCCIÓN</strong> — Las facturas son REALES y reportadas al SAT.';
            badgeEl.style.background = '#fff3cd';
            badgeEl.style.color = '#856404';
            badgeEl.style.borderColor = '#ffc107';
        }
        badgeEl.dataset.sandbox = data.sandbox;
    } catch (e) {
        badgeEl.textContent = '⚠️ No se pudo verificar la conexión con Facturama.';
        badgeEl.style.background = '#f8d7da';
        badgeEl.style.color = '#721c24';
    }
}

async function stampInvoiceViaPAC() {
    if (!state.activeExpediente) {
        showToast('Primero carga y procesa un documento para obtener el expediente.', 'warning');
        return;
    }

    const folio = state.activeExpediente.folio;
    if (!folio) {
        showToast('El expediente no tiene folio asignado.', 'error');
        return;
    }

    const btn = document.getElementById('btn-pac-stamp');
    const loadingEl = document.getElementById('pac-loading-box');
    const titleEl = document.getElementById('pac-loading-title');
    const descEl = document.getElementById('pac-loading-desc');

    function setLoading(msg, sub) {
        if (loadingEl) loadingEl.style.display = 'flex';
        if (titleEl) titleEl.textContent = msg;
        if (descEl) descEl.textContent = sub;
        if (btn) btn.disabled = true;
    }
    function clearLoading() {
        if (loadingEl) loadingEl.style.display = 'none';
        if (btn) btn.disabled = false;
    }

    try {
        setLoading('Validando datos fiscales con Facturama...', 'Verificando RFC, clave SAT e importes.');
        const testRes = await apiFetch('/api/facturama/test', {
            method: 'POST',
            body: JSON.stringify({ expedienteId: folio }),
        });
        const testData = await testRes.json();

        if (!testRes.ok || !testData.success) {
            clearLoading();
            showToast(`❌ Datos inválidos: ${testData.error}`, 'error');
            return;
        }

        const isSandbox = testData.sandbox;

        // Confirmación en producción
        if (!isSandbox) {
            const confirmado = await _mostrarModalConfirmacionProduccion(testData.resumen);
            if (!confirmado) {
                clearLoading();
                showToast('Timbrado cancelado por el usuario.', 'info');
                return;
            }
        }

        setLoading('Generando Sello Digital y Timbrando...', 'PAC Facturama está sellando el CFDI 4.0 ante el SAT.');
        const body = { expedienteId: folio };
        if (!isSandbox) body.confirmarProduccion = true;

        const stampRes = await apiFetch('/api/facturama/timbrar', {
            method: 'POST',
            body: JSON.stringify(body),
        });
        const stampData = await stampRes.json();

        if (!stampRes.ok || !stampData.success) {
            clearLoading();
            const errMsg = stampData.error || 'Error desconocido del PAC.';
            showToast(`❌ Error al timbrar: ${errMsg}`, 'error');
            return;
        }

        _lastStampResult = stampData;
        state.activeExpediente.uuid = stampData.uuid;
        state.activeExpediente.facturamaId = stampData.facturamaId;
        state.activeExpediente.estatus = 'TIMBRADA';

        // Agregar a la lista de facturas
        const newFactura = {
            id: stampData.facturaId,
            folioInterno: folio,
            folioRecibo: stampData.folio || folio,
            cliente: state.activeExpediente.cliente,
            rfc: state.activeExpediente.rfc,
            fecha: new Date().toLocaleDateString('es-MX'),
            importe: parseFloat(stampData.total || state.activeExpediente.importe || 0),
            uuid: stampData.uuid,
            estatus: 'TIMBRADA',
            facturamaId: stampData.facturamaId,
            correo: state.activeExpediente.correo
        };
        state.facturas.unshift(newFactura);

        // Recargar directorio de clientes para incluir al nuevo
        await loadClientes();

        clearLoading();
        _mostrarResultadoTimbrado(stampData, isSandbox);
        renderReportTable();
        updateDashboardCounts();

        const modoStr = isSandbox ? '🧪 (SANDBOX)' : '✅ (PRODUCCIÓN)';
        showToast(`${modoStr} ¡CFDI 4.0 timbrado exitosamente! UUID: ${stampData.uuid}`, 'success');
        addSecurityLog('CFDI Timbrado Oficial', `UUID: ${stampData.uuid} | Folio Facturama: ${stampData.facturamaId}`);

    } catch (err) {
        clearLoading();
        console.error('[STAMP EXCEPTION]', err);
        showToast(`❌ Error de conexión: ${err.message}`, 'error');
    }
}

function _mostrarModalConfirmacionProduccion(resumen) {
    return new Promise((resolve) => {
        const fmt = n => n != null ? `$${parseFloat(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '—';

        const modal = document.createElement('div');
        modal.id = 'modal-produccion-confirm';
        modal.style.cssText = `position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:20px;`;
        modal.innerHTML = `
            <div style="background:#fff;border-radius:12px;padding:30px;max-width:500px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
                    <div style="width:40px;height:40px;border-radius:50%;background:#fff3cd;display:flex;align-items:center;justify-content:center;font-size:20px;">⚡</div>
                    <div>
                        <h3 style="margin:0;font-size:1.05rem;color:#212529;font-weight:700;">Confirmar Facturación en PRODUCCIÓN</h3>
                        <p style="margin:2px 0 0;font-size:0.78rem;color:#856404;font-weight:600;">Esta factura será emitida de forma REAL ante el SAT</p>
                    </div>
                </div>
                <div style="background:#f8f9fa;border-radius:8px;padding:14px;margin-bottom:16px;font-size:0.82rem;">
                    <div style="display:grid;grid-template-columns:1fr 1.5fr;gap:6px 10px;">
                        <span style="color:#6c757d;">Receptor:</span><strong>${resumen?.receptor || '—'}</strong>
                        <span style="color:#6c757d;">RFC:</span><strong>${resumen?.rfc || '—'}</strong>
                        <span style="color:#6c757d;">Concepto:</span><strong>${resumen?.concepto || '—'}</strong>
                        <span style="color:#6c757d;">Total:</span><strong style="color:#1B365D;font-size:0.95rem;">${fmt(resumen?.total)}</strong>
                    </div>
                </div>
                <div style="display:flex;gap:10px;justify-content:flex-end;">
                    <button id="btn-cancel-prod" style="padding:8px 20px;border-radius:4px;border:1px solid #ced4da;background:#fff;cursor:pointer;">Cancelar</button>
                    <button id="btn-confirm-prod" style="padding:8px 20px;border-radius:4px;border:none;background:#28a745;color:#fff;cursor:pointer;font-weight:700;">
                        Sí, Emitir Factura Oficial
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('btn-cancel-prod').onclick = () => { modal.remove(); resolve(false); };
        document.getElementById('btn-confirm-prod').onclick = () => { modal.remove(); resolve(true); };
        modal.addEventListener('click', (e) => { if (e.target === modal) { modal.remove(); resolve(false); } });
    });
}

function _mostrarResultadoTimbrado(data, isSandbox) {
    const box = document.getElementById('pac-resultado-timbrado');
    if (!box) return;

    const fmt = n => n != null ? `$${parseFloat(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '—';
    const sandboxBadge = isSandbox
        ? '<span style="background:#d4edda;color:#155724;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:700;">🧪 PRUEBAS (SANDBOX)</span>'
        : '<span style="background:#d1ecf1;color:#0c5460;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:700;">✅ PRODUCCIÓN (SAT OFICIAL)</span>';

    box.style.display = 'block';
    box.innerHTML = `
        <div style="padding:20px;background:#f0fff4;border:1.5px solid #38a169;border-radius:8px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
                <svg fill="none" stroke="#28a745" viewBox="0 0 24 24" style="width:24px;height:24px;flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                <strong style="color:#155724;font-size:1.02rem;">Factura Timbrada con Éxito ${sandboxBadge}</strong>
            </div>
            <div style="background:#fff;border-radius:6px;padding:14px;font-size:0.82rem;display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin-bottom:16px;border:1px solid #e2e8f0;">
                <span style="color:#6c757d;">UUID SAT:</span>
                <strong style="font-family:monospace;color:#212529;word-break:break-all;">${data.uuid || '—'}</strong>
                <span style="color:#6c757d;">Folio:</span><strong>${data.serie || ''}${data.folio || '—'}</strong>
                <span style="color:#6c757d;">Fecha:</span><strong>${data.fecha ? new Date(data.fecha).toLocaleString('es-MX') : new Date().toLocaleString('es-MX')}</strong>
                <span style="color:#6c757d;">Total:</span><strong style="color:#1B365D;font-size:1rem;">${fmt(data.total)}</strong>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <button onclick="openPdfViewer('${data.facturamaId}')" class="btn btn-secondary" style="font-size:0.8rem;padding:8px 16px;display:flex;align-items:center;gap:6px;">
                    👁️ Ver PDF (Vista Previa)
                </button>
                <button onclick="downloadFromFacturama('${data.facturamaId}', 'pdf')" class="btn btn-secondary" style="font-size:0.8rem;padding:8px 16px;color:#dc3545;border-color:#dc3545;display:flex;align-items:center;gap:6px;">
                    📥 Descargar PDF
                </button>
                <button onclick="downloadFromFacturama('${data.facturamaId}', 'xml')" class="btn btn-secondary" style="font-size:0.8rem;padding:8px 16px;color:#28a745;border-color:#28a745;display:flex;align-items:center;gap:6px;">
                    📄 Descargar XML
                </button>
                <button onclick="openEmailModal('${state.activeExpediente?.folio}', '${state.activeExpediente?.correo || ''}', '${state.activeExpediente?.cliente || ''}')" class="btn btn-primary" style="font-size:0.8rem;padding:8px 16px;background:var(--primary-color);display:flex;align-items:center;gap:6px;">
                    ✉️ Enviar por Correo
                </button>
                <button onclick="copyToClipboard('${data.uuid}')" class="btn btn-secondary" style="font-size:0.8rem;padding:8px 14px;">
                    📋 Copiar UUID
                </button>
            </div>
        </div>
    `;
}

async function downloadFromFacturama(facturamaId, formato) {
    if (!facturamaId) { showToast('No hay ID de Facturama disponible.', 'error'); return; }
    try {
        const token = getJwtToken();
        const res = await fetch(`/api/facturama/descargar/${facturamaId}/${formato}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `COEPRISS_${facturamaId}.${formato}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(`✅ ${formato.toUpperCase()} descargado correctamente.`, 'success');
    } catch (e) {
        showToast(`Error al descargar ${formato}: ${e.message}`, 'error');
    }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('UUID copiado al portapapeles.', 'success');
    }).catch(() => {
        showToast('No se pudo copiar el UUID.', 'error');
    });
}

// ─────────────────────────────────────────────
// 6. VISOR DE PDF Y STEP 6
// ─────────────────────────────────────────────

let _currentPdfViewerBlobUrl = null;

async function openPdfViewer(pdfBase64OrFacturamaId, title = 'Vista Previa de Factura CFDI 4.0 (PDF)') {
    const modal = document.getElementById('modal-pdf-viewer');
    const frame = document.getElementById('pdf-viewer-frame');
    const titleEl = document.getElementById('pdf-viewer-title');
    if (!modal || !frame) return;

    if (titleEl) titleEl.textContent = title;

    if (_currentPdfViewerBlobUrl) {
        URL.revokeObjectURL(_currentPdfViewerBlobUrl);
        _currentPdfViewerBlobUrl = null;
    }

    if (pdfBase64OrFacturamaId && pdfBase64OrFacturamaId.length > 50) {
        // Base64 string
        frame.src = `data:application/pdf;base64,${pdfBase64OrFacturamaId}`;
    } else if (pdfBase64OrFacturamaId) {
        // Facturama ID -> fetch as blob
        frame.src = 'about:blank';
        try {
            const token = getJwtToken();
            const res = await fetch(`/api/facturama/descargar/${pdfBase64OrFacturamaId}/pdf`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const blob = await res.blob();
                _currentPdfViewerBlobUrl = URL.createObjectURL(blob);
                frame.src = _currentPdfViewerBlobUrl;
            } else {
                showToast('No se pudo cargar el PDF desde Facturama.', 'error');
                return;
            }
        } catch (e) {
            showToast('Error al obtener el PDF: ' + e.message, 'error');
            return;
        }
    } else if (_lastStampResult?.facturamaId) {
        return openPdfViewer(_lastStampResult.facturamaId, title);
    } else {
        showToast('No hay PDF timbrado disponible para mostrar.', 'warning');
        return;
    }

    modal.classList.add('open');
}

function downloadPdfFromViewer() {
    if (_lastStampResult?.facturamaId) {
        downloadFromFacturama(_lastStampResult.facturamaId, 'pdf');
    } else if (_currentPdfViewerBlobUrl) {
        const a = document.createElement('a');
        a.href = _currentPdfViewerBlobUrl;
        a.download = 'Factura_COEPRISS.pdf';
        a.click();
    } else {
        showToast('Descargando archivo PDF...', 'info');
    }
}

function updateStep6ComprobanteUI() {
    if (!state.activeExpediente) return;
    const d = state.activeExpediente;
    const uuidEl = document.getElementById('step6-uuid');
    const fechaEl = document.getElementById('step6-fecha');
    if (uuidEl) uuidEl.textContent = d.uuid || 'Pendiente de timbrado';
    if (fechaEl) fechaEl.textContent = new Date().toLocaleString('es-MX');
}

function openCurrentInvoicePdfViewer() {
    if (_lastStampResult?.facturamaId) {
        openPdfViewer(_lastStampResult.facturamaId);
    } else if (state.activeExpediente?.facturamaId) {
        openPdfViewer(state.activeExpediente.facturamaId);
    } else {
        showToast('Primero timbra la factura en el Paso 4 para generar el PDF oficial.', 'warning');
    }
}

function downloadCurrentXml() {
    if (_lastStampResult?.facturamaId) {
        downloadFromFacturama(_lastStampResult.facturamaId, 'xml');
    } else {
        showToast('No hay archivo XML disponible aún.', 'warning');
    }
}

function downloadCurrentPdf() {
    if (_lastStampResult?.facturamaId) {
        downloadFromFacturama(_lastStampResult.facturamaId, 'pdf');
    } else {
        showToast('No hay archivo PDF disponible aún.', 'warning');
    }
}

function openEmailModalForActive() {
    if (!state.activeExpediente) return;
    openEmailModal(
        state.activeExpediente.folio,
        state.activeExpediente.correo || '',
        state.activeExpediente.cliente || ''
    );
}

// ─────────────────────────────────────────────
// 7. ENVÍO DE CORREO ELECTRÓNICO (BREVO API)
// ─────────────────────────────────────────────

let _currentEmailExpedienteId = null;

function openEmailModal(expedienteId, destinatario = '', razonSocial = '') {
    _currentEmailExpedienteId = expedienteId || state.activeExpediente?.folio;
    const modal = document.getElementById('modal-enviar-correo');
    if (!modal) return;

    const emailInput = document.getElementById('modal-correo-destinatario');
    const nombreInput = document.getElementById('modal-correo-nombre');
    const asuntoInput = document.getElementById('modal-correo-asunto');
    const mensajeInput = document.getElementById('modal-correo-mensaje');

    if (emailInput) emailInput.value = destinatario;
    if (nombreInput) nombreInput.value = razonSocial;
    if (asuntoInput) asuntoInput.value = `Factura Electrónica CFDI 4.0 - COEPRISS Sinaloa (${_currentEmailExpedienteId || ''})`;
    if (mensajeInput) {
        mensajeInput.value = `Estimado contribuyente ${razonSocial || ''},\n\nLe hacemos entrega de los archivos oficiales (XML y PDF) correspondientes a su comprobante fiscal digital emitido por la Comisión Estatal para la Protección contra Riesgos Sanitarios de Sinaloa (COEPRISS).\n\nSaludos cordiales.`;
    }

    modal.classList.add('open');
}

async function handleSendInvoiceEmail(event) {
    if (event) event.preventDefault();

    const destinatario = document.getElementById('modal-correo-destinatario')?.value.trim();
    const nombreDestinatario = document.getElementById('modal-correo-nombre')?.value.trim();
    const asunto = document.getElementById('modal-correo-asunto')?.value.trim();
    const mensaje = document.getElementById('modal-correo-mensaje')?.value.trim();
    const adjuntarXml = document.getElementById('modal-correo-adjuntar-xml')?.checked !== false;
    const adjuntarPdf = document.getElementById('modal-correo-adjuntar-pdf')?.checked !== false;

    if (!destinatario) {
        showToast('Por favor captura un correo destinatario válido.', 'error');
        return;
    }

    const btn = document.getElementById('btn-submit-correo');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = 'Enviando vía Brevo...';
    }

    try {
        const res = await apiFetch('/api/correo/enviar', {
            method: 'POST',
            body: JSON.stringify({
                expedienteId: _currentEmailExpedienteId,
                destinatario,
                nombreDestinatario,
                asunto,
                mensaje,
                adjuntarXml,
                adjuntarPdf
            })
        });
        const data = await res.json();

        if (res.ok && data.success) {
            showToast(`✅ Factura enviada con éxito a ${destinatario} (Brevo ID: ${data.messageId || 'OK'})`, 'success');
            closeModal('modal-enviar-correo');

            // Agregar al historial de correos
            state.historialCorreos.unshift({
                fecha: new Date().toLocaleString('es-MX'),
                destinatario,
                folio: _currentEmailExpedienteId,
                adjuntos: `${adjuntarXml ? 'XML ' : ''}${adjuntarPdf ? 'PDF' : ''}`.trim() || 'Sin adjuntos',
                estatus: 'Enviado'
            });
            renderCorreosTable();
            updateDashboardCounts();
        } else {
            showToast(`❌ Error al enviar correo: ${data.error || 'Error desconocido'}`, 'error');
        }
    } catch (err) {
        showToast(`❌ Error de conexión: ${err.message}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width: 16px; height: 16px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg> Enviar Correo Ahora';
        }
    }
}

function resendEmail(destinatario, folio) {
    openEmailModal(folio, destinatario, '');
}

// ─────────────────────────────────────────────
// 8. STEP 7: REPORTE GENERAL Y EXPORTACIÓN EXCEL
// ─────────────────────────────────────────────

function setReportDatePreset(preset) {
    const fromInput = document.getElementById('report-date-from');
    const toInput = document.getElementById('report-date-to');
    if (!fromInput || !toInput) return;

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

    if (preset === 'hoy') {
        fromInput.value = todayStr;
        toInput.value = todayStr;
    } else if (preset === 'mes') {
        fromInput.value = `${yyyy}-${mm}-01`;
        toInput.value = todayStr;
    } else if (preset === 'anio') {
        fromInput.value = `${yyyy}-01-01`;
        toInput.value = todayStr;
    } else if (preset === 'todos') {
        fromInput.value = '';
        toInput.value = '';
    }
    filterReportTable();
}

function filterReportTable() {
    const busqueda = (document.getElementById('search-report')?.value || '').toLowerCase().trim();
    const estatusFilter = (document.getElementById('report-status-filter')?.value || 'TODOS').toUpperCase().trim();
    const dateFrom = document.getElementById('report-date-from')?.value;
    const dateTo = document.getElementById('report-date-to')?.value;

    const fromDateObj = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
    const toDateObj = dateTo ? new Date(dateTo + 'T23:59:59') : null;

    const tbody = document.getElementById('tbody-report-invoices');
    if (!tbody) return;

    tbody.innerHTML = '';
    let matchesCount = 0;

    const list = state.facturas.length > 0 ? state.facturas : state.expedientes.filter(e => e.estatus === 'TIMBRADO');

    list.forEach(f => {
        const folio = f.folioInterno || f.folio || '';
        const uuid = f.uuid || f.cfdiUuid || '';
        const cliente = f.cliente || f.receptorNombre || '';
        const rfc = f.rfc || f.receptorRfc || '';
        const estatus = (f.estatus || 'TIMBRADA').toUpperCase();
        const total = parseFloat(f.importe || f.cfdiTotal || 0);

        // Filtro por texto
        const matchText = !busqueda || [folio, uuid, cliente, rfc].some(val => val.toLowerCase().includes(busqueda));

        // Filtro por estatus
        const matchEstatus = (estatusFilter === 'TODOS') || (estatus === estatusFilter);

        // Filtro por fecha
        let matchFecha = true;
        if (f.fecha || f.createdAt) {
            const fDate = new Date(f.createdAt || f.fecha);
            if (fromDateObj && fDate < fromDateObj) matchFecha = false;
            if (toDateObj && fDate > toDateObj) matchFecha = false;
        }

        if (matchText && matchEstatus && matchFecha) {
            matchesCount++;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight:700;color:#1B365D;">${folio}</td>
                <td style="font-family:monospace;font-size:0.75rem;color:#495057;">${uuid ? uuid.substring(0, 18) + '...' : '—'}</td>
                <td class="col-cliente">${cliente}</td>
                <td style="font-family:monospace;font-weight:600;">${rfc}</td>
                <td style="color:#6c757d;">${f.fecha || new Date(f.createdAt).toLocaleDateString('es-MX')}</td>
                <td style="text-align:right;font-weight:700;color:#1B365D;">$${total.toFixed(2)}</td>
                <td style="text-align:center;">
                    <span class="badge badge-success">
                        <svg class="badge-icon" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
                        ${estatus}
                    </span>
                </td>
                <td style="text-align:center;">
                    <div class="action-icon-group">
                        <button class="action-icon-btn btn-view" onclick="openPdfViewer('${f.facturamaId || ''}')" title="Ver PDF"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg></button>
                        <button class="action-icon-btn btn-dl-pdf" onclick="downloadFromFacturama('${f.facturamaId}', 'pdf')" title="Descargar PDF"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg></button>
                        <button class="action-icon-btn btn-dl-xml" onclick="downloadFromFacturama('${f.facturamaId}', 'xml')" title="Descargar XML"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg></button>
                        <button class="action-icon-btn btn-email" onclick="openEmailModal('${folio}', '${f.correo || ''}', '${cliente}')" title="Enviar por correo"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg></button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        }
    });

    if (matchesCount === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-table-cell" style="text-align:center;padding:30px;color:#868e96;">No se encontraron facturas con los filtros seleccionados.</td></tr>';
    }

    const showingText = document.getElementById('showing-results-text');
    if (showingText) showingText.textContent = `Mostrando ${matchesCount} de ${list.length} facturas`;
}

function renderReportTable() {
    filterReportTable();
}

async function exportReportToExcel() {
    const estatus = document.getElementById('report-status-filter')?.value || 'TODOS';
    const desde = document.getElementById('report-date-from')?.value || '';
    const hasta = document.getElementById('report-date-to')?.value || '';
    const busqueda = document.getElementById('search-report')?.value || '';

    showToast('Generando archivo Excel oficial (.xlsx)...', 'info');
    try {
        const token = getJwtToken();
        const params = new URLSearchParams({ estatus, desde, hasta, busqueda });
        const res = await fetch(`/api/reportes/excel?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Reporte_Facturacion_COEPRISS_${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('✓ Reporte Excel descargado exitosamente.', 'success');
        addSecurityLog('Exportación Excel', `Reporte exportado con filtros: Estatus=${estatus}, Desde=${desde}, Hasta=${hasta}`);
    } catch (e) {
        showToast('Error al exportar a Excel: ' + e.message, 'error');
    }
}

// ─────────────────────────────────────────────
// 9. DIRECTORIO DE CLIENTES Y CONTRIBUYENTES
// ─────────────────────────────────────────────

async function loadClientes() {
    try {
        const res = await apiFetch('/api/clientes');
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
            state.clientes = data.data;
            renderClientesTable();
        }
    } catch (e) {
        console.warn('[LOAD CLIENTES ERROR]', e.message);
    }
}

function renderClientesTable() {
    const tbody = document.getElementById('tbody-clientes');
    if (!tbody) return;

    tbody.innerHTML = '';
    const filter = (document.getElementById('search-clientes')?.value || '').toLowerCase().trim();

    const filtered = (state.clientes || []).filter(c => {
        if (!filter) return true;
        return [c.rfc, c.razonSocial, c.email, c.codigoPostal].some(v => (v || '').toLowerCase().includes(filter));
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-table-cell" style="text-align:center;padding:30px;color:#868e96;">No hay clientes registrados en el directorio. Registra uno con el botón superior.</td></tr>';
        return;
    }

    filtered.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-family:monospace;font-weight:700;color:#1B365D;">${c.rfc}</td>
            <td class="col-cliente" style="font-weight:600;">${c.razonSocial}</td>
            <td><span class="badge badge-info">${c.regimenFiscal || '—'}</span></td>
            <td>${c.codigoPostal || '—'}</td>
            <td>${c.usoCfdi || 'G03'}</td>
            <td style="color:#0d6efd;">${c.email || '—'}</td>
            <td style="text-align:center;">
                <div style="display:flex;gap:6px;justify-content:center;">
                    <button class="btn btn-sm btn-primary" onclick="facturarACliente('${c.rfc}')" title="Facturar a este contribuyente" style="padding:4px 10px;font-size:0.75rem;">
                        ⚡ Facturar
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick='openClienteModal(${JSON.stringify(c)})' title="Editar datos" style="padding:4px 8px;font-size:0.75rem;">
                        ✏️
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="deleteCliente('${c.id}', '${c.rfc}')" title="Eliminar del directorio" style="padding:4px 8px;font-size:0.75rem;color:#dc3545;">
                        🗑️
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function filterClientesTable() {
    renderClientesTable();
}

let _editingClienteId = null;

function openClienteModal(cliente = null) {
    _editingClienteId = cliente ? cliente.id : null;
    const modal = document.getElementById('modal-cliente');
    const titleEl = document.getElementById('modal-cliente-title');
    if (!modal) return;

    if (titleEl) titleEl.textContent = cliente ? 'Editar Cliente / Contribuyente' : 'Registrar Nuevo Cliente';

    document.getElementById('cliente-rfc').value = cliente?.rfc || '';
    document.getElementById('cliente-cp').value = cliente?.codigoPostal || '';
    document.getElementById('cliente-razon').value = cliente?.razonSocial || '';
    document.getElementById('cliente-regimen').value = cliente?.regimenFiscal || '626';
    document.getElementById('cliente-uso-cfdi').value = cliente?.usoCfdi || 'G03';
    document.getElementById('cliente-forma-pago').value = cliente?.formaPago || '03';
    document.getElementById('cliente-email').value = cliente?.email || '';
    document.getElementById('cliente-telefono').value = cliente?.telefono || '';
    document.getElementById('cliente-domicilio').value = cliente?.domicilio || '';

    modal.classList.add('open');
}

async function handleSaveClient(event) {
    if (event) event.preventDefault();

    const rfc = document.getElementById('cliente-rfc')?.value.toUpperCase().trim();
    const razonSocial = document.getElementById('cliente-razon')?.value.trim();
    const codigoPostal = document.getElementById('cliente-cp')?.value.trim();
    const regimenFiscal = document.getElementById('cliente-regimen')?.value;
    const usoCfdi = document.getElementById('cliente-uso-cfdi')?.value;
    const formaPago = document.getElementById('cliente-forma-pago')?.value;
    const email = document.getElementById('cliente-email')?.value.trim();
    const telefono = document.getElementById('cliente-telefono')?.value.trim();
    const domicilio = document.getElementById('cliente-domicilio')?.value.trim();

    if (!rfc || rfc.length < 12) {
        showToast('Captura un RFC válido.', 'error');
        return;
    }
    if (!razonSocial) {
        showToast('Captura el Nombre o Razón Social.', 'error');
        return;
    }

    try {
        const res = await apiFetch('/api/clientes', {
            method: 'POST',
            body: JSON.stringify({
                rfc,
                razonSocial,
                codigoPostal,
                regimenFiscal,
                usoCfdi,
                formaPago,
                email,
                telefono,
                domicilio
            })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showToast('✓ Cliente guardado exitosamente en el Directorio.', 'success');
            closeModal('modal-cliente');
            await loadClientes();
        } else {
            showToast(`❌ Error al guardar cliente: ${data.error}`, 'error');
        }
    } catch (e) {
        showToast(`❌ Error: ${e.message}`, 'error');
    }
}

async function deleteCliente(id, rfc) {
    if (!confirm(`¿Estás seguro de desactivar al contribuyente con RFC ${rfc}?`)) return;
    try {
        const res = await apiFetch(`/api/clientes/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok && data.success) {
            showToast('✓ Cliente eliminado del Directorio.', 'info');
            await loadClientes();
        } else {
            showToast('Error al eliminar cliente.', 'error');
        }
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

function facturarACliente(rfc) {
    const cliente = (state.clientes || []).find(c => c.rfc === rfc);
    if (!cliente) return;

    // Iniciar nuevo expediente con los datos del cliente
    state.activeExpediente = {
        folio: `EXP-${Date.now().toString().slice(-6)}`,
        rfc: cliente.rfc,
        cliente: cliente.razonSocial,
        regimenFiscal: cliente.regimenFiscal || '626',
        codigoPostal: cliente.codigoPostal || '80020',
        usoCfdi: cliente.usoCfdi || 'G03',
        formaPago: cliente.formaPago || '03',
        metodoPago: 'PUE',
        correo: cliente.email || '',
        concepto: 'Derechos de Trámite Sanitario COEPRISS',
        importe: 0,
        estatus: 'PENDIENTE',
        archivos: [],
        auditoria: [`[${getCurrentDateTimeString()}] Expediente iniciado desde el Directorio de Clientes (${cliente.rfc}).`]
    };

    goToStep(3);
    showToast(`Iniciando factura para ${cliente.razonSocial}. Completa el importe y timbra.`, 'info');
}

// ─────────────────────────────────────────────
// 10. CONTROL DE FLUJO Y UTILIDADES GLOBALES
// ─────────────────────────────────────────────

function restartProcess() {
    state.activeExpediente = null;
    state.uploadedFiles = [];
    state.ocrBusy = false;
    state.scanPreviewUrl = '';
    state.scanQuality = null;
    state.lastOcrFields = null;
    state.xmlUploaded = false;
    state.pdfUploaded = false;

    const input = document.getElementById('document-file-input');
    if (input) input.value = '';

    const clienteCorreo = document.getElementById('lbl-cliente-correo');
    if (clienteCorreo) clienteCorreo.textContent = 'Carga un documento real para iniciar...';
    
    const clienteFecha = document.getElementById('lbl-cliente-fecha');
    if (clienteFecha) clienteFecha.textContent = '--/--/---- --:--';

    const btnScan = document.getElementById('btn-scan');
    if (btnScan) {
        btnScan.disabled = false;
        btnScan.textContent = 'Escanear / Leer documentos';
    }

    const docListContainer = document.getElementById('doc-list-container');
    if (docListContainer) {
        docListContainer.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; color: #868e96; padding: 30px 0; font-size: 0.82rem;">
                Arrastra o selecciona archivos reales para iniciar el expediente.
            </div>
        `;
    }

    // Limpiar campos del paso 3
    const fieldsToClear = ['step3-rfc', 'step3-razon', 'step3-cp', 'step3-correo', 'step3-concepto', 'step3-total'];
    fieldsToClear.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    const badge = document.getElementById('badge-cliente-encontrado');
    if (badge) badge.style.display = 'none';

    const resultadoTimbrado = document.getElementById('pac-resultado-timbrado');
    if (resultadoTimbrado) resultadoTimbrado.style.display = 'none';

    _lastStampResult = null;

    goToStep(1);
    showToast('Nueva solicitud de facturación iniciada.', 'info');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('open');
    }
}

function saveConfiguration() {
    const smtpHost = document.getElementById('smtp-host')?.value.trim();
    const smtpPort = document.getElementById('smtp-port')?.value.trim();
    if (!smtpHost || !/^\d{2,5}$/.test(smtpPort) || Number(smtpPort) > 65535) {
        showToast('Captura un servidor SMTP y un puerto válido.', 'error');
        return;
    }
    try {
        sessionStorage.setItem('coepriss-session-config', JSON.stringify({ smtpHost, smtpPort }));
        addSecurityLog('Configuración local', `SMTP guardado para esta sesión: ${smtpHost}:${smtpPort}.`);
        renderBitacoraTable();
        showToast('Configuración guardada en esta sesión.', 'success');
    } catch (error) {
        showToast('El navegador no permitió guardar la configuración de esta sesión.', 'error');
    }
}

function openInvoicePreviewModal(folio = '', clientName = '', totalVal = '') {
    const matchedFac = state.facturas.find(f => f.folioInterno === folio || f.folio === folio);
    const facturamaId = matchedFac ? matchedFac.facturamaId : state.activeExpediente?.facturamaId;
    if (facturamaId) {
        openPdfViewer(facturamaId, `Factura ${folio}`);
        return;
    }

    const modal = document.getElementById('modal-invoice-preview');
    if (!modal) return;

    if (!clientName && state.activeExpediente) {
        clientName = state.activeExpediente.cliente;
    }
    const uuid = matchedFac ? matchedFac.uuid : (state.activeExpediente?.uuid || 'Pendiente de timbrado');

    const folioEl = document.getElementById('pdf-folio');
    if (folioEl) folioEl.textContent = folio || state.activeExpediente?.folio || '—';

    const receptorNameEl = document.getElementById('pdf-receptor-name');
    if (receptorNameEl) receptorNameEl.textContent = clientName || '—';

    const receptorRfcEl = document.getElementById('pdf-receptor-rfc');
    if (receptorRfcEl) receptorRfcEl.textContent = state.activeExpediente?.rfc || '—';

    const receptorRegimenEl = document.getElementById('pdf-receptor-regimen');
    if (receptorRegimenEl) receptorRegimenEl.textContent = state.activeExpediente?.regimenFiscal || '—';

    const receptorCfdiEl = document.getElementById('pdf-receptor-cfdi');
    if (receptorCfdiEl) receptorCfdiEl.textContent = state.activeExpediente?.usoCfdi || '—';

    const uuidBox = document.getElementById('pdf-uuid-val');
    if (uuidBox) uuidBox.textContent = uuid;

    const numericTotal = typeof totalVal === 'number' ? totalVal : parseFloat(String(totalVal || '0').replace('$', '').replace(',', ''));
    const numericSubtotal = numericTotal / 1.16;
    const numericIva = numericTotal - numericSubtotal;

    const unitPriceEl = document.getElementById('pdf-unit-price');
    if (unitPriceEl) unitPriceEl.textContent = `$${numericSubtotal.toFixed(2)}`;

    const subtotalEl = document.getElementById('pdf-subtotal');
    if (subtotalEl) subtotalEl.textContent = `$${numericSubtotal.toFixed(2)}`;

    const ivaEl = document.getElementById('pdf-iva');
    if (ivaEl) ivaEl.textContent = `$${numericIva.toFixed(2)}`;

    const totalEl = document.getElementById('pdf-total');
    if (totalEl) totalEl.textContent = `$${numericTotal.toFixed(2)}`;

    const conceptoPreview = document.getElementById('pdf-concepto');
    if (conceptoPreview) conceptoPreview.textContent = state.activeExpediente?.concepto || 'Derechos de Trámite Sanitario COEPRISS';

    modal.classList.add('open');
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
