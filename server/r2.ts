import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import {
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN,
  R2_BUCKET_NAME,
  R2_PUBLIC_DOMAIN,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
} from './config';

let s3Client: S3Client | null = null;

export function isR2Configured(): boolean {
  return Boolean(
    CLOUDFLARE_ACCOUNT_ID &&
    R2_BUCKET_NAME &&
    (CLOUDFLARE_API_TOKEN || (R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY))
  );
}

export function getR2Client(): S3Client | null {
  if (!CLOUDFLARE_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
  if (!s3Client) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3Client;
}

/**
 * Upload a buffer directly to the Cloudflare R2 bucket (`umcaracaramelo`).
 * Supports Cloudflare API Token (direct REST) or S3 Client.
 * Returns the public CDN URL (e.g. https://media.umcaracaramelo.com.br/claquete/...)
 */
export async function uploadBufferToR2(
  key: string,
  buffer: Buffer,
  contentType = 'application/octet-stream',
): Promise<{ url: string; key: string } | null> {
  if (!isR2Configured()) return null;

  // 1. Direct Cloudflare API upload via token
  if (CLOUDFLARE_API_TOKEN) {
    try {
      const endpoint = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${R2_BUCKET_NAME}/objects/${key}`;
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
          'Content-Type': contentType,
        },
        body: new Uint8Array(buffer),
      });
      if (res.ok) {
        const url = `${R2_PUBLIC_DOMAIN}/${key}`;
        return { url, key };
      }
      const errText = await res.text();
      console.warn(`[R2] Falha na API Cloudflare (${res.status}): ${errText}`);
    } catch (err) {
      console.warn(`[R2] Erro de rede ao enviar para API Cloudflare:`, (err as Error)?.message ?? err);
    }
  }

  // 2. S3 Client upload
  const client = getR2Client();
  if (client) {
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );
      const url = `${R2_PUBLIC_DOMAIN}/${key}`;
      return { url, key };
    } catch (err) {
      console.warn(`[R2] Falha no upload via S3 client (${key}):`, (err as Error)?.message ?? err);
    }
  }

  return null;
}

/**
 * Delete an object from Cloudflare R2.
 */
export async function deleteFromR2(key: string): Promise<boolean> {
  if (CLOUDFLARE_API_TOKEN) {
    try {
      const endpoint = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${R2_BUCKET_NAME}/objects/${key}`;
      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
      });
      if (res.ok) return true;
    } catch {
      // ignore
    }
  }

  const client = getR2Client();
  if (client) {
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: key,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Builds the canonical R2 storage key for a Claquete media file. */
export function buildR2Key(projectId: string, sub: string, filename: string): string {
  return `claquete/${projectId}/${sub}/${filename}`;
}
