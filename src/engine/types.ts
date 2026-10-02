// The composition format: a JSON description of a motion-design video.
// Everything here is plain data, so a project can be written by hand (or by Claude),
// validated, previewed in the browser and rendered headlessly to MP4.
// The full reference with examples lives in docs/MOTION.md.

/** Easing: a name ("outExpo", "inOutCubic", "spring", ...), a cubic-bezier array, or a spring config. */
export type Ease =
  | string
  | [number, number, number, number]
  | { spring: { stiffness?: number; damping?: number; mass?: number } }

/** One keyframe. `t` is seconds from the layer start; `ease` shapes the motion that arrives at this keyframe. */
export interface Keyframe<T> {
  t: number
  v: T
  ease?: Ease
}

/** A two-value tween: from `from` to `to`, starting `at` seconds after the layer start. */
export interface Tween<T> {
  from: T
  to: T
  at?: number
  duration: number
  ease?: Ease
}

/** A value that can be constant, a list of keyframes, or a tween. */
export type Anim<T> = T | Keyframe<T>[] | Tween<T>

export interface GradientStopList {
  stops: [number, string][]
}
export interface LinearGradient extends GradientStopList {
  type: 'linear'
  /** Degrees, CSS convention: 0 = bottom to top, 90 = left to right, 180 = top to bottom. */
  angle?: number
}
export interface RadialGradient extends GradientStopList {
  type: 'radial'
  /** Center, relative to the box (0..1). */
  cx?: number
  cy?: number
  /** Radius, relative to the box diagonal / 2. */
  r?: number
}
export type Gradient = LinearGradient | RadialGradient
/** A color string ("#16b07a", "rgba(0,0,0,.5)", "white") or a gradient. Colors can be animated. */
export type Fill = Anim<string> | Gradient

export interface Shadow {
  color?: string
  blur?: number
  x?: number
  y?: number
}

export interface Stroke {
  color: string
  width?: number
}

export type PresetName =
  | 'none'
  | 'fade'
  | 'fadeUp'
  | 'fadeDown'
  | 'fadeLeft'
  | 'fadeRight'
  | 'slideUp'
  | 'slideDown'
  | 'slideLeft'
  | 'slideRight'
  | 'scale'
  | 'zoom'
  | 'pop'
  | 'blur'
  | 'maskUp'
  | 'maskDown'
  | 'maskLeft'
  | 'maskRight'
  | 'wipeUp'
  | 'wipeDown'
  | 'wipeLeft'
  | 'wipeRight'
  | 'rotate'
  | 'appear'

export interface PresetConfig {
  type: PresetName
  duration?: number
  delay?: number
  ease?: Ease
  /** Travel distance in px for moving presets. */
  distance?: number
  /** Start scale for scale/zoom/pop. */
  scale?: number
  /** Start blur in px for blur. */
  blur?: number
  /** Start angle in degrees for rotate. */
  angle?: number
}
/** An entrance or exit animation. Several can be combined: ["fadeUp", "blur"]. */
export type Preset = PresetName | PresetConfig | (PresetName | PresetConfig)[]

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'add'

export interface LayerBase {
  type: string
  id?: string
  /** Free text for humans; ignored by the renderer. */
  comment?: string
  hidden?: boolean
  /** Seconds after the parent (comp, scene or group) starts. */
  start?: number
  /** Seconds; defaults to the rest of the parent. */
  duration?: number

  /** Position of the anchor point in the parent, px. Defaults to the parent's center. */
  x?: Anim<number>
  y?: Anim<number>
  /** Anchor point relative to the layer box: [0,0] top-left, [0.5,0.5] center (default). */
  anchor?: [number, number]
  scale?: Anim<number>
  scaleX?: Anim<number>
  scaleY?: Anim<number>
  /** Degrees, clockwise. */
  rotation?: Anim<number>
  skewX?: Anim<number>
  opacity?: Anim<number>

  /** Gaussian blur in px. */
  blur?: Anim<number>
  /** 1 = unchanged. */
  brightness?: Anim<number>
  contrast?: Anim<number>
  saturate?: Anim<number>
  /** 0..1 */
  grayscale?: Anim<number>
  /** Degrees. */
  hueRotate?: Anim<number>
  shadow?: Shadow
  blend?: BlendMode

  in?: Preset
  out?: Preset
}

export interface RectLayer extends LayerBase {
  type: 'rect'
  width: Anim<number>
  height: Anim<number>
  radius?: Anim<number>
  fill?: Fill
  stroke?: Stroke
}

export interface EllipseLayer extends LayerBase {
  type: 'ellipse'
  width: Anim<number>
  height: Anim<number>
  fill?: Fill
  stroke?: Stroke
}

