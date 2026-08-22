const backend = process.argv[2] === 'hyperframes' ? 'hyperframes' : 'remotion';
const mode = process.argv[3] === 'preview' ? 'preview' : 'final';

async function main() {
  const baseUrl = process.env.PICUT_APP_URL ?? 'http://localhost:3000';
  const response = await fetch(`${baseUrl}/api/projects/transformer-60s/render`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({backend, mode}),
  });
  const payload = await response.text();
  if (!response.ok) throw new Error(`Render API ${response.status}: ${payload}`);
  process.stdout.write(`${payload}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
