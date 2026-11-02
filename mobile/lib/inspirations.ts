import { useMutation, useQuery } from '@tanstack/react-query';
import { File, UploadType } from 'expo-file-system';

import { api } from '@/lib/api';
import { API_URL } from '@/lib/config';
import type { Garment, GarmentCategory, ImageSize } from '@/lib/garments';
import type { Coords } from '@/lib/location';
import { coordsQuery, localDay, type Outfit, todayKey, useOccasion } from '@/lib/outfits';
import { queryClient, REPORT_FAILURE } from '@/lib/query';
import { getAccessToken, useSession } from '@/lib/session';
import { compressPhoto } from '@/lib/upload-queue';

export type Inspiration = {
  id: string;
  status: 'processing' | 'ready' | 'failed';
  failure_reason: string | null;
  garments: Record<GarmentCategory, Garment | null>;
  missing: { category: GarmentCategory; name: string }[];
  explanation: string | null;
  created_at: string;
};

const INSPIRATIONS_KEY = ['inspirations'];
const PROCESSING_POLL_MS = 2000;

function refreshInspirations(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: INSPIRATIONS_KEY });
}

export function useInspirations() {
  return useQuery({
    queryKey: INSPIRATIONS_KEY,
    queryFn: () => api<Inspiration[]>('/inspirations'),
    // Keep asking while a look is still being matched with the closet.
    refetchInterval: (query) =>
      query.state.data?.some((item) => item.status === 'processing') ? PROCESSING_POLL_MS : false,
  });
}

export function useInspirationImage(inspiration: Inspiration, size: ImageSize = 'full') {
  const accessToken = useSession((state) => state.accessToken);
  return {
    uri: `${API_URL}/v1/inspirations/${inspiration.id}/image?size=${size}`,
    headers: { Authorization: `Bearer ${accessToken}` },
  };
}

async function uploadLook(uri: string): Promise<Inspiration> {
  const result = await new File(await compressPhoto(uri)).upload(`${API_URL}/v1/inspirations`, {
    uploadType: UploadType.MULTIPART,
    fieldName: 'photo',
    mimeType: 'image/jpeg',
    headers: { Authorization: `Bearer ${await getAccessToken()}` },
  });
  if (result.status !== 202) throw new Error(`upload failed with ${result.status}`);
  return JSON.parse(result.body) as Inspiration;
}

export function useUploadLook() {
  return useMutation({ mutationFn: uploadLook, onSettled: refreshInspirations });
}

export function useDeleteInspiration() {
  return useMutation({
    mutationFn: (id: string) => api<void>(`/inspirations/${id}`, { method: 'DELETE' }),
    onSettled: refreshInspirations,
    meta: REPORT_FAILURE,
  });
}

export function useWearLookToday(coords: Coords | null | undefined) {
  return useMutation({
    mutationFn: (id: string) => {
      const { occasion } = useOccasion.getState();
      const query = `day=${localDay()}&occasion=${occasion}${coordsQuery(coords)}`;
      return api<Outfit>(`/inspirations/${id}/use?${query}`, { method: 'POST' });
    },
    onSuccess: (outfit) => queryClient.setQueryData(todayKey(outfit.occasion, outfit.day), outfit),
  });
}
