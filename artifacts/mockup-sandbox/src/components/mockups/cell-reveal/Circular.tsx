import { Gift } from "lucide-react";
import "./_group.css";

export function Circular() {
  return (
    <main className="preview-stage spinner-frame">
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
            <span className="reveal-spinner" aria-hidden="true">
              <Gift className="icon" />
            </span>
            <span className="reveal-message">Revelando…</span>
          </div>
        </div>
      </div>
    </main>
  );
}
