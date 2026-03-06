const SUPABASE_URL = 'https://jwdcuzfraamktxyiihdc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_FeOAGvfWRGxM4IK5ud_QYg_rSrOIe0g';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ERROR_LOG_KEY = 'gymapp_error_log';
const ERROR_LOG_LIMIT = 40;

const PLAN_PRICING = {
    '1': 1000,
    '3': 2700,
    '6': 4800,
    '12': 8400
};

const PLAN_LABELS = {
    '1': '1 Month',
    '3': '3 Months',
    '6': '6 Months',
    '12': '1 Year'
};

let currentMembers = [];
let editingMemberIndex = null;

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

function formatRupees(amount) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(amount);
}

function getPlanAmount(planMonths) {
    return PLAN_PRICING[String(planMonths)] || 0;
}

function getPlanLabel(planMonths) {
    return PLAN_LABELS[String(planMonths)] || `${planMonths} Months`;
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

function calculateExpiry(startDate, months) {
    const date = new Date(startDate);
    date.setMonth(date.getMonth() + Number.parseInt(months, 10));
    return date.toISOString().split('T')[0];
}

function getTodayIsoDate() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
}

function clearMemberForm() {
    document.getElementById('memberId').value = '';
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
        const memberId = document.getElementById('memberId').value.trim().toUpperCase();
        const name = document.getElementById('fullName').value.trim();
        const phone = document.getElementById('phone').value.trim();
        const joinDate = document.getElementById('joinDate').value;
        const months = document.getElementById('plan').value;

        if (!memberId || !name || !phone || !joinDate || !months) {
            showToast('info', 'Missing Details', 'Please fill in all member fields.');
            return;
        }

        if (!/^[A-Z0-9-]{3,20}$/.test(memberId)) {
            showToast('error', 'Invalid Member ID', 'Use 3-20 characters: letters, numbers, or dash.');
            return;
        }

        if (!/^\d{10}$/.test(phone)) {
            showToast('error', 'Invalid Phone', 'Phone number must be exactly 10 digits.');
            return;
        }

        const duplicateMember = currentMembers.some((member) => String(member.member_id || '').toUpperCase() === memberId);
        if (duplicateMember) {
            showToast('error', 'Duplicate Member ID', 'This Member ID already exists. Use a unique ID.');
            return;
        }

        const expiryDate = calculateExpiry(joinDate, months);
        const payload = {
            member_id: memberId,
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

        showToast('success', 'Member Added', `${name} (${memberId}) has been registered.`);
        clearMemberForm();
        fetchMembers();
    } catch (error) {
        appLogger.error('Unexpected error while adding member', error);
        showToast('error', 'Unexpected Error', 'Could not add member right now.');
    }
}

function openEditMemberModal(index) {
    const member = currentMembers[index];
    if (!member) {
        showToast('error', 'Member Missing', 'Could not load this member record.');
        return;
    }

    editingMemberIndex = index;
    document.getElementById('editMemberId').value = member.member_id || 'N/A';
    document.getElementById('editPhone').value = member.phone_number || '';
    document.getElementById('editPlan').value = String(member.plan_months || '1');
    document.getElementById('editMemberModal').classList.remove('hidden');
}

function closeEditModal() {
    editingMemberIndex = null;
    document.getElementById('editMemberModal').classList.add('hidden');
}

