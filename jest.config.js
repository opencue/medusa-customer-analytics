module.exports = {
  transform: {
    "^.+\\.[jt]sx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", tsx: true, decorators: true },
          target: "es2022",
          transform: { react: { runtime: "automatic" } },
        },
      },
    ],
  },
  testEnvironment: "node",
  moduleFileExtensions: ["js", "jsx", "ts", "tsx", "json"],
  modulePathIgnorePatterns: ["dist/", "<rootDir>/.medusa/"],
  testMatch: ["**/src/**/__tests__/**/*.unit.spec.[jt]s"],
}
