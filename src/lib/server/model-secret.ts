import 'server-only';

import {readFileSync} from 'node:fs';
import path from 'node:path';

// Bracket access is intentional: Next.js only needs the value at request
// runtime. Keeping it dynamic prevents build tools from substituting a local
// secret into server bundles or incremental compiler caches.
export function getModelApiKey() {
  const variableName = ['PICUT', 'MODEL', 'API', 'KEY'].join('_');
  const directValue = process.env[variableName]?.trim();
  if (directValue) return directValue;

  const fileVariableName = `${variableName}_FILE`;
  const configuredPath = process.env[fileVariableName]?.trim();
  if (!configuredPath) return undefined;
  try {
    const secretPath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(/* turbopackIgnore: true */ process.cwd(), configuredPath);
    return readFileSync(secretPath, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}
