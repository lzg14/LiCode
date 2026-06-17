export function checkPathPermission(path, permission) {
    if (permission.deniedPaths.some(dp => path.startsWith(dp))) {
        return false;
    }
    if (permission.allowedPaths.some(ap => path.startsWith(ap))) {
        return true;
    }
    return false;
}
