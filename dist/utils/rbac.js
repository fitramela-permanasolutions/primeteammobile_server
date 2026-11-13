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
