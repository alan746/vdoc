import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Archived acceptance evidence (old source snapshots, captured scripts).
    // Already excluded from vitest and tsconfig; it is not live code.
    "tests/fixtures/**",
  ]),
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      // A leading underscore marks an intentionally unused binding (callback parameters, destructured omissions).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
      // React Compiler readiness rules. The compiler is not enabled, and the editor relies on the
      // "latest ref" pattern for IME/autosave safety; keep these visible as warnings until the UI
      // refactor (Q-cell2/vdoc#1) migrates those components.
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/globals": "warn",
    },
  },
  {
    // CommonJS QA scripts legitimately use require().
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Layer boundaries in lib/: domain <- usecases <- (editor, infrastructure) <- composition.
  // Use cases reach storage and file formats only through ports in lib/usecases/ports.ts.
  {
    files: ["lib/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["**/editor/**", "**/infrastructure/**", "**/usecases/**", "**/composition/**", "@/lib/editor/**", "@/lib/infrastructure/**", "@/lib/usecases/**", "@/lib/composition/**"], message: "lib/domain must not depend on outer layers." }] }],
    },
  },
  {
    // UI reaches storage only through the repositories in lib/composition (Q-cell2/vdoc#2).
    files: ["components/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["**/infrastructure/persistence/**", "@/lib/infrastructure/persistence/**"], message: "Use the repositories from @/lib/composition/repositories." }] }],
    },
  },
  {
    files: ["lib/usecases/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["**/infrastructure/**", "**/composition/**", "@/lib/infrastructure/**", "@/lib/composition/**"], message: "Use cases depend on ports; wire implementations in lib/composition." }] }],
    },
  },
]);

export default eslintConfig;
