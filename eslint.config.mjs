import canvaPlugin from "@canva/app-eslint-plugin";

export default [
  {
    ignores: [
      "**/node_modules/",
      "**/dist",
      "**/*.d.ts",
      "**/*.d.tsx",
      "templates/**/*",
      ".agents/**",
      ".claude/**",
      ".codex/**",
    ],
  },
  ...canvaPlugin.configs.apps_no_i18n,
  {
    files: [
      "src/**/*",
      // Currently only the localization examples are localized and following the
      // formatjs guidelines. If more examples are localized, this list should be
      // updated:
      "examples/localization/**/*",
      "examples/content_replacement/text_translation/**/*",
    ],
    ...canvaPlugin.configs.apps_i18n,
  },
];
