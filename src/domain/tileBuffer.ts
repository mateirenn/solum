export const TERRAIN_TILE_SIZE = 256;

export type TileBufferKind = 'float32' | 'uint8';
export type TileArray = Float32Array | Uint8Array;
export type FloatTileBuffer = Float32Array | TileBackedBuffer<Float32Array>;
export type ByteTileBuffer = Uint8Array | TileBackedBuffer<Uint8Array>;

type TileArrayConstructor<T extends TileArray> = {
  new (length: number): T;
  new (source: ArrayLike<number>): T;
  BYTES_PER_ELEMENT: number;
};

function isIndexProperty(property: PropertyKey): boolean {
  if (typeof property !== 'string' || property.length === 0) return false;
  const index = Number(property);
  return Number.isInteger(index) && index >= 0 && String(index) === property;
}

function tileKey(tileX: number, tileY: number, tileColumns: number): number {
  return tileY * tileColumns + tileX;
}

/**
 * A sparse, row-major terrain buffer.
 *
 * Empty tiles read as `defaultValue` and are never allocated. Numeric property
 * access is proxied so existing terrain code can use buffer[index] while all
 * writes still mark the owning tile dirty. Full contiguous arrays are created
 * only at explicit CPU export/worker boundaries via toTypedArray().
 */
export class TileBackedBuffer<T extends TileArray> {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly tileColumns: number;
  readonly tileRows: number;
  readonly kind: TileBufferKind;
  readonly defaultValue: number;
  readonly length: number;

  private readonly arrayConstructor: TileArrayConstructor<T>;
  private readonly tiles = new Map<number, T>();
  private readonly dirty = new Set<number>();

  [index: number]: number;

  constructor(width: number, height: number, kind: TileBufferKind, defaultValue = 0, tileSize = TERRAIN_TILE_SIZE) {
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw new Error('Tile buffer dimensions must be positive integers.');
    if (!Number.isInteger(tileSize) || tileSize <= 0) throw new Error('Tile buffer size must be a positive integer.');
    this.width = width;
    this.height = height;
    this.tileSize = tileSize;
    this.tileColumns = Math.ceil(width / tileSize);
    this.tileRows = Math.ceil(height / tileSize);
    this.kind = kind;
    this.defaultValue = kind === 'uint8' ? Math.max(0, Math.min(255, Math.round(defaultValue))) : Math.fround(defaultValue);
    this.length = width * height;
    this.arrayConstructor = (kind === 'uint8' ? Uint8Array : Float32Array) as unknown as TileArrayConstructor<T>;
    return createNumericProxy(this);
  }

