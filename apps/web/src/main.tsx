/**
 * Entry web (FACE). Catatan: tanpa React.StrictMode — StrictMode menggandakan
 * mount effect di dev, yang membuat Phaser di-boot dua kali. Cukup untuk Phase 1.
 */

import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

const host = document.getElementById("root");
if (!host) throw new Error("#root tidak ditemukan");
createRoot(host).render(<App />);
