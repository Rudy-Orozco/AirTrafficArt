/**
 * Starts the desktop app from this folder (npm run desktop). Clears
 * ELECTRON_RUN_AS_NODE, which VS Code sets in its terminals and which would
 * make Electron run as plain Node instead of opening a window.
 */
import { spawn } from 'node:child_process'
import electron from 'electron'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env })
child.on('exit', (code) => process.exit(code ?? 0))
