const SUPABASE_URL = 'https://jwdcuzfraamktxyiihdc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_FeOAGvfWRGxM4IK5ud_QYg_rSrOIe0g';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ERROR_LOG_KEY = 'gymapp_error_log';
const ERROR_LOG_LIMIT = 40;
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

function getConfirmedMonthSet(member) {
    const set = new Set();
    const nowMonthIndex = getCurrentMonthIndex();

    for (const payment of getPaymentListForMember(member)) {
        const month = Number(payment.billing_month);
        const year = Number(payment.billing_year);
        if (!month || !year) continue;
        const idx = toMonthIndex(year, month);
        if (idx > nowMonthIndex) continue;
        set.add(`${year}-${String(month).padStart(2, '0')}`);
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
    const date = new Date(startDate);
    date.setMonth(date.getMonth() + Number.parseInt(months, 10));
    return date.toISOString().split('T')[0];
}

function clearMemberForm() {
    document.getElementById('memberId').value = '';
    document.getElementById('fullName').value = '';
    document.getElementById('phone').value = '';
    document.getElementById('joinDate').value = '';
    document.getElementById('plan').value = '1';
    document.getElementById('paidMonthsBaseline').value = '0';
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

    document.getElementById('activeCount').textContent = String(members.length);
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
    document.getElementById('editPaidMonthsBaseline').value = String(getPaidMonthsBaseline(member));
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

    if (!currentMembers.length) {
        tbody.innerHTML = `
            <tr>
                <td class="empty" colspan="9">No members added yet. Register your first member above.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = currentMembers.map((member, index) => {
        const memberId = escapeHtml(member.member_id || '-');
        const fullName = escapeHtml(member.full_name || 'Unknown');
        const phone = escapeHtml(member.phone_number || '-');
        const planMonths = String(member.plan_months || '1');
        const planLabel = escapeHtml(getPlanLabel(planMonths));
        const monthlyBill = formatRupees(getMonthlyCharge(planMonths));
        const paidMonths = getPaidMonthsTillNow(member);
        const dueMonths = getDueMonths(member);

        return `
            <tr>
                <td><strong>${memberId}</strong></td>
                <td>${fullName}</td>
                <td>${phone}</td>
                <td><span class="plan-pill">${planLabel}</span></td>
                <td>${monthlyBill}</td>
                <td><span class="stat-pill good">${paidMonths}</span></td>
                <td><span class="stat-pill ${dueMonths > 0 ? 'warn' : 'good'}">${dueMonths}</span></td>
                <td>${escapeHtml(formatDate(member.expiry_date || '-'))}</td>
                <td>
                    <div class="action-group">
                        <button class="btn-edit" onclick="openEditMemberModal(${index})">Edit</button>
                        <button class="btn-pay" onclick="openPaymentModal(${index})">Confirm Pay</button>
                        <button class="btn-history" onclick="openPaymentHistoryModal(${index})">History</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
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
    const monthlyAmount = getMonthlyCharge(member.plan_months);

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
    document.getElementById('payAmount').value = formatRupees(monthlyAmount);
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
    const key = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
    const confirmed = getConfirmedMonthSet(member).has(key);
    const dueMonthsBefore = getDueMonths(member);

    summary.textContent = `${formatMonthYear(selectedMonth, selectedYear)} | Due months before this payment: ${dueMonthsBefore}${confirmed ? ' | Already confirmed' : ''}`;
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
    const memberCode = String(member.member_id || 'MEM').slice(0, 10);
    return `PF-${memberCode}-${monthCode}-${shortTs}`;
}

function buildWhatsAppBillText(member, paymentInfo) {
    const lines = [
        'PulseForge Gym - Payment Receipt',
        `Receipt No: ${paymentInfo.receiptNo}`,
        `Payment Date: ${formatDate(paymentInfo.paymentDate)}`,
        '',
        `Member: ${member.full_name}`,
        `Member ID: ${member.member_id}`,
        `Phone: ${member.phone_number}`,
        '',
        `Plan: ${getPlanLabel(member.plan_months)} (${formatRupees(getPlanAmount(member.plan_months))})`,
        `Billing Month: ${formatMonthYear(paymentInfo.month, paymentInfo.year)}`,
        `Amount Received: ${formatRupees(paymentInfo.amount)}`,
        `Paid Months Till Now: ${paymentInfo.paidMonthsAfter}`,
        `Due Months Pending: ${paymentInfo.dueMonthsAfter}`,
        paymentInfo.notes ? `Notes: ${paymentInfo.notes}` : '',
        '',
        'Thank you for training with us.'
    ];

    return lines.filter(Boolean).join('\n');
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
        const amount = getMonthlyCharge(member.plan_months);

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
        if (baselineCoverageEnd !== null && selectedIndex <= baselineCoverageEnd) {
            showToast('error', 'Already Paid in Baseline', 'This month is already covered by baseline paid months.');
            return;
        }

        const monthKey = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
        if (getConfirmedMonthSet(member).has(monthKey)) {
            showToast('error', 'Duplicate Payment', 'Payment already confirmed for this month.');
            return;
        }

        const receiptNo = makeReceiptNumber(member, selectedYear, selectedMonth);
        const insertPayload = {
            member_uuid: member.id || null,
            member_id: member.member_id,
            billing_month: selectedMonth,
            billing_year: selectedYear,
            amount_paid: amount,
            payment_date: todayIso,
            receipt_no: receiptNo,
            plan_months_snapshot: Number(member.plan_months || 1),
            plan_amount_snapshot: getPlanAmount(member.plan_months),
            notes: notes || null
        };

        const { error } = await supabaseClient.from('member_payments').insert([insertPayload]);
        if (error) {
            appLogger.warn('Insert payment failed', { reason: error.message, insertPayload });
            showToast('error', 'Payment Save Failed', error.message);
            return;
        }

        const duesAfter = Math.max(getDueMonths(member) - 1, 0);
        const paidAfter = getPaidMonthsTillNow(member) + 1;
        const billText = buildWhatsAppBillText(member, {
            receiptNo,
            paymentDate: todayIso,
            month: selectedMonth,
            year: selectedYear,
            amount,
            dueMonthsAfter: duesAfter,
            paidMonthsAfter: paidAfter,
            notes
        });

        closePaymentModal();
        showToast('success', 'Payment Confirmed', `${member.full_name}: ${formatMonthYear(selectedMonth, selectedYear)} marked as paid.`);
        sendWhatsAppText(member.phone_number, billText, member.full_name);
        await fetchMembers();
    } catch (error) {
        appLogger.error('Unexpected error during payment confirmation', error);
        showToast('error', 'Unexpected Error', 'Could not confirm payment right now.');
    }
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
                <td>${escapeHtml(formatMonthYear(payment.billing_month, payment.billing_year))}</td>
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
