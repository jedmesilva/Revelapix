import { useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
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
const singleChancePrice = packs.find((pack) => pack.n === 1)?.priceCents;
const lowestUnitPrice = Math.min(...packs.map((pack) => pack.priceCents / pack.n));

export function Improved() {
  const [selectedPack, setSelectedPack] = useState<number | null>(null);
  const selected = packs.find((pack) => pack.n === selectedPack);

  return (
    <main className="preview-stage">
      <div className="overlay">
        <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="improved-packs-title">
          <div className="sheet-head">
            <h2 id="improved-packs-title">Comprar chances</h2>
            <button className="x" type="button" aria-label="Fechar">
              <X className="icon" />
            </button>
          </div>
          <div className="pack-intro">
            <p className="sub">Cada chance revela uma célula.</p>
            <div className="pack-explainer">
              <Sparkles className="icon" aria-hidden="true" />
              <span>Compare o valor por chance e escolha seu pacote.</span>
            </div>
          </div>
          <div className="pack-grid" role="group" aria-label="Pacotes de chances disponíveis">
            {packs.map((pack) => {
              const unitPrice = pack.priceCents / pack.n;
              const savings = singleChancePrice && pack.n > 1
                ? Math.round((1 - unitPrice / singleChancePrice) * 100)
                : 0;
              const bestValue = pack.n > 1 && unitPrice === lowestUnitPrice;
              const isSelected = selectedPack === pack.n;

              return (
                <button
                  className={`pack-option${isSelected ? " selected" : ""}`}
                  type="button"
                  key={pack.n}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedPack(pack.n)}
                >
                  <span className="pack-option-head">
                    <span className="pack-amount">
                      {pack.n}
                      <small>{pack.n === 1 ? "chance" : "chances"}</small>
                    </span>
                    <span className={`pack-selector${isSelected ? " checked" : ""}`} aria-hidden="true">
                      {isSelected && <Check className="icon" />}
                    </span>
                  </span>
                  <span className="pack-total">{currency.format(pack.priceCents / 100)}</span>
                  <span className="pack-unit">{currency.format(unitPrice / 100)} por chance</span>
                  {bestValue ? (
                    <span className="pack-badge best">Menor valor por chance</span>
                  ) : savings > 0 ? (
                    <span className="pack-badge">-{savings}% por chance</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="pack-confirm">
            <button className="pack-continue" type="button" disabled={!selected}>
              <span>{selected ? "Continuar para o Pix" : "Escolha um pacote"}</span>
              {selected && <span>{currency.format(selected.priceCents / 100)}</span>}
            </button>
            <p className="pack-footnote">Pix demonstrativo · nenhuma cobrança real será feita</p>
          </div>
        </section>
      </div>
    </main>
  );
}
