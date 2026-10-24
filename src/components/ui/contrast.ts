// Picks readable text (white or ink) for the owner's chosen colour by WCAG contrast.
// The embeddable widget (src/lib/widget-script.ts) keeps its own copy of this logic.

export const INK = '#13201C';
const WHITE = '#FFFFFF';

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

export function readableTextOn(hex: string): '#FFFFFF' | '#13201C' {
  const rgb = parseHex(hex);
  if (!rgb) return WHITE;
  const bg = luminance(rgb);
  const onWhite = contrast(bg, 1);
  const onInk = contrast(bg, luminance(parseHex(INK)!));
  return onInk > onWhite ? INK : WHITE;
}
