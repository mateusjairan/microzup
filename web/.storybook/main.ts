import type { StorybookConfig } from "@storybook/react-vite";

/**
 * Storybook OFFLINE (§14): framework react-vite, addon a11y, sem rede —
 * nenhuma dependência é baixada em runtime (tudo de node_modules local).
 */
const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx"],
  addons: ["@storybook/addon-a11y"],
  staticDirs: ["../src/assets"],
};

export default config;
