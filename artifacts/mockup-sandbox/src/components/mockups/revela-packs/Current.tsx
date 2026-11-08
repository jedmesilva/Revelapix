import { X } from "lucide-react";
import "./_group.css";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const packs = [
  { n: 1, priceCents: 500 },
  { n: 5, priceCents: 2000 },
  { n: 10, priceCents: 3500 },
  { n: 25, priceCents: 7500 },
];

export function Current() {
  return (
    <main className="preview-stage">
      <div className="overlay">
        <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="current-packs-title">
          <div className="sheet-head">
            <h2 id="current-packs-title">Comprar chances</h2>
            <button className="x" type="button" aria-label="Fechar">
              <X className="icon" />
            </button>
          </div>
          <p className="sub">Cada chance revela uma célula.</p>
          <div className="packs">
            {packs.map((pack) => (
              <button className="pack" type="button" key={pack.n}>
                <div>
                  <b>{pack.n} {pack.n === 1 ? "chance" : "chances"}</b>
                  <small>{currency.format(pack.priceCents / pack.n / 100)} por chance</small>
                </div>
                <span>{currency.format(pack.priceCents / 100)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
