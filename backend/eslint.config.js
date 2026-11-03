import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["node_modules/**", "migrations/**", ".wrangler/**"],
  },
  ...tseslint.configs.recommended
);
