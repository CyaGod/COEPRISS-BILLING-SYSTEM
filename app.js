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
    maxStepUnlocked: 1,
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
function getJwtToken() { return localStorage.getItem('coepriss_jwt') || sessionStorage.getItem('coepriss_jwt') || null; }
function setJwtToken(t) {
    if (t) {
        localStorage.setItem('coepriss_jwt', t);
        sessionStorage.setItem('coepriss_jwt', t);
    }
}
function clearJwtToken() {
    localStorage.removeItem('coepriss_jwt');
    localStorage.removeItem('coepriss_user');
    sessionStorage.removeItem('coepriss_jwt');
    sessionStorage.removeItem('coepriss_user');
}
function getStoredUser() {
    try {
        const raw = localStorage.getItem('coepriss_user') || sessionStorage.getItem('coepriss_user');
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}
function storeUser(u) {
    if (u) {
        localStorage.setItem('coepriss_user', JSON.stringify(u));
        sessionStorage.setItem('coepriss_user', JSON.stringify(u));
    }
}
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
        // Activar inmediatamente la sesión guardada para evitar parpadeo o redirección al recargar
        activateAuthenticatedSession(user);
        
        apiFetch('/api/auth/me')
            .then(res => {
                if (res.status === 401 || res.status === 403) {
                    clearJwtToken();
                    showLoginUi();
                    return null;
                }
                return res.json();
            })
            .then(data => {
                if (data && data.success && data.user) {
                    activateAuthenticatedSession({ ...user, ...data.user });
                }
            })
            .catch(err => {
                console.info('[Auth] Validación en segundo plano diferida:', err.message);
            });
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

function isFacturaTimbrada() {
    return Boolean(
        state.activeExpediente?.uuid ||
        state.activeExpediente?.cfdiUuid ||
        state.activeExpediente?.estatus === 'TIMBRADA' ||
        state.activeExpediente?.estatus === 'TIMBRADO' ||
        _lastStampResult?.uuid
    );
}

function isStepUnlocked(step) {
    if (step === 1) return !isFacturaTimbrada();
    if (isFacturaTimbrada()) {
        // Una vez timbrada, los pasos 1, 2 y 3 quedan bloqueados permanentemente para evitar alterar datos ya sellados
        return step >= 4;
    }
    return step <= (state.maxStepUnlocked || 1);
}

// 1. Navigation & Panel Control
function initNavigation() {
    // Header Stepper Node Click
    const stepNodes = document.querySelectorAll('.step-node');
    stepNodes.forEach(node => {
        node.addEventListener('click', () => {
            const step = parseInt(node.getAttribute('data-step'), 10);

            // 1. Si la factura ya fue timbrada oficialmente ante el SAT
            if (isFacturaTimbrada()) {
                if (step < 4) {
                    showToast('🔒 Esta factura ya fue timbrada ante el SAT. No se pueden modificar los pasos anteriores porque el comprobante ya fue emitido. Para emitir una nueva factura, haz clic en "Nueva Factura".', 'warning');
                    return;
                }
                if (step === 7) {
                    renderReportTable();
                }
                goToStep(step);
                return;
            }

            // 2. Si la factura NO ha sido timbrada: bloqueo paso a paso progresivo
            if (step > (state.maxStepUnlocked || 1)) {
                showToast(`🔒 Completa el Paso ${state.currentStep || 1} antes de desbloquear y avanzar al Paso ${step}.`, 'warning');
                return;
            }

            // Pasos ya desbloqueados (1..maxStepUnlocked): permitir revisar/corregir libremente
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
    try {
        // Find expediente
        const exp = state.expedientes.find(e => e.folio === folio) || (state.activeExpediente?.folio === folio ? state.activeExpediente : null);
        if (exp) {
            state.activeExpediente = exp;
            if (!Array.isArray(exp.archivos)) exp.archivos = [];
            if (!Array.isArray(exp.auditoria)) exp.auditoria = [];

            if (exp.receptorRfc && !exp.rfc) exp.rfc = exp.receptorRfc;
            if (exp.receptorNombre && !exp.cliente) exp.cliente = exp.receptorNombre;
            if (exp.receptorCodigoPostal && !exp.codigoPostal) exp.codigoPostal = exp.receptorCodigoPostal;
            if (exp.receptorRegimenFiscal && !exp.regimenFiscal) exp.regimenFiscal = exp.receptorRegimenFiscal;
            if (exp.receptorUsoCfdi && !exp.usoCfdi) exp.usoCfdi = exp.receptorUsoCfdi;
            if (exp.receptorEmail && !exp.correo) exp.correo = exp.receptorEmail;
            if (exp.cfdiTotal && !exp.importe) exp.importe = parseFloat(exp.cfdiTotal);
            if (exp.cfdiConcepto && !exp.concepto) exp.concepto = exp.cfdiConcepto;
            if (exp.cfdiFormaPago && !exp.formaPago) exp.formaPago = exp.cfdiFormaPago;
            if (exp.cfdiMetodoPago && !exp.metodoPago) exp.metodoPago = exp.cfdiMetodoPago;

            updatePreviewFields();
            updateStep2Fields();
            updateStep3UIFromActiveExpediente();
            renderDocumentList();
            renderTimeline();
        }
        
        // Auto-determine best wizard step: if ready for stamping, go directly to Step 4!
        let targetStep = wizardStep || 1;
        if (exp) {
            if (exp.rfc && exp.cliente && exp.codigoPostal && (exp.importe || exp.cfdiTotal)) {
                targetStep = 4;
            } else if (exp.rfc || exp.cliente) {
                targetStep = 3;
            }
        }

        showToast(`Reanudando expediente ${folio} en el Paso ${targetStep}...`, 'info');
        
        // Highlight "Nueva solicitud" sidebar link
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active', 'active-pulse'));
        const navSolicitud = document.getElementById('nav-solicitud');
        if (navSolicitud) navSolicitud.classList.add('active-pulse');

        // Enable scan button if resuming
        const btnScan = document.getElementById('btn-scan');
        if (btnScan) btnScan.disabled = false;

        // Check payment validation button toggles
        updatePaymentValidationUI();

        goToStep(targetStep);
    } catch (err) {
        console.error('[RESUME ERROR]', err);
        showToast(`Error al reanudar: ${err.message}`, 'error');
        goToStep(wizardStep || 3);
    }
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
        const nodeStep = parseInt(node.getAttribute('data-step'), 10);
        node.classList.remove('active', 'completed', 'locked');
        
        if (nodeStep === stepNumber) {
            node.classList.add('active');
        } else if (nodeStep < stepNumber) {
            node.classList.add('completed');
        }

        const unlocked = isStepUnlocked(nodeStep);
        if (!unlocked) {
            node.classList.add('locked');
            node.style.opacity = '0.38';
            node.style.cursor = 'not-allowed';
        } else {
            node.style.opacity = '1';
            node.style.cursor = 'pointer';
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

// Real document picker and drag & drop implementation.
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
    dropzone.addEventListener('drop', event => {
        event.preventDefault();
        if (event.dataTransfer && event.dataTransfer.files) {
            handleSelectedFiles(event.dataTransfer.files);
        }
    });
}

function initDocumentPicker() {
    const dropzone = document.getElementById('dropzone-step1');
    const input = document.getElementById('document-file-input');
    if (!dropzone || !input) return;

    dropzone.addEventListener('click', event => {
        if (event.target !== input) {
            input.click();
        }
    });
    input.addEventListener('change', event => {
        handleSelectedFiles(event.target.files);
        input.value = '';
    });
}

function handleSelectedFiles(fileList) {
    // Accepted MIME types: PDF and all common image formats including modern ones.
    const allowedMimes = [
        'application/pdf',
        'image/jpeg', 'image/png', 'image/webp',
        'image/bmp', 'image/gif', 'image/tiff',
        'image/heic', 'image/heif', 'image/avif'
    ];
    // Extension fallback (some OS/browsers report wrong or empty MIME for HEIC/AVIF).
    const allowedExtensions = [
        'pdf', 'jpg', 'jpeg', 'png', 'webp',
        'bmp', 'gif', 'tiff', 'tif', 'heic', 'heif', 'avif'
    ];
    const files = Array.from(fileList || []);
    if (!files.length) return;

    files.forEach(file => {
        const extension = file.name.toLowerCase().split('.').pop();
        const validType = allowedMimes.includes(file.type) || allowedExtensions.includes(extension);
        if (!validType) {
            showToast(`Formato no permitido: ${file.name}. Usa PDF, JPG, PNG, WEBP, BMP, TIFF, GIF o HEIC.`, 'warning');
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
    saveDatabaseToStorage();
    document.getElementById('lbl-cliente-correo').textContent = 'Pendiente de lectura';
    document.getElementById('lbl-cliente-fecha').textContent = state.activeExpediente.fechaRecibo;
}

async function startScanAnimation() {
    const scanner = document.getElementById('laser-scanner');
    const scanBtn = document.getElementById('btn-scan');
    const progressWrapper = document.getElementById('ocr-progress-wrapper');
    const progressBar = document.getElementById('ocr-progress-bar');
    const progressLabel = document.getElementById('ocr-progress-label');
    if (!scanner || !scanBtn || state.ocrBusy) return;
    if (!state.uploadedFiles.length) {
        showToast('Selecciona al menos un PDF, JPG, PNG u otro archivo compatible.', 'warning');
        return;
    }

    state.ocrBusy = true;
    scanBtn.disabled = true;
    scanner.style.display = 'block';
    scanBtn.textContent = `Leyendo ${state.uploadedFiles.length} documento(s)...`;
    // Show and reset the progress bar.
    if (progressWrapper) progressWrapper.style.display = 'block';
    if (progressBar) { progressBar.style.width = '0%'; progressBar.setAttribute('aria-valuenow', 0); }
    if (progressLabel) progressLabel.textContent = 'Preparando motor OCR...';
    showToast(`OCR iniciado para ${state.uploadedFiles.length} documento(s). Los archivos permanecen en este navegador.`, 'info');

    try {
        const fields = await extractUploadedDocuments();
        state.lastOcrFields = fields;
        applyExtractedFields(fields);
        const needsReview = !state.scanQuality || state.scanQuality.level !== 'alta' || countReliableOcrFields(fields) < 5;
        // Sync individual file statuses back to the expediente archivos list
        if (state.activeExpediente) {
            state.activeExpediente.archivos.forEach(archivoEntry => {
                const uploadedMatch = state.uploadedFiles.find(u => u.name === archivoEntry.name);
                if (uploadedMatch) {
                    archivoEntry.status = uploadedMatch.status || (needsReview ? 'OCR completado - requiere revision' : 'Leido correctamente (OCR local)');
                } else {
                    archivoEntry.status = needsReview ? 'OCR completado - requiere revision' : 'Leido correctamente (OCR local)';
                }
            });
            state.activeExpediente.estatus = 'Pago pendiente';
            addAuditLogToActive('Documentos procesados mediante OCR local. Datos pendientes de confirmacion.');
            addSecurityLog('OCR local', `Lectura del expediente ${state.activeExpediente.folio} finalizada en el navegador.`);
        }
        const readCount = state.uploadedFiles.filter(f => f.status && f.status.includes('Leído')).length;
        const totalCount = state.uploadedFiles.length;
        renderDocumentList();
        updateStep2Fields();
        updateOcrResultAlert(fields);
        updatePreviewFields();
        renderTimeline();
        updatePaymentValidationUI();
        saveDatabaseToStorage();
        showToast(`✅ Lectura terminada: ${readCount} de ${totalCount} archivo(s) procesado(s). Revisa o corrige los datos antes de continuar.`, 'info');
        state.maxStepUnlocked = Math.max(state.maxStepUnlocked || 1, 2);
        goToStep(2);
    } catch (error) {
        console.error('OCR error:', error);
        showToast(`No se pudo leer el documento: ${error.message || 'error desconocido'}`, 'error');
    } finally {
        scanner.style.display = 'none';
        if (progressWrapper) progressWrapper.style.display = 'none';
        if (progressBar) { progressBar.style.width = '0%'; }
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

    const total = state.uploadedFiles.length;

    // Build a per-file progress logger so the button always shows which
    // document is being read and how far along the OCR engine is.
    const makeOcrLogger = (fileIndex, fileName) => message => {
        if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
            const scanBtn = document.getElementById('btn-scan');
            const pct = Math.round(message.progress * 100);
            if (scanBtn) scanBtn.textContent = `Leyendo ${fileIndex}/${total}: ${fileName} — OCR ${pct}%`;
        }
    };

    const updateProgressBar = (fileIndex, fileName) => {
        const bar = document.getElementById('ocr-progress-bar');
        const label = document.getElementById('ocr-progress-label');
        if (bar) {
            bar.style.width = `${Math.round((fileIndex / total) * 100)}%`;
            bar.setAttribute('aria-valuenow', fileIndex);
        }
        if (label) label.textContent = `Procesando archivo ${fileIndex} de ${total}: ${fileName}`;
    };

    // --- Per-document OCR -------------------------------------------------
    // Each file is scanned independently. We collect one parsed-fields object
    // per document and then merge them so values from every file are available.
    const allFieldSets = [];
    let totalPageCount = 0;

    for (let fileIndex = 0; fileIndex < state.uploadedFiles.length; fileIndex += 1) {
        const uploaded = state.uploadedFiles[fileIndex];
        const fileNumber = fileIndex + 1;
        const shortName = uploaded.name.length > 22
            ? `${uploaded.name.slice(0, 19)}...`
            : uploaded.name;

        updateProgressBar(fileNumber, shortName);

        // Recreate the worker with a per-file logger so the progress
        // percentage shown always corresponds to the current document.
        if (state.ocrWorker) {
            await state.ocrWorker.terminate();
            state.ocrWorker = null;
        }
        try {
            state.ocrWorker = await Tesseract.createWorker(
                ['spa', 'eng'], 1,
                { logger: makeOcrLogger(fileNumber, shortName) }
            );
        } catch (e) {
            state.ocrWorker = await Tesseract.createWorker(
                'eng', 1,
                { logger: makeOcrLogger(fileNumber, shortName) }
            );
        }
        await state.ocrWorker.setParameters({
            tessedit_pageseg_mode: '6',
            preserve_interword_spaces: '1'
        });

        let fileText = '';
        let filePageCount = 0;
        const isPdf = uploaded.type === 'PDF' || uploaded.name.toLowerCase().endsWith('.pdf');

        if (!isPdf) {
            // Image document — use the enhanced multi-region recognizer.
            fileText += `\n${await recognizeImageWithFallback(uploaded.file, uploaded)}`;
            filePageCount += 1;
        } else {
            const arrayBuffer = await uploaded.file.arrayBuffer();
            const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
            const pageLimit = Math.min(pdf.numPages, 3);
            for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
                const page = await pdf.getPage(pageNumber);
                const textContent = await page.getTextContent();
                let pageText = '';
                let lastY;
                for (const item of (textContent.items || [])) {
                    if (lastY !== undefined && item.transform && Math.abs(item.transform[5] - lastY) > 5) {
                        pageText += '\n';
                    } else if (pageText.length > 0 && !pageText.endsWith(' ') && !pageText.endsWith('\n')) {
                        pageText += ' ';
                    }
                    pageText += item.str || '';
                    if (item.transform) lastY = item.transform[5];
                }
                pageText = pageText.trim();
                if (pageText.replace(/\s/g, '').length >= 30) {
                    fileText += `\n${pageText}`;
                } else {
                    const canvas = await renderPdfPageForOcr(page, true);
                    // PSM 4 works better for scanned PDF pages with a full-page
                    // document layout; image receipts keep the banded PSM 6 path.
                    fileText += `\n${await recognizeCanvasWithFallback(canvas, '4')}`;
                    canvas.width = 1;
                    canvas.height = 1;
                }
                filePageCount += 1;
            }
            if (pdf.numPages > pageLimit) {
                fileText += '\n[Advertencia: el PDF supera el limite de 3 paginas.]';
            }
        }

        totalPageCount += filePageCount;

        if (fileText.replace(/\s/g, '').length >= 10) {
            const fileFields = parseExtractedFields(fileText);
            // Attach the source filename so the merge can report provenance.
            fileFields._source = uploaded.name;
            allFieldSets.push(fileFields);
            // Store per-file OCR result on the uploaded record for UI display.
            uploaded.ocrFields = fileFields;
        }

        uploaded.status = 'OCR procesado';
    }

    // Finalise the progress bar at 100 % and terminate the worker.
    updateProgressBar(total, '');
    const scanBtn = document.getElementById('btn-scan');
    if (scanBtn) scanBtn.textContent = 'Combinando datos de todos los documentos...';

    if (!totalPageCount || allFieldSets.length === 0) {
        throw new Error('No se detecto texto legible. Usa imagenes nitidas y bien iluminadas.');
    }

    // Merge individual field-sets into a single consolidated result.
    const merged = mergeExtractedFieldSets(allFieldSets);
    return enforceOcrQualityGate(merged);
}

/**
 * mergeExtractedFieldSets — combine fields extracted from multiple documents.
 *
 * Strategy:
 *   - For every field, take the first non-empty value found across all documents.
 *   - Numeric fields (importe, importePago, etc.) prefer the document that also
 *     carries a reliable fiscal anchor (UUID, RFC) so we don't pick up an
 *     unrelated total from a cover letter.
 *   - Quality/confidence scores are averaged across all sets.
 */
function mergeExtractedFieldSets(fieldSets) {
    if (!fieldSets || fieldSets.length === 0) return {};
    if (fieldSets.length === 1) return fieldSets[0];

    if (typeof window !== 'undefined' && window.OcrCore && typeof window.OcrCore.mergeExtractedFieldSets === 'function') {
        return window.OcrCore.mergeExtractedFieldSets(fieldSets);
    }

    // Numeric fields that should be taken from the most fiscally-anchored document.
    const numericFields = new Set([
        'importe', 'importePago', 'subtotal', 'valorUnitario', 'importeLinea', 'cantidad'
    ]);
    // Fields whose first non-empty value wins (string fields).
    const stringFields = [
        'rfc', 'razonSocial', 'regimenFiscal', 'codigoPostal', 'usoCfdi', 'correo',
        'concepto', 'folioRecibo', 'banco', 'bancoEmisor', 'bancoReceptor',
        'bancoEmisorCodigo', 'bancoReceptorCodigo', 'fechaPago', 'fechaRecibo',
        'referencia', 'claveRastreo', 'cuentaBeneficiaria', 'formaPago', 'moneda',
        'rfcEmisor', 'nombreEmisor', 'regimenFiscalEmisor', 'fechaEmision',
        'fechaCertificacion', 'claveProdServ', 'claveUnidad', 'unidad',
        'objetoImpuesto', 'metodoPago', 'noSerieCsd', 'rfcProveedorCertificacion',
        'noSerieCertificadoSat', 'tipoCfdi', 'uuid', 'estatus'
    ];

    // Identify the most fiscally-anchored document (has UUID, or both RFCs, or importe).
    const anchorScore = fs => {
        let score = 0;
        if (fs.uuid) score += 10;
        if (fs.rfcEmisor && fs.rfcReceptor) score += 6;
        if (fs.rfc) score += 4;
        if (Number.isFinite(fs.importe) && fs.importe > 0) score += 3;
        if (Number.isFinite(fs.importePago) && fs.importePago > 0) score += 2;
        return score;
    };
    const bestAnchor = fieldSets.reduce(
        (best, fs) => (anchorScore(fs) > anchorScore(best) ? fs : best),
        fieldSets[0]
    );

    const merged = {};

    // String fields: first non-empty value wins.
    stringFields.forEach(key => {
        for (const fs of fieldSets) {
            if (fs[key] !== undefined && fs[key] !== null && fs[key] !== '') {
                merged[key] = fs[key];
                break;
            }
        }
    });

    // Numeric fields: prefer the best-anchored document, fall back to first non-null.
    numericFields.forEach(key => {
        if (Number.isFinite(bestAnchor[key]) && bestAnchor[key] !== null) {
            merged[key] = bestAnchor[key];
        } else {
            for (const fs of fieldSets) {
                if (Number.isFinite(fs[key]) && fs[key] !== null) {
                    merged[key] = fs[key];
                    break;
                }
            }
        }
    });

    // Confidence: average across all sets that have it.
    const confidenceKeys = new Set();
    fieldSets.forEach(fs => {
        if (fs.confidence && typeof fs.confidence === 'object') {
            Object.keys(fs.confidence).forEach(k => confidenceKeys.add(k));
        }
    });
    if (confidenceKeys.size > 0) {
        merged.confidence = {};
        confidenceKeys.forEach(key => {
            const values = fieldSets
                .map(fs => (fs.confidence && Number.isFinite(fs.confidence[key]) ? fs.confidence[key] : null))
                .filter(v => v !== null);
            merged.confidence[key] = values.length
                ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
                : 0;
        });
    }

    // Record provenance: which file contributed which field (for debugging).
    merged._sources = fieldSets.map(fs => fs._source).filter(Boolean);

    return merged;
}


function enforceOcrQualityGate(fields) {
    if (!fields) return fields || {};
    // Keep all extracted fields so the user can see and confirm what was detected in Step 2.
    return fields;
}

// A full-page OCR pass can miss table cells because the borders confuse the
// page segmentation model. If that happens, read horizontal bands as a
// lightweight fallback. It keeps the work local to the employee's browser.
async function recognizeImageWithFallback(file, uploadedRecord = null) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;
    const isLandscape = (originalWidth / originalHeight) >= 1.15;

    // A 480p photograph needs much more than the old 1.85x enlargement.
    // Scale adaptively until the photographed page is about 1800x2400 (portrait)
    // or 2400x1600 (landscape), but cap memory so the browser remains responsive.
    const scale = isLandscape
        ? Math.min(5.5, 2600 / bitmap.width, 2000 / bitmap.height, Math.max(1.85, 2200 / bitmap.width))
        : Math.min(5.5, 2600 / bitmap.width, 3200 / bitmap.height, Math.max(1.85, 1800 / bitmap.width, 2400 / bitmap.height));

    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const sourceContext = canvas.getContext('2d');
    sourceContext.imageSmoothingEnabled = true;
    sourceContext.imageSmoothingQuality = 'high';
    sourceContext.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (typeof bitmap.close === 'function') bitmap.close();

    // First normalize the photograph like a document-scanner app: remove desk margins
    const scanCanvas = createDocumentScanCanvas(canvas);
    const quality = assessScanQuality(scanCanvas, originalWidth, originalHeight);
    state.scanQuality = quality;

    const readableCanvas = createEnhancedOcrCanvas(scanCanvas);
    const previewUrl = scanCanvas.toDataURL('image/jpeg', 0.94);
    state.scanPreviewUrl = previewUrl;
    if (uploadedRecord) {
        uploadedRecord.scanPreviewUrl = previewUrl;
        uploadedRecord.scanQuality = quality;
    }

    let text = '';

    // 1. FULL PAGE PASS FIRST (Guarantees unbroken text sentences and full lines have top priority)
    const button = document.getElementById('btn-scan');
    if (button) button.textContent = 'Leyendo documento completo...';
    text += `\n${await recognizeCanvasWithFallback(scanCanvas, quality.level === 'baja' ? '11' : '6')}`;

    // 2. ADAPTIVE REGIONAL PASSES
    const regions = isLandscape
        ? [
            { name: 'encabezado institucional', left: 0.01, right: 0.99, top: 0.00, bottom: 0.26, psm: '6' },
            { name: 'datos contribuyente', left: 0.01, right: 0.99, top: 0.18, bottom: 0.52, psm: '6' },
            { name: 'concepto y tramite', left: 0.01, right: 0.99, top: 0.40, bottom: 0.78, psm: '6' },
            { name: 'importes folios y sello', left: 0.01, right: 0.99, top: 0.65, bottom: 0.99, psm: '6' }
        ]
        : (quality.level === 'baja'
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
            ]);

    for (const region of regions) {
        const regionCanvas = createOcrRegionCanvas(readableCanvas, region.top, region.bottom, region.left, region.right);
        if (button) button.textContent = `Leyendo zona ${region.name}...`;
        text += `\n${await recognizeCanvasOnce(regionCanvas, region.psm)}`;
        regionCanvas.width = 1;
        regionCanvas.height = 1;
    }

    // 3. QR DETECTION
    const qrText = await detectQrText(scanCanvas);
    if (qrText) text += `\n${qrText}`;

    const firstFields = parseExtractedFields(text);

    const hasFiscalCore = Boolean(firstFields.rfc && firstFields.razonSocial && firstFields.importe && firstFields.uuid);
    if (!hasFiscalCore && !isLandscape) {
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

async function recognizeCanvasOnce(canvas, pageSegMode = '6', charWhitelist = '') {
    const params = { tessedit_pageseg_mode: pageSegMode, preserve_interword_spaces: '1' };
    // A character whitelist dramatically reduces O/0, I/1 substitution errors in
    // structured fields. Leave empty for full free-text regions.
    if (charWhitelist) {
        params.tessedit_char_whitelist = charWhitelist;
    } else {
        // Explicitly clear any previous whitelist so free-text regions are unrestricted.
        params.tessedit_char_whitelist = '';
    }
    await state.ocrWorker.setParameters(params);
    const result = await state.ocrWorker.recognize(canvas);
    return result.data.text || '';
}

async function detectQrText(canvas) {
    // --- Attempt 1: BarcodeDetector (Chrome/Edge/Android) --------------------
    if (window.BarcodeDetector) {
        try {
            const formats = typeof window.BarcodeDetector.getSupportedFormats === 'function'
                ? await window.BarcodeDetector.getSupportedFormats()
                : ['qr_code'];
            if (formats.includes('qr_code')) {
                const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
                const codes = await detector.detect(canvas);
                const raw = codes.map(code => code.rawValue || '').filter(Boolean).join('\n');
                if (raw) return parseSatQrUrl(raw);
            }
        } catch (err) {
            console.info('BarcodeDetector falló, usando jsQR de respaldo:', err);
        }
    }

    // --- Attempt 2: jsQR fallback (Firefox, Safari, any browser) -------------
    // jsQR works directly with ImageData from a canvas, no camera access needed.
    if (window.jsQR) {
        try {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = window.jsQR(imageData.data, canvas.width, canvas.height, {
                inversionAttempts: 'dontInvert'
            });
            if (code && code.data) return parseSatQrUrl(code.data);
        } catch (err) {
            console.info('jsQR falló al leer el QR fiscal:', err);
        }
    }

    return '';
}

/**
 * parseSatQrUrl — extracts key CFDI fields from the SAT QR verification URL.
 *
 * SAT QR format:
 *   https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx
 *     ?id=UUID&re=RFC_EMISOR&rr=RFC_RECEPTOR&tt=TOTAL&fe=SELLO
 *
 * Returns the raw URL text plus structured anchor lines that parseExtractedFields
 * can pick up reliably (e.g. "FOLIO FISCAL: <uuid>").
 */
function parseSatQrUrl(raw) {
    const lines = [raw];
    try {
        const url = new URL(raw.trim());
        const uuid = url.searchParams.get('id') || '';
        const rfcEmisor = url.searchParams.get('re') || '';
        const rfcReceptor = url.searchParams.get('rr') || '';
        const total = url.searchParams.get('tt') || '';
        if (uuid) lines.push(`FOLIO FISCAL: ${uuid}`);
        if (rfcEmisor) lines.push(`RFC DEL EMISOR: ${rfcEmisor}`);
        if (rfcReceptor) lines.push(`RFC DEL RECEPTOR: ${rfcReceptor}`);
        if (total) lines.push(`TOTAL: $${total}`);
    } catch (e) {
        // Not a standard SAT URL — return the raw value only.
    }
    return lines.join('\n');
}

function createEnhancedOcrCanvas(sourceCanvas) {
    const W = sourceCanvas.width;
    const H = sourceCanvas.height;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(sourceCanvas, 0, 0);

    const image = context.getImageData(0, 0, W, H);
    const data = image.data;
    const n = W * H;

    // --- Step 1: Convert to grayscale -----------------------------------------
    const gray = new Float32Array(n);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
        gray[p] = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
    }

    // --- Step 2: Gamma correction for dark (underexposed) images ---------------
    // When the median brightness is below 110 the shot is underexposed. A gentle
    // gamma (0.65) lifts shadow detail before thresholding without blowing out
    // well-lit documents.
    const sorted = gray.slice().sort();
    const median = sorted[Math.floor(n / 2)];
    if (median < 110) {
        const gamma = 0.65;
        const gammaLut = new Float32Array(256);
        for (let v = 0; v < 256; v += 1) {
            gammaLut[v] = Math.round(255 * Math.pow(v / 255, gamma));
        }
        for (let p = 0; p < n; p += 1) {
            gray[p] = gammaLut[Math.round(Math.min(255, Math.max(0, gray[p])))];
        }
    }

    // --- Step 3: 3×3 median filter to remove paper/sensor noise ----------------
    // Kills isolated white speckles (paper grain) before binarisation so they
    // are not confused with punctuation by Tesseract.
    const grayMed = new Float32Array(n);
    const buf9 = new Float32Array(9);
    for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
            let count = 0;
            for (let dy = -1; dy <= 1; dy += 1) {
                for (let dx = -1; dx <= 1; dx += 1) {
                    const nx = Math.min(W - 1, Math.max(0, x + dx));
                    const ny = Math.min(H - 1, Math.max(0, y + dy));
                    buf9[count] = gray[(ny * W) + nx];
                    count += 1;
                }
            }
            buf9.sort();
            grayMed[(y * W) + x] = buf9[4];
        }
    }

    // --- Step 4: Sauvola adaptive thresholding (integral-image based, O(N)) ----
    // Computes a local threshold for every pixel from its 32×32 neighbourhood
    // mean and standard deviation. This handles uneven lighting and shadows that
    // global Otsu-style thresholds miss completely.
    // T(x,y) = mean(x,y) × [1 + k × (stddev(x,y)/R − 1)],  k=0.34, R=128
    const windowHalf = 16; // half-side of the 32×32 neighbourhood
    const k = 0.34;
    const R = 128;

    // Build integral images for sum and sum-of-squares.
    const intSum = new Float64Array(n);
    const intSq = new Float64Array(n);
    for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
            const v = grayMed[(y * W) + x];
            const above = y > 0 ? intSum[((y - 1) * W) + x] : 0;
            const left = x > 0 ? intSum[(y * W) + (x - 1)] : 0;
            const diagonal = (y > 0 && x > 0) ? intSum[((y - 1) * W) + (x - 1)] : 0;
            intSum[(y * W) + x] = v + above + left - diagonal;
            const aboveSq = y > 0 ? intSq[((y - 1) * W) + x] : 0;
            const leftSq = x > 0 ? intSq[(y * W) + (x - 1)] : 0;
            const diagSq = (y > 0 && x > 0) ? intSq[((y - 1) * W) + (x - 1)] : 0;
            intSq[(y * W) + x] = (v * v) + aboveSq + leftSq - diagSq;
        }
    }

    // Rectangular area sum from integral image in O(1).
    const areaSum = (x1, y1, x2, y2, integral) => {
        const r2c2 = integral[(y2 * W) + x2];
        const r1c2 = y1 > 0 ? integral[((y1 - 1) * W) + x2] : 0;
        const r2c1 = x1 > 0 ? integral[(y2 * W) + (x1 - 1)] : 0;
        const r1c1 = (y1 > 0 && x1 > 0) ? integral[((y1 - 1) * W) + (x1 - 1)] : 0;
        return r2c2 - r1c2 - r2c1 + r1c1;
    };

    const binarized = new Uint8Array(n);
    for (let y = 0; y < H; y += 1) {
        const y1 = Math.max(0, y - windowHalf);
        const y2 = Math.min(H - 1, y + windowHalf);
        for (let x = 0; x < W; x += 1) {
            const x1 = Math.max(0, x - windowHalf);
            const x2 = Math.min(W - 1, x + windowHalf);
            const count = Math.max(1, (x2 - x1 + 1) * (y2 - y1 + 1));
            const sum = areaSum(x1, y1, x2, y2, intSum);
            const sumSq = areaSum(x1, y1, x2, y2, intSq);
            const mean = sum / count;
            const variance = Math.max(0, (sumSq / count) - (mean * mean));
            const stddev = Math.sqrt(variance);
            const threshold = mean * (1 + k * ((stddev / R) - 1));
            binarized[(y * W) + x] = grayMed[(y * W) + x] >= threshold ? 255 : 0;
        }
    }

    // Write binarized values back to the ImageData.
    for (let p = 0; p < n; p += 1) {
        const v = binarized[p];
        data[p * 4] = v;
        data[(p * 4) + 1] = v;
        data[(p * 4) + 2] = v;
        data[(p * 4) + 3] = 255;
    }
    context.putImageData(image, 0, 0);

    // --- Step 5: Adaptive unsharp masking --------------------------------------
    // After Sauvola binarization the strokes are already crisp, so we use a
    // lighter strength (0.45) than the old 0.68 to avoid ringing on thin serifs.
    const blurred = document.createElement('canvas');
    blurred.width = W;
    blurred.height = H;
    const blurredCtx = blurred.getContext('2d', { willReadFrequently: true });
    blurredCtx.filter = 'blur(1px)';
    blurredCtx.drawImage(canvas, 0, 0);
    blurredCtx.filter = 'none';
    const blurredData = blurredCtx.getImageData(0, 0, W, H).data;
    const unsharpStrength = median < 110 ? 0.30 : 0.45;
    for (let i = 0; i < data.length; i += 4) {
        const base = data[i];
        const sharpened = Math.max(0, Math.min(255, base + ((base - blurredData[i]) * unsharpStrength)));
        const v = sharpened > 230 ? 255 : sharpened;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
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

async function renderPdfPageForOcr(page, isScanned = false) {
    const baseViewport = page.getViewport({ scale: 1 });
    // Render scanned PDFs at a higher resolution so small RFCs and references
    // do not disappear before Tesseract receives the page canvas.
    const scale = Math.max(1.6, Math.min(2.2, 1800 / Math.max(baseViewport.width, baseViewport.height)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    // Scanned PDF pages benefit from the same Sauvola preprocessing pipeline used
    // for photographed images. Digital PDFs (text layer) are returned raw to
    // avoid degrading already-clean vector text.
    if (isScanned) {
        const enhanced = createEnhancedOcrCanvas(canvas);
        canvas.width = 1;
        canvas.height = 1;
        return enhanced;
    }
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
        return `${isoMatch[3].padStart(2, '0')}/${isoMatch[2].padStart(2, '0')}/${isoMatch[1]}${isoMatch[4]}`;
    }
    return cleanValue;
}

function parseExtractedFields(text, sourceFileName = '') {
    if (typeof window !== 'undefined' && window.OcrCore && typeof window.OcrCore.parseExtractedFields === 'function') {
        return window.OcrCore.parseExtractedFields(text, sourceFileName);
    }
    const normalized = String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
    const plain = stripOcrAccents(normalized).toUpperCase();
    // RFC pattern: 3-4 letters (persons use 4, companies use 3), 6-digit date
    // with valid month (01-12) and day (01-31), then exactly 3 alphanumeric chars.
    // The OCR may introduce a single space or dot inside the RFC; we tolerate one
    // optional separator only between the date and the homoclave suffix.
    const rfcPattern = '[A-Z&N]{3,4}\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])[A-Z0-9]{2}[0-9A]';
    const rfcEmisorMatch = plain.match(new RegExp(`(?:RFC\\s+(?:DEL\\s+)?(?:EMISOR|ORDENANTE|PAGADOR)|EMISOR)[^A-Z0-9]{0,30}(${rfcPattern})`, 'i'));
    const rfcReceptorMatch = plain.match(new RegExp(`(?:RFC\\s+(?:DEL\\s+)?(?:RECEPTOR|BENEFICIARIO|DESTINO|CLIENTE)|RECEPTOR|CLIENTE)[^A-Z0-9]{0,30}(${rfcPattern})`, 'i'));
    const genericRfcMatch = plain.match(new RegExp(`(?:RFC|CURP)[^A-Z0-9]{0,30}(${rfcPattern})`, 'i'))
        || plain.match(new RegExp(`\\b(${rfcPattern})\\b`, 'i'));

    const stopLabels = 'RFC|NOMBRE|CODIGO\\s+POSTAL|C\\.?P\\.?|REGIMEN|USO\\s+CFDI|FOLIO|EFECTO|CONCEPTOS|DESCRIPCION|MONEDA|FORMA\\s+DE\\s+PAGO|METODO\\s+DE\\s+PAGO|SUBTOTAL|TOTAL|SELLO';
    const bankStopLabels = 'INSTITUCION|BANCO|CODIGO|CLAVE|CUENTA|CLABE|MONTO|IMPORTE|REFERENCIA|FECHA|TOTAL|FOLIO';
    const receiverNameRaw = extractOcrLabelValue(plain, '(?:NOMBRE\\s*,?\\s*DENOMINACION\\s+O\\s+RAZON\\s+SOCIAL|DENOMINACION\\s*/?\\s*RAZON\\s+SOCIAL|DENOMINACION\\s+O\\s+RAZON\\s+SOCIAL|RAZON\\s+SOCIAL|NOMBRE\\s+(?:DEL?\\s+)?(?:RECEPTOR|BENEFICIARIO|DESTINO|CLIENTE|CONTRIBUYENTE)|CONTRIBUYENTE|CLIENTE)', stopLabels, 140);
    const receiverName = cleanOcrValue(receiverNameRaw.replace(/\s+REGIM(?:E|EN|EN\s+FISCAL)?[\s\S]*$/i, ''));
    const nombreEmisor = extractOcrLabelValue(plain, 'NOMBRE\\s+(?:DEL?\\s+)?EMISOR', 'RFC|NOMBRE\\s+RECEPTOR|FOLIO|CODIGO\\s+POSTAL', 160);
    const legalName = extractOcrLabelValue(plain, '(?:DENOMINACION|RAZON)\\s+SOCIAL', stopLabels, 120);

    // SAT Constancia de Situación Fiscal: Personas Físicas list separate name components
    const satPrimerApellido = extractOcrLabelValue(plain, 'PRIMER\\s+APELLIDO', 'SEGUNDO\\s+APELLIDO|NOMBRE|RFC|CURP', 50);
    const satSegundoApellido = extractOcrLabelValue(plain, 'SEGUNDO\\s+APELLIDO', 'NOMBRE\\(S\\)|NOMBRE|RFC|CURP', 50);
    const satNombres = extractOcrLabelValue(plain, 'NOMBRE\\(S\\)|NOMBRES?', 'PRIMER\\s+APELLIDO|SEGUNDO\\s+APELLIDO|RFC|CURP|FECHA', 70);
    const personaFisicaName = [satNombres, satPrimerApellido, satSegundoApellido].filter(Boolean).join(' ');

    const razonSocial = personaFisicaName || receiverName || legalName;

    // Automatic email extraction from any text line in the document
    const emailMatch = normalized.match(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/);
    const correoExtraido = emailMatch ? emailMatch[1].toLowerCase() : '';

    const codigoPostalMatch = plain.match(/(?:CODIGO\s+POSTAL|C\.?P\.?|LUGAR\s+DE\s+EXPEDICION)[^0-9]{0,30}(\d{5})\b/i);
    const codigoPostal = codigoPostalMatch ? codigoPostalMatch[1] : '';
    const receiverRegimenFiscal = extractOcrLabelValue(plain, '(?:REGIMEN\\s+FISCAL\\s+RECEPTOR|RECEPTOR\\s*[:\\-]?\\s*REGIMEN\\s+FISCAL)', 'RECEPTOR|USO\\s+CFDI|CODIGO\\s+POSTAL|RFC|NOMBRE|CONCEPTOS', 100);
    const regimenFiscal = receiverRegimenFiscal || extractOcrLabelValue(plain, 'REGIMEN(?:ES)?(?:\\s+FISCAL(?:ES)?)?', 'USO\\s+CFDI|CODIGO\\s+POSTAL|EXPORTACION|FOLIO\\s+FISCAL|RFC|NOMBRE|CONCEPTOS', 100);
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
    const bankDocumentContext = /INSTITUCION\s+(?:EMISORA?|RECEPTORA?)|CLAVE\s+DE\s+RASTREO|CUENTA\s+BENEFICIARIA|TRANSFERENCIA|PAGO|COMPROBANTE|TICKET/i.test(plain);

    const totalMatch = plain.match(/\bTOTAL(?:\s+A\s+PAGAR)?\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i);
    const explicitPaymentAmountMatch = normalized.match(/(?:MONTO(?:\s+(?:DE\s+LA\s+OPERACI[O0E]N|DEL?\s+PAGO))?|IMPORTE\s+(?:TOTAL|PAGADO|DEL?\s+PAGO)|TOTAL\s+A\s+PAGAR|IMPORTE\s*[:=]|DEPOSITO)[^\d$\n]{0,60}\$?\s*([\d,]+(?:\.\d{1,2})?)/i)
        || (bankDocumentContext ? normalized.match(/IMPORTE\s*[:\-]?[^\d$\n]{0,20}\$?\s*([\d,]+(?:\.\d{1,2})?)/i) : null);
    const currencyMatches = [...normalized.matchAll(/\$\s*([\d,]+\.\d{1,2})/g)];
    const currencyMatch = currencyMatches.length ? currencyMatches[currencyMatches.length - 1] : null;
    const qrAmountMatch = plain.match(/[?&]TT=([\d,]+(?:\.\d+)?)/i);
    const amountMatch = qrAmountMatch || totalMatch || explicitPaymentAmountMatch || currencyMatch;
    const paymentAmount = explicitPaymentAmountMatch ? Number(explicitPaymentAmountMatch[1].replace(/,/g, '')) : null;
    const subtotalMatch = plain.match(/\bSUBTOTAL\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i);
    const folioReciboMatch = normalized.match(/(?:FOLIO\s+(?:DE\s+OPERACI[O0E]N|DEL?\s+RECIBO|DEL?\s+COMPROBANTE)?|NO\.?\s+DE?\s+RECIBO|NUM\.?\s+OPERACI[O0E]N)[\s:#-]*([A-Z0-9][A-Z0-9 ./_-]{3,45})/i);
    const numericReferenceMatch = normalized.match(/(?:NUMERO\s+DE\s+REFERENCIA|FOLIO\s+DE\s+OPERACI[O0E]N|NUM\.?\s+OPERACI[O0E]N|REFERENCIA|REF\.?)[\s:#-]*(\d{1,12})(?!\d)/i);
    const referenceMatch = normalized.match(/(?:REFERENCIA|REF\.?|AUTORIZACION|FOLIO)[\s:#-]*([A-Z0-9][A-Z0-9 ./_-]{3,45})/i);
    const trackingMatch = normalized.match(/(?:CLAVE\s+DE\s+RASTREO|CLAVE\s+RASTREO|RASTREO|FOLIO\s+DIGITAL)[\s:#-]*([A-Z0-9]{6,30})/i);
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
    const datePattern = '(?:\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}(?:T\\d{2}:\\d{2}:\\d{2})?|\\d{1,2}[/-]\\d{1,2}[/-]\\d{4})(?:\\s+\\d{1,2}:\\d{2}(?::\\d{2})?)?';
    const emissionDateMatch = plain.match(new RegExp(`(?:FECHA\\s+Y\\s+HORA\\s+DE\\s+EMISION|FECHA\\s+DE\\s+EMISION|FECHA\\s+EMISION|FECHA\\s*Y\\s*HORA\\s*DE(?!\\s*CERTIFICACION))[^0-9]{0,60}(?:\\d{5}\\s+)?(${datePattern})`, 'i'));
    const paymentDateMatch = plain.match(new RegExp(`(?:FECHA\\s+DE\\s+(?:OPERACION|PAGO)|FECHA\\s+PAGO)[^0-9]{0,40}(${datePattern})`, 'i'));

    // Spanish written-date fallback: "23 de agosto de 2026" → "23/08/2026"
    const monthMap = { enero:'01', febrero:'02', marzo:'03', abril:'04', mayo:'05', junio:'06', julio:'07', agosto:'08', septiembre:'09', octubre:'10', noviembre:'11', diciembre:'12' };
    const writtenDateRx = /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})/gi;
    const normalizeWrittenDate = raw => {
        const m = raw.match(/(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})/i);
        if (!m) return null;
        return `${m[1].padStart(2, '0')}/${monthMap[m[2].toLowerCase()]}/${m[3]}`;
    };
    const writtenEmission = !emissionDateMatch ? normalized.match(/(?:FECHA\s+(?:DE\s+)?EMISION|FECHA\s+Y\s+HORA)[^\n]{0,30}(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i) : null;
    const writtenPayment = !paymentDateMatch ? normalized.match(/(?:FECHA\s+(?:DE\s+)?(?:PAGO|OPERACION))[^\n]{0,30}(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i) : null;

    const fechaEmision = emissionDateMatch ? normalizeOcrDate(emissionDateMatch[1])
        : (writtenEmission ? (normalizeWrittenDate(writtenEmission[1]) || '') : '');

    // Extended bank list: traditional + neobanks + digital wallets operating in MX.
    const bankNames = [
        'BBVA', 'SANTANDER', 'BANAMEX', 'CITIBANAMEX', 'HSBC', 'BANORTE', 'SCOTIABANK',
        'BANCO DEL BIENESTAR', 'AZTECA', 'BANCOPPEL', 'STP', 'MERCADOPAGO', 'MERCADO PAGO',
        'NUBANK', 'NU MEXICO', 'NU', 'BANREGIO', 'INBURSA', 'AFIRME', 'COMPARTAMOS',
        'BANJERCITO', 'CI BANCO', 'PAYPAL', 'BANCA MIFEL', 'MIFEL', 'BANSI', 'MULTIVA',
        'ACTINVER', 'HEY BANCO', 'HEY', 'ALBO', 'KLAR', 'STORI', 'CUENCA', 'RAPPIBANK',
        'RAPPI', 'SPIN BY OXXO', 'SPIN', 'CONEKTA', 'STRIPE', 'CLIP', 'BROXEL',
        'ARCUS', 'MONEXCB', 'MONEX', 'INTERCAM', 'BITSTAMP', 'BITSO', 'DINERIO'
    ];
    const bank = bankNames.find(name => plain.includes(name)) || '';
    const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : null;
    const referencia = numericReferenceMatch ? cleanOcrValue(numericReferenceMatch[1]) : (referenceMatch ? cleanOcrValue(referenceMatch[1]) : '');
    const fechaPago = paymentDateMatch ? normalizeOcrDate(paymentDateMatch[1])
        : (writtenPayment ? (normalizeWrittenDate(writtenPayment[1]) || '') : '');
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
        correo: correoExtraido,
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
            correo: correoExtraido ? 0.9 : 0,
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
    // B→8 and U→0 are additional LSTM confusions seen in practice for UUIDs.
    return String(value || '')
        .toUpperCase()
        .replace(/[OQ]/g, '0')
        .replace(/[IL]/g, '1')
        .replace(/S/g, '5')
        .replace(/G/g, '6')
        .replace(/Z/g, '2')
        .replace(/B(?=[0-9A-F-]|$)/g, '8')   // B→8 only when surrounded by hex chars
        .replace(/U/g, '0');
}

function normalizeOcrConcept(value) {
    return cleanOcrValue(value)
        .replace(/[\[\]{}<>|]/g, ' ')
        .replace(/\bI\s+L(?:E|C)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ─────────────────────────────────────────────
// SAT CFDI 4.0 Catalog Normalization Helpers
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
    if (/\b03\b|TRANSFERENCIA|SPEI|ELECTRONICA/.test(clean)) return '03';
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

function applyExtractedFields(fields) {
    if (!state.activeExpediente) createActiveExpedienteFromUploads();
    if (!state.activeExpediente) return;
    const dossier = state.activeExpediente;
    if (fields.rfc) dossier.rfc = fields.rfc;
    if (fields.razonSocial) dossier.cliente = fields.razonSocial;
    if (fields.correo) dossier.correo = fields.correo;
    if (fields.banco) dossier.banco = fields.banco;
    if (Number.isFinite(fields.importe)) {
        dossier.importe = fields.importe;
        dossier.total = fields.importe;
        dossier.cfdiTotal = fields.importe;
        if (!Number.isFinite(dossier.importePago)) dossier.importePago = fields.importe;
    }
    if (Number.isFinite(fields.importePago)) {
        dossier.importePago = fields.importePago;
        if (!Number.isFinite(dossier.importe)) {
            dossier.importe = fields.importePago;
            dossier.total = fields.importePago;
            dossier.cfdiTotal = fields.importePago;
        }
    }
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
    if (fields.noSerieCertificadoSat) dossier.noSerieCertificadoSat = fields.noSerieCertificadoSat;
}

function loadPresetDossier(presetIndex) {
    showToast('Los expedientes de demostración están deshabilitados. Carga un documento real.', 'warning');
    return;
}

function renderDocumentList() {
    const listContainer = document.getElementById('doc-list-container');
    if (!listContainer || !state.activeExpediente) return;

    listContainer.innerHTML = '';
    const archivos = Array.isArray(state.activeExpediente.archivos) ? state.activeExpediente.archivos : [];
    archivos.forEach(file => {
        if (!file || !file.name) return;
        const isPdf = String(file.name).toLowerCase().endsWith('.pdf');
        const iconClass = isPdf ? 'doc-icon-pdf' : 'doc-icon-img';
        const iconSvg = isPdf 
            ? `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9.5 6H8v6H6.5v-1.5H5v-1.5h1.5V9H5V7.5h4.5V9zm5 4.5c0 .83-.67 1.5-1.5 1.5h-2.5V7.5H13c.83 0 1.5.67 1.5 1.5v4.5zm5-3H18v1.5h1.5V12H18v3h-1.5V7.5h3v2.5zm-6.5-1.5H11.5v3H13c.28 0 .5-.22.5-.5V9c0-.28-.22-.5-.5-.5z"/></svg>`
            : `<svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-4.86 8.86l-3 3.87L9 13.14 6 17h12l-3.86-5.14z"/></svg>`;

        const fileStatus = String(file.status || 'Leído');
        const isScanned = fileStatus.includes('OCR') || fileStatus.includes('Leído');
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
            <span class="doc-title">${file.type || 'Documento'}</span>
            <span class="doc-filename"><a href="#" onclick="return false;">${file.name}</a></span>
            <span class="badge ${badgeClass} doc-status-badge">
                ${badgeIcon}
                ${fileStatus}
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
    const d = state.activeExpediente;
    const hasCoreFiscal = Boolean(d?.rfc && d?.cliente && d?.codigoPostal);
    const hasPayment = Boolean(Number.isFinite(d?.importe) && d?.importe > 0);
    const isSuccess = hasCoreFiscal && hasPayment;

    alert.classList.toggle('ocr-needs-review', !isSuccess);
    if (isSuccess) {
        if (title) title.textContent = '✅ Extracción exitosa';
        if (description) description.textContent = 'Se detectaron y validaron los datos fiscales del SAT, el recibo CIS y el pago bancario.';
    } else {
        if (title) title.textContent = fields?.qualityRejected
            ? 'Lectura rechazada: calidad insuficiente'
            : 'Lectura completada: precarga editable';
        if (description) {
            description.textContent = fields?.qualityRejected
                ? 'El encuadre o contraste fue insuficiente para extraer los datos fiscales con certeza. Sube una foto nítida y plana.'
                : 'Revisa los campos antes de timbrar. Puedes editarlos en el siguiente paso.';
        }
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

function updatePreviewFields() {
    if (!state.activeExpediente) return;
    const d = state.activeExpediente;
    const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val || '—';
    };
    setText('preview-rfc', d.rfc);
    setText('preview-razon', d.cliente);
    setText('preview-cp', d.codigoPostal);
    setText('preview-regimen', d.regimenFiscal);
    setText('preview-uso', d.usoCfdi);
    setText('preview-concepto', d.concepto);
    setText('preview-total', d.importe ? `$${Number(d.importe).toFixed(2)} MXN` : '—');
    setText('preview-forma-pago', d.formaPago);
    setText('preview-metodo-pago', d.metodoPago);
}

function getRegimenLabel(code) {
    const map = {
        '601': 'General de Ley Personas Morales',
        '603': 'Personas Morales con Fines no Lucrativos',
        '605': 'Sueldos y Salarios e Ingresos Asimilados a Salarios',
        '606': 'Arrendamiento',
        '608': 'Demás ingresos',
        '612': 'Personas Físicas con Actividades Empresariales y Profesionales',
        '616': 'Sin obligaciones fiscales',
        '621': 'Incorporación Fiscal',
        '625': 'Actividades Empresariales con ingresos vía Plataformas Tecnológicas',
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

function updateStep2Fields() {
    if (!state.activeExpediente) return;
    const pending = 'Pendiente de lectura';
    const d = state.activeExpediente;

    const setTextWithMissing = (id, val, isOptional = false) => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = val || (isOptional ? 'No registrado (opcional)' : 'No detectado');
            element.classList.toggle('ocr-field-missing', !val && !isOptional);
        }
    };

    setTextWithMissing('val-rfc', d.rfc);
    setTextWithMissing('val-razon', d.cliente);
    setTextWithMissing('val-regimen', d.regimenFiscal ? `${d.regimenFiscal} - ${getRegimenLabel(d.regimenFiscal)}` : '');
    setTextWithMissing('val-cp', d.codigoPostal);
    setTextWithMissing('val-cfdi', d.usoCfdi ? `${d.usoCfdi} - ${getUsoCfdiLabel(d.usoCfdi)}` : 'G03 - Gastos en general');
    setTextWithMissing('val-correo', d.correo, true);

    // Toggle pre-existing CFDI section only if a UUID was scanned
    const cfdiSection = document.getElementById('section-cfdi-detectados');
    if (cfdiSection) {
        cfdiSection.style.display = d.uuid ? 'block' : 'none';
    }

    const formatDetectedAmount = value => value !== null && value !== '' && Number.isFinite(Number(value))
        ? `$${Number(value).toFixed(2)} MXN`
        : 'No detectado';

    setTextWithMissing('val-rfc-emisor', d.rfcEmisor);
    setTextWithMissing('val-nombre-emisor', d.nombreEmisor);
    setTextWithMissing('val-regimen-emisor', d.regimenFiscalEmisor);
    setTextWithMissing('val-tipo-cfdi', d.tipoCfdi ? d.tipoCfdi.toUpperCase() : '');
    setTextWithMissing('val-fecha-emision', d.fechaEmision);
    setTextWithMissing('val-uuid', d.uuid);
    setTextWithMissing('val-metodo-pago', d.metodoPago);
    setTextWithMissing('val-moneda', d.moneda);
    setTextWithMissing('val-subtotal', formatDetectedAmount(d.subtotal));
    setTextWithMissing('val-clave-prodserv', d.claveProdServ);
    setTextWithMissing('val-cantidad-unidad', [d.cantidad, d.claveUnidad, d.unidad].filter(Boolean).join(' / '));
    
    const lineValues = [
        d.valorUnitario !== null && d.valorUnitario !== '' && Number.isFinite(Number(d.valorUnitario)) ? `$${Number(d.valorUnitario).toFixed(2)}` : '',
        d.importeLinea !== null && d.importeLinea !== '' && Number.isFinite(Number(d.importeLinea)) ? `$${Number(d.importeLinea).toFixed(2)}` : ''
    ].filter(Boolean);
    setTextWithMissing('val-valores-linea', lineValues.length ? lineValues.join(' / ') + ' MXN' : '');
    setTextWithMissing('val-objeto-impuesto', d.objetoImpuesto);
    
    const certificateValues = [d.noSerieCsd, d.rfcProveedorCertificacion, d.noSerieCertificadoSat].filter(Boolean);
    setTextWithMissing('val-certificados', certificateValues.length ? certificateValues.join(' / ') : '');

    document.getElementById('val-cis-folio').textContent = d.folioRecibo || pending;
    document.getElementById('val-cis-fecha').textContent = d.fechaPago || d.fechaRecibo || pending;
    document.getElementById('val-cis-concepto').textContent = d.concepto || pending;
    
    const paymentAmount = Number(d.importePago || d.importe || d.total || 0);
    document.getElementById('val-cis-importe').textContent = Number.isFinite(paymentAmount) && paymentAmount > 0
        ? `$${paymentAmount.toFixed(2)} MXN`
        : pending;

    document.getElementById('val-banco').textContent = d.banco || pending;
    document.getElementById('val-banco-fecha').textContent = d.fechaPago || pending;
    document.getElementById('val-banco-importe').textContent = Number.isFinite(paymentAmount) && paymentAmount > 0
        ? `$${paymentAmount.toFixed(2)} MXN`
        : pending;
    document.getElementById('val-banco-ref').textContent = d.referencia || pending;
    document.getElementById('val-banco-clave').textContent = d.claveRastreo || pending;
    document.getElementById('val-banco-cuenta').textContent = d.cuentaBeneficiaria || pending;
    document.getElementById('val-banco-forma').textContent = d.formaPago || pending;

    // Enable step 2 confirm button
    const confirmBtn = document.getElementById('btn-confirm-step2');
    if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirmar datos y continuar al timbrado →';
    }
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
    state.maxStepUnlocked = Math.max(state.maxStepUnlocked || 1, 3);
    goToStep(3);
}

// Timeline auditoria
function renderTimeline() {
    const timeline = document.getElementById('timeline-expediente');
    if (!timeline || !state.activeExpediente) return;

    timeline.innerHTML = '';
    if (!Array.isArray(state.activeExpediente.auditoria)) {
        state.activeExpediente.auditoria = [];
    }
    const logs = state.activeExpediente.auditoria.length > 0
        ? state.activeExpediente.auditoria
        : [`[${state.activeExpediente.fechaRecibo || getCurrentDateTimeString()}] Trámite registrado en el sistema.`];

    logs.forEach(log => {
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
        if (!Array.isArray(state.activeExpediente.auditoria)) {
            state.activeExpediente.auditoria = [];
        }
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

    // Normalización inteligente de catálogos SAT
    const normRegimen = normalizeSatRegimen(d.regimenFiscal) || d.regimenFiscal;
    if (regimenSelect && normRegimen) {
        regimenSelect.value = normRegimen;
        d.regimenFiscal = normRegimen;
    }

    const normUso = normalizeSatUsoCfdi(d.usoCfdi) || d.usoCfdi;
    if (usoCfdiSelect && normUso) {
        usoCfdiSelect.value = normUso;
        d.usoCfdi = normUso;
    }

    const normForma = normalizeSatFormaPago(d.formaPago) || d.formaPago;
    if (formaPagoSelect && normForma) {
        formaPagoSelect.value = normForma;
        d.formaPago = normForma;
    }

    const normMetodo = normalizeSatMetodoPago(d.metodoPago) || d.metodoPago;
    if (metodoPagoSelect && normMetodo) {
        metodoPagoSelect.value = normMetodo;
        d.metodoPago = normMetodo;
    }

    if (correoInput && d.correo) correoInput.value = d.correo;
    if (conceptoInput && d.concepto) conceptoInput.value = d.concepto;

    const totalVal = parseFloat(d.importe || d.total || d.cfdiTotal || d.importePago || 0);
    if (totalInput && totalVal > 0) {
        totalInput.value = totalVal.toFixed(2);
    }
    updateStep3Summary(totalVal);

    // Verificar si ya existe en clientes del directorio institucional
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

    state.maxStepUnlocked = Math.max(state.maxStepUnlocked || 1, 4);
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

let _isStampingActive = false;

async function stampInvoiceViaPAC() {
    if (_isStampingActive) {
        console.warn('[STAMP] Clic duplicado ignorado: el timbrado ya se encuentra en ejecución.');
        return;
    }

    if (!state.activeExpediente) {
        showToast('Primero carga y procesa un documento para obtener el expediente.', 'warning');
        return;
    }

    // ── CAPA DE FRONTEND: Si ya tiene UUID o estatus TIMBRADA, no re-enviar al PAC ──
    if (state.activeExpediente.uuid || state.activeExpediente.estatus === 'TIMBRADA') {
        const uuidExistente = state.activeExpediente.uuid || 'Registrado';
        showToast(`Este expediente ya cuenta con comprobante fiscal oficial (UUID: ${uuidExistente}).`, 'info');
        if (_lastStampResult) {
            _mostrarResultadoTimbrado(_lastStampResult, badgeEl?.dataset?.sandbox === 'true');
        }
        goToStep(6);
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

    _isStampingActive = true;

    try {
        setLoading('Validando datos fiscales con Facturama...', 'Verificando RFC, clave SAT e importes.');
        const testRes = await apiFetch('/api/facturama/test', {
            method: 'POST',
            body: JSON.stringify({ expedienteId: folio, expediente: state.activeExpediente }),
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
        const body = { expedienteId: folio, expediente: state.activeExpediente };
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

        // Agregar a la lista de facturas si no existe ya
        const yaEnLista = state.facturas.some(f => (stampData.uuid && f.uuid === stampData.uuid) || (f.folioInterno === folio));
        if (!yaEnLista) {
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
        }

        // Recargar directorio de clientes para incluir al nuevo
        await loadClientes().catch(() => {});

        clearLoading();
        _mostrarResultadoTimbrado(stampData, isSandbox);
        renderReportTable();
        updateDashboardCounts();

        if (stampData.yaEstabaTimbrada) {
            showToast(`✓ Comprobante fiscal oficial recuperado (UUID: ${stampData.uuid}).`, 'info');
        } else {
            const modoStr = isSandbox ? '🧪 (SANDBOX)' : '✅ (PRODUCCIÓN)';
            showToast(`${modoStr} ¡CFDI 4.0 timbrado exitosamente! UUID: ${stampData.uuid}`, 'success');
        }
        
        if (stampData.correoEnviado && stampData.correoDestinatario) {
            state.historialCorreos.unshift({
                fecha: new Date().toLocaleString('es-MX'),
                destinatario: stampData.correoDestinatario,
                folio: folio,
                adjuntos: 'XML / PDF',
                estatus: 'Enviado'
            });
            renderCorreosTable();
            setTimeout(() => {
                showToast(`✉️ Factura (XML + PDF) enviada automáticamente a ${stampData.correoDestinatario} vía Brevo.`, 'success');
            }, 1000);
        }

        addSecurityLog('CFDI Timbrado Oficial', `UUID: ${stampData.uuid} | Folio Facturama: ${stampData.facturamaId}${stampData.correoEnviado ? ` | Correo enviado a ${stampData.correoDestinatario}` : ''}`);

    } catch (err) {
        clearLoading();
        console.error('[STAMP EXCEPTION]', err);
        showToast(`❌ Error de conexión: ${err.message}`, 'error');
    } finally {
        _isStampingActive = false;
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
                <button onclick="restartProcess()" class="btn btn-primary" style="font-size:0.8rem;padding:8px 16px;background:var(--secondary-color);color:#fff;border:none;display:flex;align-items:center;gap:6px;font-weight:700;">
                    ➕ Nueva Factura
                </button>
            </div>
        </div>
    `;
    goToStep(4);
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

async function openPdfViewer(pdfBase64OrFacturamaId, title = 'Vista Previa de Factura CFDI 4.0') {
    const modal = document.getElementById('modal-pdf-viewer');
    const frame = document.getElementById('pdf-viewer-frame');
    const titleEl = document.getElementById('pdf-viewer-title');
    const modalBody = frame ? frame.parentElement : null;
    if (!modal || !frame || !modalBody) return;

    if (titleEl) titleEl.textContent = title;

    // Limpiar recursos previos
    if (_currentPdfViewerBlobUrl) {
        URL.revokeObjectURL(_currentPdfViewerBlobUrl);
        _currentPdfViewerBlobUrl = null;
    }

    // Quitar cualquier visor inline anterior
    const prevInline = document.getElementById('pdf-viewer-inline');
    if (prevInline) prevInline.remove();
    frame.style.display = 'none';

    // Mostrar spinner mientras carga
    const spinner = document.createElement('div');
    spinner.id = 'pdf-viewer-spinner';
    spinner.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#fff;font-size:1rem;gap:12px;';
    spinner.innerHTML = '<svg style="width:28px;height:28px;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 12a8 8 0 018-8v4l3-3-3-3v4A10 10 0 002 12h2z"/></svg> Cargando...';
    modalBody.appendChild(spinner);
    modal.classList.add('open');

    const removeSpinner = () => {
        const s = document.getElementById('pdf-viewer-spinner');
        if (s) s.remove();
    };

    const showError = (msg) => {
        removeSpinner();
        const err = document.createElement('div');
        err.id = 'pdf-viewer-inline';
        err.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#fff;font-size:0.9rem;text-align:center;padding:24px;';
        err.innerHTML = `<div><svg style="width:40px;height:40px;margin-bottom:12px;opacity:0.6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.73-3L13.73 4a2 2 0 00-3.46 0L3.27 16A2 2 0 005.07 19z"/></svg><br>${msg}</div>`;
        modalBody.appendChild(err);
    };

    try {
        // Caso 1: es base64 puro (cadena larga > 50 chars sin guiones que parece UUID)
        const looksLikeBase64 = pdfBase64OrFacturamaId && pdfBase64OrFacturamaId.length > 100 && !/^[0-9a-f-]{30,40}$/i.test(pdfBase64OrFacturamaId);
        if (looksLikeBase64) {
            removeSpinner();
            frame.style.display = 'block';
            frame.src = `data:application/pdf;base64,${pdfBase64OrFacturamaId}`;
            return;
        }

        // Caso 2: usar _lastStampResult si no hay ID
        if (!pdfBase64OrFacturamaId && _lastStampResult?.facturamaId) {
            removeSpinner();
            return openPdfViewer(_lastStampResult.facturamaId, title);
        }

        if (!pdfBase64OrFacturamaId) {
            showError('No hay PDF disponible para mostrar.');
            return;
        }

        // Caso 3: descargar desde el servidor
        const token = getJwtToken();
        const res = await fetch(`/api/facturama/descargar/${pdfBase64OrFacturamaId}/pdf`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            showError(`No se pudo cargar la vista previa (HTTP ${res.status}).`);
            return;
        }

        const contentType = res.headers.get('content-type') || '';
        const blob = await res.blob();

        if (contentType.includes('pdf')) {
            // Es un PDF real → mostrarlo en el iframe
            removeSpinner();
            _currentPdfViewerBlobUrl = URL.createObjectURL(blob);
            frame.style.display = 'block';
            frame.src = _currentPdfViewerBlobUrl;
        } else {
            // Es HTML (fallback de BD) → renderizar inline dentro del modal
            removeSpinner();
            const htmlText = await blob.text();
            const inlineDiv = document.createElement('div');
            inlineDiv.id = 'pdf-viewer-inline';
            inlineDiv.style.cssText = 'width:100%;height:100%;overflow:auto;background:#fff;';
            // Usar srcdoc en un iframe para aislar el HTML
            const inlineFrame = document.createElement('iframe');
            inlineFrame.style.cssText = 'width:100%;height:100%;border:none;';
            inlineFrame.srcdoc = htmlText;
            inlineDiv.appendChild(inlineFrame);
            modalBody.appendChild(inlineDiv);
            // Almacenar blob por si el usuario quiere descargar
            _currentPdfViewerBlobUrl = URL.createObjectURL(blob);
        }
    } catch (e) {
        showError('Error al obtener la vista previa: ' + e.message);
    }
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
        const activeExp = state.activeExpediente;
        const matchingFactura = (state.facturas || []).find(f => (f.folioInterno === _currentEmailExpedienteId) || (f.folio === _currentEmailExpedienteId));
        const effectiveFacturamaId = activeExp?.facturamaId || _lastStampResult?.facturamaId || matchingFactura?.facturamaId || null;
        const effectiveUuid = activeExp?.uuid || _lastStampResult?.uuid || matchingFactura?.uuid || null;

        const res = await apiFetch('/api/correo/enviar', {
            method: 'POST',
            body: JSON.stringify({
                expedienteId: _currentEmailExpedienteId,
                destinatario,
                nombreDestinatario,
                asunto,
                mensaje,
                adjuntarXml,
                adjuntarPdf,
                facturamaId: effectiveFacturamaId,
                uuid: effectiveUuid,
                xmlBase64: _lastStampResult?.xmlBase64 || activeExp?.xmlBase64 || null,
                pdfBase64: _lastStampResult?.pdfBase64 || activeExp?.pdfBase64 || null
            })
        });
        const data = await res.json();

        if (res.ok && data.success) {
            showToast(`✅ Factura enviada con éxito a ${destinatario} (Brevo ID: ${data.messageId || 'OK'})`, 'success');
            closeModal('modal-enviar-correo');

            // Actualizar historial de correos desde backend
            try {
                const hRes = await apiFetch('/api/correos');
                const hData = await hRes.json();
                if (hData.success && Array.isArray(hData.data)) {
                    state.historialCorreos = hData.data;
                } else {
                    throw new Error();
                }
            } catch (e) {
                state.historialCorreos.unshift({
                    fecha: new Date().toLocaleString('es-MX'),
                    destinatario,
                    folio: _currentEmailExpedienteId,
                    adjuntos: `${adjuntarXml ? 'XML ' : ''}${adjuntarPdf ? 'PDF' : ''}`.trim() || 'Sin adjuntos',
                    estatus: 'Enviado'
                });
            }
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

function parseInvoiceDate(f) {
    if (!f) return null;
    const raw = f.fechaTimbrado || f.createdAt || f.fecha || f.fechaRecibo || f.pagoFecha;
    if (!raw) return null;
    if (raw instanceof Date && !isNaN(raw)) return raw;

    const isoDate = new Date(raw);
    if (!isNaN(isoDate.getTime())) return isoDate;

    const parts = String(raw).match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (parts) {
        const d = parseInt(parts[1], 10);
        const m = parseInt(parts[2], 10) - 1;
        const y = parseInt(parts[3], 10);
        const parsed = new Date(y, m, d);
        if (!isNaN(parsed.getTime())) return parsed;
    }
    return null;
}

function onReportYearMonthChange() {
    const yearVal = document.getElementById('report-filter-year')?.value || 'TODOS';
    const monthVal = document.getElementById('report-filter-month')?.value || 'TODOS';
    const fromInput = document.getElementById('report-date-from');
    const toInput = document.getElementById('report-date-to');

    if (fromInput && toInput) {
        if (yearVal !== 'TODOS') {
            const y = parseInt(yearVal, 10);
            if (monthVal !== 'TODOS') {
                const m = parseInt(monthVal, 10);
                const mm = String(m).padStart(2, '0');
                const lastDay = new Date(y, m, 0).getDate();
                const dd = String(lastDay).padStart(2, '0');
                fromInput.value = `${y}-${mm}-01`;
                toInput.value = `${y}-${mm}-${dd}`;
            } else {
                fromInput.value = `${y}-01-01`;
                toInput.value = `${y}-12-31`;
            }
        } else if (monthVal !== 'TODOS') {
            fromInput.value = '';
            toInput.value = '';
        } else {
            fromInput.value = '';
            toInput.value = '';
        }
    }
    filterReportTable();
}

function onCustomDateChange() {
    filterReportTable();
}

function setReportDatePreset(preset) {
    const fromInput = document.getElementById('report-date-from');
    const toInput = document.getElementById('report-date-to');
    const yearSelect = document.getElementById('report-filter-year');
    const monthSelect = document.getElementById('report-filter-month');
    const statusSelect = document.getElementById('report-status-filter');
    const searchInput = document.getElementById('search-report');

    const today = new Date();
    const yyyy = today.getFullYear();
    const mmNum = today.getMonth() + 1;
    const mm = String(mmNum).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

    if (preset === 'hoy') {
        if (fromInput) fromInput.value = todayStr;
        if (toInput) toInput.value = todayStr;
        if (yearSelect) yearSelect.value = String(yyyy);
        if (monthSelect) monthSelect.value = String(mmNum);
    } else if (preset === 'mes') {
        const lastDay = new Date(yyyy, mmNum, 0).getDate();
        if (fromInput) fromInput.value = `${yyyy}-${mm}-01`;
        if (toInput) toInput.value = `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}`;
        if (yearSelect) yearSelect.value = String(yyyy);
        if (monthSelect) monthSelect.value = String(mmNum);
    } else if (preset === 'anio') {
        if (fromInput) fromInput.value = `${yyyy}-01-01`;
        if (toInput) toInput.value = `${yyyy}-12-31`;
        if (yearSelect) yearSelect.value = String(yyyy);
        if (monthSelect) monthSelect.value = 'TODOS';
    } else if (preset === 'todos') {
        if (fromInput) fromInput.value = '';
        if (toInput) toInput.value = '';
        if (yearSelect) yearSelect.value = 'TODOS';
        if (monthSelect) monthSelect.value = 'TODOS';
        if (statusSelect) statusSelect.value = 'TODOS';
        if (searchInput) searchInput.value = '';
    }
    filterReportTable();
}

function getFilteredInvoicesList() {
    const busqueda = (document.getElementById('search-report')?.value || '').toLowerCase().trim();
    const estatusFilter = (document.getElementById('report-status-filter')?.value || 'TODOS').toUpperCase().trim();
    const filterYear = document.getElementById('report-filter-year')?.value || 'TODOS';
    const filterMonth = document.getElementById('report-filter-month')?.value || 'TODOS';
    const dateFrom = document.getElementById('report-date-from')?.value;
    const dateTo = document.getElementById('report-date-to')?.value;

    const fromDateObj = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
    const toDateObj = dateTo ? new Date(dateTo + 'T23:59:59') : null;

    const facturaFolios = new Set((state.facturas || []).map(f => f.folioInterno || f.folio));
    const expedientesRestantes = (state.expedientes || []).filter(e => !facturaFolios.has(e.folio));
    const list = [...(state.facturas || []), ...expedientesRestantes];

    return list.filter(f => {
        const folio = f.folioInterno || f.folio || '';
        const uuid = f.uuid || f.cfdiUuid || '';
        const cliente = f.cliente || f.receptorNombre || '';
        const rfc = f.rfc || f.receptorRfc || '';
        const concepto = f.concepto || f.cfdiConcepto || '';
        const estatus = (f.estatus || (uuid ? 'TIMBRADA' : 'PENDIENTE')).toUpperCase();

        const isTimbrada = estatus === 'TIMBRADA' || estatus === 'TIMBRADO' || Boolean(uuid);
        const isPendiente = estatus === 'PENDIENTE' || estatus === 'EN_PROCESO' || estatus === 'RECIBIDO' || estatus === 'PAGO PENDIENTE' || estatus === 'EN PROCESO';
        const isCancelada = estatus === 'CANCELADA' || estatus === 'CANCELADO';
        const isError = estatus === 'ERROR' || estatus === 'FALLIDO';

        // 1. Filtro por texto
        const matchText = !busqueda || [folio, uuid, cliente, rfc, concepto].some(val => (val || '').toLowerCase().includes(busqueda));

        // 2. Filtro por estatus
        let matchEstatus = false;
        if (estatusFilter === 'TODOS') {
            matchEstatus = true;
        } else if (estatusFilter === 'TIMBRADA' || estatusFilter === 'TIMBRADO') {
            matchEstatus = isTimbrada;
        } else if (estatusFilter === 'PENDIENTE') {
            matchEstatus = isPendiente && !isTimbrada;
        } else if (estatusFilter === 'CANCELADA' || estatusFilter === 'CANCELADO') {
            matchEstatus = isCancelada;
        } else if (estatusFilter === 'ERROR') {
            matchEstatus = isError;
        } else {
            matchEstatus = (estatus === estatusFilter);
        }

        // 3. Filtro por Año y Mes
        const dObj = parseInvoiceDate(f);
        let matchYearMonth = true;
        if (dObj) {
            const invYear = dObj.getFullYear();
            const invMonth = dObj.getMonth() + 1;

            if (filterYear !== 'TODOS' && parseInt(filterYear, 10) !== invYear) {
                matchYearMonth = false;
            }
            if (filterMonth !== 'TODOS' && parseInt(filterMonth, 10) !== invMonth) {
                matchYearMonth = false;
            }
        } else {
            if (filterYear !== 'TODOS' || filterMonth !== 'TODOS') {
                matchYearMonth = false;
            }
        }

        // 4. Filtro por rango de fechas (si se especificó)
        let matchRange = true;
        if (dObj) {
            if (fromDateObj && dObj < fromDateObj) matchRange = false;
            if (toDateObj && dObj > toDateObj) matchRange = false;
        }

        return matchText && matchEstatus && matchYearMonth && matchRange;
    });
}

function filterReportTable() {
    const tbody = document.getElementById('tbody-report-invoices');
    if (!tbody) return;

    tbody.innerHTML = '';
    const filteredList = getFilteredInvoicesList();

    const facturaFolios = new Set((state.facturas || []).map(f => f.folioInterno || f.folio));
    const expedientesRestantes = (state.expedientes || []).filter(e => !facturaFolios.has(e.folio));
    const totalCount = (state.facturas || []).length + expedientesRestantes.length;

    filteredList.forEach(f => {
        const folio = f.folioInterno || f.folio || '';
        const uuid = f.uuid || f.cfdiUuid || '';
        const cliente = f.cliente || f.receptorNombre || '';
        const rfc = f.rfc || f.receptorRfc || '';
        const estatus = (f.estatus || (uuid ? 'TIMBRADA' : 'PENDIENTE')).toUpperCase();
        const total = parseFloat(f.importe || f.cfdiTotal || 0);

        const isTimbrada = estatus === 'TIMBRADA' || estatus === 'TIMBRADO' || Boolean(uuid);
        const isCancelada = estatus === 'CANCELADA' || estatus === 'CANCELADO';
        const badgeClass = isTimbrada ? 'badge-success' : (isCancelada ? 'badge-danger' : 'badge-info');
        const displayEstatus = isTimbrada ? 'TIMBRADA' : estatus;
        const facturamaId = f.facturamaId || '';
        // Identificador efectivo: prefiere facturamaId, cae a uuid como alternativa
        const effectiveId = facturamaId || uuid || '';

        const dObj = parseInvoiceDate(f);
        const fechaStr = dObj ? dObj.toLocaleDateString('es-MX') : (f.fecha || '—');

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight:700;color:#1B365D;">${folio}</td>
            <td style="font-family:monospace;font-size:0.75rem;color:#495057;">${uuid ? uuid.substring(0, 18) + '...' : '—'}</td>
            <td class="col-cliente">${cliente}</td>
            <td style="font-family:monospace;font-weight:600;">${rfc}</td>
            <td style="color:#6c757d;">${fechaStr}</td>
            <td style="text-align:right;font-weight:700;color:#1B365D;">$${total.toFixed(2)}</td>
            <td style="text-align:center;">
                <span class="badge ${badgeClass}">
                    <svg class="badge-icon" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
                    ${displayEstatus}
                </span>
            </td>
            <td style="text-align:center;">
                <div class="action-icon-group">
                    ${isTimbrada ? `
                        <button class="action-icon-btn btn-view" onclick="openPdfViewer('${effectiveId}')" title="Ver PDF" ${!effectiveId ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg></button>
                        <button class="action-icon-btn btn-dl-pdf" onclick="downloadFromFacturama('${effectiveId}', 'pdf')" title="Descargar PDF" ${!effectiveId ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg></button>
                        <button class="action-icon-btn btn-dl-xml" onclick="downloadFromFacturama('${effectiveId}', 'xml')" title="Descargar XML" ${!effectiveId ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg></button>
                        <button class="action-icon-btn btn-email" onclick="openEmailModal('${folio}', '${f.correo || ''}', '${cliente}')" title="Enviar por correo"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg></button>
                        <button class="action-icon-btn btn-delete" onclick="eliminarRegistro('${folio}', 'factura')" title="Eliminar factura" style="color:#e05252;"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                    ` : `
                        <button class="btn btn-primary" onclick="resumeFlowAtStep(4, '${folio}')" style="padding: 4px 10px; font-size: 0.72rem;">Timbrar</button>
                        <button class="action-icon-btn btn-delete" onclick="eliminarRegistro('${folio}', 'expediente')" title="Eliminar registro" style="color:#e05252;margin-left:4px;"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                    `}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    if (filteredList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-table-cell" style="text-align:center;padding:30px;color:#868e96;">No se encontraron facturas con los filtros seleccionados.</td></tr>';
    }

    const showingText = document.getElementById('showing-results-text');
    if (showingText) showingText.textContent = `Mostrando ${filteredList.length} de ${totalCount} facturas`;
}

async function eliminarRegistro(folio, tipo = 'factura') {
    if (!confirm(`¿Estás seguro de eliminar el registro ${folio}? Esta acción no se puede deshacer.`)) {
        return;
    }

    try {
        const endpoint = tipo === 'factura' ? `/api/facturas/${encodeURIComponent(folio)}` : `/api/expedientes/${encodeURIComponent(folio)}`;
        const res = await apiFetch(endpoint, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast(`✅ Registro ${folio} eliminado correctamente.`, 'success');
            state.facturas = (state.facturas || []).filter(f => f.folio !== folio && f.folioInterno !== folio && f.uuid !== folio);
            state.expedientes = (state.expedientes || []).filter(e => e.folio !== folio);
            renderCloudCollections();
        } else {
            showToast(`Error al eliminar: ${data.error || 'Desconocido'}`, 'error');
        }
    } catch (err) {
        showToast(`Error al eliminar: ${err.message}`, 'error');
    }
}

async function limpiarFacturasPrueba() {
    if (!confirm('¿Deseas vaciar el historial y eliminar TODAS las facturas y expedientes de prueba para comenzar desde cero?')) {
        return;
    }

    try {
        showToast('Vaciando registros de prueba...', 'info');
        const res = await apiFetch('/api/facturas/limpiar-falsas', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Historial vaciado al 100%. Sistema listo desde cero.', 'success');
            await initRenderDbSync();
        } else {
            showToast(`Error: ${data.error || 'No se pudo realizar la limpieza'}`, 'error');
        }
    } catch (err) {
        showToast(`Error al limpiar: ${err.message}`, 'error');
    }
}

function renderReportTable() {
    filterReportTable();
}


async function exportReportToExcel() {
    const estatus = document.getElementById('report-status-filter')?.value || 'TODOS';
    const anio = document.getElementById('report-filter-year')?.value || 'TODOS';
    const mes = document.getElementById('report-filter-month')?.value || 'TODOS';
    const desde = document.getElementById('report-date-from')?.value || '';
    const hasta = document.getElementById('report-date-to')?.value || '';
    const busqueda = document.getElementById('search-report')?.value || '';

    const mesesNombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    let filenameSuffix = '';
    if (anio !== 'TODOS') {
        filenameSuffix += `_${anio}`;
        if (mes !== 'TODOS') {
            filenameSuffix += `_${mesesNombres[parseInt(mes, 10) - 1] || mes}`;
        }
    } else {
        filenameSuffix += `_${new Date().toISOString().slice(0, 10)}`;
    }
    const finalFilename = `Reporte_Facturacion_COEPRISS${filenameSuffix}.xlsx`;

    showToast('Generando archivo Excel (.xlsx) con datos completos...', 'info');
    try {
        const token = getJwtToken();
        const params = new URLSearchParams();
        if (estatus) params.append('estatus', estatus);
        if (anio && anio !== 'TODOS') params.append('anio', anio);
        if (mes && mes !== 'TODOS') params.append('mes', mes);
        if (desde) params.append('desde', desde);
        if (hasta) params.append('hasta', hasta);
        if (busqueda) params.append('busqueda', busqueda);

        const res = await fetch(`/api/reportes/excel?${params.toString()}`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });

        if (res.ok) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = finalFilename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast(`✓ Archivo ${finalFilename} descargado exitosamente.`, 'success');
            addSecurityLog('Exportación Excel', `Reporte exportado con filtros: Año=${anio}, Mes=${mes}, Estatus=${estatus}, Búsqueda=${busqueda || 'Ninguna'}`);
            return;
        }
        throw new Error(`HTTP ${res.status}`);
    } catch (e) {
        console.warn('[EXCEL API FALLBACK]', e.message);
        generateClientSideExcel(finalFilename);
    }
}

function generateClientSideExcel(filename) {
    const filteredList = getFilteredInvoicesList();
    if (filteredList.length === 0) {
        showToast('No hay facturas que coincidan con los filtros seleccionados para exportar.', 'warning');
        return;
    }

    const rows = filteredList.map(f => {
        const folio = f.folioInterno || f.folio || '';
        const uuid = f.uuid || f.cfdiUuid || '';
        const total = parseFloat(f.importe || f.cfdiTotal || 0);
        const subtotal = f.cfdiSubtotal ? parseFloat(f.cfdiSubtotal) : parseFloat((total / 1.16).toFixed(2));
        const iva = f.cfdiIva ? parseFloat(f.cfdiIva) : parseFloat((total - subtotal).toFixed(2));
        const estatus = (f.estatus || (uuid ? 'TIMBRADA' : 'PENDIENTE')).toUpperCase();
        const isTimbrada = estatus === 'TIMBRADA' || estatus === 'TIMBRADO' || Boolean(uuid);

        const dObj = parseInvoiceDate(f);
        const fechaStr = dObj ? dObj.toLocaleString('es-MX') : (f.fecha || '');

        return {
            'Folio Interno': folio,
            'Folio Fiscal (UUID SAT)': uuid || 'Sin timbrar',
            'Fecha de Timbrado': isTimbrada ? fechaStr : 'Pendiente',
            'Fecha de Registro': fechaStr,
            'Estatus': isTimbrada ? 'TIMBRADA' : estatus,
            'RFC Receptor': (f.rfc || f.receptorRfc || '').toUpperCase(),
            'Nombre / Razón Social': f.cliente || f.receptorNombre || '',
            'Régimen Fiscal': f.regimenFiscal || f.receptorRegimenFiscal || '',
            'Código Postal': f.codigoPostal || f.receptorCodigoPostal || '',
            'Uso CFDI': f.usoCfdi || f.receptorUsoCfdi || 'G03',
            'Forma de Pago': f.formaPago || f.cfdiFormaPago || '03',
            'Método de Pago': f.metodoPago || f.cfdiMetodoPago || 'PUE',
            'Moneda': f.moneda || f.cfdiMoneda || 'MXN',
            'Concepto / Descripción': f.concepto || f.cfdiConcepto || '',
            'Subtotal ($ MXN)': Number(subtotal.toFixed(2)),
            'IVA 16% ($ MXN)': Number(iva.toFixed(2)),
            'Total ($ MXN)': Number(total.toFixed(2)),
            'Correo Receptor': f.correo || f.receptorEmail || '',
            'No. Certificado SAT': f.noCertificadoSat || f.cfdiNoCertificado || '',
            'ID Facturama': f.facturamaId || '',
            'Usuario que Registró': f.usuario || 'Sistema',
            'Banco': f.banco || f.pagoBanco || '',
            'Referencia de Pago': f.referencia || f.pagoReferencia || '',
            'Fecha de Pago': f.fechaRecibo || f.pagoFecha || ''
        };
    });

    if (typeof XLSX !== 'undefined') {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        const keys = Object.keys(rows[0] || {});
        ws['!cols'] = keys.map(k => {
            const maxVal = Math.max(k.length, ...rows.map(r => String(r[k] || '').length));
            return { wch: Math.min(Math.max(maxVal + 3, 12), 45) };
        });
        XLSX.utils.book_append_sheet(wb, ws, 'Historial Facturación');
        XLSX.writeFile(wb, filename);
        showToast(`✓ Archivo ${filename} descargado exitosamente.`, 'success');
    } else {
        let csv = '\uFEFF';
        const headers = Object.keys(rows[0]);
        csv += headers.map(h => `"${h}"`).join(',') + '\r\n';
        rows.forEach(r => {
            csv += headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',') + '\r\n';
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename.replace('.xlsx', '.csv');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(`✓ Reporte descargado exitosamente.`, 'success');
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

function renderProcesoTable() {
    const tbody = document.getElementById('tbody-proceso');
    if (!tbody) return;

    tbody.innerHTML = '';
    const inProcess = (state.expedientes || []).filter(e => e.estatus !== 'TIMBRADA' && e.estatus !== 'TIMBRADO' && e.estatus !== 'Entregado');
    
    if (inProcess.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#868e96; padding: 24px;">No hay solicitudes pendientes en proceso.</td></tr>`;
        return;
    }

    inProcess.forEach(e => {
        const tr = document.createElement('tr');
        const folio = e.folio || '—';
        const cliente = e.cliente || e.receptorNombre || '—';
        const fecha = e.fechaRecibo || (e.createdAt ? new Date(e.createdAt).toLocaleDateString('es-MX') : '—');
        const estatus = e.estatus || 'En proceso';

        let wizardStep = 1;
        if (estatus.includes('validado') || estatus.includes('Extracción')) wizardStep = 2;
        else if (estatus.includes('Autorizado') || estatus.includes('Vista')) wizardStep = 3;
        else if (estatus.includes('XML') || estatus.includes('Timbrado')) wizardStep = 4;

        tr.innerHTML = `
            <td style="font-weight:600; color:#1B365D;">${folio}</td>
            <td class="col-cliente">${cliente}</td>
            <td style="color:#6c757d;">${fecha}</td>
            <td>
                <span class="badge badge-info">
                    ${estatus}
                </span>
            </td>
            <td style="text-align: center;">
                <button class="btn btn-primary" onclick="resumeFlowAtStep(${wizardStep}, '${folio}')" style="padding: 5px 12px; font-size: 0.75rem;">Reanudar</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderCorreosTable() {
    const tbody = document.getElementById('tbody-correos');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (!state.historialCorreos || state.historialCorreos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-table-cell" style="text-align:center; padding:24px; color:#868e96;">No hay correos enviados en esta sesión.</td></tr>';
        return;
    }
    state.historialCorreos.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="color:#6c757d;">${c.fecha || (c.createdAt ? new Date(c.createdAt).toLocaleString('es-MX') : '—')}</td>
            <td style="font-weight:600; color:#0d6efd;">${c.destinatario || c.correoDestinatario || '—'}</td>
            <td class="col-folio">${c.folio || c.folioExpediente || '—'}</td>
            <td>${c.adjuntos || 'XML y PDF'}</td>
            <td style="text-align: center;">
                <span class="badge badge-success">
                    ${c.estatus || 'Enviado'}
                </span>
            </td>
            <td style="text-align: center;">
                <button class="btn btn-secondary" onclick="resendEmail('${c.destinatario || c.correoDestinatario || ''}', '${c.folio || c.folioExpediente || ''}')" style="padding: 4px 10px; font-size: 0.72rem;">Reenviar</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderBitacoraTable() {
    const tbody = document.getElementById('tbody-bitacora');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (!state.bitacoraSeguridad || state.bitacoraSeguridad.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-table-cell" style="text-align:center; padding:24px; color:#868e96;">Sin eventos de seguridad registrados.</td></tr>';
        return;
    }
    state.bitacoraSeguridad.forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="color: #6c757d;">${log.fecha || (log.createdAt ? new Date(log.createdAt).toLocaleString('es-MX') : '—')}</td>
            <td style="font-weight: 600;">${log.usuario || log.usuarioNombre || 'Sistema'}</td>
            <td><span class="badge badge-pending">${log.accion || log.action || 'Acción'}</span></td>
            <td style="color: #495057;">${log.detalles || '—'}</td>
        `;
        tbody.appendChild(tr);
    });
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

    state.maxStepUnlocked = 3;
    goToStep(3);
    showToast(`Iniciando factura para ${cliente.razonSocial}. Completa el importe y timbra.`, 'info');
}

// ─────────────────────────────────────────────
// 10. CONTROL DE FLUJO Y UTILIDADES GLOBALES
// ─────────────────────────────────────────────

function restartProcess() {
    state.activeExpediente = null;
    state.maxStepUnlocked = 1;
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
    // Limpiar elementos del visor PDF al cerrar
    if (modalId === 'modal-pdf-viewer') {
        const spinner = document.getElementById('pdf-viewer-spinner');
        if (spinner) spinner.remove();
        const inline = document.getElementById('pdf-viewer-inline');
        if (inline) inline.remove();
        const frame = document.getElementById('pdf-viewer-frame');
        if (frame) { frame.style.display = 'none'; frame.src = 'about:blank'; }
        if (_currentPdfViewerBlobUrl) {
            URL.revokeObjectURL(_currentPdfViewerBlobUrl);
            _currentPdfViewerBlobUrl = null;
        }
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

// ==========================================================================
// REAL-TIME CAMERA DOCUMENT SCANNER CONTROLLER (Apple Notes / CamScanner)
// ==========================================================================

const cameraState = {
    stream: null,
    videoTrack: null,
    animFrameId: null,
    facingMode: 'environment', // Start with back camera on mobile
    capturedCount: 0,
    lastCorners: null,
    lastCornersRaw: null,
    stableFramesCount: 0,
    isCapturing: false,
    autoCaptureCooldown: 0,
    torchOn: false,
    hasTorch: false,
    lastProcessTime: 0
};

async function openCameraScannerModal() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Tu navegador no permite acceso directo a la cámara. Usa el botón de Subir Archivos.', 'warning');
        return;
    }

    const modal = document.getElementById('modal-camera-scanner');
    if (!modal) return;

    modal.classList.add('open');
    cameraState.capturedCount = 0;
    cameraState.stableFramesCount = 0;
    cameraState.lastCorners = null;
    cameraState.isCapturing = false;
    cameraState.autoCaptureCooldown = Date.now() + 1000;

    const badge = document.getElementById('camera-badge-counter');
    if (badge) badge.textContent = `📄 0 capturados`;

    await startCameraStream(cameraState.facingMode);
}

function closeCameraScannerModal() {
    stopCameraStream();
    closeModal('modal-camera-scanner');
    renderDocumentList();
    if (cameraState.capturedCount > 0) {
        showToast(`📸 ${cameraState.capturedCount} documento(s) escaneado(s) exitosamente y agregado(s) al expediente.`, 'success');
    }
}

async function startCameraStream(facingMode = 'environment') {
    const video = document.getElementById('camera-scanner-video');
    if (!video) return;

    stopCameraStream(false);
    updateCameraHud('Iniciando sensor de cámara...', '#00e676', true);

    try {
        const constraints = {
            audio: false,
            video: {
                facingMode: { ideal: facingMode },
                width: { ideal: 1920, min: 1280 },
                height: { ideal: 1080, min: 720 }
            }
        };

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
            // Fallback for basic webcams or older devices
            stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: { facingMode: { ideal: facingMode } }
            });
        }

        cameraState.stream = stream;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');

        const tracks = stream.getVideoTracks();
        if (tracks.length > 0) {
            cameraState.videoTrack = tracks[0];
            checkCameraTorchSupport(cameraState.videoTrack);
        }

        video.onloadedmetadata = () => {
            video.play().then(() => {
                updateCameraHud('Apunta la cámara al documento (CFDI, Recibo o Pago)', '#00e676');
                startCameraDetectionLoop();
            }).catch(err => {
                console.warn('Error al reproducir stream de cámara:', err);
            });
        };
    } catch (error) {
        console.error('Error al acceder a la cámara:', error);
        updateCameraHud('No se pudo acceder a la cámara. Revisa los permisos.', '#e53935');
        showToast('No se pudo iniciar la cámara. Verifica que diste permisos en tu navegador.', 'error');
    }
}

function stopCameraStream(clearCanvas = true) {
    if (cameraState.animFrameId) {
        cancelAnimationFrame(cameraState.animFrameId);
        cameraState.animFrameId = null;
    }

    if (cameraState.stream) {
        cameraState.stream.getTracks().forEach(track => {
            try { track.stop(); } catch (e) {}
        });
        cameraState.stream = null;
    }

    cameraState.videoTrack = null;
    cameraState.torchOn = false;

    const video = document.getElementById('camera-scanner-video');
    if (video) video.srcObject = null;

    if (clearCanvas) {
        const canvas = document.getElementById('camera-scanner-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
}

function checkCameraTorchSupport(track) {
    const torchBtn = document.getElementById('btn-camera-torch');
    if (!torchBtn) return;

    if (track && typeof track.getCapabilities === 'function') {
        const capabilities = track.getCapabilities();
        if (capabilities.torch) {
            cameraState.hasTorch = true;
            torchBtn.style.display = 'inline-flex';
            return;
        }
    }
    cameraState.hasTorch = false;
    torchBtn.style.display = 'none';
}

async function toggleCameraTorch() {
    if (!cameraState.videoTrack || !cameraState.hasTorch) return;
    cameraState.torchOn = !cameraState.torchOn;
    try {
        await cameraState.videoTrack.applyConstraints({
            advanced: [{ torch: cameraState.torchOn }]
        });
        const torchBtn = document.getElementById('btn-camera-torch');
        if (torchBtn) {
            torchBtn.style.background = cameraState.torchOn ? '#C8A84B' : 'rgba(255, 255, 255, 0.12)';
            torchBtn.style.color = cameraState.torchOn ? '#0A2240' : '#ffffff';
        }
    } catch (e) {
        console.warn('No se pudo activar la linterna:', e);
    }
}

function flipCameraFacingMode() {
    cameraState.facingMode = cameraState.facingMode === 'environment' ? 'user' : 'environment';
    startCameraStream(cameraState.facingMode);
}

function updateCameraHud(text, dotColor = '#00e676', pulsing = false) {
    const textEl = document.getElementById('camera-hud-text');
    const dotEl = document.getElementById('camera-hud-dot');
    if (textEl) textEl.textContent = text;
    if (dotEl) {
        dotEl.style.backgroundColor = dotColor;
        dotEl.style.boxShadow = `0 0 10px ${dotColor}`;
        dotEl.style.animation = pulsing ? 'hud-pulse 1s infinite alternate' : 'none';
    }
}

// --------------------------------------------------------------------------
// Real-Time Frame Detection & Canvas Overlay Loop
// --------------------------------------------------------------------------

function startCameraDetectionLoop() {
    const video = document.getElementById('camera-scanner-video');
    const canvas = document.getElementById('camera-scanner-canvas');
    if (!video || !canvas) return;

    // Small off-screen canvas for high-performance brightness boundary analysis
    const analysisCanvas = document.createElement('canvas');
    const analysisCtx = analysisCanvas.getContext('2d', { willReadFrequently: true });

    const detectLoop = () => {
        if (!cameraState.stream || video.paused || video.ended) {
            return;
        }

        const now = Date.now();
        const vw = video.videoWidth;
        const vh = video.videoHeight;

        if (vw > 0 && vh > 0) {
            // Resize display canvas to match the exact rendered video viewport
            const rect = video.getBoundingClientRect();
            if (canvas.width !== Math.round(rect.width) || canvas.height !== Math.round(rect.height)) {
                canvas.width = Math.round(rect.width);
                canvas.height = Math.round(rect.height);
            }

            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Throttle heavy edge detection to ~160ms (approx 6 FPS detection rate)
            // while rendering the smooth overlay at 60 FPS
            if (now - cameraState.lastProcessTime > 160 && !cameraState.isCapturing) {
                cameraState.lastProcessTime = now;

                const aW = 360;
                const aH = Math.round(360 * (vh / vw));
                analysisCanvas.width = aW;
                analysisCanvas.height = aH;
                analysisCtx.drawImage(video, 0, 0, aW, aH);

                const bounds = estimateBrightDocumentBounds(analysisCanvas);

                if (bounds && (bounds.corners || (bounds.right - bounds.left > aW * 0.35 && bounds.bottom - bounds.top > aH * 0.35))) {
                    let corners = bounds.corners;
                    if (!corners) {
                        // Fallback rectangular corners from bounding box
                        corners = [
                            { x: bounds.left, y: bounds.top },
                            { x: bounds.right, y: bounds.top },
                            { x: bounds.right, y: bounds.bottom },
                            { x: bounds.left, y: bounds.bottom }
                        ];
                    }

                    // Save raw bounds mapped to video native resolution for high-res crop
                    cameraState.lastCornersRaw = corners.map(pt => ({
                        x: pt.x * (vw / aW),
                        y: pt.y * (vh / aH)
                    }));

                    // Map corners to display canvas coordinates
                    const displayCorners = corners.map(pt => ({
                        x: pt.x * (canvas.width / aW),
                        y: pt.y * (canvas.height / aH)
                    }));

                    // Check stability between frames
                    const isStable = checkCornersStability(displayCorners);

                    if (isStable) {
                        cameraState.stableFramesCount++;
                    } else {
                        cameraState.stableFramesCount = Math.max(0, cameraState.stableFramesCount - 1);
                    }

                    cameraState.lastCorners = displayCorners;

                    // Status resolution
                    const guideTarget = document.getElementById('camera-guide-target');
                    if (guideTarget) guideTarget.style.opacity = '0.15';

                    if (cameraState.stableFramesCount >= 5 && now > cameraState.autoCaptureCooldown) {
                        // Trigger Auto-Capture!
                        drawPolygonOverlay(ctx, displayCorners, '#00e676', true);
                        updateCameraHud('✨ ¡Documento detectado! Capturando...', '#00e676', true);
                        setShutterButtonActive(true);
                        triggerManualCameraCapture();
                        cameraState.autoCaptureCooldown = now + 2000;
                        cameraState.stableFramesCount = 0;
                    } else if (cameraState.stableFramesCount >= 2) {
                        drawPolygonOverlay(ctx, displayCorners, '#00e676', false);
                        updateCameraHud('📐 Mantén firme la cámara... auto-capturando', '#00e676');
                        setShutterButtonActive(true);
                    } else {
                        drawPolygonOverlay(ctx, displayCorners, '#ffeb3b', false);
                        updateCameraHud('📄 Ajustando bordes del documento...', '#ffeb3b');
                        setShutterButtonActive(false);
                    }
                } else {
                    cameraState.lastCorners = null;
                    cameraState.lastCornersRaw = null;
                    cameraState.stableFramesCount = 0;
                    setShutterButtonActive(false);

                    const guideTarget = document.getElementById('camera-guide-target');
                    if (guideTarget) guideTarget.style.opacity = '0.55';

                    updateCameraHud('Apunta la cámara al documento (CFDI, Recibo o Pago)', '#ffffff');
                }
            } else if (cameraState.lastCorners && !cameraState.isCapturing) {
                // Keep drawing current polygon smoothly between analysis ticks
                const color = cameraState.stableFramesCount >= 2 ? '#00e676' : '#ffeb3b';
                drawPolygonOverlay(ctx, cameraState.lastCorners, color, false);
            }
        }

        cameraState.animFrameId = requestAnimationFrame(detectLoop);
    };

    cameraState.animFrameId = requestAnimationFrame(detectLoop);
}

function checkCornersStability(newCorners) {
    if (!cameraState.lastCorners || !newCorners || newCorners.length !== 4) return false;
    let totalDist = 0;
    for (let i = 0; i < 4; i++) {
        const dx = newCorners[i].x - cameraState.lastCorners[i].x;
        const dy = newCorners[i].y - cameraState.lastCorners[i].y;
        totalDist += Math.sqrt((dx * dx) + (dy * dy));
    }
    const avgDist = totalDist / 4;
    return avgDist < 20; // Average displacement under 20 display pixels is considered stable
}

function drawPolygonOverlay(ctx, corners, color = '#00e676', isFlashing = false) {
    if (!corners || corners.length < 4) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) {
        ctx.lineTo(corners[i].x, corners[i].y);
    }
    ctx.closePath();

    // Semi-transparent glowing fill
    ctx.fillStyle = isFlashing ? 'rgba(0, 230, 118, 0.35)' : (color === '#00e676' ? 'rgba(0, 230, 118, 0.18)' : 'rgba(255, 235, 59, 0.12)');
    ctx.fill();

    // Glowing border line
    ctx.strokeStyle = color;
    ctx.lineWidth = isFlashing ? 4.5 : 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = isFlashing ? 16 : 8;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 4 Corner Anchor circles (Apple Notes document scanner style)
    corners.forEach(pt => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.stroke();
    });

    ctx.restore();
}

function setShutterButtonActive(active) {
    const btn = document.getElementById('btn-camera-shutter');
    if (!btn) return;
    if (active) {
        btn.classList.add('capturing-auto');
    } else {
        btn.classList.remove('capturing-auto');
    }
}

// --------------------------------------------------------------------------
// Audio & Visual Shutter Feedback
// --------------------------------------------------------------------------

function playCameraShutterSound() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.08);

        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.09);
    } catch (e) {
        // AudioContext silent fail is fine
    }
}

function triggerShutterFlash() {
    const flashEl = document.getElementById('camera-shutter-flash');
    if (!flashEl) return;
    flashEl.classList.add('flash');
    setTimeout(() => {
        flashEl.classList.remove('flash');
    }, 100);
}

// --------------------------------------------------------------------------
// High-Resolution Document Capture & Automatic Perspective Crop
// --------------------------------------------------------------------------

function triggerManualCameraCapture() {
    if (cameraState.isCapturing) return;
    captureDocumentFromCamera();
}

function captureDocumentFromCamera() {
    const video = document.getElementById('camera-scanner-video');
    if (!video || !cameraState.stream) return;

    cameraState.isCapturing = true;
    playCameraShutterSound();
    triggerShutterFlash();

    // Create high-res native frame canvas
    const vw = video.videoWidth || 1920;
    const vh = video.videoHeight || 1080;
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = vw;
    fullCanvas.height = vh;
    const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true });
    fullCtx.drawImage(video, 0, 0, vw, vh);

    // Apply Perspective Quad Warp if corners were detected
    let scannedCanvas;
    if (cameraState.lastCornersRaw && cameraState.lastCornersRaw.length === 4) {
        try {
            scannedCanvas = warpDocumentQuadrilateral(fullCanvas, cameraState.lastCornersRaw);
        } catch (e) {
            console.warn('Warp falló, usando recorte estándar:', e);
        }
    }

    if (!scannedCanvas) {
        scannedCanvas = createDocumentScanCanvas(fullCanvas);
    }

    if (!scannedCanvas) {
        scannedCanvas = fullCanvas;
    }

    // Convert scanned canvas to JPEG File
    scannedCanvas.toBlob(blob => {
        if (!blob) {
            cameraState.isCapturing = false;
            return;
        }

        const now = new Date();
        const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const fileName = `Escaneo_Camara_${dateStr}_pag${cameraState.capturedCount + 1}.jpg`;

        const file = new File([blob], fileName, { type: 'image/jpeg' });
        handleSelectedFiles([file]);

        cameraState.capturedCount++;
        const badge = document.getElementById('camera-badge-counter');
        if (badge) {
            badge.textContent = `📄 ${cameraState.capturedCount} capturado(s)`;
            badge.style.background = 'rgba(0, 230, 118, 0.25)';
            badge.style.borderColor = '#00e676';
        }

        updateCameraHud(`✅ ¡Documento ${cameraState.capturedCount} capturado! Apunta al siguiente o presiona Listo.`, '#00e676');

        setTimeout(() => {
            cameraState.isCapturing = false;
        }, 1200);
    }, 'image/jpeg', 0.94);
}

