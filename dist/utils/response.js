export function sendSuccess(res, data, message = 'Success', statusCode = 200) {
    const response = {
        success: true,
        message,
        data,
    };
    return res.status(statusCode).json(response);
}
export function sendError(res, message = 'An error occurred', statusCode = 400, errors) {
    const response = {
        success: false,
        message,
        errors,
    };
    return res.status(statusCode).json(response);
}
