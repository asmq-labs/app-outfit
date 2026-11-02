import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { create } from 'zustand';

import { api, jsonBody } from '@/lib/api';
import { askToConfirm } from '@/lib/confirm';
import {
  type Garment,
  type GarmentCategory,
  refreshGarments,
  useDeleteGarment,
} from '@/lib/garments';
import type { Coords } from '@/lib/location';
import { queryClient, REPORT_FAILURE } from '@/lib/query';

export type Occasion = 'casual' | 'work' | 'night_out' | 'formal';

export type Outfit = {
  id: string;
  day: string;
  occasion: Occasion;
  explanation: string;
  worn: boolean;
  // Chosen by the user ahead of time rather than suggested by the app.
  planned: boolean;
  // The saved outfit with these same garments, if the user kept it.
  saved_id: string | null;
  garments: Record<GarmentCategory, Garment | null>;
  // Slots the closet could only fill with something off the occasion.
  off_occasion: GarmentCategory[];
  forecast: { min_c: number; max_c: number; rain: boolean } | null;
};

export const OCCASIONS: { value: Occasion; label: string }[] = [
  { value: 'casual', label: 'Casual' },
  { value: 'work', label: 'Trabajo' },
  { value: 'night_out', label: 'Salir' },
  { value: 'formal', label: 'Formal' },
];

export function defaultOccasion(now = new Date()): Occasion {
  const day = now.getDay();
  const hour = now.getHours();
  const isWeekday = day >= 1 && day <= 5;
  if (isWeekday && hour < 17) return 'work';
  if ((day === 5 || day === 6) && hour >= 17) return 'night_out';
  return 'casual';
}

// Shared so an outfit requested from another screen lands on the occasion shown in Today.
export const useOccasion = create<{ occasion: Occasion; setOccasion: (next: Occasion) => void }>(
  (set) => ({ occasion: defaultOccasion(), setOccasion: (occasion) => set({ occasion }) })
);

