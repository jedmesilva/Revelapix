import { useState } from "react";
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
const singleChancePrice = packs.find((pack) => pack.n === 1)?.priceCents;
const lowestUnitPrice = Math.min(...packs.map((pack) => pack.priceCents / pack.n));

export function Improved() {
  const [selectedPack, setSelectedPack] = useState(1);
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
          <p className="sub">Cada chance revela uma célula.</p>
          <fieldset className="pack-grid" aria-label="Pacotes de chances disponíveis">
            <legend className="sr-only">Selecione um pacote de chances</legend>
            {packs.map((pack) => {
              const unitPrice = pack.priceCents / pack.n;
              const savings = singleChancePrice && pack.n > 1
                ? Math.round((1 - unitPrice / singleChancePrice) * 100)
                : 0;
              const bestValue = pack.n > 1 && unitPrice === lowestUnitPrice;
              const isSelected = selectedPack === pack.n;

              return (
                <label
                  className={`pack-option${isSelected ? " selected" : ""}${bestValue ? " is-best" : ""}`}
                  key={pack.n}
                  data-testid={`button-pack-${pack.n}`}
                >
                  <input
                    className="pack-radio-input"
                    type="radio"
                    name="chance-pack"
                    value={pack.n}
                    checked={isSelected}
                    onChange={() => setSelectedPack(pack.n)}
                  />
                  <span className="pack-radio" aria-hidden="true" />
                  <span className="pack-main">
                    <span className="pack-name">{pack.n} {pack.n === 1 ? "chance" : "chances"}</span>
                    <span className="pack-unit">
                      {savings > 0 && singleChancePrice !== undefined && (
                        <s>{currency.format(singleChancePrice / 100)}</s>
                      )}
                      {currency.format(unitPrice / 100)} por chance
                    </span>
                  </span>
                  <span className="pack-end">
                    <span className="pack-total">{currency.format(pack.priceCents / 100)}</span>
                    {savings > 0 && <span className="pack-badge">−{savings}%</span>}
                  </span>
                  {bestValue ? (
                    <span className="pack-best">Melhor valor</span>
                  ) : null}
                </label>
              );
            })}
          </fieldset>
          <div className="pack-confirm">
            <button className="pack-continue" type="button" disabled={!selected}>
              {selected
                ? `Pagar ${currency.format(selected.priceCents / 100)} com Pix`
                : "Selecione um pacote"}
            </button>
            <p className="pack-footnote">Pix demonstrativo · nenhuma cobrança real será feita</p>
          </div>
        </section>
      </div>
    </main>
  );
}
