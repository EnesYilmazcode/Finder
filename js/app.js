import { fetchTerms, defaultTerm, ApiError } from "./api.js";

const els = {
  term: document.querySelector("#term"),
  status: document.querySelector("#status"),
};

function setStatus(message, kind = "info") {
  els.status.textContent = message ?? "";
  els.status.dataset.kind = kind;
  els.status.hidden = !message;
}

async function init() {
  setStatus("Loading terms...");
  els.term.disabled = true;

  try {
    const terms = await fetchTerms();
    if (!terms.length) {
      setStatus("Ohio State is not listing any searchable terms right now.", "error");
      return;
    }

    els.term.replaceChildren(
      ...terms.map((t) => {
        const option = document.createElement("option");
        option.value = t.code;
        option.textContent = t.name;
        return option;
      })
    );
    els.term.value = defaultTerm(terms).code;
    els.term.disabled = false;
    setStatus(null);
  } catch (error) {
    setStatus(
      error instanceof ApiError ? error.message : "Something went wrong loading terms.",
      "error"
    );
    if (!(error instanceof ApiError)) console.error(error);
  }
}

init();
