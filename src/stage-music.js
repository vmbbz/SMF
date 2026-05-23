const STORAGE_KEY = "smf_stage_music_prefs_v1";

export const STAGE_PLAYLIST = [
  { id: "main-theme", name: "Main Theme", src: "assets/music/01-main-theme.mp3" },
  { id: "simulacra", name: "Simulacra", src: "assets/music/02-simulacra.mp3" },
  { id: "badly", name: "Badly", src: "assets/music/03-badly.mp3" },
  { id: "hitman", name: "Hitman", src: "assets/music/04-hitman.mp3" },
  { id: "push", name: "Push", src: "assets/music/05-push-long-version.mp3" },
  { id: "super-epic", name: "Super Epic", src: "assets/music/06-super-epic.mp3" },
];

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export class StageMusicManager {
  constructor({ playlist = STAGE_PLAYLIST, volume = 0.28 } = {}) {
    this.playlist = Array.isArray(playlist) ? playlist.filter(t => t && t.src) : [];
    this.audio = new Audio();
    this.audio.preload = "metadata";
    this.audio.volume = clamp01(volume);
    this.audio.loop = false;

    this.currentIndex = 0;
    this.autoPlayEnabled = true;
    this._subscribers = new Set();
    this._errorSkips = 0;

    this._loadPrefs();
    this._bindEvents();
    this._ensureTrackLoaded();
    this._emit();
  }

  _bindEvents() {
    this.audio.addEventListener("ended", () => {
      this._errorSkips = 0;
      this.nextTrack({ autoplay: true, forcePlay: true, persist: false });
    });

    this.audio.addEventListener("play", () => {
      this._emit();
      this._savePrefs();
    });

    this.audio.addEventListener("pause", () => {
      this._emit();
      this._savePrefs();
    });

    this.audio.addEventListener("error", () => {
      if (!this.playlist.length) return;
      this._errorSkips += 1;
      if (this._errorSkips > this.playlist.length) {
        console.warn("[StageMusic] Every track failed to load.");
        this.audio.pause();
        this._emit();
        return;
      }
      const shouldPlay = !this.audio.paused;
      this.nextTrack({ autoplay: shouldPlay || this.autoPlayEnabled, forcePlay: shouldPlay, persist: false });
    });
  }

  _loadPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Number.isInteger(parsed.currentIndex)) {
        this.currentIndex = this._normalizeIndex(parsed.currentIndex);
      }
      if (typeof parsed.autoPlayEnabled === "boolean") {
        this.autoPlayEnabled = parsed.autoPlayEnabled;
      }
    } catch (e) {
      console.warn("[StageMusic] Could not load saved prefs:", e);
    }
  }

  _savePrefs() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          currentIndex: this.currentIndex,
          autoPlayEnabled: this.autoPlayEnabled,
        }),
      );
    } catch (e) {
      console.warn("[StageMusic] Could not save prefs:", e);
    }
  }

  _normalizeIndex(index) {
    if (!this.playlist.length) return 0;
    const mod = index % this.playlist.length;
    return mod < 0 ? mod + this.playlist.length : mod;
  }

  _ensureTrackLoaded() {
    if (!this.playlist.length) return;
    const track = this.playlist[this._normalizeIndex(this.currentIndex)];
    if (!track) return;
    if (this.audio.src && this.audio.src.endsWith(track.src)) return;
    this.audio.src = track.src;
    this.audio.load();
  }

  _setTrack(index, { autoplay = true, forcePlay = false, persist = true } = {}) {
    if (!this.playlist.length) return;

    this.currentIndex = this._normalizeIndex(index);
    const track = this.playlist[this.currentIndex];
    if (!track) return;

    this.audio.src = track.src;
    this.audio.load();
    this.audio.currentTime = 0;

    const shouldPlay = forcePlay || (autoplay && this.autoPlayEnabled);
    if (shouldPlay) {
      this.audio.play().catch((e) => {
        console.log("[StageMusic] Autoplay blocked until gesture:", e);
        this._emit();
      });
    } else {
      this._emit();
    }

    if (persist) this._savePrefs();
  }

  getCurrentTrack() {
    if (!this.playlist.length) return null;
    return this.playlist[this._normalizeIndex(this.currentIndex)] || null;
  }

  getState() {
    const track = this.getCurrentTrack();
    return {
      trackName: track ? track.name : "No Track",
      trackIndex: this.currentIndex,
      totalTracks: this.playlist.length,
      isPlaying: !this.audio.paused,
      autoPlayEnabled: this.autoPlayEnabled,
    };
  }

  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    this._subscribers.add(listener);
    listener(this.getState());
    return () => {
      this._subscribers.delete(listener);
    };
  }

  _emit() {
    const snapshot = this.getState();
    for (const listener of this._subscribers) {
      try {
        listener(snapshot);
      } catch (e) {
        console.warn("[StageMusic] Subscriber callback failed:", e);
      }
    }
  }

  startForFight() {
    this._ensureTrackLoaded();
    if (!this.autoPlayEnabled) {
      this._emit();
      return;
    }
    this.audio.play().catch((e) => {
      console.log("[StageMusic] Start blocked until gesture:", e);
      this._emit();
    });
  }

  stopForMenu() {
    try {
      this.audio.pause();
    } catch (_) {
      // no-op
    }
    this._emit();
  }

  play() {
    this.autoPlayEnabled = true;
    this._savePrefs();
    this._ensureTrackLoaded();
    this.audio.play().catch((e) => {
      console.log("[StageMusic] Play blocked until gesture:", e);
      this._emit();
    });
  }

  pauseByUser() {
    this.autoPlayEnabled = false;
    this._savePrefs();
    try {
      this.audio.pause();
    } catch (_) {
      // no-op
    }
    this._emit();
  }

  togglePlayPause() {
    if (this.audio.paused) this.play();
    else this.pauseByUser();
  }

  nextTrack({ autoplay = true, forcePlay = false, persist = true } = {}) {
    this._setTrack(this.currentIndex + 1, { autoplay, forcePlay, persist });
  }

  prevTrack({ autoplay = true, forcePlay = false, persist = true } = {}) {
    this._setTrack(this.currentIndex - 1, { autoplay, forcePlay, persist });
  }
}
