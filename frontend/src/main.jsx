import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import "./accessibility.css";
import "./host-privacy.css";

createRoot(document.getElementById("root")).render(<App />);