async function saveMemberUpdates() {
    try {
        if (editingMemberIndex === null) {
            showToast('error', 'No Member Selected', 'Open a member before saving changes.');
            return;
        }

        const member = currentMembers[editingMemberIndex];
        if (!member) {
            showToast('error', 'Member Missing', 'Could not load this member record.');
            return;
        }

        const phone = document.getElementById('editPhone').value.trim();
        const planMonths = document.getElementById('editPlan').value;

        if (!/^\d{10}$/.test(phone)) {
            showToast('error', 'Invalid Phone', 'Phone number must be exactly 10 digits.');
            return;
        }

        const renewalStart = getTodayIsoDate();
        const newExpiry = calculateExpiry(renewalStart, planMonths);
        const updatePayload = {
            phone_number: phone,
            plan_months: planMonths,
            join_date: renewalStart,
            expiry_date: newExpiry
        };

        let query = supabaseClient.from('members').update(updatePayload);
        if (member.id !== undefined && member.id !== null) {
            query = query.eq('id', member.id);
        } else {
            query = query.eq('member_id', member.member_id);
        }

        const { error } = await query;

        if (error) {
            appLogger.warn('Update member failed', { reason: error.message, updatePayload, member });
            showToast('error', 'Update Failed', error.message);
            return;
        }

        closeEditModal();
        showToast('success', 'Member Updated', `${member.full_name} updated. Next billing: ${formatDate(newExpiry)}.`);
        fetchMembers();
    } catch (error) {
        appLogger.error('Unexpected error while updating member', error);
        showToast('error', 'Unexpected Error', 'Could not update member details right now.');
    }
}

async function fetchMembers() {
    try {
        const { data, error } = await supabaseClient
            .from('members')
            .select('*')
            .order('expiry_date', { ascending: true });

        if (error) {
            appLogger.warn('Fetch members failed', { reason: error.message });
            showToast('error', 'Load Failed', error.message);
            return;
        }

        const members = data || [];
        currentMembers = members;

        const tbody = document.getElementById('membersTableBody');
        updateStats(members);

        if (!members.length) {
            tbody.innerHTML = `
                <tr>
                    <td class="empty" colspan="7">No members added yet. Register your first member above.</td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = members.map((member, index) => {
            const memberId = escapeHtml(member.member_id || '-');
            const fullName = escapeHtml(member.full_name || 'Unknown');
            const phone = escapeHtml(member.phone_number || '-');
            const planMonths = String(member.plan_months || '1');
            const planLabel = escapeHtml(getPlanLabel(planMonths));
            const billAmount = formatRupees(getPlanAmount(planMonths));
            const expiryRaw = member.expiry_date || '-';
            const expiry = escapeHtml(formatDate(expiryRaw));

            return `
                <tr>
                    <td><strong>${memberId}</strong></td>
                    <td>${fullName}</td>
                    <td>${phone}</td>
                    <td><span class="plan-pill">${planLabel}</span></td>
                    <td>${billAmount}</td>
                    <td>${expiry}</td>
                    <td>
                        <div class="action-group">
                            <button class="btn-edit" onclick="openEditMemberModal(${index})">Edit</button>
                            <button class="btn-wa" onclick="sendBillForMember(${index})">WhatsApp Bill</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        appLogger.error('Unexpected error while fetching members', error);
        showToast('error', 'Unexpected Error', 'Could not load member list.');
    }
}

function sendBillForMember(index) {
    const member = currentMembers[index];
    if (!member) {
        showToast('error', 'Member Missing', 'Could not load this member record.');
        return;
    }

    const phone = String(member.phone_number || '').trim();
    if (!/^\d{10}$/.test(phone)) {
        showToast('error', 'Invalid Phone', 'This member has an invalid phone number.');
        return;
    }

    const planMonths = String(member.plan_months || '1');
    const amount = formatRupees(getPlanAmount(planMonths));
    const planName = getPlanLabel(planMonths);
    const nextBilling = formatDate(member.expiry_date || '-');
    const memberCode = member.member_id || '-';

    const msg = `Hi ${member.full_name}, payment of ${amount} received for ${planName} plan. Member ID: ${memberCode}. Next billing date: ${nextBilling}. Thank you for training with us!`;
    const url = `https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`;

    window.open(url, '_blank');
    showToast('info', 'WhatsApp Opened', `Billing message ready for ${member.full_name}.`);
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

document.getElementById('editMemberModal').addEventListener('click', (event) => {
    if (event.target.id === 'editMemberModal') {
        closeEditModal();
    }
});

window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        closeEditModal();
    }
});

checkUser();
