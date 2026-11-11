/**
 * Jest configuration for the root (CDK infrastructure) project.
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
  roots: ['<rootDir>/bin', '<rootDir>/lib', '<rootDir>/src', '<rootDir>/config'],
  testPathIgnorePatterns: ['/node_modules/', '/cdk.out/', '/frontend/', '/dist/'],
  modulePathIgnorePatterns: ['/cdk.out/', '/frontend/', '/dist/'],
  moduleNameMapper: {
    '^@config$': '<rootDir>/config/index.ts',
    '^@config/(.*)$': '<rootDir>/config/$1',
    '^@constructs$': '<rootDir>/lib/constructs/index.ts',
    '^@constructs/(.*)$': '<rootDir>/lib/constructs/$1',
    '^@shared$': '<rootDir>/src/shared/index.ts',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
  },
  passWithNoTests: true,
};