  private tileCoordinates(index: number): { tileX: number; tileY: number; localX: number; localY: number; key: number } {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) throw new RangeError(`Tile buffer index ${index} is outside the project.`);
    const x = index % this.width;
    const y = Math.floor(index / this.width);
    const tileX = Math.floor(x / this.tileSize);
    const tileY = Math.floor(y / this.tileSize);
    return { tileX, tileY, localX: x - tileX * this.tileSize, localY: y - tileY * this.tileSize, key: tileKey(tileX, tileY, this.tileColumns) };
  }

  private tileDimensions(tileX: number, tileY: number): { width: number; height: number } {
    if (!Number.isInteger(tileX) || !Number.isInteger(tileY) || tileX < 0 || tileY < 0 || tileX >= this.tileColumns || tileY >= this.tileRows) throw new RangeError('Tile coordinates are outside the project.');
    return { width: Math.min(this.tileSize, this.width - tileX * this.tileSize), height: Math.min(this.tileSize, this.height - tileY * this.tileSize) };
  }

  private allocateTile(tileX: number, tileY: number): T {
    const dimensions = this.tileDimensions(tileX, tileY);
    const tile = new this.arrayConstructor(dimensions.width * dimensions.height);
    if (this.defaultValue !== 0) tile.fill(this.defaultValue);
    const key = tileKey(tileX, tileY, this.tileColumns);
    this.tiles.set(key, tile);
    return tile;
  }

  getValue(index: number): number {
    const coordinates = this.tileCoordinates(index);
    const tile = this.tiles.get(coordinates.key);
    if (!tile) return this.defaultValue;
    const tileWidth = Math.min(this.tileSize, this.width - coordinates.tileX * this.tileSize);
    return tile[coordinates.localY * tileWidth + coordinates.localX] ?? this.defaultValue;
  }

  setValue(index: number, value: number): void {
    const coordinates = this.tileCoordinates(index);
    const next = this.kind === 'uint8' ? Math.max(0, Math.min(255, Math.round(value))) : Math.fround(value);
    const tile = this.tiles.get(coordinates.key);
    const before = tile ? tile[coordinates.localY * Math.min(this.tileSize, this.width - coordinates.tileX * this.tileSize) + coordinates.localX] : this.defaultValue;
    if (Object.is(before, next) || (Number.isNaN(before) && Number.isNaN(next))) return;
    const target = tile ?? this.allocateTile(coordinates.tileX, coordinates.tileY);
    const tileWidth = Math.min(this.tileSize, this.width - coordinates.tileX * this.tileSize);
    target[coordinates.localY * tileWidth + coordinates.localX] = next;
    this.dirty.add(coordinates.key);
  }

  readTile(tileX: number, tileY: number): T {
    const dimensions = this.tileDimensions(tileX, tileY);
    const key = tileKey(tileX, tileY, this.tileColumns);
    const stored = this.tiles.get(key);
    if (!stored) {
      const empty = new this.arrayConstructor(dimensions.width * dimensions.height);
      if (this.defaultValue !== 0) empty.fill(this.defaultValue);
      return empty;
    }
    return new this.arrayConstructor(stored);
  }

  writeTile(tileX: number, tileY: number, values: ArrayLike<number>, markDirty = true): void {
    const dimensions = this.tileDimensions(tileX, tileY);
    const expected = dimensions.width * dimensions.height;
    if (values.length !== expected) throw new Error(`Tile ${tileX},${tileY} has ${values.length} samples; expected ${expected}.`);
    let allDefault = true;
    const tile = new this.arrayConstructor(expected);
    for (let index = 0; index < expected; index += 1) {
      const value = this.kind === 'uint8' ? Math.max(0, Math.min(255, Math.round(values[index] ?? this.defaultValue))) : Math.fround(values[index] ?? this.defaultValue);
      tile[index] = value;
      if (!Object.is(value, this.defaultValue)) allDefault = false;
    }
    const key = tileKey(tileX, tileY, this.tileColumns);
    if (allDefault) this.tiles.delete(key);
    else this.tiles.set(key, tile);
    if (markDirty) this.dirty.add(key);
  }

  hasTile(tileX: number, tileY: number): boolean {
    this.tileDimensions(tileX, tileY);
    return this.tiles.has(tileKey(tileX, tileY, this.tileColumns));
  }

  get allocatedTileCount(): number {
    return this.tiles.size;
  }

  get dirtyTileCount(): number {
    return this.dirty.size;
  }

  dirtyTileKeys(): number[] {
    return Array.from(this.dirty);
  }

  consumeDirtyTileKeys(): number[] {
    const keys = this.dirtyTileKeys();
    this.dirty.clear();
    return keys;
  }

  clearDirtyTiles(): void {
    this.dirty.clear();
  }

  tileCoordinatesForKey(key: number): { tileX: number; tileY: number } {
    if (!Number.isInteger(key) || key < 0 || key >= this.tileColumns * this.tileRows) throw new RangeError('Invalid terrain tile key.');
    return { tileX: key % this.tileColumns, tileY: Math.floor(key / this.tileColumns) };
  }

  tileKeysForRegion(x0: number, y0: number, x1: number, y1: number): number[] {
    const left = Math.max(0, Math.min(this.width - 1, Math.floor(Math.min(x0, x1))));
    const right = Math.max(0, Math.min(this.width - 1, Math.ceil(Math.max(x0, x1))));
    const top = Math.max(0, Math.min(this.height - 1, Math.floor(Math.min(y0, y1))));
    const bottom = Math.max(0, Math.min(this.height - 1, Math.ceil(Math.max(y0, y1))));
    const keys: number[] = [];
    for (let tileY = Math.floor(top / this.tileSize); tileY <= Math.floor(bottom / this.tileSize); tileY += 1) {
      for (let tileX = Math.floor(left / this.tileSize); tileX <= Math.floor(right / this.tileSize); tileX += 1) keys.push(tileKey(tileX, tileY, this.tileColumns));
    }
    return keys;
  }

  forEachTile(callback: (tile: T, tileX: number, tileY: number, key: number, allocated: boolean) => void, includeEmpty = true): void {
    for (let tileY = 0; tileY < this.tileRows; tileY += 1) {
      for (let tileX = 0; tileX < this.tileColumns; tileX += 1) {
        const key = tileKey(tileX, tileY, this.tileColumns);
        const allocated = this.tiles.has(key);
        if (!includeEmpty && !allocated) continue;
        callback(this.readTile(tileX, tileY), tileX, tileY, key, allocated);
      }
    }
  }

  toTypedArray(): T {
    const output = new this.arrayConstructor(this.length);
    if (this.defaultValue !== 0) output.fill(this.defaultValue);
    for (const [key, tile] of this.tiles) {
      const { tileX, tileY } = this.tileCoordinatesForKey(key);
      const tileWidth = Math.min(this.tileSize, this.width - tileX * this.tileSize);
      const tileHeight = Math.min(this.tileSize, this.height - tileY * this.tileSize);
      for (let localY = 0; localY < tileHeight; localY += 1) {
        const sourceStart = localY * tileWidth;
        const destinationStart = (tileY * this.tileSize + localY) * this.width + tileX * this.tileSize;
        output.set(tile.subarray(sourceStart, sourceStart + tileWidth), destinationStart);
      }
    }
    return output;
  }

  clone(): TileBackedBuffer<T> {
    const output = new TileBackedBuffer(this.width, this.height, this.kind, this.defaultValue, this.tileSize) as TileBackedBuffer<T>;
    for (const [key, tile] of this.tiles) {
      const { tileX, tileY } = this.tileCoordinatesForKey(key);
      output.writeTile(tileX, tileY, tile, false);
    }
    output.clearDirtyTiles();
    return output;
  }

  fill(value: number): this {
    const next = this.kind === 'uint8' ? Math.max(0, Math.min(255, Math.round(value))) : Math.fround(value);
    const previousKeys = Array.from(this.tiles.keys());
    this.tiles.clear();
    this.dirty.clear();
    if (next !== this.defaultValue) {
      for (let tileY = 0; tileY < this.tileRows; tileY += 1) {
        for (let tileX = 0; tileX < this.tileColumns; tileX += 1) {
          const dimensions = this.tileDimensions(tileX, tileY);
          const tile = new this.arrayConstructor(dimensions.width * dimensions.height).fill(next) as T;
          const key = tileKey(tileX, tileY, this.tileColumns);
          this.tiles.set(key, tile);
          this.dirty.add(key);
        }
      }
    } else {
      previousKeys.forEach((key) => this.dirty.add(key));
    }
    return this;
  }

  set(values: ArrayLike<number>, offset = 0): void {
    if (offset < 0 || offset + values.length > this.length) throw new RangeError('Source data does not fit in the terrain buffer.');
    for (let index = 0; index < values.length; index += 1) this.setValue(offset + index, values[index] ?? this.defaultValue);
  }

  slice(start = 0, end = this.length): T {
    return this.toTypedArray().slice(start, end) as T;
  }

  some(callback: (value: number, index: number, buffer: this) => boolean): boolean {
    for (let index = 0; index < this.length; index += 1) if (callback(this.getValue(index), index, this)) return true;
    return false;
  }

  every(callback: (value: number, index: number, buffer: this) => boolean): boolean {
    for (let index = 0; index < this.length; index += 1) if (!callback(this.getValue(index), index, this)) return false;
    return true;
  }

  forEach(callback: (value: number, index: number, buffer: this) => void): void {
    for (let index = 0; index < this.length; index += 1) callback(this.getValue(index), index, this);
  }

  [Symbol.iterator](): IterableIterator<number> {
    let index = 0;
    return {
      next: (): IteratorResult<number> => index < this.length ? { value: this.getValue(index++), done: false } : { value: undefined as never, done: true },
      [Symbol.iterator](): IterableIterator<number> { return this; },
    };
  }
}

