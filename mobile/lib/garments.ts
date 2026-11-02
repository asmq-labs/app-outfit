import { useMutation, useQuery } from '@tanstack/react-query';
import { File, UploadType } from 'expo-file-system';

import { api, jsonBody } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { queryClient, REPORT_FAILURE } from '@/lib/query';
import { getAccessToken, useSession } from '@/lib/session';

export type GarmentStatus = 'processing' | 'ready' | 'failed';
export type GarmentCategory = 'top' | 'bottom' | 'one_piece' | 'outerwear' | 'shoes' | 'accessory';

export type Garment = {
  id: string;
  status: GarmentStatus;
  failure_reason: string | null;
  category: GarmentCategory | null;
  name: string | null;
  color: string | null;
  warmth: 'light' | 'medium' | 'warm' | null;
  formality: 'casual' | 'smart' | 'formal' | null;
  brand: string | null;
  size: string | null;
  notes: string | null;
  image_version: string | null;
  // Picked from the basics list, so there is no photo of the user's own.
  basic_key: string | null;
  wear_count: number;
  last_worn_at: string | null;
  created_at: string;
};

export type GarmentEdit = {
  name: string;
  category: GarmentCategory | null;
  warmth: Garment['warmth'];
  formality: Garment['formality'];
  brand: string;
  size: string;
  notes: string;
};

export const CATEGORY_OPTIONS = [
  { value: 'top', label: 'Parte de arriba' },
  { value: 'bottom', label: 'Parte de abajo' },
  { value: 'one_piece', label: 'Vestido o enterizo' },
  { value: 'outerwear', label: 'Chaqueta o abrigo' },
  { value: 'shoes', label: 'Zapatos' },
  { value: 'accessory', label: 'Accesorio' },
] as const;

export const WARMTH_OPTIONS = [
  { value: 'light', label: 'Ligero' },
  { value: 'medium', label: 'Medio' },
  { value: 'warm', label: 'Abrigado' },
] as const;

export const FORMALITY_OPTIONS = [
  { value: 'casual', label: 'Casual' },
  { value: 'smart', label: 'Elegante' },
  { value: 'formal', label: 'Formal' },
] as const;

const GARMENTS_KEY = ['garments'];
const PROCESSING_POLL_MS = 3000;

export function refreshGarments(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: GARMENTS_KEY });
}

export function useGarments() {
  return useQuery({
    queryKey: GARMENTS_KEY,
    queryFn: () => api<Garment[]>('/garments'),
    // Keep asking while the server is still cataloguing something.
    refetchInterval: (query) =>
      query.state.data?.some((garment) => garment.status === 'processing')
        ? PROCESSING_POLL_MS
        : false,
  });
}

export function useRetryGarment() {
  return useMutation({
    mutationFn: (id: string) => api<Garment>(`/garments/${id}/retry`, { method: 'POST' }),
    onSettled: refreshGarments,
    meta: REPORT_FAILURE,
  });
}

// A garment appears in outfits, saved combinations, the calendar and looks, so all of them reload.
function refreshAll(): Promise<void> {
  return queryClient.invalidateQueries();
}

export function useUpdateGarment() {
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: GarmentEdit }) =>
      api<Garment>(`/garments/${id}`, jsonBody('PATCH', changes)),
    onSettled: refreshAll,
  });
}

export function useDeleteGarment() {
  return useMutation({
    mutationFn: (id: string) => api<void>(`/garments/${id}`, { method: 'DELETE' }),
    onSettled: refreshAll,
    meta: REPORT_FAILURE,
  });
}

export type ImageSize = 'full' | 'thumb';

type ImageOptions = {
  variant?: 'catalog' | 'original';
  // Small spots (tiles, calendar, cards) load a light thumbnail instead of the full image.
  size?: ImageSize;
};

export function useGarmentImage(garment: Garment, { variant, size = 'full' }: ImageOptions = {}) {
  // Photos are private, so the image request carries the session token.
  const accessToken = useSession((state) => state.accessToken);
  const shown = variant ?? (garment.status === 'ready' ? 'catalog' : 'original');
  return {
    // The version changes when the image is replaced, so a cached copy is never shown.
    uri: `${API_URL}/v1/garments/${garment.id}/image?variant=${shown}&size=${size}&v=${garment.image_version}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  };
}

export async function uploadGarmentPhoto(uri: string): Promise<void> {
  const result = await new File(uri).upload(`${API_URL}/v1/garments`, {
    uploadType: UploadType.MULTIPART,
    fieldName: 'photo',
    mimeType: 'image/jpeg',
    headers: { Authorization: `Bearer ${await getAccessToken()}` },
  });
  if (result.status !== 202) throw new Error(`upload failed with ${result.status}`);
}