export function localDay(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${date}`;
}

// Minutes east of UTC; lets the server know when this phone's morning starts.
function utcOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

export function coordsQuery(coords: Coords | null | undefined): string {
  return coords ? `&lat=${coords.lat}&lon=${coords.lon}` : '';
}

const CALENDAR_KEY = ['outfit-calendar'];

export function todayKey(occasion: Occasion, day = localDay()) {
  return ['outfit', day, occasion];
}

// The suggestion for any day: today on Hoy, or a coming day from the calendar.
export function useDayOutfit(
  day: string,
  occasion: Occasion,
  coords: Coords | null | undefined,
  enabled = true
) {
  return useQuery({
    queryKey: todayKey(occasion, day),
    queryFn: () =>
      api<Outfit>(
        `/outfits/today?day=${day}&occasion=${occasion}&tz=${utcOffsetMinutes()}${coordsQuery(coords)}`
      ),
    // Wait for the location so the outfit already matches that day's weather.
    enabled: enabled && coords !== undefined,
    // Switching occasion keeps the last outfit on screen, dimmed, until the new one arrives.
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useTodayOutfit(occasion: Occasion, coords: Coords | null | undefined) {
  return useDayOutfit(localDay(), occasion, coords);
}

// Kept outside the component so its identity never changes between renders.
export function retryFailedOutfits(): void {
  void queryClient.refetchQueries({
    queryKey: ['outfit'],
    predicate: (query) => query.state.status === 'error',
  });
}

export function useAnotherOutfit(coords: Coords | null | undefined) {
  return useMutation({
    mutationFn: (outfit: Outfit) =>
      api<Outfit>(`/outfits/${outfit.id}/another?${coordsQuery(coords).slice(1)}`, {
        method: 'POST',
      }),
    onSuccess: (outfit) => queryClient.setQueryData(todayKey(outfit.occasion, outfit.day), outfit),
  });
}

export type OutfitAsk = { garmentId?: string; occasion: Occasion; note: string };

export function useRequestOutfit(coords: Coords | null | undefined) {
  return useMutation({
    mutationFn: ({ garmentId, occasion, note }: OutfitAsk) =>
      api<Outfit>(
        `/outfits/request?${coordsQuery(coords).slice(1)}`,
        jsonBody('POST', { day: localDay(), occasion, garment_id: garmentId, note })
      ),
    onSuccess: (outfit) => {
      queryClient.setQueryData(todayKey(outfit.occasion, outfit.day), outfit);
      // Hoy lands on the occasion just asked for, with the new outfit already there.
      useOccasion.getState().setOccasion(outfit.occasion);
    },
  });
}

export function useWearOutfit(coords: Coords | null | undefined) {
  return useMutation({
    mutationFn: (outfit: Outfit) =>
      api<Outfit>(`/outfits/${outfit.id}/wear?${coordsQuery(coords).slice(1)}`, { method: 'POST' }),
    onSuccess: (outfit) => {
      queryClient.setQueryData(todayKey(outfit.occasion, outfit.day), outfit);
      void refreshGarments();
      void queryClient.invalidateQueries({ queryKey: CALENDAR_KEY });
    },
    meta: REPORT_FAILURE,
  });
}

export function useUnwearOutfit(coords: Coords | null | undefined) {
  return useMutation({
    mutationFn: (outfit: Outfit) =>
      api<Outfit>(`/outfits/${outfit.id}/unwear?${coordsQuery(coords).slice(1)}`, {
        method: 'POST',
      }),
    onSuccess: (outfit) => {
      queryClient.setQueryData(todayKey(outfit.occasion, outfit.day), outfit);
      void refreshGarments();
      void queryClient.invalidateQueries({ queryKey: CALENDAR_KEY });
    },
    meta: REPORT_FAILURE,
  });
}

export function useCalendar(start: string, end: string) {
  return useQuery({
    queryKey: [...CALENDAR_KEY, start, end],
    queryFn: () => api<Outfit[]>(`/outfits/calendar?start=${start}&end=${end}`),
  });
}

function refreshAfterOutfitChange(): void {
  void queryClient.invalidateQueries({ queryKey: CALENDAR_KEY });
  void queryClient.invalidateQueries({ queryKey: ['outfit'] });
  void refreshGarments();
}

export type OutfitDraft = {
  day: string;
  occasion: Occasion;
  worn: boolean;
  garments: Partial<Record<GarmentCategory, string | null>>;
};

export function useCreateOutfit() {
  return useMutation({
    mutationFn: (draft: OutfitDraft) => api<Outfit>('/outfits', jsonBody('POST', draft)),
    onSuccess: refreshAfterOutfitChange,
  });
}

export function useDeleteOutfit() {
  return useMutation({
    mutationFn: (id: string) => api<void>(`/outfits/${id}`, { method: 'DELETE' }),
    onSettled: refreshAfterOutfitChange,
    meta: REPORT_FAILURE,
  });
}

export type SavedOutfit = {
  id: string;
  garments: Record<GarmentCategory, Garment | null>;
  created_at: string;
};

const SAVED_KEY = ['saved-outfits'];

export function garmentIds(garments: Outfit['garments']): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(garments).map(([category, garment]) => [category, garment?.id ?? null])
  );
}

function refreshSaved(): void {
  void queryClient.invalidateQueries({ queryKey: SAVED_KEY });
  // Outfits on screen carry whether they are saved.
  void queryClient.invalidateQueries({ queryKey: ['outfit'] });
  void queryClient.invalidateQueries({ queryKey: CALENDAR_KEY });
}

export function useSavedOutfits() {
  return useQuery({ queryKey: SAVED_KEY, queryFn: () => api<SavedOutfit[]>('/saved-outfits') });
}

export function useSaveOutfit() {
  return useMutation({
    mutationFn: (garments: Outfit['garments']) =>
      api<SavedOutfit>('/saved-outfits', jsonBody('POST', { garments: garmentIds(garments) })),
    onSuccess: refreshSaved,
  });
}

export function useUnsaveOutfit() {
  return useMutation({
    mutationFn: (id: string) => api<void>(`/saved-outfits/${id}`, { method: 'DELETE' }),
    onSettled: refreshSaved,
    meta: REPORT_FAILURE,
  });
}

export function useWearSavedToday(coords: Coords | null | undefined) {
  return useMutation({
    mutationFn: (id: string) => {
      const { occasion } = useOccasion.getState();
      const query = `day=${localDay()}&occasion=${occasion}${coordsQuery(coords)}`;
      return api<Outfit>(`/saved-outfits/${id}/use?${query}`, { method: 'POST' });
    },
    onSuccess: (outfit) => queryClient.setQueryData(todayKey(outfit.occasion, outfit.day), outfit),
    meta: REPORT_FAILURE,
  });
}

export function useConfirmDeleteOutfit(id: string) {
  const unsave = useUnsaveOutfit();
  return (onDeleted?: () => void) =>
    askToConfirm({
      title: '¿Eliminar este outfit?',
      body: 'Solo se borra la combinación. Tus prendas siguen en tu armario.',
      action: 'Eliminar outfit',
      onConfirm: () => unsave.mutate(id, { onSuccess: onDeleted }),
    });
}

const NEEDED: GarmentCategory[] = ['top', 'bottom', 'one_piece', 'shoes'];

// Says the whole truth before deleting: the garment is gone for good, and so are its saved outfits.
export function useConfirmDeleteGarment(garment: Garment) {
  const { data: saved = [] } = useSavedOutfits();
  const remove = useDeleteGarment();

  return (done?: { onConfirm?: () => void; onSuccess?: () => void; onError?: () => void }) => {
    const lost = saved.filter((item) =>
      NEEDED.some((category) => item.garments[category]?.id === garment.id)
    ).length;
    const also =
      lost === 0
        ? ''
        : lost === 1
          ? ' También se eliminará 1 outfit guardado que la usa.'
          : ` También se eliminarán ${lost} outfits guardados que la usan.`;
    askToConfirm({
      title: garment.name ? `¿Eliminar «${garment.name}»?` : '¿Eliminar esta prenda?',
      body: `Se borrará de tu armario y no podrás recuperarla.${also}`,
      action: 'Eliminar prenda',
      onConfirm: () => {
        done?.onConfirm?.();
        remove.mutate(garment.id, { onSuccess: done?.onSuccess, onError: done?.onError });
      },
    });
  };
}