function createNumericProxy<T extends TileArray>(buffer: TileBackedBuffer<T>): TileBackedBuffer<T> {
  return new Proxy(buffer, {
    get(target, property, receiver) {
      if (isIndexProperty(property)) return target.getValue(Number(property));
      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      if (isIndexProperty(property)) {
        target.setValue(Number(property), Number(value));
        return true;
      }
      return Reflect.set(target, property, value, receiver);
    },
    has(target, property) {
      if (isIndexProperty(property)) return Number(property) < target.length;
      return Reflect.has(target, property);
    },
  });
}

export function createTileBackedBuffer(width: number, height: number, kind: 'float32', defaultValue?: number, tileSize?: number): TileBackedBuffer<Float32Array>;
export function createTileBackedBuffer(width: number, height: number, kind: 'uint8', defaultValue?: number, tileSize?: number): TileBackedBuffer<Uint8Array>;
export function createTileBackedBuffer(width: number, height: number, kind: TileBufferKind, defaultValue = 0, tileSize = TERRAIN_TILE_SIZE): TileBackedBuffer<TileArray> {
  return new TileBackedBuffer(width, height, kind, defaultValue, tileSize) as TileBackedBuffer<TileArray>;
}

export function createFloat32TileBuffer(width: number, height: number, defaultValue = 0, tileSize = TERRAIN_TILE_SIZE): TileBackedBuffer<Float32Array> {
  return createTileBackedBuffer(width, height, 'float32', defaultValue, tileSize);
}

