const SUPABASE_URL = 'https://jwdcuzfraamktxyiihdc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_FeOAGvfWRGxM4IK5ud_QYg_rSrOIe0g';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ERROR_LOG_KEY = 'gymapp_error_log';
const ERROR_LOG_LIMIT = 40;

const appLogger = {
    info(message, context = {}) {
        console.info(`[GymApp] ${message}`, context);
    },
    warn(message, context = {}) {
        console.warn(`[GymApp] ${message}`, context);
        persistError('warn', message, context);
    },
    error(message, error, context = {}) {
        const logPayload = {
            ...context,
            message: error?.message || String(error || ''),
            stack: error?.stack || null
        };
        console.error(`[GymApp] ${message}`, logPayload);
        persistError('error', message, logPayload);
    }
};

function persistError(level, message, context = {}) {
    try {
        const existing = JSON.parse(localStorage.getItem(ERROR_LOG_KEY) || '[]');
        existing.unshift({
            level,
            message,
            context,
            timestamp: new Date().toISOString()
        });
        localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(existing.slice(0, ERROR_LOG_LIMIT)));
    } catch (storageError) {
        console.warn('[GymApp] Failed to persist logs', storageError);
    }
}

function showToast(type, title, message) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('article');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <p class="toast-title">${escapeHtml(title)}</p>
        <p class="toast-message">${escapeHtml(message)}</p>
    `;
    container.appendChild(toast);

    window.setTimeout(() => {
        toast.classList.add('hide');
        window.setTimeout(() => toast.remove(), 280);
    }, 3400);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function formatDate(dateText) {
    const parsed = new Date(dateText);
    if (Number.isNaN(parsed.getTime())) return dateText;
    return new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    }).format(parsed);
}

async function handleLogin() {
    try {
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;

        if (!email || !password) {
            showToast('info', 'Login Required', 'Please enter email and password.');
            return;
        }

        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

        if (error) {
            appLogger.warn('Login failed', { email, reason: error.message });
            showToast('error', 'Login Failed', error.message);
            return;
        }

        showToast('success', 'Welcome', 'Signed in successfully.');
        checkUser();
    } catch (error) {
        appLogger.error('Unexpected error during login', error);
        showToast('error', 'Unexpected Error', 'Could not complete login. Please try again.');
    }
}

async function handleLogout() {
    try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) {
            appLogger.warn('Logout warning', { reason: error.message });
            showToast('error', 'Logout Failed', error.message);
            return;
        }

        showToast('info', 'Signed Out', 'You have been logged out.');
        checkUser();
    } catch (error) {
        appLogger.error('Unexpected error during logout', error);
        showToast('error', 'Unexpected Error', 'Could not log out right now.');
    }
}

async function checkUser() {
    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error) {
            appLogger.warn('Session check returned warning', { reason: error.message });
        }

        if (session) {
            document.getElementById('loginSection').style.display = 'none';
            document.getElementById('dashboardSection').style.display = 'block';
            fetchMembers();
        } else {
            document.getElementById('loginSection').style.display = 'flex';
            document.getElementById('dashboardSection').style.display = 'none';
        }
    } catch (error) {
        appLogger.error('Failed to check auth session', error);
        showToast('error', 'Session Error', 'Unable to verify login status.');
    }
}

function calculateExpiry(joinDate, months) {
    const date = new Date(joinDate);
    date.setMonth(date.getMonth() + Number.parseInt(months, 10));
    return date.toISOString().split('T')[0];
}

function clearMemberForm() {
    document.getElementById('fullName').value = '';
    document.getElementById('phone').value = '';
    document.getElementById('joinDate').value = '';
    document.getElementById('plan').value = '1';
}

function updateStats(members) {
    const now = new Date();
    const inSevenDays = new Date();
    inSevenDays.setDate(now.getDate() + 7);

    const expiringSoon = members.filter((member) => {
        const expiry = new Date(member.expiry_date);
        return expiry >= now && expiry <= inSevenDays;
    }).length;

    document.getElementById('activeCount').textContent = String(members.length);
    document.getElementById('expiringSoonCount').textContent = String(expiringSoon);
}

async function addMember() {
    try {
        const name = document.getElementById('fullName').value.trim();
        const phone = document.getElementById('phone').value.trim();
        const joinDate = document.getElementById('joinDate').value;
        const months = document.getElementById('plan').value;

        if (!name || !phone || !joinDate || !months) {
            showToast('info', 'Missing Details', 'Please fill in all member fields.');
            return;
        }

        if (!/^\d{10}$/.test(phone)) {
            showToast('error', 'Invalid Phone', 'Phone number must be exactly 10 digits.');
            return;
        }

        const expiryDate = calculateExpiry(joinDate, months);
        const payload = {
            full_name: name,
            phone_number: phone,
            join_date: joinDate,
            plan_months: months,
            expiry_date: expiryDate
        };

        const { error } = await supabaseClient.from('members').insert([payload]);

        if (error) {
            appLogger.warn('Add member failed', { reason: error.message, payload });
            showToast('error', 'Save Failed', error.message);
            return;
        }

        showToast('success', 'Member Added', `${name} has been registered successfully.`);
        clearMemberForm();
        fetchMembers();
    } catch (error) {
        appLogger.error('Unexpected error while adding member', error);
        showToast('error', 'Unexpected Error', 'Could not add member right now.');
    }
}

async function fetchMembers() {
    try {
        const { data, error } = await supabaseClient.from('members').select('*').order('expiry_date', { ascending: true });

        if (error) {
            appLogger.warn('Fetch members failed', { reason: error.message });
            showToast('error', 'Load Failed', error.message);
            return;
        }

        const members = data || [];
        const tbody = document.getElementById('membersTableBody');
        updateStats(members);

        if (!members.length) {
            tbody.innerHTML = `
                <tr>
                    <td class="empty" colspan="4">No members added yet. Register your first member above.</td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = members.map((member) => {
            const fullName = escapeHtml(member.full_name || 'Unknown');
            const phone = escapeHtml(member.phone_number || '-');
            const expiryRaw = member.expiry_date || '-';
            const expiry = escapeHtml(formatDate(expiryRaw));
            const safeName = JSON.stringify(member.full_name || '');
            const safePhone = JSON.stringify(member.phone_number || '');
            const safeExpiry = JSON.stringify(member.expiry_date || '');

            return `
                <tr>
                    <td><strong>${fullName}</strong></td>
                    <td>${phone}</td>
                    <td>${expiry}</td>
                    <td>
                        <button class="btn-wa" onclick="sendBill(${safePhone}, ${safeName}, ${safeExpiry})">
                            WhatsApp Bill
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        appLogger.error('Unexpected error while fetching members', error);
        showToast('error', 'Unexpected Error', 'Could not load member list.');
    }
}

function sendBill(phone, name, expiry) {
    const msg = `Hi ${name}, payment received! Your gym membership is active until ${expiry}. See you at the gym!`;
    const url = `https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
    showToast('info', 'WhatsApp Opened', `Billing message for ${name} is ready.`);
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then((reg) => appLogger.info('Service worker registered', { scope: reg.scope }))
            .catch((error) => appLogger.warn('Service worker registration failed', { reason: error.message }));
    });
}

window.addEventListener('error', (event) => {
    appLogger.error('Uncaught window error', event.error || new Error(event.message), {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
    });
    showToast('error', 'Application Error', 'Something went wrong. Please retry.');
});

window.addEventListener('unhandledrejection', (event) => {
    appLogger.error('Unhandled promise rejection', event.reason);
    showToast('error', 'Request Error', 'A request failed unexpectedly.');
});

checkUser();
