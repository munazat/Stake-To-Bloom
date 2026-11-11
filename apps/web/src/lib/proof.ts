/**
 * proof.ts — from a picked file to a judged proof.
 *
 * The browser's job is to make the image small and clean, not to judge it:
 *   - downscale to <= 1280 px on the long side (keeps the AI call fast and cheap)
 *   - re-encode as JPEG q0.8 on a canvas, which drops EXIF/GPS as a side effect
 *   - upload into the caller's own folder, then ask the server to judge it
 * The server re-checks everything (magic bytes, size, duplicates, ownership); a
 * tampered client gains nothing.
 */
import { ensureSession } from './session.ts'
import { supabase } from './supabase.ts'
import { submitProof, type ProofResult } from './api.ts'

export const MAX_LONG_SIDE = 1280
export const JPEG_QUALITY = 0.8
export const MAX_UPLOAD_BYTES = 2_621_440

export class ProofPrepareError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProofPrepareError'
  }
}

/** Scale (width, height) down so the long side is at most `max`; never scales up. */
export function fitWithin(
  width: number,
  height: number,
  max = MAX_LONG_SIDE,
): { width: number; height: number } {
  const long = Math.max(width, height)
  if (long <= max) return { width, height }
  const scale = max / long
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export async function sha256OfBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface PreparedProof {
  blob: Blob
  sha256: string
  width: number
  height: number
}

export async function prepareProof(file: Blob): Promise<PreparedProof> {
  if (!file.type.startsWith('image/') || /heic|heif/i.test(file.type)) {
    throw new ProofPrepareError('Please use a JPG or PNG image.')
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new ProofPrepareError('That image could not be read. Please use a JPG or PNG.')
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ProofPrepareError('This browser cannot process images.')
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    )
    if (!blob) throw new ProofPrepareError('Could not encode the image.')
    if (blob.size > MAX_UPLOAD_BYTES)
      throw new ProofPrepareError('That image is still over 2.5 MB after resizing.')
    return { blob, sha256: await sha256OfBlob(blob), width, height }
  } finally {
    bitmap.close()
  }
}

/** `<userId>/<pactId>/<dayIndex>-<uuid>.jpg` — the shape the bucket policy and server expect. */
export function proofStoragePath(
  userId: string,
  pactId: string,
  dayIndex: number,
  uuid: string,
): string {
  const day = Math.min(6, Math.max(0, Math.trunc(dayIndex)))
  return `${userId}/${pactId}/${day}-${uuid}.jpg`
}

/**
 * Upload, then submit. `dayIndex` only names the file: the server assigns the
 * day itself from its own clock and ignores this number.
 */
export async function uploadAndSubmit(
  pactId: string,
  dayIndex: number,
  prepared: PreparedProof,
): Promise<ProofResult> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const session = await ensureSession()
  const path = proofStoragePath(session.user.id, pactId, dayIndex, crypto.randomUUID())
  const { error } = await supabase.storage.from('proofs').upload(path, prepared.blob, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (error) throw new Error(`Upload failed: ${error.message}`)
  return submitProof(pactId, path)
}
