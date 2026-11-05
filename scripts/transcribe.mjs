#!/usr/bin/env node
// Runs scripts/transcribe.py with the Python that has faster-whisper: $WHISPER_PYTHON, or python3.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const python = process.env.WHISPER_PYTHON || 'python3'
const script = join(dirname(fileURLToPath(import.meta.url)), 'transcribe.py')
const r = spawnSync(python, ['-I', script, ...process.argv.slice(2)], { stdio: 'inherit' })
if (r.error) {
  console.error(`Could not run ${python}. Install Python 3 and faster-whisper (pip install faster-whisper), or set WHISPER_PYTHON.`)
  process.exit(1)
}
process.exit(r.status ?? 1)
