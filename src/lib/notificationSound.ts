// Tiện ích phát âm thanh chuông thông báo (Web Audio API - không cần tải file mp3 bên ngoài)

const BELL_SOUND_STORAGE_KEY = 'vuth_bell_sound_enabled';

export function isBellSoundEnabled(): boolean {
  try {
    const val = localStorage.getItem(BELL_SOUND_STORAGE_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export function setBellSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(BELL_SOUND_STORAGE_KEY, String(enabled));
  } catch (e) {
    console.warn('Lỗi lưu cài đặt chuông:', e);
  }
}

/**
 * Phát âm thanh chuông "Ding - Dong - Ting" ngọt ngào và rõ ràng
 */
export function playNotificationBell(): void {
  if (!isBellSoundEnabled()) return;

  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const startTime = ctx.currentTime;

    // Nốt 1: 880 Hz (A5 - Ding)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, startTime);
    osc1.frequency.exponentialRampToValueAtTime(870, startTime + 0.6);
    gain1.gain.setValueAtTime(0.28, startTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, startTime + 0.6);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(startTime);
    osc1.stop(startTime + 0.6);

    // Nốt 2: 1318.5 Hz (E6 - Dong) sau 0.12s
    const t2 = startTime + 0.12;
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1318.5, t2);
    osc2.frequency.exponentialRampToValueAtTime(1310, t2 + 0.9);
    gain2.gain.setValueAtTime(0.35, t2);
    gain2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.9);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(t2);
    osc2.stop(t2 + 0.9);

    // Nốt 3: 1760 Hz (A6 - Chime lấp lánh) sau 0.22s
    const t3 = startTime + 0.22;
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'triangle';
    osc3.frequency.setValueAtTime(1760, t3);
    gain3.gain.setValueAtTime(0.22, t3);
    gain3.gain.exponentialRampToValueAtTime(0.001, t3 + 0.8);
    osc3.connect(gain3);
    gain3.connect(ctx.destination);
    osc3.start(t3);
    osc3.stop(t3 + 0.8);
  } catch (err) {
    console.warn('Không thể phát âm thanh chuông:', err);
  }
}
