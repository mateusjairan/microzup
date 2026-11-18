import React from "react";
import { definePreview } from "@storybook/react-vite";
import "../src/styles/index.css";
import { I18nProvider } from "../src/app/I18nProvider";
import { ThemeProvider, type ThemePreference } from "../src/app/ThemeProvider";
import { ToastProvider } from "../src/app/ToastProvider";
import { ShortcutsProvider } from "../src/app/ShortcutsProvider";

/** Toolbar de tema (core do Storybook — sem addon extra, sem rede). */
const globalTypes = {
  theme: {
    description: "Tema claro/escuro (tokens.css)",
    defaultValue: "system" as ThemePreference,
    toolbar: {
      title: "Tema",
      icon: "mirror",
      items: [
        { value: "light", icon: "sun", title: "Claro" },
        { value: "dark", icon: "moon", title: "Escuro" },
        { value: "system", icon: "mirror", title: "Seguir o sistema" },
      ],
      dynamicTitle: true,
    },
  },
};

const preview = definePreview({
  parameters: {
    layout: "centered",
    a11y: {
      // sem violações sérias é o critério (§14)
      config: {},
    },
  },
  globalTypes,
  decorators: [
    (Story: React.ComponentType, context: { globals: { theme?: string } }) => {
      const preference = (context.globals.theme as ThemePreference | undefined) ?? "system";
      return (
        <I18nProvider>
          <ThemeProvider preference={preference}>
            <ToastProvider>
              <ShortcutsProvider>
                <Story />
              </ShortcutsProvider>
            </ToastProvider>
          </ThemeProvider>
        </I18nProvider>
      );
    },
  ],
});

export default preview;
