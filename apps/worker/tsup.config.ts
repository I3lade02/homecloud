import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/worker.ts"],

  format: ["esm"],

  platform: "node",

  target: "node24",

  clean: true,

  sourcemap: true,

  noExternal: [/^@picloud\//],

  /**
   * Sharp obsahuje nativní
   * platformní knihovny
   */
  external: ["sharp"],
});
