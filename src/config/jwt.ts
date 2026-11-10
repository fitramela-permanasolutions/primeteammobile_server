import jwt, { SignOptions } from 'jsonwebtoken';
import { UserTokenPayload } from '../types/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'primeteam_jwt_secret_token_key_permanasolutions_2026';
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'];

export function generateToken(payload: UserTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): UserTokenPayload {
  return jwt.verify(token, JWT_SECRET) as UserTokenPayload;
}
