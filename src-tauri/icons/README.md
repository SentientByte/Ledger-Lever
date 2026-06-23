# App icons

These PNG/ICO/ICNS files are **pre-rendered and committed** so the release
workflow doesn't have to generate them at build time (rendering an SVG on the
Windows CI runner required system `cairo`, which isn't available there).

`app-icon.svg` is the source of truth. To regenerate the icon set after
editing it:

```bash
# 1. Render the SVG to a 512x512 PNG (no system cairo needed)
npm install @resvg/resvg-js
node -e "const {Resvg}=require('@resvg/resvg-js'),fs=require('fs');\
const r=new Resvg(fs.readFileSync('app-icon.svg'),{fitTo:{mode:'width',value:512}});\
fs.writeFileSync('app-icon.png', r.render().asPng());"

# 2. Generate all required sizes with the Tauri CLI
npx @tauri-apps/cli@latest icon app-icon.png --output .
```

Then commit the updated files. The Tauri CLI also emits `android/` and `ios/`
folders — delete those, they aren't used by the desktop build.

The files referenced by `tauri.conf.json` are `32x32.png`, `128x128.png`,
`128x128@2x.png`, and `icon.ico`.
