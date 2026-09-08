import { useMemo, useState } from 'react';
import { DEFAULT_PROJECT_OPTIONS, StartingTerrain, resolutionForWorldSize } from '../domain/terrain';
import { RecentProject } from '../domain/project';

type StartScreenProps = {
  onCreate: (options: typeof DEFAULT_PROJECT_OPTIONS, onProgress?: (progress: number) => void) => void | Promise<void>;
  onOpen: () => void;
  onRecover: () => void;
  recoveryAvailable: boolean;
  recentProjects: RecentProject[];
};

const presets = [2048, 4096, 8192, 16384];

export function StartScreen({ onCreate, onOpen, onRecover, recoveryAvailable, recentProjects }: StartScreenProps) {
  const [options, setOptions] = useState(DEFAULT_PROJECT_OPTIONS);
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState(0);
  const resolution = useMemo(() => resolutionForWorldSize(options.worldWidth), [options.worldWidth]);

  function setOption<Key extends keyof typeof options>(key: Key, value: (typeof options)[Key]) {
    setOptions((current) => ({ ...current, [key]: value }));
  }

  async function createProject(): Promise<void> {
    setCreating(true);
    setCreateProgress(0);
    try { await onCreate(options, setCreateProgress); } finally { setCreating(false); setCreateProgress(0); }
  }

  return (
    <main className="start-screen">
      <section className="start-intro">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>SOLUM</span>
        </div>
        <div className="intro-copy">
          <p className="eyebrow">Roblox terrain studio / 01</p>
          <h1>Sculpt the world.<br /><em>Keep the map.</em></h1>
          <p className="intro-lede">A focused terrain authoring desk for developers who think in valleys, slopes, materials, and studs—not grayscale pixels.</p>
        </div>
        <div className="contour-hero" aria-hidden="true">
          <svg viewBox="0 0 620 250" preserveAspectRatio="none">
            <path d="M-10 188 C 70 155, 80 72, 180 96 S 280 224, 378 164 S 500 26, 630 68" />
            <path d="M-10 210 C 82 171, 102 94, 182 116 S 278 244, 390 185 S 507 49, 630 89" />
            <path d="M-10 234 C 90 192, 112 120, 194 139 S 290 265, 402 206 S 526 71, 630 112" />
            <path d="M-10 160 C 56 131, 67 51, 173 73 S 270 202, 361 141 S 485 8, 630 46" />
          </svg>
          <span>topographic signal / live</span>
        </div>
        <div className="intro-foot"><span>LOCAL / PRIVATE</span><span>4 STUDS / SAMPLE</span><span>WINDOWS FIRST</span></div>
      </section>

      <section className="start-panel">
        <div className="start-panel-head">
          <div><p className="eyebrow">New workspace</p><h2>Begin with a shape</h2></div>
          <button className="quiet-icon" onClick={onOpen} title="Open an existing .rterrain project" aria-label="Open project">↗</button>
        </div>
        <div className="form-stack">
          <label className="field-label">Project name<input value={options.name} onChange={(event) => setOption('name', event.target.value)} placeholder="Untitled terrain" /></label>
          <div className="field-label">World footprint <span className="field-help">Roblox studs</span>
            <div className="preset-grid">
              {presets.map((preset) => <button key={preset} className={`preset ${options.worldWidth === preset ? 'selected' : ''}`} onClick={() => { setOption('worldWidth', preset); setOption('worldDepth', preset); }}><strong>{preset.toLocaleString()}</strong><span>× {preset.toLocaleString()}</span></button>)}
            </div>
          </div>
          <div className="resolution-readout"><span>Working samples</span><strong>{resolution.toLocaleString()} × {resolution.toLocaleString()}</strong><small>4 studs represented by each height sample</small></div>
          <div className="form-row">
            <label className="field-label">Low elevation<input type="number" value={options.minElevation} onChange={(event) => setOption('minElevation', Number(event.target.value))} /></label>
            <label className="field-label">High elevation<input type="number" value={options.maxElevation} onChange={(event) => setOption('maxElevation', Number(event.target.value))} /></label>
          </div>
          <div className="form-row">
            <label className="field-label">Sea level<input type="number" value={options.seaLevel} onChange={(event) => setOption('seaLevel', Number(event.target.value))} /><span className="field-help">studs</span></label>
            <label className="field-label">Seed<input type="number" value={options.seed} onChange={(event) => setOption('seed', Number(event.target.value))} /></label>
          </div>
          <div className="field-label">Starting terrain
            <div className="segmented">
              {([['gentle-noise', 'Gentle noise'], ['flat', 'Flat'], ['empty', 'Base level']] as Array<[StartingTerrain, string]>).map(([value, label]) => <button key={value} className={options.startingTerrain === value ? 'selected' : ''} onClick={() => setOption('startingTerrain', value)}>{label}</button>)}
            </div>
          </div>
          {creating && <div className="creation-progress" role="status" aria-live="polite"><div><span>Preparing terrain</span><b>{Math.round(createProgress * 100)}%</b></div><i><em style={{ width: `${Math.max(3, Math.round(createProgress * 100))}%` }} /></i></div>}
          <button className="primary-action" disabled={creating} onClick={createProject}><span>{creating ? 'Preparing terrain…' : 'Create terrain project'}</span><b>→</b></button>
          <button className="secondary-action" disabled={creating} onClick={onOpen}>Open existing project <span>Ctrl O</span></button>
        </div>
          <div className="recent-block">
          <div className="section-title"><span>Recent projects</span><span>{recentProjects.length}</span></div>
          {recoveryAvailable && <button className="recovery-row" onClick={onRecover}><span className="recovery-icon">↻</span><span><strong>Recover last session</strong><small>Autosaved locally before the last close</small></span><b>→</b></button>}
          {recentProjects.length === 0 ? <p className="empty-note">Projects you save will appear here. Solum keeps your terrain local.</p> : recentProjects.map((recent) => <div className="recent-row" key={`${recent.name}-${recent.openedAt}`}><span className="recent-dot" /><div><strong>{recent.name}</strong><small>{recent.samples} samples · {new Date(recent.openedAt).toLocaleDateString()}</small></div><span className="recent-arrow">↗</span></div>)}
        </div>
      </section>
    </main>
  );
}
