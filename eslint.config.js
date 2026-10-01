import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(...tseslint.configs.recommended, {
  files: ["src/**/*.ts"],
  languageOptions: {
    globals: globals.node,
  },
  rules: {
    "no-eval": "error",
    "no-new-func": "error",
    "no-implied-eval": "error",
    "@typescript-eslint/no-explicit-any": "warn",
  },
});
