import React, { useEffect, useState } from "react";
import { setPlaybackRate, setPitchSemitones } from "@/lib/eq";

const LS_KEY = "wora.tempo";

interface TempoState {
  psEnabled: boolean;
  ps: number; // play speed %
  pitchEnabled: boolean;
  pitch: number; // semitones
  srEnabled: boolean;
  sr: number; // sample rate %
}

const DEFAULTS: TempoState = {
  psEnabled: false,
  ps: 100,
  pitchEnabled: false,
  pitch: 0,
  srEnabled: false,
  sr: 100,
};

export function loadTempo(): TempoState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULTS };
}

// Apply a tempo state to the audio engine.
export function applyTempo(s: TempoState): void {
  const rate = (s.psEnabled ? s.ps / 100 : 1) * (s.srEnabled ? s.sr / 100 : 1);
  const preserve = !s.srEnabled; // sample-rate mode = varispeed (pitch follows)
  setPlaybackRate(rate, preserve);
  setPitchSemitones(s.pitchEnabled ? s.pitch : 0);
}

export default function TempoControl() {
  const [s, setS] = useState<TempoState>(DEFAULTS);

  useEffect(() => {
    const loaded = loadTempo();
    setS(loaded);
    applyTempo(loaded);
  }, []);

  const commit = (next: TempoState) => {
    setS(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {}
    applyTempo(next);
  };

  const reset = () => commit({ ...DEFAULTS });

  return (
    <div className="wora-border flex flex-col gap-6 rounded-2xl bg-white/70 p-6 dark:bg-black/70">
      <Row
        label="play speed"
        enabled={s.psEnabled}
        onEnabled={(v) => commit({ ...s, psEnabled: v })}
        value={s.ps}
        unit="%"
        min={50}
        max={400}
        step={1}
        onValue={(v) => commit({ ...s, ps: v })}
        hint="andamento (tom preservado)"
      />
      <Row
        label="pitch"
        enabled={s.pitchEnabled}
        onEnabled={(v) => commit({ ...s, pitchEnabled: v })}
        value={s.pitch}
        unit="semitones"
        min={-12}
        max={12}
        step={0.5}
        onValue={(v) => commit({ ...s, pitch: v })}
        hint="tom independente (andamento inalterado)"
      />
      <Row
        label="sample rate"
        enabled={s.srEnabled}
        onEnabled={(v) => commit({ ...s, srEnabled: v })}
        value={s.sr}
        unit="%"
        min={50}
        max={400}
        step={1}
        onValue={(v) => commit({ ...s, sr: v })}
        hint="varispeed (andamento + tom juntos)"
      />

      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          className="rounded-md border border-black/10 px-3 py-1.5 text-xs transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
        >
          Reset
        </button>
        <p className="ml-auto text-xs opacity-40">
          Aplica ao vivo e persiste. Pitch usa DSP inline (AudioWorklet).
        </p>
      </div>
    </div>
  );
}

function Row({
  label,
  enabled,
  onEnabled,
  value,
  unit,
  min,
  max,
  step,
  onValue,
  hint,
}: {
  label: string;
  enabled: boolean;
  onEnabled: (v: boolean) => void;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onValue: (v: number) => void;
  hint: string;
}) {
  return (
    <div className={`flex flex-col gap-2 ${enabled ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabled(e.target.checked)}
          />
          {label}
        </label>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={!enabled}
          onChange={(e) => onValue(parseFloat(e.target.value))}
          className="w-20 rounded-md border border-black/10 bg-transparent px-2 py-1 text-xs tabular-nums dark:border-white/10"
        />
        <span className="text-xs opacity-50">{unit}</span>
        <span className="ml-auto text-[10px] opacity-40">{hint}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={!enabled}
        onChange={(e) => onValue(parseFloat(e.target.value))}
        className="w-full cursor-pointer"
      />
      <div className="flex justify-between text-[10px] opacity-40">
        <span>
          {min}
          {unit === "%" ? "%" : ""}
        </span>
        <span>
          {max}
          {unit === "%" ? "%" : ""}
        </span>
      </div>
    </div>
  );
}
