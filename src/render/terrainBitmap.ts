import { materialByIndex } from '../domain/roblox';
import { compositeHeightAt, materialAt, SelectionRect, slopeDegreesAt, TerrainProject, ViewMode } from '../domain/terrain';

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
}

function heightColor(normalized: number): [number, number, number] {
  const stops: Array<[number, [number, number, number]]> = [
    [0, [17, 29, 36]],
    [0.22, [43, 75, 73]],
    [0.48, [111, 130, 80]],
    [0.72, [165, 143, 94]],
    [1, [229, 228, 209]],
  ];
  for (let index = 1; index < stops.length; index += 1) {
    if (normalized <= stops[index][0]) {
      const [previousStop, previousColor] = stops[index - 1];
      const [nextStop, nextColor] = stops[index];
      const amount = (normalized - previousStop) / (nextStop - previousStop);
      return [
        Math.round(previousColor[0] + (nextColor[0] - previousColor[0]) * amount),
        Math.round(previousColor[1] + (nextColor[1] - previousColor[1]) * amount),
        Math.round(previousColor[2] + (nextColor[2] - previousColor[2]) * amount),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

function slopeColor(degrees: number): [number, number, number] {
  const amount = Math.min(1, degrees / 55);
  if (amount < 0.5) return [Math.round(81 + amount * 2 * 104), Math.round(158 - amount * 2 * 45), 92];
  return [Math.round(185 + (amount - 0.5) * 2 * 42), Math.round(113 - (amount - 0.5) * 2 * 79), Math.round(92 - (amount - 0.5) * 2 * 38)];
}

function blend(a: [number, number, number], b: [number, number, number], amount: number): [number, number, number] {
  return [Math.round(a[0] * (1 - amount) + b[0] * amount), Math.round(a[1] * (1 - amount) + b[1] * amount), Math.round(a[2] * (1 - amount) + b[2] * amount)];
}

export function renderTerrainBitmap(project: TerrainProject, viewMode: ViewMode, maxDimension = 768, materialOverride?: Uint8Array | null, existingCanvas?: HTMLCanvasElement, dirtyRegion?: SelectionRect | null): HTMLCanvasElement {
  const scale = Math.min(1, maxDimension / Math.max(project.width, project.height));
  const bitmapWidth = Math.max(1, Math.round(project.width * scale));
  const bitmapHeight = Math.max(1, Math.round(project.height * scale));
  const canvas = existingCanvas && existingCanvas.width === bitmapWidth && existingCanvas.height === bitmapHeight ? existingCanvas : document.createElement('canvas');
  if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
  if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const minMapX = dirtyRegion ? Math.min(dirtyRegion.x0, dirtyRegion.x1) : 0;
  const maxMapX = dirtyRegion ? Math.max(dirtyRegion.x0, dirtyRegion.x1) : project.width - 1;
  const minMapY = dirtyRegion ? Math.min(dirtyRegion.y0, dirtyRegion.y1) : 0;
  const maxMapY = dirtyRegion ? Math.max(dirtyRegion.y0, dirtyRegion.y1) : project.height - 1;
  const startX = dirtyRegion ? Math.max(0, Math.floor(minMapX * scale) - 1) : 0;
  const endX = dirtyRegion ? Math.min(bitmapWidth - 1, Math.ceil((maxMapX + 1) * scale)) : bitmapWidth - 1;
  const startY = dirtyRegion ? Math.max(0, Math.floor(minMapY * scale) - 1) : 0;
  const endY = dirtyRegion ? Math.min(bitmapHeight - 1, Math.ceil((maxMapY + 1) * scale)) : bitmapHeight - 1;
  const patchWidth = Math.max(1, endX - startX + 1);
  const patchHeight = Math.max(1, endY - startY + 1);
  const image = context.createImageData(patchWidth, patchHeight);
  for (let py = startY; py <= endY; py += 1) {
    for (let px = startX; px <= endX; px += 1) {
      const x = Math.min(project.width - 1, Math.round(px / scale));
      const y = Math.min(project.height - 1, Math.round(py / scale));
      const index = y * project.width + x;
      const height = compositeHeightAt(project, x, y);
      const material = hexToRgb(materialByIndex(materialOverride?.[index] ?? materialAt(project, index)).previewColor);
      let color = heightColor(height);
      if (viewMode === 'materials') color = material;
      if (viewMode === 'combined') color = blend(color, material, 0.54);
      if (viewMode === 'slope') color = slopeColor(slopeDegreesAt(project, x, y));
      if (viewMode === 'mask') {
        const coverage = Math.round((project.mask[index] ?? 1) * 255);
        color = [coverage, coverage, coverage];
      }
      const output = ((py - startY) * patchWidth + px - startX) * 4;
      image.data[output] = color[0];
      image.data[output + 1] = color[1];
      image.data[output + 2] = color[2];
      image.data[output + 3] = 255;
    }
  }
  context.putImageData(image, startX, startY);
  return canvas;
}
