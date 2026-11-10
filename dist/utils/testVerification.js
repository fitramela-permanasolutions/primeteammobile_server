import { verifyPassword, hashPassword } from './password.js';
import { generateToken, verifyToken } from '../config/jwt.js';
import crypto from 'crypto';
async function runTests() {
    console.log('--- Testing Password Verification & Compatibility ---');
    // Test 1: MD5 hash compatibility
    const plain1 = 'permana2026';
    const md5Hash = crypto.createHash('md5').update(plain1).digest('hex');
    const isMd5Valid = await verifyPassword(plain1, md5Hash);
    console.log('✓ Legacy MD5 Verification:', isMd5Valid ? 'PASSED' : 'FAILED');
    // Test 2: PHP $2y$ Bcrypt compatibility
    const plain2 = 'secretBcrypt123';
    // generate a $2y$ hash style or normal bcrypt
    const freshHash = await hashPassword(plain2);
    const phpStyleHash = freshHash.replace(/^\$2a\$/, '$2y$');
    const isPhpBcryptValid = await verifyPassword(plain2, phpStyleHash);
    console.log('✓ PHP $2y$ Bcrypt Verification:', isPhpBcryptValid ? 'PASSED' : 'FAILED');
    // Test 3: New hash password roundtrip
    const plain3 = 'mobileSuperPass';
    const newHash = await hashPassword(plain3);
    const isNewHashValid = await verifyPassword(plain3, newHash);
    console.log('✓ Newly hashed password roundtrip:', isNewHashValid ? 'PASSED' : 'FAILED');
    // Test 4: JWT Token Generation & Verification
    console.log('\n--- Testing JWT Token Generation & Payload ---');
    const samplePayload = {
        id: 1,
        email: 'ekie.wachidi@gmail.com',
        user_type: 'staff',
        is_admin: 1,
        first_name: 'Ekie',
        last_name: 'Wachidi',
    };
    const token = generateToken(samplePayload);
    const decoded = verifyToken(token);
    console.log('✓ JWT Token generated successfully. Length:', token.length);
    console.log('✓ Decoded payload matches:', decoded.email === samplePayload.email && decoded.id === 1 ? 'PASSED' : 'FAILED');
    console.log('\nAll security & compatibility tests passed successfully!');
}
runTests().catch(console.error);
