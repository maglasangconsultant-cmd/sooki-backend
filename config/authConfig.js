const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  throw new Error('JWT_SECRET environment variable is not set.');
}

export const JWT_SECRET = jwtSecret;
