import { useEffect, useRef } from 'react';
import { supabase } from '../utils/supabase';

/** Plays the shared alert sound for notification rows inserted by the machine/backend. */
export default function NotificationSound() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio('/notification.wav');
    audio.preload = 'auto';
    audioRef.current = audio;

    // Browsers require a user gesture before sounds can play. Prime the audio silently
    // on the first interaction so later incoming notifications may play normally.
    const unlockAudio = () => {
      audio.muted = true;
      void audio.play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
        })
        .catch(() => { audio.muted = false; });
    };

    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });

    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel(`notification-sound:${Date.now()}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        () => {
          const audio = audioRef.current;
          if (!audio) return;
          audio.currentTime = 0;
          void audio.play().catch(() => {
            // The next user interaction re-enables audio when the browser blocks autoplay.
          });
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, []);

  return null;
}
