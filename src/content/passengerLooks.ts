export type PassengerLookId = 'nora-red';

/**
 * One authored palette for Nora in every representation: roadside, boarding and seated.
 * Keeping it independent from the passenger roster avoids visual drift between scenes.
 */
export const NORA_RED_LOOK = {
  id: 'nora-red' as const,
  // Muted wine red reads as fabric under the bus lamps instead of neon plastic.
  dress: 0x7f1f2d,
  dressShadow: 0x45131b,
  skin: 0xb77f68,
  // Natural ash-blonde with warmer lowlights and visible darker roots.
  hair: 0xc2af91,
  hairShadow: 0x746554,
  hairRoot: 0x5e5144,
  hairHighlight: 0xd8c9ad,
  eyes: 0x48635f,
  lips: 0x8f2039,
  shoes: 0x2a070d,
  jewellery: 0xd3b46b,
} as const;
