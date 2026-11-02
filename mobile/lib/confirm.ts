import { router } from 'expo-router';
import { create } from 'zustand';

type ConfirmRequest = {
  title: string;
  body: string;
  action: string;
  onConfirm: () => void;
};

export const useConfirm = create<{ request: ConfirmRequest | null }>(() => ({ request: null }));

// Asks in a bottom sheet, so a consequential choice stays within thumb reach.
export function askToConfirm(request: ConfirmRequest): void {
  useConfirm.setState({ request });
  router.push('/confirm');
}
