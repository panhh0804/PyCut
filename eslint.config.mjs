import {defineConfig, globalIgnores} from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Project-local Agent skills are vendored knowledge/reference packages, not
  // πCut application source. They are reviewed separately and loaded by Pi's
  // ResourceLoader, so their upstream examples must not inherit app lint rules.
  globalIgnores(['.next/**', 'node_modules/**', 'output/**', 'public/renders/**', '.picut/**', '.agents/**', '.pi/**']),
]);
