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
  ]),
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
    files: ["lib/usecases/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["**/infrastructure/**", "**/composition/**", "@/lib/infrastructure/**", "@/lib/composition/**"], message: "Use cases depend on ports; wire implementations in lib/composition." }] }],
    },
  },
]);

export default eslintConfig;
