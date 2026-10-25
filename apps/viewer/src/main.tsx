import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RenderApp } from "./RenderApp";
import "./index.css";

const render = new URLSearchParams(location.search).has("render");

createRoot(document.getElementById("root")!).render(<StrictMode>{render ? <RenderApp /> : <App />}</StrictMode>);
