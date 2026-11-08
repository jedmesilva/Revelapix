import { Gift } from "lucide-react";
import "./_group.css";

export function Current() {
  return (
    <main className="preview-stage current-frame">
      <div className="preview-cell">
        <div
          className="cell revealing"
          role="button"
          aria-label="Revelando célula 8"
          aria-disabled="true"
          aria-busy="true"
          tabIndex={0}
        >
          <div className="box">
            <Gift className="icon" />
            <span className="reveal-message">Revelando…</span>
          </div>
        </div>
      </div>
    </main>
  );
}