export function createUint8TileBuffer(width: number, height: number, defaultValue = 0, tileSize = TERRAIN_TILE_SIZE): TileBackedBuffer<Uint8Array> {
  return createTileBackedBuffer(width, height, 'uint8', defaultValue, tileSize);
}

export function float32TileBufferFrom(values: ArrayLike<number>, width: number, height: number, defaultValue = 0, tileSize = TERRAIN_TILE_SIZE): TileBackedBuffer<Float32Array> {
  if (values.length !== width * height) throw new Error('Float32 tile source does not match the requested dimensions.');
  const output = createFloat32TileBuffer(width, height, defaultValue, tileSize);
  const source = values instanceof Float32Array ? values : Float32Array.from(values);
  const columns = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);
  for (let tileY = 0; tileY < rows; tileY += 1) {
    const tileHeight = Math.min(tileSize, height - tileY * tileSize);
    for (let tileX = 0; tileX < columns; tileX += 1) {
      const tileWidth = Math.min(tileSize, width - tileX * tileSize);
      const tile = new Float32Array(tileWidth * tileHeight);
      for (let localY = 0; localY < tileHeight; localY += 1) {
        const sourceStart = (tileY * tileSize + localY) * width + tileX * tileSize;
        tile.set(source.subarray(sourceStart, sourceStart + tileWidth), localY * tileWidth);
      }
      output.writeTile(tileX, tileY, tile, false);
    }
  }
  output.clearDirtyTiles();
  return output;
}

export function uint8TileBufferFrom(values: ArrayLike<number>, width: number, height: number, defaultValue = 0, tileSize = TERRAIN_TILE_SIZE): TileBackedBuffer<Uint8Array> {
  if (values.length !== width * height) throw new Error('Uint8 tile source does not match the requested dimensions.');
  const output = createUint8TileBuffer(width, height, defaultValue, tileSize);
  const source = values instanceof Uint8Array ? values : Uint8Array.from(values);
  const columns = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);
  for (let tileY = 0; tileY < rows; tileY += 1) {
    const tileHeight = Math.min(tileSize, height - tileY * tileSize);
    for (let tileX = 0; tileX < columns; tileX += 1) {
      const tileWidth = Math.min(tileSize, width - tileX * tileSize);
      const tile = new Uint8Array(tileWidth * tileHeight);
      for (let localY = 0; localY < tileHeight; localY += 1) {
        const sourceStart = (tileY * tileSize + localY) * width + tileX * tileSize;
        tile.set(source.subarray(sourceStart, sourceStart + tileWidth), localY * tileWidth);
      }
      output.writeTile(tileX, tileY, tile, false);
    }
  }
  output.clearDirtyTiles();
  return output;
}

export function isTileBackedBuffer(value: unknown): value is TileBackedBuffer<TileArray> {
  return value instanceof TileBackedBuffer;
}

export function toFloat32Array(buffer: FloatTileBuffer): Float32Array {
  return buffer instanceof TileBackedBuffer ? buffer.toTypedArray() : new Float32Array(buffer);
}

export function toUint8Array(buffer: ByteTileBuffer): Uint8Array {
  return buffer instanceof TileBackedBuffer ? buffer.toTypedArray() : new Uint8Array(buffer);
}

export function cloneFloatBuffer(buffer: FloatTileBuffer): FloatTileBuffer {
  return buffer instanceof TileBackedBuffer ? buffer.clone() : new Float32Array(buffer);
}

export function cloneByteBuffer(buffer: ByteTileBuffer): ByteTileBuffer {
  return buffer instanceof TileBackedBuffer ? buffer.clone() : new Uint8Array(buffer);
}

export function clearDirtyTiles(buffer: FloatTileBuffer | ByteTileBuffer): void {
  if (buffer instanceof TileBackedBuffer) buffer.clearDirtyTiles();
}

export function tileCountForDimensions(width: number, height: number, tileSize = TERRAIN_TILE_SIZE): number {
  return Math.ceil(width / tileSize) * Math.ceil(height / tileSize);
}
