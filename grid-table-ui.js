(() => {
  "use strict";

  /*
   * Tableau de barème éditable, partagé par les barèmes 3 × 500 et Laser Run.
   *
   * Une ligne = des points et le seuil à partir duquel ils sont attribués :
   * - grille commune : Points | valeur ;
   * - grille filles / garçons : Points | Filles | Garçons.
   *
   * mount(container, options) remplit le conteneur et renvoie
   * { read(), set(data) } :
   * - read() -> { rows } ou { girls, boys } au format [[valeur, points], …],
   *   ou { error } si une ligne est incomplète ;
   * - set(data) remplace le contenu (ex. préréglage Seconde / Première).
   */

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  function isDuration(text) {
    return /^(\d+:)?\d+:\d+(\.\d+)?$/.test(String(text).trim());
  }

  function isNumber(text) {
    return /^-?\d+([.,]\d+)?$/.test(String(text).trim());
  }

  function toTable(data, split) {
    const text = v => v == null ? "" : String(v);
    if (!split) return (data.rows || []).map(([value, pts]) => ({pts:text(pts), all:text(value), girls:"", boys:""}));
    const girls = data.girls || [], boys = data.boys || [];
    if (girls.length === boys.length) {
      return girls.map(([value, pts], i) => ({pts:text(pts), all:"", girls:text(value), boys:text(boys[i][0])}));
    }
    const points = [...new Set([...girls, ...boys].map(r => Number(r[1])))].sort((a, b) => b - a);
    return points.map(pts => ({
      pts:text(pts),
      all:"",
      girls:text(girls.find(r => Number(r[1]) === pts)?.[0]),
      boys:text(boys.find(r => Number(r[1]) === pts)?.[0])
    }));
  }

  const emptyRow = () => ({pts:"", all:"", girls:"", boys:""});

  function mount(container, options) {
    const kind = options.kind === "duration" ? "duration" : "number";
    const split = !!options.split;
    const unit = options.unit || (kind === "duration" ? "temps" : "valeur");
    const placeholder = options.placeholder || (kind === "duration" ? "5:00" : "10");
    let table = toTable(options, split);
    if (!table.length) table = [emptyRow(), emptyRow(), emptyRow()];

    function collect() {
      table = [...container.querySelectorAll("tr[data-row]")].map(tr => ({
        pts: tr.querySelector(".gt-pts").value,
        all: tr.querySelector(".gt-all")?.value ?? "",
        girls: tr.querySelector(".gt-girls")?.value ?? "",
        boys: tr.querySelector(".gt-boys")?.value ?? ""
      }));
    }

    function draw() {
      const cell = (cls, value) =>
        '<td><input class="' + cls + '" inputmode="' + (kind === "duration" ? "text" : "decimal") + '" value="' + esc(value) + '" placeholder="' + esc(placeholder) + '"></td>';
      container.innerHTML =
        '<div class="gt-wrap"><table class="cb-grid-table"><thead><tr><th>Points</th>' +
        (split ? "<th>Filles (" + esc(unit) + ")</th><th>Garçons (" + esc(unit) + ")</th>" : "<th>À partir de (" + esc(unit) + ")</th>") +
        "<th></th></tr></thead><tbody>" +
        table.map((row, i) => '<tr data-row="' + i + '">' +
          '<td><input class="gt-pts cb-pts" type="number" step="0.25" value="' + esc(row.pts) + '" placeholder="0"></td>' +
          (split ? cell("gt-girls", row.girls) + cell("gt-boys", row.boys) : cell("gt-all", row.all)) +
          '<td><button type="button" class="cb-remove" data-gt-del="' + i + '" aria-label="Retirer la ligne ' + (i + 1) + '">✕</button></td></tr>').join("") +
        '</tbody></table></div><button type="button" class="cb-add-row gt-add">+ Ajouter une ligne</button>';

      container.querySelector(".gt-add").onclick = () => {
        collect();
        table.push(emptyRow());
        draw();
        container.querySelector("tr[data-row]:last-child .gt-pts")?.focus();
      };
      container.querySelectorAll("[data-gt-del]").forEach(button => button.onclick = () => {
        collect();
        table.splice(Number(button.dataset.gtDel), 1);
        if (!table.length) table.push(emptyRow());
        draw();
      });
    }

    function read() {
      collect();
      const out = split ? {girls:[], boys:[]} : {rows:[]};
      const sides = split ? ["girls", "boys"] : ["all"];
      const valid = text => kind === "duration" ? isDuration(text) : isNumber(text);
      for (const [index, row] of table.entries()) {
        const filled = sides.filter(side => String(row[side]).trim() !== "");
        const ptsText = String(row.pts).trim();
        if (!filled.length && ptsText === "") continue;
        const pts = Number(ptsText.replace(",", "."));
        if (ptsText === "" || !Number.isFinite(pts)) return {error:"ligne " + (index + 1) + " : points manquants"};
        if (!filled.length) return {error:"ligne " + (index + 1) + " : valeur manquante"};
        for (const side of filled) {
          const value = String(row[side]).trim();
          if (!valid(value)) return {error:"ligne " + (index + 1) + " : valeur « " + value + " » illisible" + (kind === "duration" ? " (format 5:30)" : "")};
          (side === "all" ? out.rows : out[side]).push([kind === "duration" ? value : Number(value.replace(",", ".")), pts]);
        }
      }
      if (split ? !out.girls.length || !out.boys.length : !out.rows.length) {
        return {error:"ajoute au moins une ligne" + (split ? " pour les filles et pour les garçons" : "")};
      }
      return out;
    }

    function set(data) {
      table = toTable(data, split);
      if (!table.length) table = [emptyRow()];
      draw();
    }

    draw();
    return {read, set};
  }

  window.DFGridTable = {mount};
})();
