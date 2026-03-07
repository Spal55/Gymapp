const SUPABASE_URL = 'https://jwdcuzfraamktxyiihdc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_FeOAGvfWRGxM4IK5ud_QYg_rSrOIe0g';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ERROR_LOG_KEY = 'gymapp_error_log';
const ERROR_LOG_LIMIT = 40;
const GYM_NAME = 'Fitness Point Reloaded 2.0';
const RECEIPT_PREFIX = 'FPR2';
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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
let paymentsByMemberKey = new Map();
let editingMemberIndex = null;
let paymentMemberIndex = null;
let historyMemberIndex = null;
let activePage = 'overview';
let memberSearchTerm = '';
let memberFilters = {
    dues: 'all',
    paid: 'all',
    plan: 'all',
    joinMonth: 'all',
    sort: 'member_id_asc'
};
let memberStatusColumnAvailable = true;
let paymentTableAvailable = true;
let paymentTableWarned = false;

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

function formatMonthYear(month, year) {
    const monthName = MONTH_NAMES[Number(month) - 1] || '-';
    return `${monthName} ${year}`;
}

function formatMonthYearFromDate(dateText) {
    const parsed = parseLocalDate(dateText);
    if (!parsed) return dateText;
    return new Intl.DateTimeFormat('en-IN', {
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

function getMonthlyCharge(planMonths) {
    const months = Number(planMonths) || 1;
    const total = getPlanAmount(planMonths);
    return Number((total / months).toFixed(2));
}

function parseLocalDate(dateText) {
    if (!dateText) return null;
    const value = `${dateText}T00:00:00`;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatIsoLocalDate(date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
}

function getMonthStartDate(dateText) {
    const parsed = parseLocalDate(dateText);
    if (!parsed) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
}

function getTodayIsoDate() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
}

function toMonthIndex(year, month) {
    return (Number(year) * 12) + (Number(month) - 1);
}

function getCurrentMonthIndex() {
    const now = new Date();
    return toMonthIndex(now.getFullYear(), now.getMonth() + 1);
}

function getMemberKey(member) {
    return String(member?.id || member?.member_id || '');
}

function isMemberActive(member) {
    if (memberStatusColumnAvailable && member?.is_active === false) return false;
    return true;
}

function getPaymentListForMember(member) {
    return paymentsByMemberKey.get(getMemberKey(member)) || [];
}

function getPaidMonthsBaseline(member) {
    const raw = member?.paid_months_baseline ?? member?.months_paid_till_now ?? 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getRequiredMonthsTillNow(member) {
    const joinDate = parseLocalDate(member.join_date);
    if (!joinDate) return 0;
    const joinMonthIndex = toMonthIndex(joinDate.getFullYear(), joinDate.getMonth() + 1);
    const nowMonthIndex = getCurrentMonthIndex();
    if (joinMonthIndex > nowMonthIndex) return 0;
    return (nowMonthIndex - joinMonthIndex) + 1;
}

function getMonthYearFromIndex(index) {
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    return { month, year };
}

function getCoverageKeys(startMonth, startYear, durationMonths) {
    const keys = [];
    const startIdx = toMonthIndex(startYear, startMonth);
    for (let i = 0; i < durationMonths; i += 1) {
        const { month, year } = getMonthYearFromIndex(startIdx + i);
        keys.push(`${year}-${String(month).padStart(2, '0')}`);
    }
    return keys;
}

function getCoverageRangeLabel(startMonth, startYear, durationMonths) {
    const start = formatMonthYear(startMonth, startYear);
    if (durationMonths <= 1) return start;
    const endIdx = toMonthIndex(startYear, startMonth) + durationMonths - 1;
    const end = getMonthYearFromIndex(endIdx);
    return `${start} to ${formatMonthYear(end.month, end.year)}`;
}

function getConfirmedMonthSet(member, includeFuture = false) {
    const set = new Set();
    const nowMonthIndex = getCurrentMonthIndex();

    for (const payment of getPaymentListForMember(member)) {
        const month = Number(payment.billing_month);
        const year = Number(payment.billing_year);
        const duration = Number(payment.plan_months_snapshot || 1);
        if (!month || !year) continue;
        const coverage = getCoverageKeys(month, year, duration);
        for (const key of coverage) {
            if (!includeFuture) {
                const [keyYear, keyMonth] = key.split('-').map(Number);
                const idx = toMonthIndex(keyYear, keyMonth);
                if (idx > nowMonthIndex) continue;
            }
            set.add(key);
        }
    }

    return set;
}

function getPaidMonthsTillNow(member) {
    return getPaidMonthsBaseline(member) + getConfirmedMonthSet(member).size;
}

function getDueMonths(member) {
    const required = getRequiredMonthsTillNow(member);
    const paid = getPaidMonthsTillNow(member);
    return Math.max(required - paid, 0);
}

function calculateExpiry(startDate, months) {
    const monthStart = getMonthStartDate(startDate);
    if (!monthStart) return startDate;
    const cycleMonths = Number.parseInt(months, 10) || 1;
    const expiry = new Date(monthStart.getFullYear(), monthStart.getMonth() + cycleMonths, 1);
    return formatIsoLocalDate(expiry);
}

function calculateExpiryFromBillingMonth(billingMonth, billingYear, durationMonths = 1) {
    const month = Number(billingMonth);
    const year = Number(billingYear);
    const duration = Number(durationMonths) || 1;
    const expiry = new Date(year, (month - 1) + duration, 1);
    return formatIsoLocalDate(expiry);
}

function clearMemberForm() {
    document.getElementById('memberId').value = '';
    document.getElementById('fullName').value = '';
    document.getElementById('phone').value = '';
    document.getElementById('joinDate').value = '';
    document.getElementById('plan').value = '1';
    document.getElementById('paidMonthsBaseline').value = '0';
    document.getElementById('memberStatus').value = 'active';
}

function updateStats(members) {
    const now = new Date();
    const inSevenDays = new Date();
    inSevenDays.setDate(now.getDate() + 7);

    const expiringSoon = members.filter((member) => {
        const expiry = new Date(member.expiry_date);
        return expiry >= now && expiry <= inSevenDays;
    }).length;

    const totalDueMonths = members.reduce((sum, member) => sum + getDueMonths(member), 0);

    const activeMembers = members.filter((member) => isMemberActive(member)).length;
    document.getElementById('activeCount').textContent = String(activeMembers);
    document.getElementById('expiringSoonCount').textContent = String(expiringSoon);
    document.getElementById('totalDueMonthsCount').textContent = String(totalDueMonths);
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
            switchPage('overview');
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

async function addMember() {
    try {
        const memberId = document.getElementById('memberId').value.trim().toUpperCase();
        const name = document.getElementById('fullName').value.trim();
        const phone = document.getElementById('phone').value.trim();
        const joinDate = document.getElementById('joinDate').value;
        const months = document.getElementById('plan').value;
        const paidBaseline = Number.parseInt(document.getElementById('paidMonthsBaseline').value, 10) || 0;
        const status = document.getElementById('memberStatus').value;

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

        if (paidBaseline < 0) {
            showToast('error', 'Invalid Baseline', 'Paid months baseline cannot be negative.');
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
            expiry_date: expiryDate,
            paid_months_baseline: paidBaseline
        };
        if (memberStatusColumnAvailable) payload.is_active = status !== 'inactive';

        let { error } = await supabaseClient.from('members').insert([payload]);
        if (error && memberStatusColumnAvailable && error.message.includes('is_active')) {
            memberStatusColumnAvailable = false;
            const fallbackPayload = { ...payload };
            delete fallbackPayload.is_active;
            error = (await supabaseClient.from('members').insert([fallbackPayload])).error;
            if (!error) showToast('info', 'Status Column Missing', 'Member added. Run SQL update to enable active/inactive status.');
        }

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
    document.getElementById('editPaidMonthsBaseline').value = String(getPaidMonthsBaseline(member));
    document.getElementById('editMemberStatus').value = isMemberActive(member) ? 'active' : 'inactive';
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
        const paidBaseline = Number.parseInt(document.getElementById('editPaidMonthsBaseline').value, 10) || 0;
        const status = document.getElementById('editMemberStatus').value;

        if (!/^\d{10}$/.test(phone)) {
            showToast('error', 'Invalid Phone', 'Phone number must be exactly 10 digits.');
            return;
        }

        if (paidBaseline < 0) {
            showToast('error', 'Invalid Baseline', 'Paid months baseline cannot be negative.');
            return;
        }

        const joinDate = member.join_date || getTodayIsoDate();
        const newExpiry = calculateExpiry(joinDate, planMonths);
        const updatePayload = {
            phone_number: phone,
            plan_months: planMonths,
            expiry_date: newExpiry,
            paid_months_baseline: paidBaseline
        };
        if (memberStatusColumnAvailable) updatePayload.is_active = status !== 'inactive';

        let query = supabaseClient.from('members').update(updatePayload);
        if (member.id !== undefined && member.id !== null) {
            query = query.eq('id', member.id);
        } else {
            query = query.eq('member_id', member.member_id);
        }

        let { error } = await query;
        if (error && memberStatusColumnAvailable && error.message.includes('is_active')) {
            memberStatusColumnAvailable = false;
            const fallbackPayload = { ...updatePayload };
            delete fallbackPayload.is_active;
            let fallbackQuery = supabaseClient.from('members').update(fallbackPayload);
            if (member.id !== undefined && member.id !== null) {
                fallbackQuery = fallbackQuery.eq('id', member.id);
            } else {
                fallbackQuery = fallbackQuery.eq('member_id', member.member_id);
            }
            error = (await fallbackQuery).error;
            if (!error) showToast('info', 'Status Column Missing', 'Member updated. Run SQL update to enable active/inactive status.');
        }

        if (error) {
            appLogger.warn('Update member failed', { reason: error.message, updatePayload, member });
            showToast('error', 'Update Failed', error.message);
            return;
        }

        closeEditModal();
        showToast('success', 'Member Updated', `${member.full_name} updated successfully.`);
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

        await fetchPaymentsForMembers(members);
        renderMembers();
    } catch (error) {
        appLogger.error('Unexpected error while fetching members', error);
        showToast('error', 'Unexpected Error', 'Could not load member list.');
    }
}

async function fetchPaymentsForMembers(members) {
    paymentsByMemberKey = new Map();

    if (!members.length) {
        paymentTableAvailable = true;
        return;
    }

    const memberIds = members.map((m) => m.id).filter(Boolean);
    const memberCodes = members.map((m) => m.member_id).filter(Boolean);

    if (!memberIds.length && !memberCodes.length) {
        paymentTableAvailable = false;
        return;
    }

    let data = null;
    let error = null;

    if (memberIds.length) {
        const response = await supabaseClient
            .from('member_payments')
            .select('*')
            .in('member_uuid', memberIds)
            .order('payment_date', { ascending: false })
            .order('created_at', { ascending: false });

        data = response.data;
        error = response.error;
    }

    if (error || !memberIds.length) {
        const fallback = await supabaseClient
            .from('member_payments')
            .select('*')
            .in('member_id', memberCodes)
            .order('payment_date', { ascending: false })
            .order('created_at', { ascending: false });

        data = fallback.data;
        error = fallback.error;
    }

    if (error) {
        paymentTableAvailable = false;
        appLogger.warn('Fetch payments failed', { reason: error.message });
        if (!paymentTableWarned) {
            showToast('info', 'Payment Table Missing', 'Run the new Supabase SQL to enable payment history and dues.');
            paymentTableWarned = true;
        }
        return;
    }

    paymentTableAvailable = true;
    for (const payment of data || []) {
        const key = String(payment.member_uuid || payment.member_id || '');
        if (!key) continue;
        if (!paymentsByMemberKey.has(key)) paymentsByMemberKey.set(key, []);
        paymentsByMemberKey.get(key).push(payment);
    }
}

function renderMembers() {
    const tbody = document.getElementById('membersTableBody');
    updateStats(currentMembers);
    const visibleMembers = currentMembers.filter((member) => {
        if (!memberSearchTerm) return true;
        const code = String(member.member_id || '').toLowerCase();
        return code.includes(memberSearchTerm);
    }).filter((member) => {
        const paidMonths = getPaidMonthsTillNow(member);
        const dueMonths = getDueMonths(member);
        const planMonths = String(member.plan_months || '');
        const joinDate = parseLocalDate(member.join_date);
        const joinMonth = joinDate ? String(joinDate.getMonth() + 1) : '';

        if (memberFilters.dues === 'due_only' && dueMonths <= 0) return false;
        if (memberFilters.dues === 'no_due' && dueMonths > 0) return false;

        if (memberFilters.paid === 'paid_only' && paidMonths <= 0) return false;
        if (memberFilters.paid === 'unpaid_only' && paidMonths > 0) return false;

        if (memberFilters.plan !== 'all' && planMonths !== memberFilters.plan) return false;
        if (memberFilters.joinMonth !== 'all' && joinMonth !== memberFilters.joinMonth) return false;
        return true;
    }).sort((a, b) => {
        if (memberFilters.sort === 'member_id_desc') {
            return String(b.member_id || '').localeCompare(String(a.member_id || ''), undefined, { numeric: true, sensitivity: 'base' });
        }
        if (memberFilters.sort === 'doj_asc') {
            const aTime = parseLocalDate(a.join_date)?.getTime() || 0;
            const bTime = parseLocalDate(b.join_date)?.getTime() || 0;
            return aTime - bTime;
        }
        if (memberFilters.sort === 'doj_desc') {
            const aTime = parseLocalDate(a.join_date)?.getTime() || 0;
            const bTime = parseLocalDate(b.join_date)?.getTime() || 0;
            return bTime - aTime;
        }
        return String(a.member_id || '').localeCompare(String(b.member_id || ''), undefined, { numeric: true, sensitivity: 'base' });
    });

    if (!visibleMembers.length) {
        tbody.innerHTML = `
            <tr>
                <td class="empty" colspan="10">${currentMembers.length ? 'No member matches current search/filter.' : 'No members added yet. Register your first member above.'}</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = visibleMembers.map((member) => {
        const index = currentMembers.findIndex((m) => getMemberKey(m) === getMemberKey(member));
        const memberId = escapeHtml(member.member_id || '-');
        const fullName = escapeHtml(member.full_name || 'Unknown');
        const phone = escapeHtml(member.phone_number || '-');
        const planMonths = String(member.plan_months || '1');
        const planLabel = escapeHtml(getPlanLabel(planMonths));
        const planBill = formatRupees(getPlanAmount(planMonths));
        const paidMonths = getPaidMonthsTillNow(member);
        const dueMonths = getDueMonths(member);
        const active = isMemberActive(member);
        const latestPayment = getLatestPayment(member);
        const billEnabled = Boolean(latestPayment);
        const dueEnabled = dueMonths > 0;

        return `
            <tr>
                <td><strong>${memberId}</strong></td>
                <td>${fullName}</td>
                <td>${phone}</td>
                <td><span class="plan-pill">${planLabel}</span></td>
                <td>${planBill}</td>
                <td><span class="stat-pill ${active ? 'good' : 'inactive'}">${active ? 'Active' : 'Inactive'}</span></td>
                <td><span class="stat-pill good">${paidMonths}</span></td>
                <td><span class="stat-pill ${dueMonths > 0 ? 'warn' : 'good'}">${dueMonths}</span></td>
                <td>${escapeHtml(formatMonthYearFromDate(member.expiry_date || '-'))}</td>
                <td>
                    <div class="action-group">
                        <button class="btn-edit" onclick="openEditMemberModal(${index})">Edit</button>
                        <button class="btn-pay" onclick="openPaymentModal(${index})">Confirm Pay</button>
                        <button class="btn-bill ${billEnabled ? '' : 'is-disabled'}" onclick="sendLatestBillForMember(${index})" ${billEnabled ? '' : 'disabled'}>Send Bill</button>
                        <button class="btn-pdf ${billEnabled ? '' : 'is-disabled'}" onclick="sendReceiptPdfForMember(${index})" ${billEnabled ? '' : 'disabled'}>PDF/Share</button>
                        <button class="btn-reminder ${dueEnabled ? '' : 'is-disabled'}" onclick="sendDueReminderForMember(${index})" ${dueEnabled ? '' : 'disabled'}>Due Reminder</button>
                        <button class="btn-history" onclick="openPaymentHistoryModal(${index})">History</button>
                        <button class="btn-status" onclick="toggleMemberStatus(${index})">${active ? 'Set Inactive' : 'Set Active'}</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function getLatestPayment(member) {
    const list = getPaymentListForMember(member);
    if (!list.length) return null;
    const sorted = list.slice().sort((a, b) => {
        const aDate = new Date(a.payment_date || a.created_at || 0).getTime();
        const bDate = new Date(b.payment_date || b.created_at || 0).getTime();
        return bDate - aDate;
    });
    return sorted[0];
}

function openPaymentModal(index) {
    const member = currentMembers[index];
    if (!member) {
        showToast('error', 'Member Missing', 'Could not load this member record.');
        return;
    }

    paymentMemberIndex = index;
    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();
    const planAmount = getPlanAmount(member.plan_months);

    const monthSelect = document.getElementById('paymentMonth');
    const yearSelect = document.getElementById('paymentYear');
    monthSelect.innerHTML = MONTH_NAMES.map((name, i) => `<option value="${i + 1}">${name}</option>`).join('');

    const joinDate = parseLocalDate(member.join_date) || today;
    const joinYear = joinDate.getFullYear();
    const yearOptions = [];
    for (let year = joinYear; year <= currentYear; year += 1) yearOptions.push(year);
    yearSelect.innerHTML = yearOptions.map((year) => `<option value="${year}">${year}</option>`).join('');

    document.getElementById('payMemberId').value = member.member_id || '-';
    document.getElementById('payMemberName').value = member.full_name || '-';
    document.getElementById('payAmount').value = formatRupees(planAmount);
    document.getElementById('paymentNotes').value = '';
    monthSelect.value = String(currentMonth);
    yearSelect.value = String(currentYear);

    refreshPaymentPreview();
    document.getElementById('paymentModal').classList.remove('hidden');
}

function closePaymentModal() {
    paymentMemberIndex = null;
    document.getElementById('paymentModal').classList.add('hidden');
}

function refreshPaymentPreview() {
    if (paymentMemberIndex === null) return;
    const member = currentMembers[paymentMemberIndex];
    if (!member) return;

    const selectedMonth = Number(document.getElementById('paymentMonth').value);
    const selectedYear = Number(document.getElementById('paymentYear').value);
    const summary = document.getElementById('paymentSummary');
    const duration = Number(member.plan_months || 1);
    const coverage = getCoverageKeys(selectedMonth, selectedYear, duration);
    const confirmedSet = getConfirmedMonthSet(member, true);
    const hasConflict = coverage.some((key) => confirmedSet.has(key));
    const dueMonthsBefore = getDueMonths(member);
    const rangeLabel = getCoverageRangeLabel(selectedMonth, selectedYear, duration);

    summary.textContent = `${rangeLabel} | Amount: ${formatRupees(getPlanAmount(member.plan_months))} | Due months before this payment: ${dueMonthsBefore}${hasConflict ? ' | Overlaps an existing paid period' : ''}`;
}

function getBaselineCoverageEndIndex(member) {
    const joinDate = parseLocalDate(member.join_date);
    if (!joinDate) return null;
    const baseline = getPaidMonthsBaseline(member);
    if (baseline <= 0) return null;
    const joinIdx = toMonthIndex(joinDate.getFullYear(), joinDate.getMonth() + 1);
    return joinIdx + baseline - 1;
}

function makeReceiptNumber(member, year, month) {
    const shortTs = String(Date.now()).slice(-6);
    const monthCode = `${year}${String(month).padStart(2, '0')}`;
    const memberCode = String(member.member_id || 'MEM')
        .replace(/[^A-Z0-9]/gi, '')
        .toUpperCase()
        .slice(0, 8) || 'MEM';
    return `${RECEIPT_PREFIX}-${monthCode}-${memberCode}-${shortTs}`;
}

function buildWhatsAppBillText(member, paymentInfo) {
    const duration = Number(paymentInfo.duration || member.plan_months || 1);
    const coverageRange = getCoverageRangeLabel(paymentInfo.month, paymentInfo.year, duration);
    const lines = [
        `${GYM_NAME} - Payment Receipt`,
        `Receipt No: ${paymentInfo.receiptNo}`,
        `Payment Date: ${formatDate(paymentInfo.paymentDate)}`,
        '',
        `Member: ${member.full_name}`,
        `Member ID: ${member.member_id}`,
        `Phone: ${member.phone_number}`,
        '',
        `Plan: ${getPlanLabel(member.plan_months)} (${formatRupees(getPlanAmount(member.plan_months))})`,
        `Coverage: ${coverageRange}`,
        `Amount Received: ${formatRupees(paymentInfo.amount)}`,
        `Expiry (Month/Year): ${formatMonthYearFromDate(paymentInfo.expiryDate || member.expiry_date || '-')}`,
        `Paid Months Till Now: ${paymentInfo.paidMonthsAfter}`,
        `Due Months Pending: ${paymentInfo.dueMonthsAfter}`,
        paymentInfo.notes ? `Notes: ${paymentInfo.notes}` : '',
        '',
        `Thank you for training with ${GYM_NAME}.`
    ];

    return lines.filter(Boolean).join('\n');
}

function buildDueReminderText(member) {
    const dueMonths = getDueMonths(member);
    const totalDue = getMonthlyCharge(member.plan_months) * dueMonths;
    return [
        `${GYM_NAME} - Payment Reminder`,
        `Hi ${member.full_name},`,
        `Your pending dues are ${dueMonths} month(s).`,
        `Plan: ${getPlanLabel(member.plan_months)} | Monthly Equivalent: ${formatRupees(getMonthlyCharge(member.plan_months))}`,
        `Approx. due amount: ${formatRupees(totalDue)}`,
        `Please visit the gym desk to clear dues.`,
        'Thank you.'
    ].join('\n');
}

async function confirmMonthlyPayment() {
    try {
        if (paymentMemberIndex === null) {
            showToast('error', 'No Member Selected', 'Open payment modal from member list.');
            return;
        }

        if (!paymentTableAvailable) {
            showToast('error', 'Payment Table Missing', 'Run Supabase SQL changes before confirming payments.');
            return;
        }

        const member = currentMembers[paymentMemberIndex];
        if (!member) {
            showToast('error', 'Member Missing', 'Could not load this member record.');
            return;
        }

        const selectedMonth = Number(document.getElementById('paymentMonth').value);
        const selectedYear = Number(document.getElementById('paymentYear').value);
        const notes = document.getElementById('paymentNotes').value.trim();
        const todayIso = getTodayIsoDate();
        const duration = Number(member.plan_months || 1);
        const amount = getPlanAmount(member.plan_months);

        const joinDate = parseLocalDate(member.join_date);
        if (!joinDate) {
            showToast('error', 'Join Date Missing', 'Member join date is invalid.');
            return;
        }

        const joinIndex = toMonthIndex(joinDate.getFullYear(), joinDate.getMonth() + 1);
        const selectedIndex = toMonthIndex(selectedYear, selectedMonth);
        const nowIndex = getCurrentMonthIndex();
        if (selectedIndex < joinIndex) {
            showToast('error', 'Invalid Month', 'Selected month is before the join date.');
            return;
        }
        if (selectedIndex > nowIndex) {
            showToast('error', 'Invalid Month', 'Future month payments are not allowed in this flow.');
            return;
        }

        const baselineCoverageEnd = getBaselineCoverageEndIndex(member);
        const coverageEndIndex = selectedIndex + duration - 1;
        if (baselineCoverageEnd !== null && selectedIndex <= baselineCoverageEnd) {
            showToast('error', 'Already Paid in Baseline', 'This month is already covered by baseline paid months.');
            return;
        }
        const confirmedSet = getConfirmedMonthSet(member, true);
        const coverageKeys = getCoverageKeys(selectedMonth, selectedYear, duration);
        if (coverageKeys.some((key) => confirmedSet.has(key))) {
            showToast('error', 'Duplicate Payment', 'Payment already confirmed for one or more months in this plan period.');
            return;
        }

        const receiptNo = makeReceiptNumber(member, selectedYear, selectedMonth);
        const newExpiry = calculateExpiryFromBillingMonth(selectedMonth, selectedYear, duration);
        const insertPayload = {
            member_uuid: member.id || null,
            member_id: member.member_id,
            billing_month: selectedMonth,
            billing_year: selectedYear,
            amount_paid: amount,
            payment_date: todayIso,
            receipt_no: receiptNo,
            plan_months_snapshot: duration,
            plan_amount_snapshot: getPlanAmount(member.plan_months),
            notes: notes || null
        };

        const { error } = await supabaseClient.from('member_payments').insert([insertPayload]);
        if (error) {
            appLogger.warn('Insert payment failed', { reason: error.message, insertPayload });
            showToast('error', 'Payment Save Failed', error.message);
            return;
        }

        let expiryUpdateQuery = supabaseClient.from('members').update({ expiry_date: newExpiry });
        if (member.id !== undefined && member.id !== null) {
            expiryUpdateQuery = expiryUpdateQuery.eq('id', member.id);
        } else {
            expiryUpdateQuery = expiryUpdateQuery.eq('member_id', member.member_id);
        }
        const { error: expiryError } = await expiryUpdateQuery;
        if (expiryError) {
            appLogger.warn('Expiry update after payment failed', { reason: expiryError.message, member, newExpiry });
            showToast('info', 'Payment Saved', 'Payment saved but expiry date update failed. Please retry edit/save.');
        }

        closePaymentModal();
        showToast('success', 'Payment Confirmed', `${member.full_name}: ${getCoverageRangeLabel(selectedMonth, selectedYear, duration)} marked as paid. Use Send Bill to share receipt.`);
        await fetchMembers();
    } catch (error) {
        appLogger.error('Unexpected error during payment confirmation', error);
        showToast('error', 'Unexpected Error', 'Could not confirm payment right now.');
    }
}

function sendLatestBillForMember(index) {
    const member = currentMembers[index];
    if (!member) {
        showToast('error', 'Member Missing', 'Could not load this member record.');
        return;
    }

    const latestPayment = getLatestPayment(member);
    if (!latestPayment) {
        showToast('info', 'No Receipt Yet', 'Confirm payment first, then Send Bill will be available.');
        return;
    }

    const billText = buildWhatsAppBillText(member, getReceiptPayload(member, latestPayment));

    sendWhatsAppText(member.phone_number, billText, member.full_name);
}

function getReceiptPayload(member, payment) {
    return {
        receiptNo: payment.receipt_no || '-',
        paymentDate: payment.payment_date || payment.created_at || getTodayIsoDate(),
        month: Number(payment.billing_month || 1),
        year: Number(payment.billing_year || new Date().getFullYear()),
        amount: Number(payment.amount_paid || getPlanAmount(member.plan_months)),
        duration: Number(payment.plan_months_snapshot || member.plan_months || 1),
        expiryDate: member.expiry_date,
        dueMonthsAfter: getDueMonths(member),
        paidMonthsAfter: getPaidMonthsTillNow(member),
        notes: payment.notes || ''
    };
}

function getReceiptPdfFileName(member, payload) {
    const memberCode = String(member.member_id || 'MEM')
        .replace(/[^A-Z0-9]/gi, '')
        .toUpperCase();
    const monthCode = `${payload.year}${String(payload.month).padStart(2, '0')}`;
    return `${memberCode || 'MEM'}_${monthCode}_receipt.pdf`;
}

function createReceiptPdfBlob(member, payload) {
    if (!window.jspdf || !window.jspdf.jsPDF) return null;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const lineGap = 22;
    let y = 48;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(GYM_NAME, 40, y);
    y += lineGap;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.text('Payment Receipt', 40, y);
    y += lineGap * 1.4;

    const lines = [
        `Receipt No: ${payload.receiptNo}`,
        `Payment Date: ${formatDate(payload.paymentDate)}`,
        `Member: ${member.full_name}`,
        `Member ID: ${member.member_id}`,
        `Phone: ${member.phone_number}`,
        `Plan: ${getPlanLabel(member.plan_months)} (${formatRupees(getPlanAmount(member.plan_months))})`,
        `Coverage: ${getCoverageRangeLabel(payload.month, payload.year, payload.duration)}`,
        `Amount Received: ${formatRupees(payload.amount)}`,
        `Expiry (Month/Year): ${formatMonthYearFromDate(payload.expiryDate || member.expiry_date || '-')}`,
        `Paid Months Till Now: ${payload.paidMonthsAfter}`,
        `Due Months Pending: ${payload.dueMonthsAfter}`,
        payload.notes ? `Notes: ${payload.notes}` : ''
    ].filter(Boolean);

    for (const line of lines) {
        doc.text(line, 40, y, { maxWidth: 510 });
        y += lineGap;
    }

    y += 8;
    doc.text(`Thank you for training with ${GYM_NAME}.`, 40, y);
    return doc.output('blob');
}

function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function sendReceiptPdfForMember(index) {
    try {
        const member = currentMembers[index];
        if (!member) {
            showToast('error', 'Member Missing', 'Could not load this member record.');
            return;
        }

        const latestPayment = getLatestPayment(member);
        if (!latestPayment) {
            showToast('info', 'No Receipt Yet', 'Confirm payment first, then PDF sharing will be available.');
            return;
        }

        const payload = getReceiptPayload(member, latestPayment);
        const blob = createReceiptPdfBlob(member, payload);
        if (!blob) {
            showToast('error', 'PDF Library Missing', 'PDF generator not available. Refresh and try again.');
            return;
        }

        const fileName = getReceiptPdfFileName(member, payload);
        const file = new File([blob], fileName, { type: 'application/pdf' });
        const canShareFiles = typeof navigator !== 'undefined'
            && typeof navigator.share === 'function'
            && typeof navigator.canShare === 'function'
            && navigator.canShare({ files: [file] });

        if (canShareFiles) {
            await navigator.share({
                title: `${GYM_NAME} Receipt`,
                text: `Receipt for ${member.full_name}`,
                files: [file]
            });
            showToast('success', 'PDF Shared', 'Receipt PDF shared. Choose WhatsApp from the share sheet.');
            return;
        }

        downloadBlob(blob, fileName);
        const text = `${buildWhatsAppBillText(member, payload)}\n\nPDF downloaded (${fileName}). Please attach it manually in WhatsApp.`;
        sendWhatsAppText(member.phone_number, text, member.full_name);
    } catch (error) {
        if (error?.name === 'AbortError') return;
        appLogger.error('Failed to generate/share PDF receipt', error);
        showToast('error', 'PDF Share Failed', 'Could not create or share PDF receipt.');
    }
}

function sendDueReminderForMember(index) {
    const member = currentMembers[index];
    if (!member) {
        showToast('error', 'Member Missing', 'Could not load this member record.');
        return;
    }

    const dueMonths = getDueMonths(member);
    if (dueMonths <= 0) {
        showToast('info', 'No Dues', `${member.full_name} has no pending dues.`);
        return;
    }

    const reminder = buildDueReminderText(member);
    sendWhatsAppText(member.phone_number, reminder, member.full_name);
}

function escapeCsvCell(value) {
    const text = String(value ?? '');
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
}

function downloadCsv(filename, headers, rows) {
    const lines = [headers.map(escapeCsvCell).join(',')];
    for (const row of rows) {
        lines.push(row.map(escapeCsvCell).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function exportMembersCsv() {
    if (!currentMembers.length) {
        showToast('info', 'No Data', 'No members available to export.');
        return;
    }

    const rows = currentMembers.map((member) => {
        const dueMonths = getDueMonths(member);
        const paidMonths = getPaidMonthsTillNow(member);
        return [
            member.member_id || '',
            member.full_name || '',
            member.phone_number || '',
            member.join_date || '',
            member.plan_months || '',
            getPlanAmount(member.plan_months),
            member.expiry_date || '',
            isMemberActive(member) ? 'Active' : 'Inactive',
            paidMonths,
            dueMonths
        ];
    });

    downloadCsv(
        `members_${getTodayIsoDate()}.csv`,
        ['member_id', 'full_name', 'phone_number', 'join_date', 'plan_months', 'plan_amount', 'expiry_date', 'status', 'paid_months_till_now', 'due_months'],
        rows
    );
    showToast('success', 'Export Ready', 'Members CSV downloaded.');
}

function exportPaymentsCsv() {
    const rows = [];
    for (const member of currentMembers) {
        const payments = getPaymentListForMember(member);
        for (const payment of payments) {
            rows.push([
                payment.receipt_no || '',
                member.member_id || payment.member_id || '',
                member.full_name || '',
                payment.billing_month || '',
                payment.billing_year || '',
                payment.plan_months_snapshot || '',
                payment.amount_paid || '',
                payment.payment_date || '',
                payment.notes || ''
            ]);
        }
    }

    if (!rows.length) {
        showToast('info', 'No Data', 'No payments available to export.');
        return;
    }

    downloadCsv(
        `payments_${getTodayIsoDate()}.csv`,
        ['receipt_no', 'member_id', 'member_name', 'billing_month', 'billing_year', 'plan_months_snapshot', 'amount_paid', 'payment_date', 'notes'],
        rows
    );
    showToast('success', 'Export Ready', 'Payments CSV downloaded.');
}

async function toggleMemberStatus(index) {
    try {
        const member = currentMembers[index];
        if (!member) {
            showToast('error', 'Member Missing', 'Could not load this member record.');
            return;
        }

        if (!memberStatusColumnAvailable) {
            showToast('error', 'Status Column Missing', 'Run Supabase SQL to enable active/inactive toggle.');
            return;
        }

        const nextStatus = !isMemberActive(member);
        let query = supabaseClient.from('members').update({ is_active: nextStatus });
        if (member.id !== undefined && member.id !== null) {
            query = query.eq('id', member.id);
        } else {
            query = query.eq('member_id', member.member_id);
        }

        const { error } = await query;
        if (error && error.message.includes('is_active')) {
            memberStatusColumnAvailable = false;
            showToast('error', 'Status Column Missing', 'Run Supabase SQL to enable active/inactive toggle.');
            return;
        }
        if (error) {
            appLogger.warn('Toggle member status failed', { reason: error.message, member });
            showToast('error', 'Status Update Failed', error.message);
            return;
        }

        showToast('success', 'Status Updated', `${member.full_name} is now ${nextStatus ? 'Active' : 'Inactive'}.`);
        await fetchMembers();
    } catch (error) {
        appLogger.error('Unexpected error while toggling member status', error);
        showToast('error', 'Unexpected Error', 'Could not update member status right now.');
    }
}

function switchPage(page) {
    activePage = page;
    const overview = document.getElementById('overviewPage');
    const members = document.getElementById('membersPage');
    const overviewBtn = document.getElementById('navOverview');
    const membersBtn = document.getElementById('navMembers');

    const isOverview = page === 'overview';
    overview.style.display = isOverview ? 'block' : 'none';
    members.style.display = isOverview ? 'none' : 'block';
    overviewBtn.classList.toggle('active', isOverview);
    membersBtn.classList.toggle('active', !isOverview);
}

function handleMemberSearch() {
    memberSearchTerm = String(document.getElementById('memberSearchInput').value || '').trim().toLowerCase();
    renderMembers();
}

function handleMembersFilterChange() {
    memberFilters = {
        dues: document.getElementById('filterDues').value,
        paid: document.getElementById('filterPaid').value,
        plan: document.getElementById('filterPlan').value,
        joinMonth: document.getElementById('filterJoinMonth').value,
        sort: document.getElementById('sortMembers').value
    };
    renderMembers();
}

function sendWhatsAppText(phone, text, memberName) {
    const normalized = String(phone || '').trim();
    if (!/^\d{10}$/.test(normalized)) {
        showToast('error', 'Invalid Phone', 'This member has an invalid phone number.');
        return;
    }

    const url = `https://wa.me/91${normalized}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
    showToast('info', 'WhatsApp Opened', `Receipt message prepared for ${memberName}.`);
}

function openPaymentHistoryModal(index) {
    const member = currentMembers[index];
    if (!member) {
        showToast('error', 'Member Missing', 'Could not load this member record.');
        return;
    }

    historyMemberIndex = index;
    document.getElementById('historyMemberTitle').textContent = `${member.full_name} (${member.member_id})`;

    const baseline = getPaidMonthsBaseline(member);
    const paid = getPaidMonthsTillNow(member);
    const due = getDueMonths(member);
    document.getElementById('historySummary').textContent = `Baseline paid months: ${baseline} | Total paid till now: ${paid} | Pending dues: ${due}`;

    const list = getPaymentListForMember(member).slice().sort((a, b) => {
        const aIdx = toMonthIndex(a.billing_year, a.billing_month);
        const bIdx = toMonthIndex(b.billing_year, b.billing_month);
        return bIdx - aIdx;
    });

    const body = document.getElementById('paymentHistoryBody');
    if (!list.length) {
        body.innerHTML = `
            <tr>
                <td class="empty" colspan="5">No confirmed month-wise payments yet.</td>
            </tr>
        `;
    } else {
        body.innerHTML = list.map((payment) => `
            <tr>
                <td>${escapeHtml(getCoverageRangeLabel(payment.billing_month, payment.billing_year, Number(payment.plan_months_snapshot || 1)))}</td>
                <td>${escapeHtml(formatDate(payment.payment_date || payment.created_at || '-'))}</td>
                <td>${escapeHtml(formatRupees(payment.amount_paid || 0))}</td>
                <td>${escapeHtml(payment.receipt_no || '-')}</td>
                <td>${escapeHtml(payment.notes || '-')}</td>
            </tr>
        `).join('');
    }

    document.getElementById('paymentHistoryModal').classList.remove('hidden');
}

function closePaymentHistoryModal() {
    historyMemberIndex = null;
    document.getElementById('paymentHistoryModal').classList.add('hidden');
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

document.getElementById('paymentMonth').addEventListener('change', refreshPaymentPreview);
document.getElementById('paymentYear').addEventListener('change', refreshPaymentPreview);
document.getElementById('memberSearchInput').addEventListener('input', handleMemberSearch);
document.getElementById('filterDues').addEventListener('change', handleMembersFilterChange);
document.getElementById('filterPaid').addEventListener('change', handleMembersFilterChange);
document.getElementById('filterPlan').addEventListener('change', handleMembersFilterChange);
document.getElementById('filterJoinMonth').addEventListener('change', handleMembersFilterChange);
document.getElementById('sortMembers').addEventListener('change', handleMembersFilterChange);

document.getElementById('editMemberModal').addEventListener('click', (event) => {
    if (event.target.id === 'editMemberModal') closeEditModal();
});

document.getElementById('paymentModal').addEventListener('click', (event) => {
    if (event.target.id === 'paymentModal') closePaymentModal();
});

document.getElementById('paymentHistoryModal').addEventListener('click', (event) => {
    if (event.target.id === 'paymentHistoryModal') closePaymentHistoryModal();
});

window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeEditModal();
    closePaymentModal();
    closePaymentHistoryModal();
});

checkUser();
