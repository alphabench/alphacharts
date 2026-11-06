// Plain-JS building blocks for the recipe fixtures. Deliberately naive loops over arrays, sharing no code with the engine.

export const NA = Number.NaN;
export const blank = (n) => new Array(n).fill(NA);
