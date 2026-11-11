/**
 * Jest configuration for the root project (CDK infrastructure, Lambda code and scripts).
 *
 * The frontend is a separate project and is excluded from this test run.
 */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { isolatedModules: true } }],
  },
  testMatch: ['**/?(*.)+(spec|test).ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  roots: ['<rootDir>/lib', '<rootDir>/src', '<rootDir>/test'],
  setupFiles: ['<rootDir>/test/setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/cdk.out/', '/frontend/'],
  modulePathIgnorePatterns: ['/cdk.out/', '/frontend/'],
};
