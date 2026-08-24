import * as THREE from 'three';

/**
 * Every texture in the game is drawn here, at run time, on a 2D canvas. No image files
 * means no loading, no licensing, and signage that can say anything the script needs it
 * to say — including a mile marker that reads a number that should not exist.
 */

export function canvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  existing?: THREE.CanvasTexture,
): THREE.CanvasTexture {
  const canvas = existing
    ? (existing.image as HTMLCanvasElement)
    : Object.assign(document.createElement('canvas'), { width, height });
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, width, height);
  draw(ctx, width, height);

  const texture = existing ?? new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const HIGHWAY_FONT = "'Arial Narrow', 'Haettenschweiler', Impact, sans-serif";

function centredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  colour: string,
  weight = 'bold',
): void {
  ctx.font = `${weight} ${size}px ${HIGHWAY_FONT}`;
  ctx.fillStyle = colour;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/** Grime, so nothing in the world looks freshly minted. */
function weather(ctx: CanvasRenderingContext2D, w: number, h: number, amount = 0.16): void {
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * 255 * amount;
    data[i] = Math.max(0, Math.min(255, data[i] + n));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
  }
  ctx.putImageData(image, 0, 0);
}

/** The small green post that tells you how far you have come. */
export function mileMarkerTexture(mile: number, existing?: THREE.CanvasTexture): THREE.CanvasTexture {
  return canvasTexture(
    48,
    96,
    (ctx, w, h) => {
      ctx.fillStyle = '#0e3a1c';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#d8d8d0';
      ctx.lineWidth = 3;
      ctx.strokeRect(3, 3, w - 6, h - 6);
      centredText(ctx, 'MILE', w / 2, 22, 17, '#d8d8d0');
      const digits = String(Math.max(0, Math.round(mile)));
      centredText(ctx, digits, w / 2, 58, digits.length > 2 ? 30 : 38, '#d8d8d0');
      weather(ctx, w, h, 0.2);
    },
    existing,
  );
}

export type SignKind = 'destination' | 'warning' | 'speed' | 'service';

/** Roadside signage. Text is data so the script can put words on the highway. */
export function signTexture(
  kind: SignKind,
  lines: string[],
  existing?: THREE.CanvasTexture,
): THREE.CanvasTexture {
  const w = 160;
  const h = kind === 'warning' ? 160 : 112;
  return canvasTexture(
    w,
    h,
    (ctx) => {
      if (kind === 'warning') {
        // diamond on yellow, drawn as a rotated square inset in the quad
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#c8a415';
        ctx.fillRect(-52, -52, 104, 104);
        ctx.strokeStyle = '#141008';
        ctx.lineWidth = 4;
        ctx.strokeRect(-46, -46, 92, 92);
        ctx.restore();
        lines.forEach((line, i) => {
          centredText(ctx, line, w / 2, h / 2 - (lines.length - 1) * 11 + i * 22, 20, '#141008');
        });
      } else if (kind === 'speed') {
        ctx.fillStyle = '#d6d3c8';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#16150f';
        ctx.lineWidth = 5;
        ctx.strokeRect(6, 6, w - 12, h - 12);
        centredText(ctx, 'SPEED', w / 2, 26, 20, '#16150f');
        centredText(ctx, 'LIMIT', w / 2, 48, 20, '#16150f');
        centredText(ctx, lines[0] ?? '55', w / 2, 82, 42, '#16150f');
      } else {
        ctx.fillStyle = kind === 'service' ? '#123a6b' : '#0e3a1c';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#d8d8d0';
        ctx.lineWidth = 4;
        ctx.strokeRect(7, 7, w - 14, h - 14);
        const step = h / (lines.length + 1);
        lines.forEach((line, i) => {
          centredText(ctx, line, w / 2, step * (i + 1), lines.length > 2 ? 22 : 28, '#e6e4d8');
        });
      }
      weather(ctx, w, h, 0.14);
    },
    existing,
  );
}
