/** @type {import('jest').Config} */
// Stable weekday/hour assertions for pantry hours logic (matches device-local behavior under one TZ).
process.env.TZ = "UTC";

module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
};
