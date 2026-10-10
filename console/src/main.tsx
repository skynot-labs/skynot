import "@fontsource/fraunces/400.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { render } from "preact";
import { App } from "./App";
import "./styles.css";

render(<App />, document.getElementById("app")!);
