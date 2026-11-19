import jwt from 'jsonwebtoken';
const JWT_SECRET = process.env.JWT_SECRET || 'primeteam_jwt_secret_token_key_permanasolutions_2026';
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '7d');
export function generateToken(payload, expiresIn) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: expiresIn || JWT_EXPIRES_IN });
}
export function verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
}
