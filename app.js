/* Customer Book – plain JS + Supabase */
(function () {
  const CFG = window.APP_CONFIG || {};
  const STATUSES = ["New", "Interested", "Follow-up", "Paid", "Lost"];
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let sb = null;
  window.CUSTOMER_BOOK_DIAGNOSTICS = function () {
    return {
      configLoaded: !!window.APP_CONFIG,
      supabaseSdkLoaded: !!(window.supabase && typeof window.supabase.createClient === "function"),
      urlPresent: !!CFG.SUPABASE_URL,
      keyPresent: !!CFG.SUPABASE_ANON_KEY,
      keyPrefix: CFG.SUPABASE_ANON_KEY ? CFG.SUPABASE_ANON_KEY.slice(0, 15) : null,
      initialized: !!sb,
      error: configError || null
    };
  };
  let customers = [];
  let templates = [];

  /* ---------- helpers ---------- */
  const digits = (s) => String(s || "").replace(/\D/g, "");
  const phoneKey = (s) => digits(s).slice(-10);
  const todayStr = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local
  const getCC = () => localStorage.getItem("cb_cc") || CFG.DEFAULT_COUNTRY_CODE || "91";

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add("hidden"), 2800);
  }

  function dayDiff(iso) {
    const a = new Date(iso); a.setHours(0, 0, 0, 0);
    const b = new Date(); b.setHours(0, 0, 0, 0);
    return Math.round((b - a) / 86400000);
  }
  function lastContactedText(c) {
    if (!c.last_contacted_at) return "Not contacted yet";
    const verb = c.last_contact_type === "whatsapp" ? "WhatsApped" : c.last_contact_type === "call" ? "Called" : "Updated";
    const d = dayDiff(c.last_contacted_at);
    if (d <= 0) return `${verb} today`;
    if (d === 1) return `${verb} yesterday`;
    return `${verb} ${d} days ago`;
  }
  function fmtDate(d) {
    if (!d) return "";
    const [y, m, day] = d.split("-");
    return `${day}/${m}/${y}`;
  }
  function parseTags(s) {
    return [...new Set(String(s || "").split(",").map((x) => x.trim()).filter(Boolean))];
  }
  function waNumber(phone) {
    let d = digits(phone);
    if (d.length === 10) return getCC() + d;
    if (d.startsWith("00")) return d.slice(2);
    if (d.startsWith("0")) return getCC() + d.slice(1);
    return d;
  }

  /* ---------- Supabase configuration / login ---------- */
  function getSupabaseConfigError() {
    if (!window.APP_CONFIG) {
      return "config.js did not load. Make sure config.js is in the same folder as index.html and that its filename is exactly config.js.";
    }
    if (!CFG.SUPABASE_URL || typeof CFG.SUPABASE_URL !== "string") {
      return "SUPABASE_URL is missing in config.js.";
    }
    try {
      const u = new URL(CFG.SUPABASE_URL);
      if (u.protocol !== "https:" || !u.hostname.endsWith(".supabase.co")) {
        return "SUPABASE_URL must be your HTTPS Supabase project URL.";
      }
    } catch (_) {
      return "SUPABASE_URL is not a valid URL. Check config.js.";
    }
    if (!CFG.SUPABASE_ANON_KEY || typeof CFG.SUPABASE_ANON_KEY !== "string") {
      return "SUPABASE_ANON_KEY (publishable key) is missing in config.js.";
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      return "Supabase JavaScript SDK did not load. Check your internet connection, CDN access, and browser console.";
    }
    return "";
  }

  let configError = getSupabaseConfigError();
  if (!configError) {
    try {
      sb = window.supabase.createClient(CFG.SUPABASE_URL.trim(), CFG.SUPABASE_ANON_KEY.trim());
    } catch (err) {
      configError = "Supabase client could not initialize: " + (err?.message || String(err));
      console.error(configError, err);
    }
  } else {
    console.error("Customer Book setup:", configError);
  }
  function showApp() {
    $("#login-view").classList.add("hidden");
    $("#app-view").classList.remove("hidden");
    init();
  }
  function showLogin() {
    $("#app-view").classList.add("hidden");
    $("#login-view").classList.remove("hidden");
  }
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#login-error");
    if (!sb) { err.textContent = configError || "Supabase client is unavailable. Check config.js and the browser console."; return; }
    let u = $("#login-user").value.trim().toLowerCase();
    if (!u.includes("@")) u += "@" + (CFG.LOGIN_EMAIL_DOMAIN || "customerbook.app");
    err.textContent = "";
    try {
      const { error } = await sb.auth.signInWithPassword({ email: u, password: $("#login-pass").value });
      if (error) {
        err.textContent = /invalid login|invalid credentials/i.test(error.message) ? "Wrong username or password" : error.message;
        return;
      }
      showApp();
    } catch (err) {
      console.error("Login request failed:", err);
      err.textContent = "Could not contact Supabase. Check your internet connection and project URL.";
    }
  });
  $("#logout").addEventListener("click", async () => {
    if (sb) await sb.auth.signOut();
    location.reload();
  });

  /* ---------- tabs ---------- */
  document.querySelectorAll(".tab").forEach((b) =>
    b.addEventListener("click", () => switchTab(b.dataset.tab))
  );
  function switchTab(name) {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    ["customers", "add", "settings"].forEach((t) => $("#tab-" + t).classList.toggle("hidden", t !== name));
    window.scrollTo(0, 0);
  }

  /* ---------- modal ---------- */
  function openModal(html) {
    $("#modal-body").innerHTML = html;
    $("#modal").classList.remove("hidden");
  }
  function closeModal() {
    $("#modal").classList.add("hidden");
    $("#modal-body").innerHTML = "";
  }
  $("#modal-x").addEventListener("click", closeModal);
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

  /* ---------- init / data ---------- */
  let inited = false;
  async function init() {
    if (inited) return;
    inited = true;

    $("#a-status").innerHTML = STATUSES.map((s) => `<option>${s}</option>`).join("");
    $("#f-status").innerHTML = `<option value="">All status</option>` + STATUSES.map((s) => `<option>${s}</option>`).join("");
    $("#cc").value = getCC();

    if (!sb) {
      $("#setup-banner").textContent = configError || "Supabase is not initialized. Check config.js and the browser console.";
      $("#setup-banner").classList.remove("hidden");
      return;
    }
    await loadAll();
  }

  async function loadAll() {
    const [c, t] = await Promise.all([
      fetchAllCustomers(),
      sb.from("templates").select("*").order("created_at", { ascending: true }),
    ]);
    if (c.error) { toast("Could not load customers: " + c.error.message); return; }
    customers = c.data || [];
    templates = (t.data) || [];
    renderAll();
  }

  async function fetchAllCustomers() {
    // page through results so lists over 1000 rows still load
    let all = [], from = 0;
    for (;;) {
      const { data, error } = await sb.from("customers").select("*").order("created_at", { ascending: false }).range(from, from + 999);
      if (error) return { error };
      all = all.concat(data);
      if (data.length < 1000) break;
      from += 1000;
    }
    return { data: all };
  }

  function renderAll() {
    renderTagFilter();
    renderDue();
    renderList();
    renderTemplates();
  }

  /* ---------- add customer ---------- */
  function findByPhone(p, exceptId) {
    const k = phoneKey(p);
    if (k.length < 10) return null;
    return customers.find((c) => c.phone_key === k && c.id !== exceptId) || null;
  }

  $("#a-phone").addEventListener("input", () => {
    const box = $("#dup-msg");
    const hit = findByPhone($("#a-phone").value);
    if (hit) {
      box.innerHTML = `⚠️ <b>Customer data exists</b> – ${esc(hit.name)} (${esc(hit.phone)}). <a href="#" id="dup-open">View / edit</a>`;
      box.classList.remove("hidden");
      $("#dup-open").onclick = (e) => { e.preventDefault(); editCustomer(hit.id); };
    } else {
      box.classList.add("hidden");
    }
  });

  $("#add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!sb) return toast("Configure Supabase first (config.js)");
    const phone = $("#a-phone").value.trim();
    if (phoneKey(phone).length < 10) return toast("Enter a valid 10-digit number");
    if (findByPhone(phone)) return toast("Customer data exists");
    const row = {
      name: $("#a-name").value.trim(),
      phone,
      phone_key: phoneKey(phone),
      info: $("#a-info").value.trim(),
      status: $("#a-status").value,
      tags: parseTags($("#a-tags").value),
    };
    const { data, error } = await sb.from("customers").insert(row).select().single();
    if (error) {
      return toast(error.code === "23505" ? "Customer data exists" : "Error: " + error.message);
    }
    customers.unshift(data);
    e.target.reset();
    $("#dup-msg").classList.add("hidden");
    renderAll();
    toast("Customer saved");
    switchTab("customers");
  });

  /* ---------- list / filters ---------- */
  ["search", "f-status", "f-tag", "sort"].forEach((id) => {
    $("#" + id).addEventListener(id === "search" ? "input" : "change", renderList);
  });

  function renderTagFilter() {
    const cur = $("#f-tag").value;
    const tags = [...new Set(customers.flatMap((c) => c.tags || []))].sort((a, b) => a.localeCompare(b));
    $("#f-tag").innerHTML = `<option value="">All tags</option>` + tags.map((t) => `<option ${t === cur ? "selected" : ""}>${esc(t)}</option>`).join("");
  }

  function cardHTML(c, compact) {
    const fu = c.followup_date ? `<span class="fu">📅 Call again ${fmtDate(c.followup_date)}</span>` : "";
    return `
    <div class="cust ${compact ? "compact" : ""}" data-id="${c.id}">
      <div class="cust-head">
        <div>
          <div class="cust-name">${esc(c.name)}</div>
          <div class="cust-phone">${esc(c.phone)}</div>
        </div>
        <span class="badge s-${esc(c.status)}">${esc(c.status)}</span>
      </div>
      ${!compact && c.info ? `<div class="cust-info">${esc(c.info)}</div>` : ""}
      <div class="meta">
        <span>🕒 ${lastContactedText(c)}</span>
        ${fu}
        ${(c.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
      </div>
      <div class="actions">
        <button class="btn call sm" data-act="call">📞 Call</button>
        <button class="btn wa sm" data-act="wa">💬 WhatsApp</button>
        <button class="btn sm" data-act="remark">📝 Remarks</button>
        ${compact ? "" : `<button class="btn sm" data-act="edit">✏️ Edit</button><button class="btn sm danger" data-act="del">🗑</button>`}
      </div>
    </div>`;
  }

  function renderList() {
    const q = $("#search").value.trim().toLowerCase();
    const st = $("#f-status").value;
    const tg = $("#f-tag").value;
    const sort = $("#sort").value;
    let rows = customers.filter((c) => {
      if (st && c.status !== st) return false;
      if (tg && !(c.tags || []).includes(tg)) return false;
      if (q) {
        const hay = (c.name + " " + c.phone + " " + (c.info || "") + " " + (c.tags || []).join(" ")).toLowerCase();
        if (!hay.includes(q) && !(digits(q) && digits(c.phone).includes(digits(q)))) return false;
      }
      return true;
    });

    if (sort === "az") rows.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "last") rows.sort((a, b) => (new Date(b.last_contacted_at || 0)) - (new Date(a.last_contacted_at || 0)));
    else if (sort === "stale") {
      const cutoff = Date.now() - 30 * 86400000;
      rows = rows.filter((c) => !c.last_contacted_at || new Date(c.last_contacted_at).getTime() < cutoff);
      rows.sort((a, b) => (new Date(a.last_contacted_at || 0)) - (new Date(b.last_contacted_at || 0)));
    } else rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    $("#count-line").textContent = `${rows.length} of ${customers.length} customers`;
    $("#list").innerHTML = rows.length ? rows.map((c) => cardHTML(c, false)).join("") : `<div class="card muted">No customers found.</div>`;
  }

  function renderDue() {
    const t = todayStr();
    const due = customers.filter((c) => c.followup_date && c.followup_date <= t).sort((a, b) => a.followup_date.localeCompare(b.followup_date));
    $("#due-box").classList.toggle("hidden", !due.length);
    $("#due-count").textContent = due.length;
    $("#due-list").innerHTML = `<div class="list">${due.map((c) => cardHTML(c, true)).join("")}</div>`;
  }

  // one click handler for both lists
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const card = btn.closest(".cust");
    if (!card) return;
    const c = customers.find((x) => x.id === card.dataset.id);
    if (!c) return;
    const act = btn.dataset.act;
    if (act === "call") doCall(c);
    else if (act === "wa") doWhatsApp(c);
    else if (act === "remark") showHistory(c.id);
    else if (act === "edit") editCustomer(c.id);
    else if (act === "del") deleteCustomer(c);
  });

  /* ---------- call / whatsapp ---------- */
  function doCall(c) {
    window.location.href = "tel:" + c.phone.replace(/[^\d+]/g, "");
    setTimeout(() => openRemarkModal(c.id, "call"), 700);
  }

  function doWhatsApp(c) {
    const list = templates.map((t, i) => `<label class="choice" data-i="${i}"><input type="radio" name="tpl" hidden> ${esc(t.title)}</label>`).join("");
    openModal(`
      <h2>WhatsApp ${esc(c.name)}</h2>
      ${templates.length ? `<p class="muted small">Pick a template (optional)</p>${list}` : `<p class="muted small">No templates yet – add them in Settings.</p>`}
      <label>Message<textarea id="wa-msg" rows="4" placeholder="Type a message (optional)"></textarea></label>
      <p></p>
      <button class="btn wa" id="wa-go" style="width:100%">Open WhatsApp</button>`);
    document.querySelectorAll("#modal-body .choice").forEach((el) =>
      el.addEventListener("click", () => {
        document.querySelectorAll("#modal-body .choice").forEach((x) => x.classList.remove("sel"));
        el.classList.add("sel");
        $("#wa-msg").value = templates[el.dataset.i].body.replace(/\{name\}/gi, c.name);
      })
    );
    $("#wa-go").addEventListener("click", () => {
      const msg = $("#wa-msg").value.trim();
      const url = `https://wa.me/${waNumber(c.phone)}` + (msg ? `?text=${encodeURIComponent(msg)}` : "");
      window.open(url, "_blank");
      openRemarkModal(c.id, "whatsapp");
    });
  }

  /* ---------- remarks ---------- */
  function openRemarkModal(id, type) {
    const c = customers.find((x) => x.id === id);
    if (!c) return;
    const label = type === "call" ? "Call" : type === "whatsapp" ? "WhatsApp" : "Note";
    openModal(`
      <h2>${label} remark – ${esc(c.name)}</h2>
      <form id="rm-form" class="form">
        <label>Remark<textarea id="rm-text" rows="3" placeholder="What was discussed?" autofocus></textarea></label>
        <div class="row">
          <label>Call again on<input id="rm-date" type="date" min="${todayStr()}" value="${c.followup_date && c.followup_date >= todayStr() ? c.followup_date : ""}"></label>
          <label>Status<select id="rm-status">${STATUSES.map((s) => `<option ${s === c.status ? "selected" : ""}>${s}</option>`).join("")}</select></label>
        </div>
        <div class="row">
          <button class="btn primary" type="submit">Save remark</button>
          <button class="btn" type="button" id="rm-skip">Skip</button>
        </div>
      </form>`);
    $("#rm-skip").onclick = async () => {
      // still record that contact happened
      if (type !== "note") await saveRemark(c, type, "", c.followup_date, c.status, true);
      closeModal();
    };
    $("#rm-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      await saveRemark(c, type, $("#rm-text").value.trim(), $("#rm-date").value || null, $("#rm-status").value, false);
      closeModal();
    });
  }

  async function saveRemark(c, type, text, date, status, quiet) {
    const now = new Date().toISOString();
    const { error } = await sb.from("remarks").insert({ customer_id: c.id, text, contact_type: type, followup_date: date });
    if (error && !quiet) return toast("Error: " + error.message);
    const patch = { followup_date: date, status, last_contacted_at: now, last_contact_type: type };
    const { error: e2 } = await sb.from("customers").update(patch).eq("id", c.id);
    if (e2) return toast("Error: " + e2.message);
    Object.assign(c, patch);
    renderAll();
    if (!quiet) toast("Remark saved");
  }

  async function showHistory(id) {
    const c = customers.find((x) => x.id === id);
    openModal(`<h2>${esc(c.name)}</h2><p class="muted">Loading…</p>`);
    const { data, error } = await sb.from("remarks").select("*").eq("customer_id", id).order("created_at", { ascending: false });
    if (error) return toast("Error: " + error.message);
    const icon = { call: "📞", whatsapp: "💬", note: "📝" };
    $("#modal-body").innerHTML = `
      <h2>${esc(c.name)} – remarks</h2>
      <button class="btn primary sm" id="h-add">+ Add remark</button>
      <div style="margin-top:10px">
      ${data.length ? data.map((r) => `
        <div class="hist">
          <div class="small muted">${icon[r.contact_type] || "📝"} ${new Date(r.created_at).toLocaleString()}${r.followup_date ? ` · call again ${fmtDate(r.followup_date)}` : ""}</div>
          <div>${r.text ? esc(r.text) : '<span class="muted">(no remark)</span>'}</div>
        </div>`).join("") : '<p class="muted">No remarks yet.</p>'}
      </div>`;
    $("#h-add").onclick = () => openRemarkModal(id, "note");
  }

  /* ---------- edit / delete ---------- */
  function editCustomer(id) {
    const c = customers.find((x) => x.id === id);
    if (!c) return;
    openModal(`
      <h2>Edit customer</h2>
      <form id="e-form" class="form">
        <label>Name<input id="e-name" required value="${esc(c.name)}"></label>
        <label>Contact number<input id="e-phone" required inputmode="tel" value="${esc(c.phone)}"></label>
        <div id="e-dup" class="dup hidden"></div>
        <label>Info<textarea id="e-info" rows="3">${esc(c.info)}</textarea></label>
        <div class="row">
          <label>Status<select id="e-status">${STATUSES.map((s) => `<option ${s === c.status ? "selected" : ""}>${s}</option>`).join("")}</select></label>
          <label>Tags<input id="e-tags" value="${esc((c.tags || []).join(", "))}"></label>
        </div>
        <label>Call again on<input id="e-date" type="date" value="${c.followup_date || ""}"></label>
        <button class="btn primary" type="submit">Save changes</button>
      </form>`);
    $("#e-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const phone = $("#e-phone").value.trim();
      if (phoneKey(phone).length < 10) return toast("Enter a valid 10-digit number");
      const hit = findByPhone(phone, c.id);
      if (hit) {
        $("#e-dup").innerHTML = `⚠️ <b>Customer data exists</b> for ${esc(hit.name)}`;
        $("#e-dup").classList.remove("hidden");
        return;
      }
      const patch = {
        name: $("#e-name").value.trim(),
        phone,
        phone_key: phoneKey(phone),
        info: $("#e-info").value.trim(),
        status: $("#e-status").value,
        tags: parseTags($("#e-tags").value),
        followup_date: $("#e-date").value || null,
      };
      const { error } = await sb.from("customers").update(patch).eq("id", c.id);
      if (error) return toast(error.code === "23505" ? "Customer data exists" : "Error: " + error.message);
      Object.assign(c, patch);
      renderAll();
      closeModal();
      toast("Customer updated");
    });
  }

  async function deleteCustomer(c) {
    if (!confirm(`Delete ${c.name}? All their remarks will be deleted too.`)) return;
    const { error } = await sb.from("customers").delete().eq("id", c.id);
    if (error) return toast("Error: " + error.message);
    customers = customers.filter((x) => x.id !== c.id);
    renderAll();
    toast("Deleted");
  }

  /* ---------- templates ---------- */
  function renderTemplates() {
    $("#tpl-list").innerHTML = templates.length
      ? templates.map((t) => `
        <div class="tpl-item" data-id="${t.id}">
          <b>${esc(t.title)}</b>
          <pre>${esc(t.body)}</pre>
          <button class="btn sm" data-t="edit">Edit</button>
          <button class="btn sm danger" data-t="del">Delete</button>
        </div>`).join("")
      : `<p class="muted small">No templates yet.</p>`;
  }
  $("#tpl-list").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-t]");
    if (!b) return;
    const t = templates.find((x) => x.id === b.closest(".tpl-item").dataset.id);
    if (b.dataset.t === "edit") {
      $("#t-id").value = t.id; $("#t-title").value = t.title; $("#t-body").value = t.body;
      $("#t-save").textContent = "Update template";
      $("#t-title").focus();
    } else if (confirm("Delete this template?")) {
      const { error } = await sb.from("templates").delete().eq("id", t.id);
      if (error) return toast("Error: " + error.message);
      templates = templates.filter((x) => x.id !== t.id);
      renderTemplates();
    }
  });
  function clearTplForm() {
    $("#t-id").value = ""; $("#t-title").value = ""; $("#t-body").value = "";
    $("#t-save").textContent = "Add template";
  }
  $("#t-cancel").addEventListener("click", clearTplForm);
  $("#tpl-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!sb) return toast("Configure Supabase first (config.js)");
    const row = { title: $("#t-title").value.trim(), body: $("#t-body").value.trim() };
    const id = $("#t-id").value;
    if (id) {
      const { error } = await sb.from("templates").update(row).eq("id", id);
      if (error) return toast("Error: " + error.message);
      Object.assign(templates.find((x) => x.id === id), row);
    } else {
      const { data, error } = await sb.from("templates").insert(row).select().single();
      if (error) return toast("Error: " + error.message);
      templates.push(data);
    }
    clearTplForm();
    renderTemplates();
    toast("Template saved");
  });

  $("#cc-save").addEventListener("click", () => {
    const v = digits($("#cc").value);
    if (!v) return toast("Enter a country code");
    localStorage.setItem("cb_cc", v);
    toast("Saved");
  });

  /* ---------- export / import ---------- */
  async function exportRows() {
    const { data: rem } = await sb.from("remarks").select("customer_id,text,created_at").order("created_at", { ascending: false }).range(0, 9999);
    const last = {};
    (rem || []).forEach((r) => { if (!(r.customer_id in last) && r.text) last[r.customer_id] = r.text; });
    return customers.map((c) => ({
      Name: c.name,
      Phone: c.phone,
      Info: c.info || "",
      Status: c.status,
      Tags: (c.tags || []).join(", "),
      "Call Again On": c.followup_date || "",
      "Last Contacted": c.last_contacted_at ? new Date(c.last_contacted_at).toLocaleString() : "",
      "Last Remark": last[c.id] || "",
      Added: new Date(c.created_at).toLocaleString(),
    }));
  }
  async function doExport(type) {
    if (!sb) return toast("Configure Supabase first");
    if (!customers.length) return toast("Nothing to export");
    const ws = XLSX.utils.json_to_sheet(await exportRows());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Customers");
    XLSX.writeFile(wb, `customers-${todayStr()}.${type}`, { bookType: type });
  }
  $("#exp-xlsx").addEventListener("click", () => doExport("xlsx"));
  $("#exp-csv").addEventListener("click", () => doExport("csv"));

  $("#imp-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file || !sb) return;
    const out = $("#imp-result");
    out.textContent = "Reading file…";
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const pick = (r, names) => {
        for (const k of Object.keys(r)) if (names.includes(k.trim().toLowerCase())) return String(r[k]).trim();
        return "";
      };
      const seen = new Set(customers.map((c) => c.phone_key));
      const toAdd = [];
      let skipped = 0, invalid = 0;
      rows.forEach((r) => {
        const phone = pick(r, ["phone", "contact", "contact no", "contact no.", "contact number", "mobile", "mobile no", "number", "phone number"]);
        const name = pick(r, ["name", "customer", "customer name", "full name"]) || "Unnamed";
        const key = phoneKey(phone);
        if (key.length < 10) { invalid++; return; }
        if (seen.has(key)) { skipped++; return; }
        seen.add(key);
        let status = pick(r, ["status"]);
        if (!STATUSES.includes(status)) status = "New";
        toAdd.push({
          name, phone, phone_key: key,
          info: pick(r, ["info", "notes", "note", "details", "remark", "remarks"]),
          status,
          tags: parseTags(pick(r, ["tags", "tag"])),
        });
      });
      for (let i = 0; i < toAdd.length; i += 200) {
        const { error } = await sb.from("customers").insert(toAdd.slice(i, i + 200));
        if (error) { out.textContent = "Import stopped: " + error.message; await loadAll(); return; }
      }
      await loadAll();
      out.textContent = `Imported ${toAdd.length}. Skipped ${skipped} already in book, ${invalid} without a valid number.`;
    } catch (err) {
      out.textContent = "Could not read that file: " + err.message;
    }
  });

  /* ---------- start ---------- */
  (async () => {
    if (!sb) {
      showLogin();
      $("#login-error").textContent = configError || "Supabase is not initialized. Check config.js and the browser console.";
      return;
    }
    const { data } = await sb.auth.getSession();
    if (data.session) showApp(); else showLogin();
    // if the session ends (signed out elsewhere / expired), go back to the login page
    sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") location.reload(); });
  })();
})();