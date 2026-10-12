import { render } from "preact";
import "../design/tokens.css";
import "../design/brand.css";
import "./github.css";
import { GitHubSite } from "./GitHubSite";
import { pages } from "./links";

const page = pages.find((entry) => entry.id === document.body.dataset.page);
const mount = document.getElementById("app");
if (!page || !mount) throw new Error("Unknown public page");
render(<GitHubSite page={page.id} />, mount);
