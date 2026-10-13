// Directory-loader entrypoint. OpenCode v2 resolves `<dir>/server` for file:// plugin
// directories (the package.json exports map only applies to named npm packages).
export { default } from "./dist/index.js"
