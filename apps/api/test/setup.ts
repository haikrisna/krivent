import { randomBytes } from 'node:crypto';
// Ephemeral test-only secret; never a production fallback.
process.env.AUTH_JWT_SECRET = randomBytes(32).toString('hex');
