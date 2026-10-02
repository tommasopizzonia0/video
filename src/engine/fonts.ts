// Fonts that ship with the editor, so compositions look the same everywhere.
// All are open-source (SIL Open Font License), bundled from @fontsource.

import bricolage from '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2?url'
import frauncesItalic from '@fontsource-variable/fraunces/files/fraunces-latin-wght-italic.woff2?url'
import fraunces from '@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2?url'
import interTightItalic from '@fontsource-variable/inter-tight/files/inter-tight-latin-wght-italic.woff2?url'
import interTight from '@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2?url'
import interItalic from '@fontsource-variable/inter/files/inter-latin-wght-italic.woff2?url'
import inter from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url'
import monoItalic from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-italic.woff2?url'
import mono from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url'
import spaceGrotesk from '@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?url'
import instrumentItalic from '@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2?url'
import instrument from '@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2?url'
import type { FontSource } from './types'

export const BUILTIN_FONT_FILES: FontSource[] = [
  { family: 'Inter', src: inter, weight: '100 900' },
  { family: 'Inter', src: interItalic, weight: '100 900', style: 'italic' },
  { family: 'Inter Tight', src: interTight, weight: '100 900' },
  { family: 'Inter Tight', src: interTightItalic, weight: '100 900', style: 'italic' },
  { family: 'Fraunces', src: fraunces, weight: '100 900' },
  { family: 'Fraunces', src: frauncesItalic, weight: '100 900', style: 'italic' },
  { family: 'Instrument Serif', src: instrument, weight: '400' },
  { family: 'Instrument Serif', src: instrumentItalic, weight: '400', style: 'italic' },
  { family: 'Space Grotesk', src: spaceGrotesk, weight: '300 700' },
  { family: 'Bricolage Grotesque', src: bricolage, weight: '200 800' },
  { family: 'JetBrains Mono', src: mono, weight: '100 800' },
  { family: 'JetBrains Mono', src: monoItalic, weight: '100 800', style: 'italic' },
]
