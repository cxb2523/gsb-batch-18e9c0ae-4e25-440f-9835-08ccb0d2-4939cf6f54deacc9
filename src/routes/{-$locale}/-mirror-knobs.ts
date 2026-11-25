import type { MIRROR } from '@/components/liquid-glass/engine'

// What the rim mirrors of its surroundings (MIRROR in engine.ts), as sliders: shared by the labs
// that tune it (/mirror-lab, /pull-lab). Not a route: the leading dash keeps the router off it.

export type MirrorKey = keyof typeof MIRROR

// Bumped when the set of values changes, so stale saved ones do not override the kit's.
export const MIRROR_STORE = 'glass-mirror-tuning-5'

// Each knob: its range and what it does, in both languages.
export const MIRROR_KNOBS: { key: MirrorKey; min: number; max: number; step: number; en: string; tr: string; hintEn: string; hintTr: string }[] = [
  { key: 'line', min: 0, max: 1, step: 0.05, en: 'On the rim line', tr: 'Kenar çizgisinde', hintEn: 'How much of the neighbour shows on the line at the rim. The line is as thin as the rim light under the cursor, and gets no thicker', hintTr: 'Komşunun, kenardaki çizgide ne kadar göründüğü. Çizgi imleç altındaki kenar ışığı kadar incedir, kalınlaşmaz' },
  { key: 'band', min: 0, max: 2, step: 0.05, en: 'Picture inside the rim', tr: 'Kenarın içindeki görüntü', hintEn: 'How much of it shows just inside the line; it fades inwards from there', hintTr: 'Çizginin hemen içinde ne kadar göründüğü; oradan içeri doğru söner' },
  { key: 'depth', min: 0.05, max: 2, step: 0.01, en: 'Picture depth', tr: 'Görüntü derinliği', hintEn: 'How deep the picture goes (× half the glass): deepest where the neighbour is nearest, thinner round the sides', hintTr: 'Görüntünün ne kadar derine indiği (× camın yarısı): komşunun en yakın olduğu yerde en derin, yanlara doğru incelir' },
  { key: 'fall', min: 0.2, max: 6, step: 0.05, en: 'Fade inwards', tr: 'İçeri sönüş', hintEn: 'How fast it fades from the rim inwards: higher keeps it closer to the rim', hintTr: 'Kenardan içeri ne kadar hızlı söndüğü: yükseldikçe kenara yakın kalır' },
  { key: 'soft', min: 0, max: 1, step: 0.01, en: 'Softness', tr: 'Yumuşaklık', hintEn: 'How blurred the picture is (0 = a sharp mirror image of the neighbour)', hintTr: 'Görüntünün bulanıklığı (0 = komşunun keskin ayna görüntüsü)' },
  { key: 'gain', min: 0, max: 4, step: 0.05, en: 'Gain', tr: 'Kazanç', hintEn: 'How much more than its plain difference from the surface a neighbour counts', hintTr: 'Komşunun, yüzeyden farkının kaç katı sayıldığı' },
  { key: 'dim', min: 0, max: 1, step: 0.05, en: 'Darker neighbours', tr: 'Koyu komşular', hintEn: 'How much a neighbour darker than the surface dims the rim (0 = not at all)', hintTr: 'Yüzeyden koyu bir komşunun kenarı ne kadar kararttığı (0 = hiç)' },
  { key: 'reach', min: 0.1, max: 3, step: 0.05, en: 'Reach', tr: 'Menzil', hintEn: 'How far the rim\'s edge looks (× the glass\'s height): a further neighbour still shows, as a thinner crescent', hintTr: 'Kenarın ucunun ne kadar uzağa baktığı (× cam yüksekliği): daha uzak komşu da görünür, daha ince bir hilal olarak' },
  { key: 'reachMin', min: 0, max: 96, step: 1, en: 'Reach, at least (px)', tr: 'Menzil, en az (px)', hintEn: 'Small glass looks at least this far', hintTr: 'Küçük cam en az bu kadar uzağa bakar' },
  { key: 'reachMax', min: 16, max: 240, step: 1, en: 'Reach, at most (px)', tr: 'Menzil, en çok (px)', hintEn: 'Tall glass looks no further than this', hintTr: 'Yüksek cam bundan uzağa bakmaz' },
  { key: 'near', min: 0, max: 1, step: 0.05, en: 'Share: near', tr: 'Pay: yakın', hintEn: 'How much of what a point gathers comes from the near end of its look', hintTr: 'Bir noktanın topladığının ne kadarı bakışının yakın ucundan gelir' },
  { key: 'mid', min: 0, max: 1, step: 0.05, en: 'Share: halfway', tr: 'Pay: yarı yol', hintEn: 'How much comes from halfway along its look', hintTr: 'Ne kadarı bakışının ortasından gelir' },
  { key: 'far', min: 0, max: 1, step: 0.05, en: 'Share: far end', tr: 'Pay: uzak uç', hintEn: 'How much comes from the far end of its look', hintTr: 'Ne kadarı bakışının ucundan gelir' },
  { key: 'bounce', min: 0, max: 1.5, step: 0.05, en: 'Far side of the rim light', tr: 'Kenar ışığının uzak tarafı', hintEn: 'Its brightness, against the lit side (the old blue edge sat here)', hintTr: 'Aydınlık tarafa göre parlaklığı (eski mavi kenar buradaydı)' },
  { key: 'tint', min: 0, max: 1, step: 0.05, en: 'Far side takes colour', tr: 'Uzak taraf renk alır', hintEn: 'How much of the surroundings\' colour that side takes (0 = always white)', hintTr: 'O tarafın çevrenin renginden ne kadar aldığı (0 = hep beyaz)' },
]
