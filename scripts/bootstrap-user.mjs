import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

process.loadEnvFile('.env');
if (!process.env.BOOTSTRAP_SECRET) throw new Error('Defina BOOTSTRAP_SECRET na .env.');
let muted = false;
const output = new Writable({
  write(chunk, _encoding, done) {
    if (!muted) process.stdout.write(chunk);
    done();
  },
});
const prompt = createInterface({ input: process.stdin, output, terminal: !!process.stdout.isTTY });
try {
  const email = (await prompt.question('E-mail do primeiro usuário: ')).trim();
  process.stdout.write('Senha (não será exibida): ');
  muted = true;
  const password = await prompt.question('');
  muted = false;
  process.stdout.write('\n');
  const response = await fetch(`${process.env.BOOTSTRAP_API_URL ?? 'http://127.0.0.1:3000'}/auth/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bootstrap-Secret': process.env.BOOTSTRAP_SECRET },
    body: JSON.stringify({ email, password }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? 'Falha ao criar usuário.');
  console.log(`Usuário ${result.email} criado. Faça login no frontend.`);
} finally {
  muted = false;
  prompt.close();
}