export interface PathLayer extends LayerBase {
  type: 'path'
  /** SVG path data. */
  d: string
  width: number
  height: number
  /** Coordinate system of `d` as [minX, minY, width, height]; it is scaled into the layer box. Defaults to the box. */
  viewBox?: [number, number, number, number]
  fill?: Fill
  stroke?: Stroke
  lineCap?: 'butt' | 'round' | 'square'
  lineJoin?: 'miter' | 'round' | 'bevel'
  /** Draw only part of the stroke, 0..1 of its length. Animate `trimEnd` 0 → 1 to draw a line. */
  trimStart?: Anim<number>
  trimEnd?: Anim<number>
}

export interface TextStyle {
  font?: string
  weight?: number
  italic?: boolean
  color?: Fill
}

export interface TextAnimation {
  /** Animate per character, word or line. */
  by?: 'char' | 'word' | 'line'
  preset?: Preset
  /** Seconds between two units. */
  stagger?: number
  duration?: number
  delay?: number
  ease?: Ease
  /** Which unit goes first. */
  order?: 'start' | 'end' | 'center' | 'edges' | 'random'
}

export interface TextBackground {
  fill: Fill
  /** [vertical, horizontal] px, or one number for both. */
  padding?: number | [number, number]
  radius?: number
  /** One box around the whole text, or one per line (highlighter look). */
  mode?: 'box' | 'line'
}

export interface Counter {
  from: number
  to: number
  at?: number
  duration?: number
  ease?: Ease
  decimals?: number
  prefix?: string
  suffix?: string
  /** Thousands separator, e.g. "." for Italian. */
  separator?: string
}

export interface TextLayer extends LayerBase {
  type: 'text'
  /** Use \n for line breaks. When `accent` is set, {curly braces} mark the accented part. */
  text: string
  font?: string
  size?: number
  weight?: number
  italic?: boolean
  color?: Fill
  /** In em: -0.03 is a typical tight headline. */
  letterSpacing?: number
  /** Multiplier of the font size. */
  lineHeight?: number
  align?: 'left' | 'center' | 'right'
  /** Wrap width in px. */
  width?: number
  uppercase?: boolean
  stroke?: Stroke
  accent?: TextStyle
  background?: TextBackground
  animate?: TextAnimation
  exit?: TextAnimation
  counter?: Counter
}

export type Fit = 'cover' | 'contain' | 'fill'

export interface ImageLayer extends LayerBase {
  type: 'image'
  asset: string
  width?: Anim<number>
  height?: Anim<number>
  fit?: Fit
  radius?: Anim<number>
}

export interface VideoLayer extends LayerBase {
  type: 'video'
  asset: string
  width?: Anim<number>
  height?: Anim<number>
  fit?: Fit
  radius?: Anim<number>
  /** Seconds into the source where the layer starts playing. */
  sourceStart?: number
  playbackRate?: number
  volume?: number
  muted?: boolean
}

export interface GroupLayer extends LayerBase {
  type: 'group'
  layers: Layer[]
  width?: Anim<number>
  height?: Anim<number>
  /** Hide children outside the group box (with `radius`). */
  clip?: boolean
  radius?: Anim<number>
  fill?: Fill
  stroke?: Stroke
}

export type Layer = RectLayer | EllipseLayer | PathLayer | TextLayer | ImageLayer | VideoLayer | GroupLayer

export type TransitionType = 'cut' | 'fade' | 'dip' | 'slide' | 'push' | 'zoom' | 'blur' | 'wipe' | 'iris'

export interface Transition {
  type: TransitionType
  duration?: number
  ease?: Ease
  direction?: 'left' | 'right' | 'up' | 'down'
  /** Color for "dip". */
  color?: string
}

export interface Scene {
  id?: string
  comment?: string
  duration: number
  background?: Fill
  layers: Layer[]
  /** How this scene enters, overlapping the end of the previous one. */
  transition?: Transition
}

export interface Asset {
  type: 'image' | 'video' | 'audio'
  /** Path relative to the composition file, or a URL. */
  src: string
}

export interface FontSource {
  family: string
  src: string
  weight?: string
  style?: 'normal' | 'italic'
}

export interface AudioClip {
  asset: string
  /** Comp time in seconds. */
  start?: number
  /** Seconds into the source. */
  sourceStart?: number
  duration?: number
  volume?: number
  fadeIn?: number
  fadeOut?: number
}

export interface Effects {
  /** Film grain strength, 0..1 (0.04 to 0.08 is subtle). */
  grain?: number
  /** Darkened corners, 0..1. */
  vignette?: number
  /** Motion blur on export: subframes per frame and shutter (0..1 of a frame). */
  motionBlur?: { samples?: number; shutter?: number }
}

export interface Composition {
  width: number
  height: number
  fps?: number
  /** Seconds. Defaults to the end of the last scene. */
  duration?: number
  background?: Fill
  fonts?: FontSource[]
  assets?: Record<string, Asset>
  audio?: AudioClip[]
  scenes?: Scene[]
  /** Drawn above the scenes, in comp time. */
  layers?: Layer[]
  effects?: Effects
}
