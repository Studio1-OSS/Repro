import { createRoot } from "react-dom/client";
import "../popup/style.css";
import { Annotate } from "./Annotate";

document.body.style.width = "auto";
createRoot(document.getElementById("root")!).render(<Annotate />);
