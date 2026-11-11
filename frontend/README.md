# React + TypeScript + Vite + Tailwind CSS

This template provides React 19, TypeScript 7, Vite 8, Tailwind CSS 4, HMR, and ESLint.

## Development

Use Node.js 22.13+ or 24+ (the supported ranges are `^22.13.0 || >=24.0.0`) and npm 11.17+. From this directory:

```sh
npm ci
npm run dev
```

Run `npm run build` for type checking and a production build, and `npm run lint` for ESLint.

The local `.npmrc` applies a 48-hour release cooldown to all new package resolutions, including transitive dependencies, with no exemptions. `npm ci` installs the reviewed lockfile without rechecking publication dates. See the root README for the dependency policy.

## TypeScript compiler and lint compatibility

`tsc` runs the latest stable TypeScript 7 compiler, installed with the `@typescript/native` npm alias. The `typescript` dependency aliases `@typescript/typescript6` because typescript-eslint still needs the TypeScript 6 JavaScript API. This follows the [TypeScript team's side-by-side installation guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0) and keeps linting compatible without bypassing peer dependency checks. `tsc6` is available for tools that explicitly need the older compiler.

## Tailwind CSS

Tailwind is configured through `@tailwindcss/vite` in `vite.config.ts`. Its theme and utilities are imported in `src/index.css`; use utility classes directly in JSX, for example:

```tsx
<div className="rounded-xl bg-violet-100 p-6 text-violet-950">
  Ready for Tailwind
</div>
```

The starter's existing CSS remains in place. [Preflight](https://tailwindcss.com/docs/preflight#disabling-preflight) is omitted to preserve its appearance. To enable Tailwind's base reset when replacing the starter design, replace the three Tailwind layer/import lines in `src/index.css` with `@import 'tailwindcss';`. Custom styles outside a CSS layer take precedence over layered utilities; put new base or component rules in `@layer base` or `@layer components` when utility classes should override them.

See the [Tailwind Vite installation guide](https://tailwindcss.com/docs/installation/using-vite) for details.

## React plugins

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
