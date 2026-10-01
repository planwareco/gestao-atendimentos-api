/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  globalSetup: '<rootDir>/tests/helpers/globalSetup.js',
  testTimeout: 30_000,
  clearMocks: true,
};
