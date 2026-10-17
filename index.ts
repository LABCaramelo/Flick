// Minimal Higgsfield SDK example: Seedance 2.5 text-to-video.
// Run with: npm run higgsfield:example   (billable generation)
//
// Credentials come from HF_CREDENTIALS ("key-id:key-secret") in .env.local,
// loaded at runtime and never printed.

import dotenv from 'dotenv';
import { config, higgsfield, NotEnoughCreditsError, ValidationError, AuthenticationError, TimeoutError, type V2Response } from '@higgsfield/client/v2';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });

if (!process.env.HF_CREDENTIALS) {
  console.error('HF_CREDENTIALS não definido. Adicione-o ao .env.local no formato key-id:key-secret.');
  process.exit(1);
}

config({
  credentials: process.env.HF_CREDENTIALS,
  // videos often take longer than the SDK's default 5 minute polling window
  maxPollTime: 20 * 60_000,
  pollInterval: 4000,
});

async function main(): Promise<number> {
  console.log('Enviando para bytedance/seedance-2.5/text-to-video…');
  let result: V2Response;
  try {
    result = await higgsfield.subscribe('bytedance/seedance-2.5/text-to-video', {
      input: {
        prompt: 'A cinematic scene at sunset',
        duration: 5,
        resolution: '720p',
        aspect_ratio: '16:9',
      },
      withPolling: true,
    });
  } catch (err) {
    if (err instanceof AuthenticationError) console.error('Credenciais inválidas (401).');
    else if (err instanceof NotEnoughCreditsError) console.error('Créditos insuficientes na conta Higgsfield (403).');
    else if (err instanceof ValidationError) console.error('Entrada rejeitada pelo modelo (422):', JSON.stringify(err.details ?? err.message));
    else if (err instanceof TimeoutError) console.error('Tempo esgotado aguardando a geração.');
    else console.error('Falha na requisição:', (err as Error).message);
    return 1;
  }

  const status = result.status as string;
  console.log(`request_id: ${result.request_id} · status: ${status}`);
  if (status === 'completed' && result.video?.url) {
    console.log(`Vídeo gerado: ${result.video.url}`);
    return 0;
  }
  if (status === 'nsfw') console.error('A geração foi bloqueada pela moderação de conteúdo (nsfw).');
  else if (status === 'failed') console.error('A geração falhou no Higgsfield.');
  else if (status === 'canceled' || status === 'cancelled') console.error('A geração foi cancelada.');
  else console.error(`Resposta sem vídeo (status "${status}").`);
  return 1;
}

main().then((code) => process.exit(code));
