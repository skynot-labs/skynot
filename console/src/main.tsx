import "./design/tokens.css";
import "./ui/styles.css";
import "./ui/skynot.css";
import "./ui/studio.css";
import "./ui/avatar-editor.css";
import "./ui/studio-customizer.css";
import "./design/brand.css";
import "./design/design-system.css";
import { render } from "preact";
import { z } from "zod";
import { App } from "./App";
import { DesignSystem } from "./design/DesignSystem";
import { isDesignPage } from "./paths";

// zod tests for eval before its first parse, and the published studio's content policy reports that as a violation.
z.config({ jitless: true });

render(
  isDesignPage(window.location) ? <DesignSystem /> : <App />,
  document.getElementById("app")!,
);
