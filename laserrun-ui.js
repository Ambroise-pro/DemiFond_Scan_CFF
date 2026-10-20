(() => {
  "use strict";

  /*
   * Laser Run : QR Chrono Carnet
   * {"nom":"Prénom Nom","tempsTotal":"00:09:12","tempsTir":"01:07.3","efficacite":"68.2%"}
   *
   * Note /20 = performance /6 (temps de course, filles / garçons)
   *          + efficacité au tir /6 (% de réussite)
   *          + observateur /2 + respect du geste /3 + échauffement /3
   */
  const DEFAULT_BAREME = {
    girls: [
      ["5:00",6],["8:10",6],["8:20",5.75],["8:30",5.5],["8:40",5.25],
      ["8:50",5],["9:00",4.75],["9:10",4.5],["9:20",4.25],["9:30",4],
      ["9:40",3.75],["9:50",3.5],["10:00",3.25],["10:10",3],["10:20",2.75],
      ["10:30",2.5],["10:40",2.25],["10:50",2],["11:00",1.75],["11:10",1.5],
      ["11:20",1.25],["11:30",1],["11:40",0.75],["11:50",0.5],["15:00",0]
    ],
    boys: [
      ["0:50",6],["7:30",6],["7:40",5.75],["7:50",5.5],["8:00",5.25],
      ["8:10",5],["8:20",4.75],["8:30",4.5],["8:40",4.25],["8:50",4],
      ["9:00",3.75],["9:10",3.5],["9:20",3.25],["9:30",3],["9:40",2.75],
      ["9:50",2.5],["10:00",2.25],["10:10",2],["10:20",1.75],["10:30",1.5],
      ["10:40",1.25],["10:50",1],["11:00",0.75],["11:10",0.5],["15:20",0]
    ],
    shooting: [
      [15,0],[19,.25],[22,.5],[25,.5],[28,1],[31,1.25],[34,1.5],[37,1.75],
      [40,2],[43,2.25],[46,2.5],[49,2.75],[52,3],[55,3.5],[60,4],[65,4.5],
      [70,5],[75,5.5],[80,5.75],[85,6]
    ]
  };

  const DEFAULT_LABELS = {
    obs: "Rôle partenaire-observateur",
    geste: "Respect du geste",
    warmup: "Échauffement"
  };

  // Critères saisis par le professeur : champ élève, clé d'intitulé, barème.
  const CRITERIA = [
    ["laserRunObs","obs",2],
    ["laserRunGeste","geste",3],
    ["laserRunWarmup","warmup",3]
  ];

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function current() {
    return typeof activeSession === "function" ? activeSession() : null;
  }

  function isLaserRunSession(session) {
    return session?.type === "laserrun";
  }

  function isPayload(data) {
    return !!data &&
      typeof data === "object" &&
      (
        data.type === "DF_LASERRUN_RESULT" ||
        ("tempsTotal" in data && "efficacite" in data)
      );
  }

  // Accepte "00:09:12", "01:07.3", "9:12", "9min 12s", "9m 12s", "12s" ou des secondes.
  function parseDuration(text) {
    const raw = String(text ?? "").trim().toLowerCase().replace(",", ".");
    if (!raw) return null;
    let m = raw.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
    if (m) return (Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000;
    m = raw.match(/^(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+(?:\.\d+)?)\s*s?)?$/);
    if (m && (m[1] != null || m[2] != null)) {
      return (Number(m[1] || 0) * 60 + Number(m[2] || 0)) * 1000;
    }
    return null;
  }

  function timeLabel(ms) {
    if (ms == null || !Number.isFinite(Number(ms))) return "—";
    const total = Math.round(Number(ms) / 1000);
    return Math.floor(total / 60) + "min " + String(total % 60).padStart(2,"0") + "s";
  }

  function inputTime(ms) {
    if (ms == null || !Number.isFinite(Number(ms))) return "";
    const total = Math.round(Number(ms) / 1000);
    return Math.floor(total / 60) + ":" + String(total % 60).padStart(2,"0");
  }

  function fmtPts(v) {
    return String(Math.round(Number(v || 0) * 100) / 100).replace(".", ",");
  }

  function fmtPct(v) {
    return v == null ? "—" : String(Math.round(Number(v) * 10) / 10).replace(".", ",") + " %";
  }

  function normName(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function settings() {
    db.settings = db.settings || {};
    db.settings.laserRunBareme =
      db.settings.laserRunBareme || clone(DEFAULT_BAREME);

    // Comme pour le 3 × 500 : chaque évaluation garde son propre barème.
    const session = current();
    if (isLaserRunSession(session)) {
      if (!session.laserRunBareme) {
        session.laserRunBareme = clone(db.settings.laserRunBareme);
      }
      return session.laserRunBareme;
    }

    return db.settings.laserRunBareme;
  }

  function criterionLabels() {
    const session = current();
    const labels = {};
    for (const key of Object.keys(DEFAULT_LABELS)) {
      labels[key] =
        String(session?.laserRunLabels?.[key] || "").trim() ||
        DEFAULT_LABELS[key];
    }
    return labels;
  }

  function scoreOptions(max, value) {
    let html = '<option value="">—</option>';
    for (let v = 0; v <= max + 0.001; v += 0.25) {
      const rounded = Math.round(v * 100) / 100;
      const selected =
        value != null && value !== "" && Number(value) === rounded
          ? " selected"
          : "";
      html += '<option value="' + rounded + '"' + selected + '>' + fmtPts(rounded) + '</option>';
    }
    return html;
  }

  function sexOptions(sex) {
    return [["","—"],["F","F"],["M","G"]]
      .map(([value,label]) =>
        '<option value="' + value + '"' + (sex === value ? " selected" : "") + '>' + label + '</option>'
      )
      .join("");
  }

  // Même lecture que RECHERCHE / LOOKUP du tableur : dernier seuil atteint.
  function performancePoints(rows, ms) {
    const thresholds = rows
      .map(([t,p]) => ({ms:parseDuration(t), p:Number(p)}))
      .filter(x => x.ms != null)
      .sort((a,b) => a.ms - b.ms);

    if (!thresholds.length) return 0;
    if (ms < thresholds[0].ms) return thresholds[0].p;

    let points = 0;
    for (const row of thresholds) {
      if (ms >= row.ms) points = row.p;
      else break;
    }
    return points;
  }

  function tableScore(rows, value) {
    if (value == null) return 0;
    const sorted = rows.slice().sort((a,b) => Number(b[0]) - Number(a[0]));
    for (const [limit,pts] of sorted) {
      if (value >= Number(limit)) return Number(pts);
    }
    return 0;
  }

  function criterionValue(student, field) {
    const raw = student[field];
    return raw === "" || raw == null ? null : Number(raw);
  }

  function scoreLaserRun(student) {
    const run = student?.laserRun;
    if (!run || !Number(run.totalMs) || run.efficiency == null) return null;

    const b = settings();
    const sexKnown = student.sex === "F" || student.sex === "M";
    const perf = sexKnown
      ? performancePoints(student.sex === "M" ? b.boys : b.girls, Number(run.totalMs))
      : null;
    const effPts = tableScore(b.shooting, Number(run.efficiency));

    const [obs, geste, warmup] =
      CRITERIA.map(([field]) => criterionValue(student, field));

    const total20 =
      perf == null || obs == null || geste == null || warmup == null
        ? null
        : Math.min(20, perf + effPts + obs + geste + warmup);

    return {
      perf,
      effPts,
      afl1: perf == null ? null : perf + effPts,
      obs,
      geste,
      warmup,
      total20,
      totalMs: Number(run.totalMs),
      shootMs: run.shootMs == null ? null : Number(run.shootMs),
      efficiency: Number(run.efficiency)
    };
  }

  /* =========================
     BARÈME
  ========================= */

  // Le code 57 est un verrou d'interface, pas une authentification serveur.
  function requestBaremeAccess(globalOnly) {
    const code = window.prompt("Code d'acces au bareme Laser Run :");
    if (code === null) return;
    if (code.trim() !== "57") {
      window.alert("Code incorrect.");
      return;
    }
    openBaremeDialog(globalOnly);
  }

  function ensureHomeBaremeButton() {
    const home = document.getElementById("home");
    if (!home || document.getElementById("homeBaremeLaserRunBtn")) return;
    const grid = home.querySelector(".scan-home-grid");
    if (!grid) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "homeBaremeLaserRunBtn";
    button.className = "scan-home-card";
    button.innerHTML = '<span class="home-card-step">PARAMETRER LES EVALUATIONS</span><strong>⚙️ Barème Laser Run</strong><span>Consulter et modifier les références temps / tir. Accès par code.</span><b>Ouvrir le barème →</b>';
    button.addEventListener("click", () => requestBaremeAccess(true));
    grid.appendChild(button);
  }

  function ensureBaremeButton() {
    const manager = document.getElementById("groupSessionManager");
    const existing = document.getElementById("laserRunBaremeBtn");

    if (!isLaserRunSession(current())) {
      existing?.remove();
      return;
    }
    if (!manager || existing) return;

    const actions = manager.querySelector(".session-manager-actions");
    if (!actions) return;

    const button = document.createElement("button");
    button.id = "laserRunBaremeBtn";
    button.type = "button";
    button.textContent = "⚙️ Barème Laser Run";
    button.onclick = () => requestBaremeAccess(false);
    actions.appendChild(button);
  }

  function openBaremeDialog(globalOnly = false) {
    let d = document.getElementById("laserRunBaremeDialog");
    if (!d) {
      d = document.createElement("dialog");
      d.id = "laserRunBaremeDialog";
      document.body.appendChild(d);
    }

    const b = globalOnly
      ? (db.settings.laserRunBareme || clone(DEFAULT_BAREME))
      : settings();
    const labels = criterionLabels();
    const rowsToText = rows => rows.map(r => r.join(" = ")).join("\n");

    d.innerHTML = `
      <div style="min-width:min(920px,94vw);max-height:86vh;overflow:auto;padding:8px">
        <h2>Barème Laser Run</h2>
        <p>Modifie les valeurs puis enregistre. Les notes sont immédiatement recalculées.</p>

        <div style="margin:14px 0;padding:12px;border:1px solid #d8e1f3;border-radius:12px">
          <b>Intitulés des critères complémentaires</b>
          <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:8px">
            <label>Critère /2
              <input id="lrLabelObs" style="width:100%" value="${esc(labels.obs)}">
            </label>
            <label>Critère /3
              <input id="lrLabelGeste" style="width:100%" value="${esc(labels.geste)}">
            </label>
            <label>Critère /3
              <input id="lrLabelWarmup" style="width:100%" value="${esc(labels.warmup)}">
            </label>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px">
          <label><b>Performance filles /6</b><textarea id="lrGirls" style="width:100%;min-height:320px">${rowsToText(b.girls)}</textarea></label>
          <label><b>Performance garçons /6</b><textarea id="lrBoys" style="width:100%;min-height:320px">${rowsToText(b.boys)}</textarea></label>
          <label><b>Efficacité tir /6</b><textarea id="lrShooting" style="width:100%;min-height:320px">${rowsToText(b.shooting)}</textarea></label>
        </div>

        <p style="font-size:13px;color:#64748b">Format d'une ligne : <b>temps = points</b> pour la performance (ex. 9:10 = 4.5), <b>% de réussite = points</b> pour le tir. L'élève obtient les points du dernier seuil atteint.</p>

        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
          <button id="lrReset" type="button">Réinitialiser</button>
          <button id="lrCancel" type="button">Annuler</button>
          <button id="lrSave" type="button">Enregistrer</button>
        </div>
      </div>
    `;

    const parseRows = (text, timeMode) =>
      String(text || "")
        .split(/\n+/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
          const parts = line.split("=").map(x => x.trim());
          if (parts.length !== 2) return null;
          const key = timeMode ? parts[0] : Number(parts[0].replace(",", "."));
          const pts = Number(parts[1].replace(",", "."));
          if (timeMode ? parseDuration(key) == null : !Number.isFinite(key)) return null;
          if (!Number.isFinite(pts)) return null;
          return [key, pts];
        });

    const session = !globalOnly ? current() : null;

    d.querySelector("#lrCancel").onclick = () => d.close();

    d.querySelector("#lrReset").onclick = () => {
      if (!confirm("Réinitialiser le barème Laser Run ?")) return;
      db.settings.laserRunBareme = clone(DEFAULT_BAREME);
      if (isLaserRunSession(session)) {
        session.laserRunBareme = clone(DEFAULT_BAREME);
        delete session.laserRunLabels;
      }
      save();
      d.close();
      refreshViews();
      toast?.("Barème Laser Run réinitialisé");
    };

    d.querySelector("#lrSave").onclick = () => {
      const next = {
        girls: parseRows(d.querySelector("#lrGirls").value, true),
        boys: parseRows(d.querySelector("#lrBoys").value, true),
        shooting: parseRows(d.querySelector("#lrShooting").value, false)
      };

      if (Object.values(next).some(rows => !rows.length || rows.includes(null))) {
        alert("Le barème contient une zone vide ou une ligne mal formatée.");
        return;
      }

      db.settings.laserRunBareme = clone(next);
      if (isLaserRunSession(session)) {
        session.laserRunBareme = clone(next);
        session.laserRunLabels = {
          obs: d.querySelector("#lrLabelObs").value.trim() || DEFAULT_LABELS.obs,
          geste: d.querySelector("#lrLabelGeste").value.trim() || DEFAULT_LABELS.geste,
          warmup: d.querySelector("#lrLabelWarmup").value.trim() || DEFAULT_LABELS.warmup
        };
      }

      save();
      d.close();
      refreshViews();
      toast?.("Barème Laser Run enregistré");
    };

    d.showModal();
  }

  /* =========================
     SCAN
  ========================= */

  function validatePayload(data) {
    const name = String(data.nom || "").trim().replace(/\s+/g, " ");
    if (!name) {
      return {ok:false, message:"QR Laser Run : nom de l'élève manquant."};
    }

    const totalMs = parseDuration(data.tempsTotal);
    if (!totalMs || totalMs <= 0) {
      return {ok:false, message:"QR Laser Run : temps total invalide."};
    }

    const shootMs =
      data.tempsTir == null || data.tempsTir === ""
        ? null
        : parseDuration(data.tempsTir);
    if (data.tempsTir != null && data.tempsTir !== "" && shootMs == null) {
      return {ok:false, message:"QR Laser Run : temps de tir invalide."};
    }

    // Le chronomètre envoie "68.2%" ; une valeur numérique reste acceptée.
    const efficiency = Number(String(data.efficacite ?? "").replace(",", ".").replace("%", "").trim());
    if (data.efficacite === "" || data.efficacite == null || !Number.isFinite(efficiency) || efficiency < 0 || efficiency > 100) {
      return {ok:false, message:"QR Laser Run : efficacité au tir invalide (0 à 100 %)."};
    }

    const sexRaw = String(data.sexe ?? data.sex ?? "").trim().toUpperCase();
    const sex =
      ["F","FILLE"].includes(sexRaw) ? "F" :
      ["M","G","GARCON","GARÇON"].includes(sexRaw) ? "M" :
      "";

    return {
      ok:true,
      data:{
        name,
        sex,
        classroom: String(data.classe ?? data.classroom ?? "").trim().toUpperCase(),
        totalMs,
        shootMs,
        efficiency
      }
    };
  }

  // Le QR ne porte que le nom : on le rapproche des élèves déjà connus.
  function sameName(student, key) {
    const first = normName(student.first);
    const last = normName(student.last);
    return (
      key === normName(first + " " + last) ||
      key === normName(last + " " + first)
    );
  }

  function splitName(name) {
    const parts = name.split(" ");
    return parts.length > 1
      ? {first: parts[0], last: parts.slice(1).join(" ")}
      : {first: "", last: name};
  }

  function handleLaserRun(raw) {
    const checked = validatePayload(raw);
    if (!checked.ok) {
      scanError(checked.message);
      return true;
    }
    const data = checked.data;

    let group = activeGroup();
    let session = activeSession();
    if (!group || !session) {
      if (!prepareScanner()) return true;
      group = activeGroup();
      session = activeSession();
    }

    if (session.status === "locked") {
      scanError("Évaluation verrouillée : scan refusé.");
      return true;
    }

    // Ne jamais mélanger le Laser Run avec un autre protocole.
    if (session.type && session.type !== "laserrun") {
      scanError("Cette évaluation est configurée pour un autre protocole. Crée une évaluation séparée pour le Laser Run.");
      return true;
    }

    const key = normName(data.name);
    let student = session.students.find(s => sameName(s, key));
    const known = (group.students || []).find(s => sameName(s, key));

    if (student?.laserRun) {
      const run = student.laserRun;
      const sameQR =
        run.totalMs === data.totalMs &&
        run.shootMs === data.shootMs &&
        run.efficiency === data.efficiency;

      if (sameQR) {
        scanError(String(student.last || "").toUpperCase() + " " + String(student.first || "") + " · QR déjà scanné.");
        return true;
      }

      if (!confirm(
        String(student.last || "").toUpperCase() + " " + String(student.first || "") +
        "\n\nUn résultat Laser Run est déjà enregistré.\n\nRemplacer ce relevé ?"
      )) {
        return true;
      }
    }

    if (!student) {
      const identity = known
        ? {
            studentId: known.externalId || known.id,
            last: known.last,
            first: known.first,
            classroom: known.classroom,
            sex: known.sex
          }
        : {
            studentId: "LR-" + key.replace(/ /g, "-"),
            ...splitName(data.name),
            classroom: data.classroom,
            sex: data.sex
          };
      student = buildStudent(identity);
      session.students.push(student);
    }

    if (data.sex) student.sex = data.sex;
    if (data.classroom) student.classroom = data.classroom;

    student.laserRun = {
      name: data.name,
      totalMs: data.totalMs,
      shootMs: data.shootMs,
      efficiency: data.efficiency,
      scannedAt: Date.now()
    };

    session.type = "laserrun";
    updateMasterStudent(group, student);

    db.history.unshift({
      at: Date.now(),
      groupId: group.id,
      sessionId: session.id,
      studentId: student.id,
      type: "laserrun"
    });

    save();
    beep();

    const message = document.getElementById("scanMessage");
    if (message) {
      message.className = "scan-ok";
      message.innerHTML =
        "✓ " + esc(String(student.last || "").toUpperCase()) + " " + esc(student.first || "") +
        "<br>" + (student.classroom ? esc(student.classroom) + " · " : "") +
        "Laser Run · " + timeLabel(data.totalMs) + " · tir " + fmtPct(data.efficiency) +
        (student.sex ? "" : "<br>Sexe inconnu : à compléter dans la fiche pour la note de performance.");
    }

    toast?.("Laser Run enregistré");
    if (typeof render === "function") render();
    return true;
  }

  function installBridge() {
    if (typeof window.handleQR !== "function" || window.handleQR.__laserRunBridge) return;
    const original = window.handleQR;

    const wrapped = function(raw) {
      let data = raw;
      try {
        if (typeof raw === "string") data = JSON.parse(raw);
      } catch {}

      if (isPayload(data)) {
        handleLaserRun(data);
        return;
      }

      return original(raw);
    };

    wrapped.__laserRunBridge = true;
    window.handleQR = wrapped;
  }

  /* =========================
     CORRECTION
  ========================= */

  function findSessionStudent(studentId) {
    return current()?.students?.find(s => String(s.id) === String(studentId)) || null;
  }

  function openEditor(studentId) {
    const student = findSessionStudent(studentId);
    if (!student) {
      toast?.("Élève introuvable dans cette évaluation.");
      return;
    }

    let d = document.getElementById("laserRunEditDialog");
    if (!d) {
      d = document.createElement("dialog");
      d.id = "laserRunEditDialog";
      document.body.appendChild(d);
    }

    const run = student.laserRun || {};
    const labels = criterionLabels();

    d.innerHTML = `
      <div style="min-width:min(820px,94vw);max-height:88vh;overflow:auto;padding:8px">
        <h2>Corriger — ${esc(String(student.last||"").toUpperCase())} ${esc(student.first||"")}</h2>

        <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px;padding:12px;border-radius:14px;background:#f3f6fb">
          <label>Nom<input id="lrELast" value="${esc(student.last||"")}"></label>
          <label>Prénom<input id="lrEFirst" value="${esc(student.first||"")}"></label>
          <label>Classe<input id="lrEClass" value="${esc(student.classroom||"")}"></label>
          <label>Sexe
            <select id="lrESex">${sexOptions(student.sex)}</select>
          </label>
        </div>

        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px">
          <label>Temps total<input id="lrETotal" value="${inputTime(run.totalMs)}" placeholder="9:12"></label>
          <label>Temps de tir<input id="lrEShoot" value="${inputTime(run.shootMs)}" placeholder="1:07"></label>
          <label>Réussite au tir (%)<input id="lrEEff" type="number" min="0" max="100" step="0.1" value="${run.efficiency ?? ""}"></label>
        </div>

        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:16px">
          ${CRITERIA.map(([field,key,max]) => `
            <label>${esc(labels[key])} /${max}
              <select id="lrE_${field}">${scoreOptions(max, student[field])}</select>
            </label>
          `).join("")}
        </div>

        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
          <button id="lrECancel" type="button">Annuler</button>
          <button id="lrESave" type="button">Enregistrer et recalculer</button>
        </div>
      </div>
    `;

    d.querySelector("#lrECancel").onclick = () => d.close();

    d.querySelector("#lrESave").onclick = () => {
      const last = d.querySelector("#lrELast").value.trim();
      const first = d.querySelector("#lrEFirst").value.trim();
      if (!last) {
        alert("Le nom est obligatoire.");
        return;
      }

      const totalMs = parseDuration(d.querySelector("#lrETotal").value);
      if (!totalMs) {
        alert("Vérifie le temps total.");
        return;
      }

      const shootText = d.querySelector("#lrEShoot").value.trim();
      const shootMs = shootText ? parseDuration(shootText) : null;
      if (shootText && shootMs == null) {
        alert("Vérifie le temps de tir.");
        return;
      }

      const efficiency = Number(d.querySelector("#lrEEff").value);
      if (d.querySelector("#lrEEff").value === "" || !Number.isFinite(efficiency) || efficiency < 0 || efficiency > 100) {
        alert("La réussite au tir doit être comprise entre 0 et 100 %.");
        return;
      }

      student.last = last;
      student.first = first;
      student.classroom = d.querySelector("#lrEClass").value.trim().toUpperCase();
      student.sex = d.querySelector("#lrESex").value;
      student.laserRun = {...run, totalMs, shootMs, efficiency};
      for (const [field] of CRITERIA) {
        const value = d.querySelector("#lrE_" + field).value;
        student[field] = value === "" ? "" : Number(value);
      }

      save();
      d.close();
      if (typeof render === "function") render();
      toast?.("Laser Run recalculé");
    };

    d.showModal();
  }

  /* =========================
     VUES
  ========================= */

  function bindInlineFields(root) {
    root.querySelectorAll(".laserrun-inline").forEach(select => {
      select.onchange = () => {
        const student = findSessionStudent(select.dataset.studentId);
        if (!student) return;
        const field = select.dataset.field;
        student[field] =
          field === "sex" || select.value === ""
            ? select.value
            : Number(select.value);
        save();
        if (typeof render === "function") render();
      };
    });
  }

  function renderTableIfNeeded() {
    if (!isLaserRunSession(current())) return;

    const body = document.getElementById("students");
    if (!body) return;

    body.innerHTML = visibleStudents().map(student => {
      const sc = scoreLaserRun(student);
      return `
        <tr data-student-id="${esc(student.id)}">
          <td><b>${esc(String(student.last||"").toUpperCase())} ${esc(student.first||"")}</b></td>
          <td>${esc(student.classroom||"")}</td>
          <td>${esc(student.sex||"—")}</td>
          <td>${sc ? timeLabel(sc.totalMs) : "—"}</td>
          <td>${sc ? timeLabel(sc.shootMs) : "—"}</td>
          <td>${sc ? fmtPct(sc.efficiency) : "—"}</td>
          <td><b>${sc?.afl1 == null ? "—" : fmtPts(sc.afl1) + "/12"}</b></td>
          <td>
            <button type="button" class="student-edit" data-id="${esc(student.id)}">✏️ Corriger</button>
            <button type="button" class="student-delete-hold" data-student-id="${esc(student.id)}" title="Maintenir pour supprimer">Supprimer</button>
          </td>
        </tr>
      `;
    }).join("");

    body.querySelectorAll(".student-edit").forEach(button => {
      button.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        openEditor(button.dataset.id);
      };
    });

    const head = document.querySelector(".student-list-card thead tr");
    if (head) {
      head.innerHTML =
        "<th>Élève</th><th>Classe</th><th>Sexe</th><th>Temps total</th><th>Temps tir</th><th>Réussite tir</th><th>Perf + tir</th><th>Action</th>";
    }
  }

  function renderResultsIfNeeded() {
    if (!isLaserRunSession(current())) return;

    const body = document.getElementById("resultRows");
    if (!body) return;

    const labels = criterionLabels();

    body.innerHTML = visibleStudents().map(student => {
      const sc = scoreLaserRun(student);
      return `
        <tr>
          <td><b>${esc(String(student.last||"").toUpperCase())} ${esc(student.first||"")}</b></td>
          <td>
            <select class="laserrun-inline" data-student-id="${esc(student.id)}" data-field="sex" aria-label="Sexe">
              ${sexOptions(student.sex)}
            </select>
          </td>
          <td>${sc ? timeLabel(sc.totalMs) : "—"}</td>
          <td><b>${sc?.perf == null ? "—" : fmtPts(sc.perf)}</b></td>
          <td>${sc ? timeLabel(sc.shootMs) : "—"}</td>
          <td>${sc ? fmtPct(sc.efficiency) : "—"}</td>
          <td><b>${sc ? fmtPts(sc.effPts) : "—"}</b></td>
          ${CRITERIA.map(([field,key,max]) => `
            <td>
              <select class="laserrun-inline" data-student-id="${esc(student.id)}" data-field="${field}" aria-label="${esc(labels[key])} sur ${max}">
                ${scoreOptions(max, student[field])}
              </select>
            </td>
          `).join("")}
          <td><b>${sc?.total20 == null ? "—" : fmtPts(sc.total20)}</b></td>
        </tr>
      `;
    }).join("");

    bindInlineFields(body);

    const head = document.querySelector("#results .table thead tr");
    if (head) {
      head.innerHTML =
        "<th>Nom / prénom</th>" +
        "<th>Sexe</th>" +
        "<th>Temps total</th>" +
        "<th>Performance /6</th>" +
        "<th>Temps tir</th>" +
        "<th>Réussite tir</th>" +
        "<th>Efficacité /6</th>" +
        CRITERIA.map(([,key,max]) => "<th>" + esc(labels[key]) + " /" + max + "</th>").join("") +
        "<th>Note /20</th>";
    }

    const title = document.querySelector("#results h2");
    if (title) title.textContent = "Fiche d’évaluation · Laser Run";

    document.getElementById("ccfViewTabs")?.classList.add("hidden");
    document.getElementById("ccfQuickView")?.classList.add("hidden");
  }

  /* =========================
     PDF / ARCHIVE
  ========================= */

  function sheetRows(students, labels) {
    return students.map(student => {
      const sc = scoreLaserRun(student);
      return `
        <tr>
          <td class="student"><b>${esc(String(student.last||"").toUpperCase())} ${esc(student.first||"")}</b></td>
          <td>${esc(student.classroom||"")}</td>
          <td>${esc(student.sex||"—")}</td>
          <td>${sc ? timeLabel(sc.totalMs) : "—"}</td>
          <td>${sc?.perf == null ? "—" : fmtPts(sc.perf)}</td>
          <td>${sc ? timeLabel(sc.shootMs) : "—"}</td>
          <td>${sc ? fmtPct(sc.efficiency) : "—"}</td>
          <td>${sc ? fmtPts(sc.effPts) : "—"}</td>
          ${CRITERIA.map(([,key]) => `<td>${sc?.[key] == null ? "—" : fmtPts(sc[key])}</td>`).join("")}
          <td class="final"><b>${sc?.total20 == null ? "—" : fmtPts(sc.total20)}</b></td>
        </tr>`;
    }).join("");
  }

  function sheetHead(labels) {
    return "<tr>" +
      "<th>Élève</th><th>Classe</th><th>Sexe</th>" +
      "<th>Temps total</th><th>Perf /6</th><th>Temps tir</th><th>Réussite tir</th><th>Efficacité /6</th>" +
      CRITERIA.map(([,key,max]) => "<th>" + esc(labels[key]) + "<br>/" + max + "</th>").join("") +
      "<th>Note<br>/20</th>" +
    "</tr>";
  }

  function printPDF() {
    const group = activeGroup();
    const session = current();

    if (!isLaserRunSession(session)) {
      toast?.("Ouvre une évaluation Laser Run avant d’imprimer.");
      return;
    }

    const students = visibleStudents();
    const labels = criterionLabels();

    const w = window.open("", "_blank");
    if (!w) {
      alert("Autorise les fenêtres surgissantes pour générer le PDF.");
      return;
    }

    w.document.write(`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Laser Run</title>
<style>
  @page{size:A4 landscape;margin:8mm}
  body{font-family:Arial,sans-serif;color:#111;margin:0;font-size:11px}
  h1{font-size:20px;margin:0 0 4px}
  .meta{margin:0 0 10px;color:#444}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #aaa;padding:4px 3px;text-align:center;white-space:nowrap}
  th{background:#e9eef7;font-size:10px}
  td:first-child,th:first-child{text-align:left}
  .final{background:#fff3c7}
</style>
</head>
<body>
<h1>Fiche d’évaluation · Laser Run</h1>
<p class="meta">
  <b>${esc(group?.name||"")}</b>
  · ${esc(session.label||"")}
  · ${students.length} élève${students.length>1?"s":""}
</p>
<table>
<thead>${sheetHead(labels)}</thead>
<tbody>${sheetRows(students, labels)}</tbody>
</table>
<script>window.onload=()=>window.print();<\/script>
</body>
</html>`);
    w.document.close();
  }

  function installPrintButton() {
    const button = document.getElementById("exportPdfCCF");
    if (!button || !isLaserRunSession(current())) return;

    button.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      printPDF();
    };
  }

  // Utilisé par archive-ui.js avec l'évaluation active positionnée sur la session archivée.
  function buildArchiveReport(group, session, payload, statusText) {
    const students = (session.students || []).slice().sort((a,b) =>
      String(a.last||"").localeCompare(String(b.last||""), "fr") ||
      String(a.first||"").localeCompare(String(b.first||""), "fr")
    );
    const labels = criterionLabels();
    const scores = students.map(scoreLaserRun);
    const complete = scores.filter(Boolean).length;
    const graded = scores.filter(sc => sc?.total20 != null).length;
    const classes = [...new Set(students.map(s => s.classroom).filter(Boolean))].sort();

    const dataJson = JSON.stringify(payload).replace(/</g, "\\u003c");

    return "<!doctype html>" +
      "<html lang=\"fr\"><head><meta charset=\"utf-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
      "<title>Archive Laser Run — " + esc(group.name) + "</title>" +
      "<style>" +
        ":root{font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;color:#172033}" +
        "*{box-sizing:border-box}body{margin:0;padding:24px;background:#eef2f7}main{max-width:1500px;margin:auto}" +
        ".hero{background:#172554;color:#fff;padding:24px;border-radius:20px;margin-bottom:16px}" +
        ".hero h1{margin:0 0 8px;font-size:28px}.hero p{margin:4px 0;color:#dbeafe}" +
        ".cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}" +
        ".card{background:#fff;border-radius:16px;padding:16px;border:1px solid #d8e0ea}.card b{display:block;font-size:26px;margin-top:5px}" +
        ".table-wrap{overflow:auto;background:#fff;border-radius:16px;border:1px solid #d8e0ea}" +
        "table{border-collapse:collapse;width:100%;min-width:1100px;font-size:13px}" +
        "th,td{padding:9px;border-bottom:1px solid #e5e7eb;text-align:center;white-space:nowrap}th{background:#f8fafc}" +
        "td.student{text-align:left}td.final{font-size:15px;background:#fff8dc}" +
        ".note{font-size:13px;color:#64748b;margin-top:16px}" +
        "@media(max-width:900px){body{padding:12px}.cards{grid-template-columns:repeat(2,1fr)}}" +
      "</style></head><body><main>" +
        "<section class=\"hero\">" +
          "<h1>Laser Run</h1>" +
          "<p><b>" + esc(group.name) + "</b></p>" +
          "<p>" + esc(session.label || "") + " · " + esc(statusText || "") + "</p>" +
          "<p>Archive créée le " + esc(new Date().toLocaleString("fr-FR")) + "</p>" +
        "</section>" +
        "<section class=\"cards\">" +
          "<div class=\"card\">Élèves<b>" + students.length + "</b></div>" +
          "<div class=\"card\">Laser Run scannés<b>" + complete + "</b></div>" +
          "<div class=\"card\">Notes /20 complètes<b>" + graded + "</b></div>" +
          "<div class=\"card\">Classes<b>" + esc(classes.join(" · ") || "—") + "</b></div>" +
        "</section>" +
        "<h2>Vue synthétique</h2>" +
        "<div class=\"table-wrap\"><table><thead>" + sheetHead(labels) + "</thead><tbody>" +
          sheetRows(students, labels) +
        "</tbody></table></div>" +
        "<p class=\"note\">Ce fichier est à la fois une archive lisible et une sauvegarde réimportable dans DemiFond Scan CCF.</p>" +
        "<script id=\"demifond-archive-data\" type=\"application/json\">" + dataJson + "<\/script>" +
      "</main></body></html>";
  }

  /* =========================
     INSTALLATION
  ========================= */

  function refreshViews() {
    ensureHomeBaremeButton();
    ensureBaremeButton();
    renderTableIfNeeded();
    renderResultsIfNeeded();
    installPrintButton();
  }

  window.scoreLaserRun = scoreLaserRun;
  window.renderLaserRunView = refreshViews;
  window.DFLaserRun = {
    isPayload,
    openBareme: () => requestBaremeAccess(false),
    buildArchiveReport
  };

  function installRenderHooks() {
    if (typeof window.render !== "function" || window.render.__laserRunView) return;
    const original = window.render;

    const wrapped = function() {
      original();
      refreshViews();
    };

    wrapped.__laserRunView = true;
    window.render = wrapped;
    wrapped();
  }

  function install() {
    settings();
    installBridge();
    installRenderHooks();
    refreshViews();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
})();
