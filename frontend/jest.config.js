const nextJest = require("next/jest");

const createJestConfig = nextJest({
  dir: "./",
});

/** @type {import('jest').Config} */
const customJestConfig = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testEnvironment: "jsdom",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^react-map-gl$": "<rootDir>/src/__mocks__/react-map-gl.js",
    "^react-map-gl/mapbox$": "<rootDir>/src/__mocks__/react-map-gl.js",
    "^mapbox-gl$": "<rootDir>/src/__mocks__/mapbox-gl.js",
    "^mapbox-gl/dist/mapbox-gl.css$": "<rootDir>/src/__mocks__/mapbox-gl-css.js",
  },
  testPathIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/.next/"],
  collectCoverageFrom: [
    "src/**/*.{js,jsx,ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/index.ts",
  ],
};

module.exports = createJestConfig(customJestConfig);
