import nextConfig from "eslint-config-next";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextConfig,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  { ignores: [".next/**", "node_modules/**", "drizzle/**", "data/**", "next-env.d.ts", "relay/**", ".chrome-profile/**", "backups/**", "screenshots/**", "traces/**"] },
];

export default config;
