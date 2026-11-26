// InwardsFlow — damage photo storage helpers.
//
// Photos live in the private `damage-photos` bucket (Phase 1 migration):
// RLS-scoped storage policies tie each path to a container the user can
// access. Path convention: <container_id>/<entry_id>/<timestamp>-<filename>.
// The tally entry stores the paths (damage_photo_urls); the UI resolves
// short-lived signed URLs on demand — never public URLs.
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

const BUCKET = 'damage-photos';

export async function uploadDamagePhotos(
  containerId: string,
  entryId: string,
  files: File[]
): Promise<{ paths: string[]; failures: number }> {
  const supabase = createBrowserSupabaseClient();
  const paths: string[] = [];
  let failures = 0;
  for (const file of files) {
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    const path = `${containerId}/${entryId}/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
    if (error) {
      failures += 1;
    } else {
      paths.push(path);
    }
  }
  return { paths, failures };
}

export async function getDamagePhotoSignedUrls(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (error || !data) return [];
  return data
    .map((d) => d.signedUrl)
    .filter((u): u is string => typeof u === 'string' && u.length > 0);
}
