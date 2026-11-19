const ADMIN_ROLE_REGEX = /(super\s*[-_]*\s*(duper\s*[-_]*\s*)?admin|administrator|\badmin\b)/i;
export function isAdminOrSuperAdmin(user) {
    if (!user)
        return false;
    // Check explicit is_admin flag from permana_users
    if (user.is_admin === true || user.is_admin === 1 || user.is_admin === '1') {
        return true;
    }
    // Check role_title (from permana_roles), role, user_type, and job_title case-insensitively
    const candidates = [user.role_title, user.role, user.user_type]
        .filter((val) => typeof val === 'string' && val.trim().length > 0)
        .map((val) => val.trim());
    if (candidates.some((c) => ADMIN_ROLE_REGEX.test(c))) {
        return true;
    }
    // For staff users without a non-admin custom role, also check job_title if it explicitly says Admin/Superadmin
    if ((!user.user_type || String(user.user_type).toLowerCase() === 'staff') &&
        typeof user.job_title === 'string' &&
        ADMIN_ROLE_REGEX.test(user.job_title.trim())) {
        return true;
    }
    return false;
}
export function resolveUserRoleTitle(user) {
    if (!user)
        return 'Staff';
    const rawRoleTitle = typeof user.role_title === 'string' ? user.role_title.trim() : '';
    if (rawRoleTitle) {
        return rawRoleTitle;
    }
    if (user.is_admin === true || user.is_admin === 1 || user.is_admin === '1') {
        return 'Admin';
    }
    if (typeof user.role === 'string' && user.role.trim()) {
        return user.role.trim();
    }
    if (String(user.user_type || '').toLowerCase() === 'client') {
        return 'Client';
    }
    return 'Staff';
}
const CLIENT_ROLE_REGEX = /client/i;
const PIC_ROLE_REGEX = /\bpic\b|person\s+in\s+charge|pic[\s_-]/i;
/**
 * Case-insensitive check for Client role (Read-Only inside assigned projects).
 * Never treats Admin/Superadmin as Client.
 */
export function isClientRole(user) {
    if (!user)
        return false;
    if (isAdminOrSuperAdmin(user))
        return false;
    const candidates = [user.role_title, user.role, user.user_type]
        .filter((val) => typeof val === 'string' && val.trim().length > 0)
        .map((val) => val.trim());
    return candidates.some((c) => CLIENT_ROLE_REGEX.test(c));
}
/**
 * Case-insensitive check for PIC role (full write/edit/delete inside assigned projects).
 */
export function isPicRole(user) {
    if (!user)
        return false;
    if (isAdminOrSuperAdmin(user))
        return true;
    const candidates = [user.role_title, user.role, user.job_title]
        .filter((val) => typeof val === 'string' && val.trim().length > 0)
        .map((val) => val.trim());
    return candidates.some((c) => PIC_ROLE_REGEX.test(c) || c.toLowerCase().includes('pic'));
}
export function canWriteInProject(user) {
    if (!user)
        return false;
    return !isClientRole(user);
}
export function canManageChecklistItem(user) {
    if (!user)
        return false;
    return isAdminOrSuperAdmin(user) || isPicRole(user);
}
