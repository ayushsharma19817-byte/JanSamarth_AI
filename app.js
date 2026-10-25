const form = document.querySelector("#profile-form");
const submitButton = document.querySelector("#submit-btn");
const resultsSection = document.querySelector("#results-section");
const resultsContainer = document.querySelector("#results");
const resultCount = document.querySelector("#result-count");
const notice = document.querySelector("#notice");
const voiceButton = document.querySelector("#voice-btn");
const voiceStatus = document.querySelector("#voice-status");

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch (_) {}
  return "https://www.myscheme.gov.in/";
}

function makeList(items, className) {
  const ul = document.createElement("ul");
  ul.className = className;
  (items || []).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    ul.appendChild(li);
  });
  if (!items || items.length === 0) {
    const li = document.createElement("li");
    li.textContent = "Check the official source for the current list.";
    ul.appendChild(li);
  }
  return ul;
}

function renderCard(scheme) {
  const card = document.createElement("article");
  card.className = "scheme-card";

  const top = document.createElement("div");
  top.className = "card-top";
  const heading = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = scheme.name;
  const department = document.createElement("div");
  department.className = "dept";
  department.textContent = scheme.department || "Department not specified";
  heading.append(title, department);

  const badge = document.createElement("span");
  badge.className = "match-badge " + (scheme.matched_sample_rules ? "good" : "caution");
  badge.textContent = scheme.status;
  top.append(heading, badge);

  const summary = document.createElement("p");
  summary.textContent = scheme.summary;

  const checksTitle = document.createElement("div");
  checksTitle.className = "card-subtitle";
  checksTitle.textContent = "Sample rule checks";
  const checks = document.createElement("ul");
  checks.className = "check-list";
  (scheme.checks || []).forEach((check) => {
    const li = document.createElement("li");
    li.className = check.passed ? "pass" : "fail";
    li.textContent = (check.passed ? "✓ " : "• ") + check.label + ": " + check.detail;
    checks.appendChild(li);
  });
  if (!scheme.checks || scheme.checks.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No explicit rule was configured for this field.";
    checks.appendChild(li);
  }

  const docsTitle = document.createElement("div");
  docsTitle.className = "card-subtitle";
  docsTitle.textContent = "Document checklist (verify officially)";
  const docs = makeList(scheme.documents, "doc-list");

  const verified = document.createElement("div");
  verified.className = "verified";
  verified.textContent = "Source status: " + (scheme.last_verified || "Not verified");

  const actions = document.createElement("div");
  actions.className = "card-actions";
  const official = document.createElement("a");
  official.href = safeExternalUrl(scheme.official_source || scheme.application_url);
  official.target = "_blank";
  official.rel = "noopener noreferrer";
  official.textContent = "Official information ↗";
  const apply = document.createElement("a");
  apply.href = safeExternalUrl(scheme.application_url || scheme.official_source);
  apply.target = "_blank";
  apply.rel = "noopener noreferrer";
  apply.className = "outline";
  apply.textContent = "Explore portal ↗";
  actions.append(official, apply);

  const disclaimer = document.createElement("p");
  disclaimer.className = "verified";
  disclaimer.textContent = scheme.disclaimer || "Confirm all conditions with the official department.";

  card.append(top, summary, checksTitle, checks, docsTitle, docs, verified, actions, disclaimer);
  return card;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  submitButton.textContent = "Checking sample rules…";
  resultsContainer.replaceChildren();
  try {
    const data = Object.fromEntries(new FormData(form).entries());
    data.age = Number(data.age);
    data.annual_income = Number(data.annual_income);
    const response = await fetch("/api/check-eligibility", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(data)
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail ? JSON.stringify(payload.detail) : "The request could not be completed.");
    }
    resultCount.textContent = `${payload.count} records · ${payload.potential_matches} possible sample matches`;
    notice.textContent = payload.notice;
    payload.results.forEach((scheme) => resultsContainer.appendChild(renderCard(scheme)));
    resultsSection.hidden = false;
    resultsSection.scrollIntoView({behavior: "smooth", block: "start"});
  } catch (error) {
    notice.textContent = "Could not check schemes. Make sure the Python server is running. Details: " + error.message;
    resultsSection.hidden = false;
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Find matching schemes <span>→</span>';
  }
});

// Browser speech recognition is optional and browser-dependent. It fills the search box only.
voiceButton.addEventListener("click", () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    voiceStatus.textContent = "Speech recognition is not supported in this browser. Try a supported browser or type your search instead.";
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = "hi-IN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  voiceStatus.textContent = "Listening in Hindi… Say what kind of scheme you are looking for.";
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    form.elements.query.value = transcript;
    voiceStatus.textContent = "Captured: " + transcript + " — review it, then click Find matching schemes.";
  };
  recognition.onerror = (event) => {
    voiceStatus.textContent = "Voice input could not start (" + event.error + "). You can type your search instead.";
  };
  recognition.onend = () => {
    if (!voiceStatus.textContent.startsWith("Captured:") && !voiceStatus.textContent.startsWith("Voice input could not")) {
      voiceStatus.textContent = "Voice input ended. Review the search field before submitting.";
    }
  };
  recognition.start();
});

fetch("/api/health").then((r) => r.json()).then((data) => {
  if (data.status !== "ok") console.warn("JanSamarth API is not ready.");
}).catch(() => console.warn("API health check failed."));
