export const ROBLOX_TERRAIN = {
  studsPerSample: 4,
  maxHeightmapWidth: 4096,
  maxHeightmapHeight: 4096,
  projectExtension: '.rterrain',
} as const;

export type RobloxMaterial = {
  id: string;
  enumName: string;
  displayName: string;
  previewColor: string;
  exportKeyColor: [number, number, number];
};

// Focused catalog of materials used by Solum's first material and rules workflows.
// Identity is stable and deliberately separate from the export/display color.
export const ROBLOX_MATERIALS: RobloxMaterial[] = [
  { id: 'grass', enumName: 'Grass', displayName: 'Grass', previewColor: '#7d9b52', exportKeyColor: [94, 145, 71] },
  { id: 'leafy-grass', enumName: 'LeafyGrass', displayName: 'LeafyGrass', previewColor: '#86a55b', exportKeyColor: [119, 161, 78] },
  { id: 'ground', enumName: 'Ground', displayName: 'Ground', previewColor: '#7e694b', exportKeyColor: [127, 101, 69] },
  { id: 'mud', enumName: 'Mud', displayName: 'Mud', previewColor: '#5c493a', exportKeyColor: [94, 73, 59] },
  { id: 'rock', enumName: 'Rock', displayName: 'Rock', previewColor: '#777b7c', exportKeyColor: [119, 124, 126] },
  { id: 'slate', enumName: 'Slate', displayName: 'Slate', previewColor: '#4f5a60', exportKeyColor: [79, 90, 96] },
  { id: 'sand', enumName: 'Sand', displayName: 'Sand', previewColor: '#c6a86a', exportKeyColor: [214, 183, 117] },
  { id: 'sandstone', enumName: 'Sandstone', displayName: 'Sandstone', previewColor: '#ad865b', exportKeyColor: [179, 137, 91] },
  { id: 'limestone', enumName: 'Limestone', displayName: 'Limestone', previewColor: '#b8b19d', exportKeyColor: [196, 190, 168] },
  { id: 'basalt', enumName: 'Basalt', displayName: 'Basalt', previewColor: '#3f454b', exportKeyColor: [61, 67, 73] },
  { id: 'cobblestone', enumName: 'Cobblestone', displayName: 'Cobblestone', previewColor: '#79756d', exportKeyColor: [133, 128, 117] },
  { id: 'salt', enumName: 'Salt', displayName: 'Salt', previewColor: '#ddd8c8', exportKeyColor: [228, 224, 207] },
  { id: 'snow', enumName: 'Snow', displayName: 'Snow', previewColor: '#e6ebea', exportKeyColor: [239, 244, 244] },
];

export const MATERIAL_INDEX_BY_ID = Object.fromEntries(
  ROBLOX_MATERIALS.map((material, index) => [material.id, index]),
) as Record<string, number>;

export function materialByIndex(index: number): RobloxMaterial {
  return ROBLOX_MATERIALS[index] ?? ROBLOX_MATERIALS[0];
}
