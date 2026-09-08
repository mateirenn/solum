import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export async function openNativeProject(): Promise<{ path: string; contents: string } | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Solum terrain project', extensions: ['rterrain'] }],
  });
  if (typeof selected !== 'string') return null;
  return { path: selected, contents: await invoke<string>('read_project_file', { path: selected }) };
}

export async function saveNativeProject(contents: string, defaultPath: string): Promise<string | null> {
  const selected = await save({
    defaultPath,
    filters: [{ name: 'Solum terrain project', extensions: ['rterrain'] }],
  });
  if (typeof selected !== 'string') return null;
  await writeNativeProject(contents, selected);
  return selected;
}

export async function writeNativeProject(contents: string, path: string): Promise<void> {
  await invoke('write_project_file', { path, contents });
}

export async function readNativeRecovery(): Promise<string | null> {
  return invoke<string | null>('read_recovery_file');
}

export async function writeNativeRecovery(contents: string): Promise<void> {
  await invoke('write_recovery_file', { contents });
}

export async function clearNativeRecovery(): Promise<void> {
  await invoke('clear_recovery_file');
}
