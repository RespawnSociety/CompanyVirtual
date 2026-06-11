// Deklarasi tipe minimal untuk easystarjs (lib JS tanpa types resmi).
declare module "easystarjs" {
  export interface PathNode {
    x: number;
    y: number;
  }
  export class js {
    setGrid(grid: number[][]): void;
    setAcceptableTiles(tiles: number[] | number): void;
    enableDiagonals(): void;
    disableDiagonals(): void;
    enableCornerCutting(): void;
    disableCornerCutting(): void;
    enableSync(): void;
    setIterationsPerCalculation(iterations: number): void;
    avoidAdditionalPoint(x: number, y: number): void;
    findPath(
      startX: number,
      startY: number,
      endX: number,
      endY: number,
      callback: (path: PathNode[] | null) => void,
    ): number;
    calculate(): void;
    cancelPath(instanceId: number): boolean;
  }
  const EasyStar: { js: typeof js };
  export default EasyStar;
}
