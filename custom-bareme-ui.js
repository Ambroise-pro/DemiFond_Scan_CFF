(() => {
  "use strict";

  /*
   * Barèmes personnalisés.
   *
   * Le professeur scanne un QR d'exemple : ses champs deviennent l'identité
   * de l'élève (nom, sexe, classe) ou des critères notés par une grille
   * « valeur = points » (une seule grille ou filles / garçons séparées).
   * Il peut ajouter des critères notés à la main (échauffement…).
   *
   * Les modèles sont rangés dans db.settings.customBaremes.
   * Un exercice qui utilise un modèle en garde une copie (session.customBareme),
   * comme le 3 × 500 et le Laser Run : modifier le modèle ne change pas les
   * évaluations passées.
   */

  const ACCESS_CODE = "57";
  const BUILTIN_TYPES = ["DF_3X500_RESULT", "DF_TRAINING_RESULT", "DF_CCF_RESULT"];

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function current() {
    return typeof activeSession === "function" ? activeSession() : null;
  }

  function isCustomSession(session) {
    return session?.type === "custom" && !!session.customBareme;
  }

  function templates() {
    db.settings = db.settings || {};
    db.settings.customBaremes = Array.isArray(db.settings.customBaremes) ? db.settings.customBaremes : [];
    return db.settings.customBaremes;
  }

  /* =========================
     VALEURS
  ========================= */

  // "00:09:12", "01:07.3", "9:12", "9min 12s", "12s".
  function parseDuration(text) {
    const raw = String(text ?? "").trim().toLowerCase().replace(",", ".");
    if (!raw) return null;
    let m = raw.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
    if (m) return (Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000;
    m = raw.match(/^(?:(\d+)\s*m(?:in)?)\s*(?:(\d+(?:\.\d+)?)\s*s?)?$/) || raw.match(/^(\d+(?:\.\d+)?)\s*s$/);
    if (!m) return null;
    if (m.length === 2) return Number(m[1]) * 1000;
    return (Number(m[1] || 0) * 60 + Number(m[2] || 0)) * 1000;
  }

  function parseNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const raw = String(value ?? "").trim().replace(",", ".").replace(/\s*%$/, "");
    if (raw === "" || !/^-?\d+(\.\d+)?$/.test(raw)) return null;
    return Number(raw);
  }

  // Type d'un champ d'après sa valeur d'exemple.
  function detectKind(value) {
    if (typeof value === "number") return "number";
    const text = String(value ?? "").trim();
    if (/%$/.test(text) && parseNumber(text) != null) return "percent";
    if (parseNumber(text) != null) return "number";
    if (parseDuration(text) != null) return "duration";
    return "text";
  }

  function readValue(kind, value) {
    return kind === "duration" ? parseDuration(value) : parseNumber(value);
  }

  function formatValue(kind, value) {
    if (value == null || !Number.isFinite(Number(value))) return "—";
    if (kind === "duration") {
      const total = Math.round(Number(value) / 1000);
      return Math.floor(total / 60) + "min " + String(total % 60).padStart(2, "0") + "s";
    }
    const text = String(Math.round(Number(value) * 100) / 100).replace(".", ",");
    return kind === "percent" ? text + " %" : text;
  }

  function inputValue(kind, value) {
    if (value == null || !Number.isFinite(Number(value))) return "";
    if (kind === "duration") {
      const total = Math.round(Number(value) / 1000);
      return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
    }
    return String(value);
  }

  function fmtPts(v) {
    return String(Math.round(Number(v || 0) * 100) / 100).replace(".", ",");
  }

  const KIND_LABELS = {duration:"Temps", percent:"Pourcentage", number:"Nombre", text:"Texte"};

  // Champs d'un QR : clés de premier niveau et d'un niveau imbriqué ("a.b").
  function flatten(data) {
    const out = [];
    for (const [key, value] of Object.entries(data || {})) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [sub, inner] of Object.entries(value)) {
          if (inner == null || typeof inner !== "object") out.push([key + "." + sub, inner]);
        }
      } else if (!Array.isArray(value)) {
        out.push([key, value]);
      }
    }
    return out;
  }

  function pick(data, path) {
    return path.split(".").reduce((value, key) => value == null ? undefined : value[key], data);
  }

  function normName(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function readSex(value) {
    const raw = normName(value).toUpperCase();
    if (["F", "FILLE", "FEMME", "FEMININ"].includes(raw)) return "F";
    if (["M", "G", "GARCON", "HOMME", "MASCULIN"].includes(raw)) return "M";
    return "";
  }

  /* =========================
     NOTE
  ========================= */

  // Dernier seuil atteint (comme RECHERCHE / LOOKUP) ; sous le premier seuil : sa note.
  function gridPoints(rows, kind, value) {
    const thresholds = rows
      .map(([limit, pts]) => ({limit:readValue(kind, limit), pts:Number(pts)}))
      .filter(row => row.limit != null && Number.isFinite(row.pts))
      .sort((a, b) => a.limit - b.limit);
    if (!thresholds.length || value == null) return null;
    let points = thresholds[0].pts;
    for (const row of thresholds) {
      if (value >= row.limit) points = row.pts;
      else break;
    }
    return points;
  }

  function maxPoints(bareme) {
    return [...bareme.criteria, ...bareme.manual].reduce((sum, c) => sum + Number(c.max || 0), 0);
  }

  function scoreCustom(student, bareme = current()?.customBareme) {
    if (!bareme || !student?.custom) return null;
    const values = student.custom.values || {};
    const sex = student.sex;

    const criteria = bareme.criteria.map(c => {
      const value = values[c.id] ?? null;
      const rows = c.split ? (sex === "M" ? c.boys : sex === "F" ? c.girls : null) : c.rows;
      const pts = rows ? gridPoints(rows, c.kind, value) : null;
      return {id:c.id, value, pts:pts == null ? null : Math.min(Number(c.max), pts)};
    });

    const manual = bareme.manual.map(c => {
      const raw = student.customManual?.[c.id];
      return {id:c.id, pts:raw === "" || raw == null ? null : Number(raw)};
    });

    const all = [...criteria, ...manual];
    const sum = all.reduce((total, c) => total + (c.pts || 0), 0);
    const max = maxPoints(bareme);
    const complete = all.every(c => c.pts != null);

    return {
      criteria,
      manual,
      sum,
      max,
      total: complete ? sum : null,
      note20: complete && max > 0 ? Math.min(20, sum * 20 / max) : null
    };
  }

  /* =========================
     ACCÈS PAR CODE
  ========================= */

  function withCode(then) {
    const code = window.prompt("Code d'acces aux baremes :");
    if (code === null) return;
    if (code.trim() !== ACCESS_CODE) {
      window.alert("Code incorrect.");
      return;
    }
    then();
  }

  /* =========================
     LECTURE D'UN QR D'EXEMPLE
  ========================= */

  function startCamera(dialog, onText) {
    const video = dialog.querySelector("#cbVideo");
    const status = dialog.querySelector("#cbCameraStatus");
    if (!navigator.mediaDevices?.getUserMedia || typeof jsQR !== "function") {
      status.textContent = "Caméra indisponible : colle le contenu du QR ci-dessous.";
      return () => {};
    }

    let stream = null, raf = 0, stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", {willReadFrequently:true});

    const stop = () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach(track => track.stop());
      video.srcObject = null;
      video.classList.add("hidden");
    };

    navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}}, audio:false})
      .then(async s => {
        if (stopped) { s.getTracks().forEach(track => track.stop()); return; }
        stream = s;
        video.srcObject = s;
        video.classList.remove("hidden");
        await video.play();
        status.textContent = "Présente le QR d'exemple devant la caméra.";
        const loop = () => {
          if (stopped) return;
          if (video.videoWidth) {
            const scale = Math.min(1, 640 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(image.data, image.width, image.height, {inversionAttempts:"dontInvert"});
            if (code?.data) {
              stop();
              onText(code.data);
              return;
            }
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      })
      .catch(() => {
        status.textContent = "Caméra refusée : colle le contenu du QR ci-dessous.";
      });

    return stop;
  }

  /* =========================
     ÉDITEUR DE BARÈME
  ========================= */

  function defaultRole(key, kind) {
    const k = normName(key.split(".").pop());
    if (["nom", "name", "eleve", "coureur", "nom complet"].includes(k)) return "name";
    if (["sexe", "sex", "genre"].includes(k)) return "sex";
    if (["classe", "classroom", "class"].includes(k)) return "class";
    return kind === "text" ? "ignore" : "criterion";
  }

  /*
   * Grille éditable : une ligne = des points et le seuil à atteindre
   * (un seul seuil, ou un seuil filles et un seuil garçons).
   */
  function tableFromCriterion(c) {
    const text = v => v == null ? "" : String(v);
    if (!c.split) {
      return (c.rows || []).map(([value, pts]) => ({pts:text(pts), all:text(value), girls:"", boys:""}));
    }
    const girls = c.girls || [], boys = c.boys || [];
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

  const emptyRows = n => Array.from({length:n}, () => ({pts:"", all:"", girls:"", boys:""}));

  function newCriterion(field) {
    return {id:newId(), field:field.key, kind:field.kind, label:field.key, max:6, split:field.kind === "duration", rows:[], girls:[], boys:[], table:emptyRows(4)};
  }

  function cleanValue(kind, text) {
    const raw = String(text).trim();
    return kind === "duration" ? raw : Number(raw.replace(",", ".").replace("%", ""));
  }

  // Lignes saisies -> grilles [[valeur, points]] ; message d'erreur si une ligne est incomplète.
  function gridsFromTable(c) {
    const out = {rows:[], girls:[], boys:[]};
    const sides = c.split ? ["girls", "boys"] : ["all"];
    for (const [index, row] of c.table.entries()) {
      const filled = sides.filter(side => String(row[side]).trim() !== "");
      if (!filled.length && String(row.pts).trim() === "") continue;
      const pts = Number(String(row.pts).replace(",", "."));
      if (String(row.pts).trim() === "" || !Number.isFinite(pts)) return {error:"ligne " + (index + 1) + " : points manquants"};
      if (!filled.length) return {error:"ligne " + (index + 1) + " : valeur manquante"};
      for (const side of filled) {
        if (readValue(c.kind, row[side]) == null) return {error:"ligne " + (index + 1) + " : valeur « " + row[side] + " » illisible"};
        out[side === "all" ? "rows" : side].push([cleanValue(c.kind, row[side]), pts]);
      }
    }
    if (c.split ? !out.girls.length || !out.boys.length : !out.rows.length) return {error:"ajoute au moins une ligne" + (c.split ? " pour les filles et pour les garçons" : "")};
    return out;
  }

  function newId() {
    return typeof uid === "function" ? uid() : String(Date.now()) + Math.random().toString(16).slice(2);
  }

  /*
   * base : un modèle existant (modification) ou null (création).
   * onSave(bareme, alsoTemplate) : enregistre ; alsoTemplate n'existe que
   * pour la copie d'un exercice.
   */
  function openEditor(base, onSave, options = {}) {
    let d = document.getElementById("customBaremeDialog");
    if (!d) {
      d = document.createElement("dialog");
      d.id = "customBaremeDialog";
      document.body.appendChild(d);
    }

    // État de travail : champs connus (depuis l'exemple ou le barème existant).
    const state = {
      name: base?.name || "",
      example: base?.example || null,
      fields: base ? clone(base.fields || []) : [],
      criteria: base ? clone(base.criteria).map(c => ({...c, table:tableFromCriterion(c)})) : [],
      manual: base ? clone(base.manual) : []
    };
    let stopCamera = () => {};

    function loadExample(text) {
      let data;
      try {
        data = typeof text === "string" ? JSON.parse(text) : text;
      } catch {
        alert("Ce QR ne contient pas de données JSON lisibles.");
        return;
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        alert("Ce QR ne contient pas de champs exploitables.");
        return;
      }
      const flat = flatten(data);
      if (!flat.length) {
        alert("Ce QR ne contient aucun champ.");
        return;
      }
      state.example = data;
      state.fields = flat.map(([key, value]) => {
        const kind = detectKind(value);
        return {key, kind, example:String(value ?? ""), role:defaultRole(key, kind)};
      });
      // Les critères déjà définis sur un champ toujours présent sont conservés.
      state.criteria = state.criteria.filter(c => state.fields.some(f => f.key === c.field));
      for (const field of state.fields) {
        if (field.role === "criterion" && !state.criteria.some(c => c.field === field.key)) {
          state.criteria.push(newCriterion(field));
        }
      }
      for (const field of state.fields) {
        if (state.criteria.some(c => c.field === field.key)) field.role = "criterion";
      }
      draw();
    }

    function readForm() {
      state.name = d.querySelector("#cbName")?.value.trim() ?? state.name;
      d.querySelectorAll("[data-field-role]").forEach(select => {
        const field = state.fields.find(f => f.key === select.dataset.fieldRole);
        if (field) field.role = select.value;
      });
      d.querySelectorAll("[data-criterion]").forEach(box => {
        const c = state.criteria.find(x => x.id === box.dataset.criterion);
        if (!c) return;
        c.label = box.querySelector(".cb-label").value.trim() || c.field;
        c.max = Number(box.querySelector(".cb-max").value) || 0;
        c.split = box.querySelector(".cb-split").checked;
        c.table = [...box.querySelectorAll("tr[data-row]")].map(tr => ({
          pts: tr.querySelector(".cb-pts").value,
          all: tr.querySelector(".cb-v-all")?.value ?? "",
          girls: tr.querySelector(".cb-v-girls")?.value ?? "",
          boys: tr.querySelector(".cb-v-boys")?.value ?? ""
        }));
      });
      d.querySelectorAll("[data-manual]").forEach(row => {
        const c = state.manual.find(x => x.id === row.dataset.manual);
        if (!c) return;
        c.label = row.querySelector(".cb-label").value.trim();
        c.max = Number(row.querySelector(".cb-max").value) || 0;
      });
    }

    // Garde les critères en phase avec les rôles choisis.
    function syncCriteria() {
      for (const field of state.fields) {
        const existing = state.criteria.find(c => c.field === field.key);
        if (field.role === "criterion" && !existing) {
          state.criteria.push(newCriterion(field));
        }
      }
      state.criteria = state.criteria.filter(c => state.fields.some(f => f.key === c.field && f.role === "criterion"));
    }

    function gridTable(c) {
      const placeholder = {duration:"9:10", percent:"60", number:"1200"}[c.kind] || "";
      const unit = {duration:"temps", percent:"%", number:"valeur"}[c.kind] || "valeur";
      const cell = (cls, value) => '<td><input class="' + cls + '" inputmode="' + (c.kind === "duration" ? "text" : "decimal") + '" value="' + esc(value) + '" placeholder="' + placeholder + '"></td>';
      return '<table class="cb-grid-table"><thead><tr><th>Points</th>' +
        (c.split ? '<th>Filles (' + unit + ')</th><th>Garçons (' + unit + ')</th>' : '<th>À partir de (' + unit + ')</th>') +
        '<th></th></tr></thead><tbody>' +
        c.table.map((row, i) => '<tr data-row="' + i + '">' +
          '<td><input class="cb-pts" type="number" step="0.25" min="0" value="' + esc(row.pts) + '" placeholder="0"></td>' +
          (c.split ? cell("cb-v-girls", row.girls) + cell("cb-v-boys", row.boys) : cell("cb-v-all", row.all)) +
          '<td><button type="button" class="cb-remove" data-del-row="' + i + '" aria-label="Retirer la ligne ' + (i + 1) + '">✕</button></td></tr>').join("") +
        '</tbody></table><button type="button" class="cb-add-row">+ Ajouter une ligne</button>';
    }

    function draw() {
      const roles = [["ignore","Ignorer"],["name","Nom de l'élève"],["sex","Sexe"],["class","Classe"],["criterion","Critère noté"]];
      const total = [...state.criteria, ...state.manual].reduce((sum, c) => sum + Number(c.max || 0), 0);

      d.innerHTML = `
        <div class="cb-editor">
          <h2>${base ? "Modifier le barème" : "Créer un barème"}</h2>

          <label class="cb-block"><b>Nom du barème</b>
            <input id="cbName" value="${esc(state.name)}" placeholder="Ex. Laser Run 1ère" maxlength="80">
          </label>

          <section class="cb-block">
            <b>1. QR d'exemple</b>
            <p class="cb-hint">Scanne un QR de résultat : ses champs apparaissent ci-dessous.</p>
            <div class="cb-row">
              <button type="button" id="cbCamera">📷 Scanner le QR d'exemple</button>
              <button type="button" id="cbPasteToggle">Coller le texte du QR</button>
            </div>
            <p id="cbCameraStatus" class="cb-hint" aria-live="polite"></p>
            <video id="cbVideo" class="cb-video hidden" playsinline muted></video>
            <div id="cbPaste" class="hidden">
              <textarea id="cbPasteText" placeholder='{"nom":"…","sexe":"F","tempsTotal":"00:09:12"}'></textarea>
              <button type="button" id="cbPasteRead">Lire ce contenu</button>
            </div>
          </section>

          ${state.fields.length ? `
          <section class="cb-block">
            <b>2. Rôle de chaque champ</b>
            <div class="cb-table">
              <table>
                <thead><tr><th>Champ</th><th>Exemple</th><th>Type</th><th>Rôle</th></tr></thead>
                <tbody>
                  ${state.fields.map(f => `
                    <tr>
                      <td><b>${esc(f.key)}</b></td>
                      <td>${esc(f.example)}</td>
                      <td>${KIND_LABELS[f.kind]}</td>
                      <td><select data-field-role="${esc(f.key)}">
                        ${roles.filter(([value]) => value !== "criterion" || f.kind !== "text")
                          .map(([value,label]) => `<option value="${value}" ${f.role === value ? "selected" : ""}>${label}</option>`).join("")}
                      </select></td>
                    </tr>`).join("")}
                </tbody>
              </table>
            </div>
          </section>` : ""}

          ${state.criteria.length ? `
          <section class="cb-block">
            <b>3. Grilles de notation</b>
            <p class="cb-hint">Une ligne par seuil : les points et la valeur à partir de laquelle ils sont attribués.
              L'élève obtient les points du dernier seuil atteint (sous le premier seuil : les points du premier).
              Temps au format 9:10, pourcentages sans le signe %.</p>
            ${state.criteria.map(c => `
              <div class="cb-criterion" data-criterion="${esc(c.id)}">
                <div class="cb-row">
                  <label>Critère <input class="cb-label" value="${esc(c.label)}"></label>
                  <label>Sur <input class="cb-max" type="number" min="0" step="0.5" value="${esc(c.max)}"> pts</label>
                  <label class="cb-check"><input class="cb-split" type="checkbox" ${c.split ? "checked" : ""}> Grilles filles / garçons séparées</label>
                </div>
                <small>Champ « ${esc(c.field)} » · ${KIND_LABELS[c.kind]}</small>
                ${gridTable(c)}
              </div>`).join("")}
          </section>` : ""}

          <section class="cb-block">
            <b>${state.criteria.length ? "4" : "2"}. Critères notés par le professeur</b>
            ${state.manual.map(c => `
              <div class="cb-row" data-manual="${esc(c.id)}">
                <label>Critère <input class="cb-label" value="${esc(c.label)}" placeholder="Ex. Échauffement"></label>
                <label>Sur <input class="cb-max" type="number" min="0" step="0.5" value="${esc(c.max)}"> pts</label>
                <button type="button" class="cb-remove" data-remove="${esc(c.id)}" aria-label="Retirer ce critère">✕</button>
              </div>`).join("")}
            <button type="button" id="cbAddManual">+ Ajouter un critère noté par le prof</button>
          </section>

          <p class="cb-total">Total du barème : <b>${fmtPts(total)} pts</b>${total && total !== 20 ? " (note ramenée sur 20)" : ""}</p>

          ${options.templateId ? `<label class="cb-check"><input id="cbAlsoTemplate" type="checkbox"> Enregistrer aussi ces changements dans le modèle</label>` : ""}

          <div class="cb-row cb-actions">
            ${base && options.onDelete ? '<button type="button" id="cbDelete" class="flow-danger">Supprimer ce barème</button>' : ""}
            <button type="button" id="cbCancel">Annuler</button>
            <button type="button" id="cbSave" class="flow-primary">Enregistrer</button>
          </div>
        </div>`;

      d.querySelector("#cbCamera").onclick = () => {
        stopCamera();
        stopCamera = startCamera(d, text => { readForm(); loadExample(text); });
      };
      d.querySelector("#cbPasteToggle").onclick = () => d.querySelector("#cbPaste").classList.toggle("hidden");
      d.querySelector("#cbPasteRead").onclick = () => {
        readForm();
        loadExample(d.querySelector("#cbPasteText").value.trim());
      };
      d.querySelectorAll("[data-field-role]").forEach(select => select.onchange = () => {
        readForm();
        syncCriteria();
        draw();
      });
      d.querySelectorAll(".cb-split").forEach(box => box.onchange = () => {
        readForm();
        const c = state.criteria.find(x => x.id === box.closest("[data-criterion]").dataset.criterion);
        // Bascule une grille unique vers filles / garçons (et inversement) sans perdre la saisie.
        for (const row of c.table) {
          if (c.split) { row.girls = row.girls || row.all; row.boys = row.boys || row.all; }
          else row.all = row.all || row.girls || row.boys;
        }
        draw();
      });
      d.querySelectorAll(".cb-add-row").forEach(button => button.onclick = () => {
        readForm();
        const c = state.criteria.find(x => x.id === button.closest("[data-criterion]").dataset.criterion);
        c.table.push(...emptyRows(1));
        draw();
        d.querySelector('[data-criterion="' + c.id + '"] tr[data-row]:last-child .cb-pts')?.focus();
      });
      d.querySelectorAll("[data-del-row]").forEach(button => button.onclick = () => {
        readForm();
        const c = state.criteria.find(x => x.id === button.closest("[data-criterion]").dataset.criterion);
        c.table.splice(Number(button.dataset.delRow), 1);
        if (!c.table.length) c.table.push(...emptyRows(1));
        draw();
      });
      d.querySelector("#cbAddManual").onclick = () => {
        readForm();
        state.manual.push({id:newId(), label:"", max:2});
        draw();
      };
      d.querySelectorAll("[data-remove]").forEach(button => button.onclick = () => {
        readForm();
        state.manual = state.manual.filter(c => c.id !== button.dataset.remove);
        draw();
      });
      d.querySelector("#cbCancel").onclick = () => { stopCamera(); d.close(); };
      d.querySelector("#cbDelete")?.addEventListener("click", () => {
        if (!confirm("Supprimer le barème « " + (base.name || "") + " » ?\nLes évaluations qui l'utilisent gardent leur copie.")) return;
        stopCamera();
        d.close();
        options.onDelete();
      });
      d.querySelector("#cbSave").onclick = save_;
    }

    function save_() {
      readForm();
      if (!state.name) { alert("Donne un nom au barème."); return; }
      if (!state.criteria.length && !state.manual.length) { alert("Ajoute au moins un critère."); return; }
      if (state.fields.length && !state.fields.some(f => f.role === "name")) {
        alert("Indique quel champ du QR contient le nom de l'élève.");
        return;
      }

      const criteria = [];
      for (const c of state.criteria) {
        const grids = gridsFromTable(c);
        if (grids.error) {
          alert("Critère « " + c.label + " » : " + grids.error + ".");
          return;
        }
        const out = {id:c.id, field:c.field, kind:c.kind, label:c.label, max:c.max, split:c.split, ...grids};
        if (!(out.max > 0)) { alert("Le critère « " + c.label + " » doit valoir plus de 0 point."); return; }
        criteria.push(out);
      }

      const manual = state.manual.filter(c => c.label);
      if (manual.some(c => !(c.max > 0))) { alert("Chaque critère du professeur doit valoir plus de 0 point."); return; }

      const field = role => state.fields.find(f => f.role === role)?.key || null;
      const bareme = {
        id: base?.id || newId(),
        name: state.name,
        example: state.example,
        fields: state.fields.map(({key, kind, example, role}) => ({key, kind, example, role})),
        nameField: field("name"),
        sexField: field("sex"),
        classField: field("class"),
        criteria,
        manual: manual.map(({id, label, max}) => ({id, label, max:Number(max)})),
        updatedAt: Date.now()
      };

      stopCamera();
      d.close();
      onSave(bareme, !!d.querySelector("#cbAlsoTemplate")?.checked);
    }

    draw();
    d.addEventListener("close", () => stopCamera(), {once:true});
    d.showModal();
  }

  function createTemplate() {
    withCode(() => openEditor(null, bareme => {
      templates().push(bareme);
      save();
      toast?.("Barème « " + bareme.name + " » créé");
      afterChange();
    }));
  }

  function editTemplate(id) {
    const template = templates().find(t => t.id === id);
    if (!template) return;
    withCode(() => openEditor(template, bareme => {
      const list = templates();
      list[list.findIndex(t => t.id === id)] = bareme;
      save();
      toast?.("Barème « " + bareme.name + " » enregistré");
      afterChange();
    }, {onDelete: () => {
      db.settings.customBaremes = templates().filter(t => t.id !== id);
      save();
      toast?.("Barème supprimé");
      afterChange();
    }}));
  }

  // Barème de l'exercice ouvert (sa copie), avec option de mise à jour du modèle.
  function editSessionBareme() {
    const session = current();
    if (!isCustomSession(session)) return;
    withCode(() => openEditor(session.customBareme, (bareme, alsoTemplate) => {
      session.customBareme = bareme;
      if (alsoTemplate) {
        const list = templates(), index = list.findIndex(t => t.id === bareme.id);
        if (index >= 0) list[index] = clone(bareme); else list.push(clone(bareme));
      }
      save();
      toast?.("Barème de l'exercice enregistré");
      afterChange();
    }, {templateId: session.customBareme.id}));
  }

  // Appliquer un modèle à un exercice (sans résultats, ou déjà en barème perso).
  function applyToExercise(exercise, group) {
    const list = templates();
    if (!exercise) return;
    const hasOther = (exercise.students?.length && exercise.type !== "custom") ||
      (db.trainingScans || []).some(r => String(r.groupId) === String(group?.id) && String(r.sessionId) === String(exercise.id));
    if (hasOther) {
      alert("Cet exercice contient déjà des résultats d'un autre protocole. Ajoute un nouvel exercice pour utiliser un barème perso.");
      return;
    }
    if (!list.length) {
      if (confirm("Aucun barème perso pour l'instant. En créer un ?")) createTemplate();
      return;
    }

    let d = document.getElementById("customApplyDialog");
    if (!d) {
      d = document.createElement("dialog");
      d.id = "customApplyDialog";
      document.body.appendChild(d);
    }
    d.innerHTML = `
      <div class="cb-editor">
        <h2>Barème perso · ${esc(exercise.label || "")}</h2>
        <p class="cb-hint">Les QR scannés dans cet exercice seront notés avec le barème choisi.</p>
        <div class="bareme-choices">
          ${list.map(t => `<button type="button" data-apply="${esc(t.id)}"><strong>⚙️ ${esc(t.name)}</strong><span>${esc(summary(t))}</span></button>`).join("")}
        </div>
        ${exercise.type === "custom" ? '<button type="button" id="caRemove" class="flow-danger">Retirer le barème perso</button>' : ""}
        <div class="cb-row cb-actions"><button type="button" id="caCancel">Annuler</button></div>
      </div>`;
    d.querySelector("#caCancel").onclick = () => d.close();
    d.querySelector("#caRemove")?.addEventListener("click", () => {
      if (exercise.students?.length && !confirm("Les notes de cet exercice ne seront plus calculées. Continuer ?")) return;
      exercise.type = exercise.students?.length ? "custom" : "";
      if (!exercise.students?.length) delete exercise.customBareme;
      save();
      d.close();
      afterChange();
    });
    d.querySelectorAll("[data-apply]").forEach(button => button.onclick = () => {
      const template = list.find(t => t.id === button.dataset.apply);
      exercise.type = "custom";
      exercise.customBareme = clone(template);
      save();
      d.close();
      toast?.("Barème « " + template.name + " » appliqué");
      afterChange();
    });
    d.showModal();
  }

  function summary(t) {
    const parts = [...t.criteria.map(c => c.label + " /" + fmtPts(c.max)), ...t.manual.map(c => c.label + " /" + fmtPts(c.max))];
    return parts.join(" · ") + " — total " + fmtPts(maxPoints(t));
  }

  /* =========================
     SCAN
  ========================= */

  function matches(bareme, data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    const required = [bareme.nameField, ...bareme.criteria.map(c => c.field)].filter(Boolean);
    return required.length > 0 && required.every(path => pick(data, path) !== undefined);
  }

  function isBuiltin(data) {
    return BUILTIN_TYPES.includes(data?.type) ||
      window.DFLaserRun?.isPayload(data) ||
      (!!data?.studentId && [1, 2].includes(Number(data.race)));
  }

  // Utilisé par workspace-ui.js pour router un QR vers le bon exercice.
  function typeFor(data, exercise) {
    if (isCustomSession(exercise) && matches(exercise.customBareme, data)) return "custom";
    if (isBuiltin(data)) return null;
    return templates().some(t => matches(t, data)) ? "custom" : null;
  }

  function sameName(student, key) {
    const first = normName(student.first), last = normName(student.last);
    return key === normName(first + " " + last) || key === normName(last + " " + first);
  }

  function splitName(name) {
    const parts = name.split(" ");
    return parts.length > 1 ? {first:parts[0], last:parts.slice(1).join(" ")} : {first:"", last:name};
  }

  function handleCustom(data, session, group) {
    const bareme = session.customBareme;

    if (session.status === "locked") {
      scanError("Évaluation verrouillée : scan refusé.");
      return;
    }

    const name = String(pick(data, bareme.nameField) ?? "").trim().replace(/\s+/g, " ");
    if (!name) {
      scanError("QR « " + bareme.name + " » : nom de l'élève manquant.");
      return;
    }

    const values = {};
    for (const c of bareme.criteria) {
      const value = readValue(c.kind, pick(data, c.field));
      if (value == null) {
        scanError("QR « " + bareme.name + " » : valeur illisible pour « " + c.label + " ».");
        return;
      }
      values[c.id] = value;
    }

    const sex = bareme.sexField ? readSex(pick(data, bareme.sexField)) : "";
    const classroom = bareme.classField ? String(pick(data, bareme.classField) ?? "").trim().toUpperCase() : "";

    const key = normName(name);
    let student = session.students.find(s => sameName(s, key));
    const known = (group.students || []).find(s => sameName(s, key));

    if (student?.custom) {
      if (JSON.stringify(student.custom.values) === JSON.stringify(values)) {
        scanError(String(student.last || "").toUpperCase() + " " + (student.first || "") + " · QR déjà scanné.");
        return;
      }
      if (!confirm(String(student.last || "").toUpperCase() + " " + (student.first || "") +
        "\n\nUn résultat est déjà enregistré.\n\nRemplacer ce relevé ?")) return;
    }

    if (!student) {
      student = buildStudent(known
        ? {studentId:known.externalId || known.id, last:known.last, first:known.first, classroom:known.classroom, sex:known.sex}
        : {studentId:"CB-" + key.replace(/ /g, "-"), ...splitName(name), classroom, sex});
      session.students.push(student);
    }

    if (sex) student.sex = sex;
    if (classroom) student.classroom = classroom;
    student.custom = {name, values, raw:data, scannedAt:Date.now()};

    updateMasterStudent(group, student);
    db.history.unshift({at:Date.now(), groupId:group.id, sessionId:session.id, studentId:student.id, type:"custom"});
    save();
    beep();

    const message = document.getElementById("scanMessage");
    if (message) {
      message.className = "scan-ok";
      message.innerHTML =
        "✓ " + esc(String(student.last || "").toUpperCase()) + " " + esc(student.first || "") +
        "<br>" + esc(bareme.name) + " · " +
        bareme.criteria.map(c => esc(c.label) + " " + formatValue(c.kind, values[c.id])).join(" · ") +
        (bareme.criteria.some(c => c.split) && !student.sex ? "<br>Sexe inconnu : à compléter dans la fiche." : "");
    }
    toast?.(bareme.name + " enregistré");
    if (typeof render === "function") render();
  }

  function installBridge() {
    if (typeof window.handleQR !== "function" || window.handleQR.__customBaremeBridge) return;
    const original = window.handleQR;

    const wrapped = function(raw) {
      let data = raw;
      try {
        if (typeof raw === "string") data = JSON.parse(raw);
      } catch {
        return original(raw);
      }

      const group = typeof activeGroup === "function" ? activeGroup() : null;
      const session = current();

      if (group && isCustomSession(session)) {
        if (matches(session.customBareme, data)) handleCustom(data, session, group);
        else scanError("Ce QR ne correspond pas au barème « " + session.customBareme.name + " » de cet exercice.");
        return;
      }

      if (!group || !session || isBuiltin(data)) return original(raw);

      const candidates = templates().filter(t => matches(t, data));
      if (!candidates.length) return original(raw);

      const empty = !session.type && !session.students?.length;
      if (!empty) return original(raw);

      if (candidates.length > 1) {
        scanError("Plusieurs barèmes perso correspondent à ce QR : choisis-en un avec « ⚙️ Barème perso » sur la carte de l'exercice.");
        return;
      }

      session.type = "custom";
      session.customBareme = clone(candidates[0]);
      handleCustom(data, session, group);
    };

    wrapped.__customBaremeBridge = true;
    window.handleQR = wrapped;
  }

  /* =========================
     CORRECTION
  ========================= */

  function sexOptions(sex) {
    return [["","—"],["F","F"],["M","G"]]
      .map(([value,label]) => '<option value="' + value + '"' + (sex === value ? " selected" : "") + '>' + label + '</option>')
      .join("");
  }

  function scoreOptions(max, value) {
    let out = '<option value="">—</option>';
    for (let v = 0; v <= Number(max) + 0.001; v += 0.25) {
      const rounded = Math.round(v * 100) / 100;
      const selected = value != null && value !== "" && Number(value) === rounded ? " selected" : "";
      out += '<option value="' + rounded + '"' + selected + '>' + fmtPts(rounded) + '</option>';
    }
    return out;
  }

  function findSessionStudent(id) {
    return current()?.students?.find(s => String(s.id) === String(id)) || null;
  }

  function openStudentEditor(studentId) {
    const session = current();
    const student = findSessionStudent(studentId);
    if (!isCustomSession(session) || !student) return;
    const bareme = session.customBareme;

    let d = document.getElementById("customStudentDialog");
    if (!d) {
      d = document.createElement("dialog");
      d.id = "customStudentDialog";
      document.body.appendChild(d);
    }
    const values = student.custom?.values || {};

    d.innerHTML = `
      <div class="cb-editor">
        <h2>Corriger — ${esc(String(student.last || "").toUpperCase())} ${esc(student.first || "")}</h2>
        <div class="cb-grid4">
          <label>Nom<input id="csLast" value="${esc(student.last || "")}"></label>
          <label>Prénom<input id="csFirst" value="${esc(student.first || "")}"></label>
          <label>Classe<input id="csClass" value="${esc(student.classroom || "")}"></label>
          <label>Sexe<select id="csSex">${sexOptions(student.sex)}</select></label>
        </div>
        <div class="cb-grid4">
          ${bareme.criteria.map(c => `<label>${esc(c.label)} (${KIND_LABELS[c.kind].toLowerCase()})
            <input data-value="${esc(c.id)}" value="${esc(inputValue(c.kind, values[c.id]))}" placeholder="${c.kind === "duration" ? "9:12" : "0"}"></label>`).join("")}
          ${bareme.manual.map(c => `<label>${esc(c.label)} /${fmtPts(c.max)}
            <select data-manual-value="${esc(c.id)}">${scoreOptions(c.max, student.customManual?.[c.id])}</select></label>`).join("")}
        </div>
        <div class="cb-row cb-actions">
          <button type="button" id="csCancel">Annuler</button>
          <button type="button" id="csSave" class="flow-primary">Enregistrer et recalculer</button>
        </div>
      </div>`;

    d.querySelector("#csCancel").onclick = () => d.close();
    d.querySelector("#csSave").onclick = () => {
      const last = d.querySelector("#csLast").value.trim();
      if (!last) { alert("Le nom est obligatoire."); return; }
      const next = {};
      for (const c of bareme.criteria) {
        const text = d.querySelector('[data-value="' + c.id + '"]').value.trim();
        const value = text === "" ? null : readValue(c.kind, text);
        if (text !== "" && value == null) { alert("Valeur illisible pour « " + c.label + " »."); return; }
        next[c.id] = value;
      }
      student.last = last;
      student.first = d.querySelector("#csFirst").value.trim();
      student.classroom = d.querySelector("#csClass").value.trim().toUpperCase();
      student.sex = d.querySelector("#csSex").value;
      student.custom = {...(student.custom || {}), values:next};
      student.customManual = student.customManual || {};
      d.querySelectorAll("[data-manual-value]").forEach(select => {
        student.customManual[select.dataset.manualValue] = select.value === "" ? "" : Number(select.value);
      });
      save();
      d.close();
      if (typeof render === "function") render();
      toast?.("Résultat recalculé");
    };
    d.showModal();
  }

  /* =========================
     VUES
  ========================= */

  function ensureStyles() {
    if (document.getElementById("customBaremeStyles")) return;
    const style = document.createElement("style");
    style.id = "customBaremeStyles";
    style.textContent =
      "table.custom-table{min-width:0!important;width:100%}" +
      "table.custom-table th,table.custom-table td{min-width:0!important;padding:8px 5px;white-space:normal}" +
      "table.custom-table th:nth-child(1),table.custom-table td:nth-child(1){min-width:130px!important;max-width:none}" +
      "table.custom-table .cb-manual{background:#eef2ff}" +
      "table.custom-table select{min-width:58px;font-size:16px;padding:6px 4px}";
    document.head.appendChild(style);
  }

  function renderTableIfNeeded() {
    const session = current();
    if (!isCustomSession(session)) return;
    const body = document.getElementById("students");
    if (!body) return;
    const bareme = session.customBareme;

    body.innerHTML = visibleStudents().map(student => {
      const sc = scoreCustom(student, bareme);
      return `
        <tr data-student-id="${esc(student.id)}">
          <td><b>${esc(String(student.last || "").toUpperCase())} ${esc(student.first || "")}</b></td>
          <td>${esc(student.classroom || "")}</td>
          <td>${esc(student.sex || "—")}</td>
          ${bareme.criteria.map(c => `<td>${formatValue(c.kind, student.custom?.values?.[c.id])}</td>`).join("")}
          <td><b>${sc?.total == null ? (sc ? fmtPts(sc.sum) + " (partiel)" : "—") : fmtPts(sc.total) + "/" + fmtPts(sc.max)}</b></td>
          <td>
            <button type="button" class="student-edit" data-id="${esc(student.id)}">✏️ Corriger</button>
            <button type="button" class="student-delete-hold" data-student-id="${esc(student.id)}" title="Maintenir pour supprimer">Supprimer</button>
          </td>
        </tr>`;
    }).join("");

    body.querySelectorAll(".student-edit").forEach(button => {
      button.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        openStudentEditor(button.dataset.id);
      };
    });

    const head = document.querySelector(".student-list-card thead tr");
    if (head) {
      head.innerHTML = "<th>Élève</th><th>Classe</th><th>Sexe</th>" +
        bareme.criteria.map(c => "<th>" + esc(c.label) + "</th>").join("") +
        "<th>Total</th><th>Action</th>";
    }
  }

  function renderResultsIfNeeded() {
    const session = current();
    const table = document.querySelector("#resultRows")?.closest("table");
    if (!isCustomSession(session)) {
      table?.classList.remove("custom-table");
      return;
    }
    const body = document.getElementById("resultRows");
    if (!body) return;
    const bareme = session.customBareme;
    const showNote20 = maxPoints(bareme) !== 20;

    body.innerHTML = visibleStudents().map(student => {
      const sc = scoreCustom(student, bareme);
      return `
        <tr>
          <td><b>${esc(String(student.last || "").toUpperCase())} ${esc(student.first || "")}</b></td>
          <td><select class="custom-inline" data-student-id="${esc(student.id)}" data-field="sex" aria-label="Sexe">${sexOptions(student.sex)}</select></td>
          ${bareme.criteria.map((c, i) => `
            <td>${formatValue(c.kind, sc?.criteria[i].value)}</td>
            <td><b>${sc?.criteria[i].pts == null ? "—" : fmtPts(sc.criteria[i].pts)}</b></td>`).join("")}
          ${bareme.manual.map(c => `
            <td class="cb-manual"><select class="custom-inline" data-student-id="${esc(student.id)}" data-manual="${esc(c.id)}" aria-label="${esc(c.label)} sur ${fmtPts(c.max)}">
              ${scoreOptions(c.max, student.customManual?.[c.id])}
            </select></td>`).join("")}
          <td><b>${sc?.total == null ? "—" : fmtPts(sc.total) + "/" + fmtPts(sc.max)}</b></td>
          ${showNote20 ? `<td><b>${sc?.note20 == null ? "—" : fmtPts(sc.note20)}</b></td>` : ""}
        </tr>`;
    }).join("");

    body.querySelectorAll(".custom-inline").forEach(select => {
      select.onchange = () => {
        const student = findSessionStudent(select.dataset.studentId);
        if (!student) return;
        if (select.dataset.field === "sex") student.sex = select.value;
        else {
          student.customManual = student.customManual || {};
          student.customManual[select.dataset.manual] = select.value === "" ? "" : Number(select.value);
        }
        save();
        if (typeof render === "function") render();
      };
    });

    ensureStyles();
    table?.classList.add("custom-table");

    const head = document.querySelector("#results .table thead tr");
    if (head) {
      head.innerHTML = "<th>Nom / prénom</th><th>Sexe</th>" +
        bareme.criteria.map(c => "<th>" + esc(c.label) + "</th><th>Points /" + fmtPts(c.max) + "</th>").join("") +
        bareme.manual.map(c => '<th class="cb-manual">' + esc(c.label) + " /" + fmtPts(c.max) + "</th>").join("") +
        "<th>Total /" + fmtPts(maxPoints(bareme)) + "</th>" +
        (showNote20 ? "<th>Note /20</th>" : "");
    }

    const title = document.querySelector("#results h2");
    if (title) title.textContent = "Fiche d’évaluation · " + bareme.name;

    document.getElementById("ccfViewTabs")?.classList.add("hidden");
    document.getElementById("ccfQuickView")?.classList.add("hidden");
  }

  /* =========================
     PDF / ARCHIVE
  ========================= */

  function sheetHead(bareme) {
    return "<tr><th>Élève</th><th>Classe</th><th>Sexe</th>" +
      bareme.criteria.map(c => "<th>" + esc(c.label) + "</th><th>/" + fmtPts(c.max) + "</th>").join("") +
      bareme.manual.map(c => "<th>" + esc(c.label) + "<br>/" + fmtPts(c.max) + "</th>").join("") +
      "<th>Total<br>/" + fmtPts(maxPoints(bareme)) + "</th><th>Note<br>/20</th></tr>";
  }

  function sheetRows(students, bareme) {
    return students.map(student => {
      const sc = scoreCustom(student, bareme);
      return "<tr><td class=\"student\"><b>" + esc(String(student.last || "").toUpperCase()) + " " + esc(student.first || "") + "</b></td>" +
        "<td>" + esc(student.classroom || "") + "</td><td>" + esc(student.sex || "—") + "</td>" +
        bareme.criteria.map((c, i) => "<td>" + formatValue(c.kind, sc?.criteria[i].value) + "</td><td>" + (sc?.criteria[i].pts == null ? "—" : fmtPts(sc.criteria[i].pts)) + "</td>").join("") +
        bareme.manual.map((c, i) => "<td>" + (sc?.manual[i].pts == null ? "—" : fmtPts(sc.manual[i].pts)) + "</td>").join("") +
        "<td>" + (sc?.total == null ? "—" : fmtPts(sc.total)) + "</td>" +
        "<td class=\"final\"><b>" + (sc?.note20 == null ? "—" : fmtPts(sc.note20)) + "</b></td></tr>";
    }).join("");
  }

  function printPDF() {
    const group = activeGroup();
    const session = current();
    if (!isCustomSession(session)) return;
    const bareme = session.customBareme;
    const students = visibleStudents();
    const w = window.open("", "_blank");
    if (!w) { alert("Autorise les fenêtres surgissantes pour générer le PDF."); return; }
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(bareme.name)}</title>
<style>@page{size:A4 landscape;margin:8mm}body{font-family:Arial,sans-serif;color:#111;margin:0;font-size:11px}h1{font-size:20px;margin:0 0 4px}
.meta{margin:0 0 10px;color:#444}table{width:100%;border-collapse:collapse}th,td{border:1px solid #aaa;padding:4px 3px;text-align:center;white-space:nowrap}
th{background:#e9eef7;font-size:10px}td:first-child,th:first-child{text-align:left}.final{background:#fff3c7}</style></head><body>
<h1>Fiche d’évaluation · ${esc(bareme.name)}</h1>
<p class="meta"><b>${esc(group?.name || "")}</b> · ${esc(session.label || "")} · ${students.length} élève${students.length > 1 ? "s" : ""}</p>
<table><thead>${sheetHead(bareme)}</thead><tbody>${sheetRows(students, bareme)}</tbody></table>
<script>window.onload=()=>window.print();<\/script></body></html>`);
    w.document.close();
  }

  function installPrintButton() {
    const button = document.getElementById("exportPdfCCF");
    if (!button || !isCustomSession(current())) return;
    button.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      printPDF();
    };
  }

  function buildArchiveReport(group, session, payload, statusText) {
    const bareme = session.customBareme;
    const students = (session.students || []).slice().sort((a, b) =>
      String(a.last || "").localeCompare(String(b.last || ""), "fr") ||
      String(a.first || "").localeCompare(String(b.first || ""), "fr"));
    const graded = students.filter(s => scoreCustom(s, bareme)?.note20 != null).length;
    const dataJson = JSON.stringify(payload).replace(/</g, "\\u003c");
    return "<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
      "<title>Archive " + esc(bareme.name) + " — " + esc(group.name) + "</title>" +
      "<style>:root{font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;color:#172033}*{box-sizing:border-box}" +
      "body{margin:0;padding:24px;background:#eef2f7}main{max-width:1500px;margin:auto}" +
      ".hero{background:#172554;color:#fff;padding:24px;border-radius:20px;margin-bottom:16px}.hero h1{margin:0 0 8px;font-size:28px}.hero p{margin:4px 0;color:#dbeafe}" +
      ".table-wrap{overflow:auto;background:#fff;border-radius:16px;border:1px solid #d8e0ea}table{border-collapse:collapse;width:100%;font-size:13px}" +
      "th,td{padding:9px;border-bottom:1px solid #e5e7eb;text-align:center;white-space:nowrap}th{background:#f8fafc}td.student{text-align:left}td.final{background:#fff8dc}" +
      ".note{font-size:13px;color:#64748b;margin-top:16px}</style></head><body><main>" +
      "<section class=\"hero\"><h1>" + esc(bareme.name) + "</h1><p><b>" + esc(group.name) + "</b></p>" +
      "<p>" + esc(session.label || "") + " · " + esc(statusText || "") + "</p>" +
      "<p>" + students.length + " élève(s) · " + graded + " note(s) /20 complète(s) · " + esc(summary(bareme)) + "</p></section>" +
      "<div class=\"table-wrap\"><table><thead>" + sheetHead(bareme) + "</thead><tbody>" + sheetRows(students, bareme) + "</tbody></table></div>" +
      "<p class=\"note\">Ce fichier est à la fois une archive lisible et une sauvegarde réimportable dans DemiFond Scan CCF.</p>" +
      "<script id=\"demifond-archive-data\" type=\"application/json\">" + dataJson + "<\/script>" +
      "</main></body></html>";
  }

  /* =========================
     INSTALLATION
  ========================= */

  function refreshViews() {
    renderTableIfNeeded();
    renderResultsIfNeeded();
    installPrintButton();
  }

  function afterChange() {
    if (typeof render === "function") render();
    refreshViews();
  }

  window.scoreCustom = scoreCustom;
  window.renderCustomView = refreshViews;
  window.DFCustomBareme = {
    templates,
    createTemplate,
    editTemplate,
    editSessionBareme,
    applyToExercise,
    typeFor,
    summary,
    buildArchiveReport
  };

  function installRenderHooks() {
    if (typeof window.render !== "function" || window.render.__customBaremeView) return;
    const original = window.render;
    const wrapped = function() {
      original();
      refreshViews();
    };
    wrapped.__customBaremeView = true;
    window.render = wrapped;
    wrapped();
  }

  function install() {
    templates();
    installBridge();
    installRenderHooks();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
})();
