import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],

  format: ["esm"],

  platform: "node",

  target: "node24",

  clean: true,

  sourcemap: true,

  noExternal: [/^@picloud\//],

  /*
   * Nativní Argon2 binding
   * musí zůstat externí.
   */
  external: ["@node-rs/argon2"],
});
