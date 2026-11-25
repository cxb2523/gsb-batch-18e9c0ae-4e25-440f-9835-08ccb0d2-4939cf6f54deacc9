// The values the lab's popup differs by, laid over the kit's own (`engine.ts`). Everything not
// named here is the kit's, so the two columns of /popup-lab differ by exactly these.
import {
  GLOW as KIT_GLOW,
  GLOW_SMALL as KIT_GLOW_SMALL,
  GOOEY as KIT_GOOEY,
  MORPH as KIT_MORPH,
  MORPH_GLOW as KIT_MORPH_GLOW,
  MORPH_GLOW_SMALL as KIT_MORPH_GLOW_SMALL,
} from '@/components/liquid-glass/engine'

/** The opening light spills a little further past the surface's edge than the kit's. */
export const GLOW = { ...KIT_GLOW, halo: 0.5 }
export const GLOW_SMALL = { ...KIT_GLOW_SMALL, halo: GLOW.halo }

/** A morphing control's press light comes up softly and stays fainter: the control is not flooded white in one frame. */
export const MORPH_GLOW = { ...KIT_MORPH_GLOW, halo: GLOW.halo, amount: 1.4, riseSpeed: 9 }
export const MORPH_GLOW_SMALL = { ...KIT_MORPH_GLOW_SMALL, halo: GLOW.halo, amount: MORPH_GLOW.amount, riseSpeed: MORPH_GLOW.riseSpeed }

export const GOOEY = {
  ...KIT_GOOEY,
  /** The list (cut to the glass) comes in from 30% open, while the panel grows, not after it. */
  itemsAt: 0.3,
  /** Closing, the list fades out as one in this long (seconds), while the glass goes back in. */
  closeFade: 0.2,
  /** × the rewind's pace while the panel is still all but open (the neck forming back), so the glass starts going in at once. */
  closeNeckPace: 3,
}

export const MORPH = {
  ...KIT_MORPH,
  /** The side that grows the most opens on a calmer spring: the surface does not balloon in a few frames. */
  openSpeed: 18,
  /** The control's label fades out with a blur as the surface comes out (0–1 of the calm follow; CSS px). */
  labelOut: 0.5,
  labelBlur: 4,
  /** Closing: the list fades out and the control's label fades in, in step, from this far open… */
  closeLabel: 0.45,
  /** …to this far: list gone, label whole. */
  closeLabelEnd: 0.08,
  /** How softly (CSS px) the surface melts into the control where they meet, scaled by how far it sticks out. */
  melt: 18,
  /** The surface's edge, soft as it comes out and sharp as it settles (CSS px of blur; 0 = off), and when it is sharp (0–1 of the calm follow). */
  edgeSoft: 0,
  edgeSharpAt: 0.001,
}
