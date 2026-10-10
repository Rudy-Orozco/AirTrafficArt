# AirTrafficArt
## Desktop app

The app can run as a desktop app (Electron). From `frontend/`:

| Command | What it does |
| --- | --- |
| `npm run desktop` | Build and open the desktop app |
| `npm run desktop:kiosk` | Same, full screen with no way out but closing (for a wall display) |
| `npm run dist:win` | Windows installer and portable zip (run on Windows; the installer needs Wine on Linux) |
| `npm run dist:win:zip` | Windows portable zip only (works from Linux too) |
| `npm run dist:linux` / `npm run dist:mac` | Linux AppImage / macOS disk image (build the Mac one on a Mac) |

Packages land in `frontend/release/`. In the app: F11 toggles full screen, Ctrl+R reloads, Ctrl+Shift+I opens developer tools.
