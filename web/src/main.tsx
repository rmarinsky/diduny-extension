import { render } from "hono/jsx/dom";
import "./i18n";
import { App } from "./App";

const root = document.getElementById("root");

if (!root) throw new Error("Missing root element");

render(<App />, root);
