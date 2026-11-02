import { useMutation, useQuery } from '@tanstack/react-query';

import { api, jsonBody } from '@/lib/api';
import { queryClient } from '@/lib/query';
import type { User } from '@/lib/session';

type Profile = User & { style_profile: string | null };

const PROFILE_KEY = ['me'];

export function useStyleProfile() {
  return useQuery({ queryKey: PROFILE_KEY, queryFn: () => api<Profile>('/me') });
}

export function useSaveStyleProfile() {
  return useMutation({
    mutationFn: (text: string) =>
      api<Profile>('/me/style-profile', jsonBody('PUT', { style_profile: text })),
    onSuccess: (profile) => {
      queryClient.setQueryData(PROFILE_KEY, profile);
      // The server set aside the outfits prepared under the old profile.
      void queryClient.invalidateQueries({ queryKey: ['outfit'] });
    },
  });
}
